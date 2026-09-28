import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@storyworld/contracts/model";
import { initialWorld } from "@storyworld/contracts/simulation";
import { decodeOperation, decodeRoom, OLD_ROOM_MESSAGE } from "./room-decoding";

const event = (snapshot: unknown, revision = 0) => ({
  id: `room:${revision}`,
  revision,
  actor: "abc",
  summary: "The adventure begins",
  snapshot: JSON.stringify(snapshot),
});

// A world written by schema version 1, when entities had a `kind`.
const legacyWorld = {
  ...initialWorld("room"),
  schemaVersion: 1,
  entities: [
    {
      id: "nova",
      kind: "character",
      name: "Nova",
      bounds: { x: 150, y: 300, width: 80, height: 70 },
    },
  ],
  rules: [],
  goal: null,
};

describe("decodeRoom", () => {
  it("reads a current room, oldest event first", () => {
    const world = initialWorld("room");
    const room = decodeRoom({
      worldSchemaVersion: SCHEMA_VERSION,
      events: [event({ ...world, revision: 1 }, 1), event(world, 0)],
      scene: undefined,
    });
    expect(room.ok).toBe(true);
    if (room.ok) {
      expect(room.events.map((item) => item.revision)).toEqual([0, 1]);
      expect(room.events[0]!.state.entities[0]!.properties).toEqual(["moves"]);
    }
  });

  it("decodes each committed snapshot once, and again if it changes", () => {
    const world = initialWorld("cached-room");
    const rows = (snapshot: unknown) => ({
      worldSchemaVersion: SCHEMA_VERSION,
      events: [{ ...event(snapshot), id: "cached-room:0" }],
      scene: undefined,
    });
    const first = decodeRoom(rows(world));
    const second = decodeRoom(rows(world));
    if (!first.ok || !second.ok) throw new Error("expected a room");
    expect(second.events[0]!.state).toBe(first.events[0]!.state);
    const changed = decodeRoom(rows({ ...world, weather: "rain" }));
    if (!changed.ok) throw new Error("expected a room");
    expect(changed.events[0]!.state.weather).toBe("rain");
    // A cached ID never hides a snapshot that no longer parses.
    expect(decodeRoom(rows({ ...world, weather: "snow" })).ok).toBe(false);
  });

  it("refuses a room stamped with an older schema version kindly", () => {
    expect(
      decodeRoom({
        worldSchemaVersion: 1,
        events: [event(legacyWorld)],
        scene: undefined,
      }),
    ).toEqual({ ok: false, error: OLD_ROOM_MESSAGE });
    expect(OLD_ROOM_MESSAGE).toMatch(/older version of Storyworld/);
  });

  it("refuses old snapshots and scenes instead of throwing", () => {
    expect(
      decodeRoom({
        worldSchemaVersion: SCHEMA_VERSION,
        events: [event(legacyWorld)],
        scene: undefined,
      }).ok,
    ).toBe(false);
    expect(
      decodeRoom({
        worldSchemaVersion: SCHEMA_VERSION,
        events: [{ ...event(initialWorld("room")), snapshot: "{not json" }],
        scene: undefined,
      }).ok,
    ).toBe(false);
    expect(
      decodeRoom({
        worldSchemaVersion: SCHEMA_VERSION,
        events: [event(initialWorld("room"))],
        scene: JSON.stringify({ objects: [{ kind: "character" }] }),
      }).ok,
    ).toBe(false);
  });

  it("waits quietly while the world row has not arrived", () => {
    expect(
      decodeRoom({
        worldSchemaVersion: undefined,
        events: [],
        scene: undefined,
      }),
    ).toEqual({ ok: true, events: [], scene: undefined });
  });
});

describe("decodeOperation", () => {
  it("drops a stored proposal that no longer parses", () => {
    expect(
      decodeOperation(
        JSON.stringify({
          type: "CREATE_ENTITY",
          entity: {
            id: "b",
            kind: "bridge",
            name: "Bridge",
            bounds: { x: 1, y: 1, width: 5, height: 5 },
          },
        }),
      ),
    ).toBeUndefined();
    expect(decodeOperation("nope")).toBeUndefined();
    expect(
      decodeOperation(JSON.stringify({ type: "REMOVE_ENTITY", entityId: "b" })),
    ).toEqual({ type: "REMOVE_ENTITY", entityId: "b" });
  });
});
