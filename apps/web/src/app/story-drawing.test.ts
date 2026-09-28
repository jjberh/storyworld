import { describe, expect, it, vi } from "vitest";
import {
  entitySketchSchema,
  operationSchema,
  type InteractionResponse,
} from "@storyworld/contracts";
import type { WorldOperation } from "@storyworld/contracts/model";
import { FixtureWorldClient } from "@storyworld/world-fixtures";
import { InteractionError } from "../services/interaction-client";
import {
  NEEDS_JEV_NOTE,
  outcomeNote,
  resolveDrawingInteraction,
  SKETCH_BUDGET,
  sketchFromStrokes,
  strokesBounds,
  withSketch,
} from "./story-drawing";

const bridge: WorldOperation = {
  type: "CREATE_ENTITY",
  entity: {
    id: "bridge",
    role: "helper",
    name: "Bridge",
    description: "",
    properties: ["carries"],
    bounds: { x: 380, y: 320, width: 200, height: 40 },
  },
};

describe("sketches from strokes", () => {
  it("keeps integer points inside the page", () => {
    const sketch = sketchFromStrokes([[380.4, 330.6, 1200, -5, 500, 340]]);
    expect(sketch).toEqual({ strokes: [[380, 331, 1000, 0, 500, 340]] });
    expect(entitySketchSchema.safeParse(sketch).success).toBe(true);
  });

  it("thins long scribbles to fit the operation budget", () => {
    const long = Array.from({ length: 3000 }, (_, index) =>
      index % 2 === 0 ? 100 + ((index * 7) % 800) : 100 + ((index * 3) % 400),
    );
    const sketch = sketchFromStrokes([long, long])!;
    const size = sketch.strokes.reduce((total, line) => total + line.length, 0);
    expect(size).toBeLessThanOrEqual(SKETCH_BUDGET);
    expect(entitySketchSchema.safeParse(sketch).success).toBe(true);
    const operation = withSketch(bridge, sketch);
    expect(operationSchema.safeParse(operation).success).toBe(true);
    expect(JSON.stringify(operation).length).toBeLessThan(10_000);
  });

  it("turns a dot into a tiny line and ignores empty input", () => {
    expect(sketchFromStrokes([[10, 10]])).toEqual({
      strokes: [[10, 10, 10, 10]],
    });
    expect(sketchFromStrokes([])).toBeUndefined();
  });

  it("bounds every stroke with padding", () => {
    expect(
      strokesBounds([
        [400, 330, 450, 340],
        [500, 320, 560, 360],
      ]),
    ).toEqual({ x: 394, y: 314, width: 172, height: 52 });
  });

  it("attaches the sketch only to a created entity", () => {
    const sketch = { strokes: [[400, 330, 560, 340]] };
    expect(withSketch(bridge, sketch)).toMatchObject({
      entity: { sketch },
    });
    const goal: WorldOperation = {
      type: "SET_GOAL",
      characterId: "nova",
      targetId: "castle",
    };
    expect(withSketch(goal, sketch)).toBe(goal);
  });
});

describe("resolving a committed drawing", () => {
  const answer = (outcome: InteractionResponse["outcome"]) =>
    ({
      mode: "live",
      outcome,
      odds: 0.8,
      confidence: 0.9,
      actorId: "bridge",
      characterId: "nova",
      obstacleId: "river",
    }) satisfies InteractionResponse;

  it("commits Jev's outcome as RESOLVE_INTERACTION", async () => {
    const client = new FixtureWorldClient();
    await client.apply(bridge);
    const request = vi.fn(async () => answer("crosses"));
    const result = await resolveDrawingInteraction(client, "bridge", request);
    expect(result).toEqual({ kind: "resolved", outcome: "crosses" });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1 }),
      "bridge",
    );
    const world = client.getSnapshot().world!;
    expect(world.pathStatus).toBe("available");
    expect(world.interaction).toMatchObject({ outcome: "crosses", odds: 0.8 });
  });

  it("keeps the drawing without an outcome when Jev is not set up", async () => {
    const client = new FixtureWorldClient();
    await client.apply(bridge);
    const result = await resolveDrawingInteraction(
      client,
      "bridge",
      async () => {
        throw new InteractionError(
          "needs Jev",
          "PROVIDER_NOT_CONFIGURED",
          false,
        );
      },
    );
    expect(result).toEqual({ kind: "needs-jev" });
    const world = client.getSnapshot().world!;
    expect(world.entities.some((entity) => entity.id === "bridge")).toBe(true);
    expect(world.interaction).toBeNull();
    expect(world.pathStatus).toBe("blocked");
  });

  it("reports a provider failure kindly and never invents an outcome", async () => {
    const client = new FixtureWorldClient();
    await client.apply(bridge);
    const result = await resolveDrawingInteraction(
      client,
      "bridge",
      async () => {
        throw new InteractionError(
          "Jev is busy.",
          "PROVIDER_RATE_LIMITED",
          true,
        );
      },
    );
    expect(result).toEqual({ kind: "failed", message: "Jev is busy." });
    expect(client.getSnapshot().world!.interaction).toBeNull();
  });

  it("reports an outcome the world refuses instead of throwing", async () => {
    const client = new FixtureWorldClient();
    await client.apply(bridge);
    // A bridge cannot launch; the reducer refuses it.
    const result = await resolveDrawingInteraction(client, "bridge", async () =>
      answer("launched_across"),
    );
    expect(result.kind).toBe("failed");
    expect(client.getSnapshot().world!.interaction).toBeNull();
  });
});

describe("outcome notes", () => {
  it("keeps funny failures kind", () => {
    for (const outcome of ["almost", "splash", "blocked", "scared"] as const) {
      const note = outcomeNote(outcome, { drawing: "Boat", character: "Nova" });
      expect(note).not.toMatch(/wrong|fail|bad/i);
    }
    expect(
      outcomeNote("crosses", { drawing: "Bridge", character: "Nova" }),
    ).toBe("The bridge holds. Nova has a way through.");
    expect(NEEDS_JEV_NOTE).toMatch(/Jev/);
  });
});
