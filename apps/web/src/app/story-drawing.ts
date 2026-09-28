import {
  MAX_SKETCH_NUMBERS,
  type InteractionResponse,
} from "@storyworld/contracts";
import type {
  Bounds,
  EntitySketch,
  InteractionOutcome,
  WorldClient,
  WorldOperation,
  WorldState,
} from "@storyworld/contracts/model";
import {
  InteractionError,
  requestInteraction,
} from "../services/interaction-client";

// Drawing something new into a committed story: the stroke data a drawing
// keeps as its cutout, and the second step that asks Jev what happens once
// the drawing is committed. Both pages that accept drawings share this.

/** Numbers a sketch keeps, below the contract cap so the operation stays small. */
export const SKETCH_BUDGET = Math.min(1200, MAX_SKETCH_NUMBERS);

const clampX = (value: number) =>
  Math.min(1000, Math.max(0, Math.round(value)));
const clampY = (value: number) => Math.min(600, Math.max(0, Math.round(value)));

function pointsOf(stroke: readonly number[]) {
  const points: [number, number][] = [];
  for (let index = 0; index + 1 < stroke.length; index += 2)
    points.push([clampX(stroke[index]!), clampY(stroke[index + 1]!)]);
  return points;
}

/** Drops points closer than `spacing` to the last kept one, keeping both ends. */
function thin(points: [number, number][], spacing: number) {
  if (points.length <= 2) return points;
  const kept: [number, number][] = [points[0]!];
  for (const point of points.slice(1, -1)) {
    const last = kept.at(-1)!;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing)
      kept.push(point);
  }
  kept.push(points.at(-1)!);
  return kept;
}

/**
 * The child's strokes as a compact, contract-valid sketch: integer world
 * coordinates, thinned until they fit the budget. A single tap becomes a
 * tiny dot. Undefined when there is nothing to keep.
 */
export function sketchFromStrokes(
  strokes: readonly (readonly number[])[],
): EntitySketch | undefined {
  let lines = strokes
    .map(pointsOf)
    .filter((points) => points.length > 0)
    .map((points) => (points.length === 1 ? [points[0]!, points[0]!] : points))
    .slice(0, 40);
  if (lines.length === 0) return undefined;
  const size = () => lines.reduce((total, line) => total + line.length * 2, 0);
  for (
    let spacing = 3;
    size() > SKETCH_BUDGET && spacing < 2000;
    spacing *= 1.5
  )
    lines = lines.map((line) => thin(line, spacing));
  while (size() > SKETCH_BUDGET && lines.length > 1) lines = lines.slice(0, -1);
  return { strokes: lines.map((line) => line.flat()) };
}

/** The region the strokes cover, padded like a single drawn stroke. */
export function strokesBounds(strokes: readonly (readonly number[])[]): Bounds {
  const points = strokes.flatMap((stroke) => pointsOf(stroke));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.max(0, Math.min(...xs) - 6);
  const y = Math.max(0, Math.min(...ys) - 6);
  return {
    x,
    y,
    width: Math.min(1000 - x, Math.max(12, Math.max(...xs) - x + 6)),
    height: Math.min(600 - y, Math.max(12, Math.max(...ys) - y + 6)),
  };
}

/** A CREATE_ENTITY proposal carrying the child's own strokes as its cutout. */
export function withSketch(
  operation: WorldOperation,
  sketch: EntitySketch | undefined,
): WorldOperation {
  if (operation.type !== "CREATE_ENTITY" || !sketch) return operation;
  return { ...operation, entity: { ...operation.entity, sketch } };
}

export function interactionOperation(
  response: InteractionResponse,
): WorldOperation {
  return {
    type: "RESOLVE_INTERACTION",
    entityId: response.actorId,
    outcome: response.outcome,
    odds: response.odds,
    confidence: response.confidence,
    // The obstacle Jev judged; the reducer refuses a stale outcome.
    obstacleId: response.obstacleId,
  };
}

/** Resolves once the committed world holds `entityId`. */
export function waitForEntity(
  client: Pick<WorldClient, "getSnapshot" | "subscribe">,
  entityId: string,
  timeoutMs = 10_000,
): Promise<WorldState> {
  const committed = () => {
    const world = client.getSnapshot().world;
    return world?.entities.some((entity) => entity.id === entityId)
      ? world
      : undefined;
  };
  const now = committed();
  if (now) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("The drawing did not reach the world in time."));
    }, timeoutMs);
    const unsubscribe = client.subscribe(() => {
      const world = committed();
      if (!world) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(world);
    });
  });
}

export type InteractionResult =
  | { kind: "resolved"; outcome: InteractionOutcome }
  | { kind: "needs-jev" }
  | { kind: "failed"; message: string };

export const NEEDS_JEV_NOTE =
  "Your drawing joined the story! Deciding what it does needs Jev, which isn't set up here, so it simply stays in the picture.";

const FAILED_NOTE =
  "Your drawing is in the story. The world couldn't decide what happens this time.";

/**
 * After a drawing is committed, asks Jev what happens and commits that
 * outcome as RESOLVE_INTERACTION. Only a director calls this (guests
 * propose). It never throws: a missing key or a failure leaves the drawing
 * in the world with a kind explanation, and never invents an outcome.
 */
export async function resolveDrawingInteraction(
  client: Pick<WorldClient, "apply" | "getSnapshot" | "subscribe">,
  entityId: string,
  request: typeof requestInteraction = requestInteraction,
): Promise<InteractionResult> {
  let response: InteractionResponse;
  try {
    const world = await waitForEntity(client, entityId);
    // Each drawing is resolved once; a retry reports the committed outcome.
    const resolved = world.entities.find(
      (entity) => entity.id === entityId,
    )?.outcome;
    if (resolved) return { kind: "resolved", outcome: resolved };
    response = await request(world, entityId);
  } catch (error) {
    if (
      error instanceof InteractionError &&
      error.code === "PROVIDER_NOT_CONFIGURED"
    )
      return { kind: "needs-jev" };
    return {
      kind: "failed",
      message: error instanceof InteractionError ? error.message : FAILED_NOTE,
    };
  }
  try {
    await client.apply(interactionOperation(response));
  } catch {
    return {
      kind: "failed",
      message:
        "Your drawing is in the story. The world changed before its moment could play.",
    };
  }
  return { kind: "resolved", outcome: response.outcome };
}

/** A short, kind line about a committed outcome. Failures are never "wrong". */
export function outcomeNote(
  outcome: InteractionOutcome,
  names: { drawing: string; character: string },
) {
  const { drawing, character } = names;
  switch (outcome) {
    case "crosses":
      return `The ${drawing.toLowerCase()} holds. ${character} has a way through.`;
    case "flies_over":
      return `Whoosh! ${drawing} gets ${character} over the top.`;
    case "rides_across":
      return `${character} rides ${drawing} all the way across!`;
    case "launched_across":
      return `Boing! ${drawing} sends ${character} flying across.`;
    case "almost":
      return `So close! ${character} nearly made it. What else could you draw?`;
    case "splash":
      return `Splash! ${character} came up giggling. Try another idea!`;
    case "blocked":
      return `${drawing} is in the picture, but the way is still blocked. Try another idea!`;
    case "scared":
      return `Eek! ${drawing} gave ${character} a fright. Maybe draw a friend?`;
    case "sheltered":
      return `${character} is cozy and dry now.`;
    case "nothing_happens":
      return `${drawing} is part of the picture now.`;
  }
}
