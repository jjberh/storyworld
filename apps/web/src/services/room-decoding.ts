import {
  SCHEMA_VERSION,
  confirmedSceneSchema,
  operationSchema,
  worldStateSchema,
  type ConfirmedScene,
  type WorldOperation,
  type WorldState,
} from "@storyworld/contracts";

export const OLD_ROOM_MESSAGE =
  "This room was made with an older version of Storyworld, so it can't open here. Start a new story to keep playing.";

type RawEvent = {
  id: string;
  revision: number;
  actor: string;
  summary: string;
  snapshot: string;
};

export type DecodedRoom =
  | {
      ok: true;
      events: {
        id: string;
        revision: number;
        actor: string;
        summary: string;
        state: WorldState;
      }[];
      scene: ConfirmedScene | undefined;
    }
  | { ok: false; error: string };

/**
 * Decoded snapshots by event ID. An event's snapshot never changes once
 * committed, and every subscription update re-decodes the whole room, so
 * each snapshot (sketches included) is parsed and validated once. The text
 * is kept to check the ID still names the same snapshot.
 */
const decodedSnapshots = new Map<string, { text: string; state: WorldState }>();
const MAX_CACHED_SNAPSHOTS = 500;

function decodeSnapshot(id: string, text: string): WorldState | undefined {
  const cached = decodedSnapshots.get(id);
  if (cached?.text === text) return cached.state;
  const parsed = worldStateSchema.safeParse(parseJson(text));
  if (!parsed.success) return undefined;
  if (decodedSnapshots.size >= MAX_CACHED_SNAPSHOTS)
    decodedSnapshots.delete(decodedSnapshots.keys().next().value!);
  decodedSnapshots.set(id, { text, state: parsed.data });
  return parsed.data;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Checks a room's rows before the app trusts them. A room stamped with another
 * schema version, or whose snapshots or scene no longer match the contracts,
 * is refused with a kind message instead of crashing the renderer.
 */
export function decodeRoom(rows: {
  worldSchemaVersion: number | undefined;
  events: readonly RawEvent[];
  scene: string | undefined;
}): DecodedRoom {
  if (
    rows.worldSchemaVersion !== undefined &&
    rows.worldSchemaVersion !== SCHEMA_VERSION
  )
    return { ok: false, error: OLD_ROOM_MESSAGE };
  const events: Extract<DecodedRoom, { ok: true }>["events"] = [];
  for (const event of [...rows.events].sort(
    (a, b) => a.revision - b.revision,
  )) {
    const state = decodeSnapshot(event.id, event.snapshot);
    if (!state) return { ok: false, error: OLD_ROOM_MESSAGE };
    events.push({
      id: event.id,
      revision: event.revision,
      actor: event.actor,
      summary: event.summary,
      state,
    });
  }
  let scene: ConfirmedScene | undefined;
  if (rows.scene !== undefined) {
    const parsed = confirmedSceneSchema.safeParse(parseJson(rows.scene));
    if (!parsed.success) return { ok: false, error: OLD_ROOM_MESSAGE };
    scene = parsed.data;
  }
  return { ok: true, events, scene };
}

/** A stored proposal's operation, or undefined when it no longer parses. */
export function decodeOperation(text: string): WorldOperation | undefined {
  const parsed = operationSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : undefined;
}
