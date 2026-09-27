import { describe, expect, it } from "vitest";
import type { Entity, WorldState } from "@storyworld/contracts/model";
import type {
  StoryAction,
  StorySequence,
} from "@storyworld/contracts/story-beat";
import {
  BEAT_HOLD_MS,
  CELEBRATE_EXTRA_MS,
  REDUCED_MOTION_BEAT_HOLD_MS,
  beatHoldMs,
  beatMovement,
  logicalX,
  movementFor,
  pendingRevealId,
  restingRain,
} from "./story-playback";

const fox: Entity = {
  id: "fox",
  kind: "character",
  name: "Fox",
  bounds: { x: 100, y: 120, width: 200, height: 120 },
};
const river: Entity = {
  id: "river",
  kind: "river",
  name: "River",
  bounds: { x: 450, y: 30, width: 120, height: 540 },
};
const castle: Entity = {
  id: "castle",
  kind: "castle",
  name: "Castle",
  bounds: { x: 700, y: 120, width: 200, height: 120 },
};

function world(overrides: Partial<WorldState> = {}): WorldState {
  return {
    id: "world",
    revision: 1,
    schemaVersion: 1,
    entities: [fox, river, castle],
    rules: [],
    goal: { characterId: "fox", targetId: "castle" },
    pathStatus: "blocked",
    weather: "clear",
    ...overrides,
  };
}

function sequence(...actions: StoryAction[]): StorySequence {
  return {
    mode: "fixture",
    requestId: "request",
    sourceRevision: 1,
    sourceEventId: "event-1",
    beats: actions.map((action, index) => ({
      id: `beat-${index}`,
      narration: `Beat ${index}`,
      mood: "curious",
      action,
    })),
  };
}

describe("movementFor", () => {
  it("parks a blocked character on the near bank of the river", () => {
    const movement = movementFor(fox, castle, world(), undefined);
    expect(movement.placement).toBe("near-obstacle");
    // Right edge of the piece stops 14 units before the river.
    expect(fox.bounds.x + movement.offset.x + fox.bounds.width).toBe(
      river.bounds.x - 14,
    );
    // Vertical travel is clamped to 80 units toward the river's middle.
    expect(movement.offset.y).toBe(80);
  });

  it("parks on the far side when the character starts right of the river", () => {
    const eastFox = { ...fox, bounds: { ...fox.bounds, x: 650, y: 180 } };
    const movement = movementFor(
      eastFox,
      castle,
      world({ entities: [eastFox, river, castle] }),
      undefined,
    );
    expect(eastFox.bounds.x + movement.offset.x).toBe(
      river.bounds.x + river.bounds.width + 14,
    );
    expect(movement.offset.y).toBe(60);
  });

  it("uses the obstacle named by an upcoming blocked_by beat", () => {
    const pond: Entity = {
      ...river,
      id: "pond",
      bounds: { ...river.bounds, x: 350 },
    };
    const movement = movementFor(
      fox,
      castle,
      world({ entities: [fox, river, pond, castle], pathStatus: "available" }),
      { type: "blocked_by", entityId: "fox", obstacleId: "pond" },
    );
    expect(movement.placement).toBe("near-obstacle");
    expect(fox.bounds.x + movement.offset.x + fox.bounds.width).toBe(336);
  });

  it("stops beside the target when the route is open", () => {
    const movement = movementFor(
      fox,
      castle,
      world({ pathStatus: "available" }),
      undefined,
    );
    expect(movement.placement).toBe("target-side");
    // Right edge 24 units short of the castle, vertically centred on it.
    expect(fox.bounds.x + movement.offset.x + fox.bounds.width).toBe(
      castle.bounds.x - 24,
    );
    expect(movement.offset.y).toBe(0);
  });

  it("falls back to the target when a blocked world has no river", () => {
    const movement = movementFor(
      fox,
      castle,
      world({ entities: [fox, castle] }),
      undefined,
    );
    expect(movement.placement).toBe("target-side");
  });
});

describe("beatMovement", () => {
  it("moves toward the target, looking ahead to a blocked beat", () => {
    const moved = beatMovement(
      { type: "move_toward", entityId: "fox", targetId: "castle" },
      { type: "blocked_by", entityId: "fox", obstacleId: "river" },
      world({ pathStatus: "available" }),
    );
    expect(moved?.entityId).toBe("fox");
    expect(moved?.movement.placement).toBe("near-obstacle");
  });

  it("parks a blocked_by beat at its obstacle", () => {
    const moved = beatMovement(
      { type: "blocked_by", entityId: "fox", obstacleId: "river" },
      undefined,
      world(),
    );
    expect(moved?.movement.placement).toBe("near-obstacle");
  });

  it("ignores beats that do not move a piece or name missing pieces", () => {
    expect(
      beatMovement({ type: "focus", entityId: "fox" }, undefined, world()),
    ).toBeUndefined();
    expect(
      beatMovement(
        { type: "move_toward", entityId: "fox", targetId: "missing" },
        undefined,
        world(),
      ),
    ).toBeUndefined();
  });
});

describe("beat timing and resting state", () => {
  it("holds each beat, longer for a celebration, briefly under reduced motion", () => {
    expect(beatHoldMs({ type: "focus", entityId: "fox" }, false)).toBe(
      BEAT_HOLD_MS,
    );
    expect(beatHoldMs({ type: "celebrate", entityId: "fox" }, false)).toBe(
      BEAT_HOLD_MS + CELEBRATE_EXTRA_MS,
    );
    expect(beatHoldMs({ type: "celebrate", entityId: "fox" }, true)).toBe(
      REDUCED_MOTION_BEAT_HOLD_MS,
    );
  });

  it("shows committed rain unless the sequence presents the weather shift", () => {
    const rainy = world({ weather: "rain" });
    expect(restingRain(rainy, null)).toBe(true);
    expect(restingRain(world(), null)).toBe(false);
    expect(
      restingRain(rainy, sequence({ type: "weather_shift", weather: "rain" })),
    ).toBe(false);
  });

  it("hides a revealed piece until its reveal beat completes", () => {
    const reveal = sequence(
      { type: "focus", entityId: "fox" },
      { type: "reveal", entityId: "castle" },
    );
    expect(pendingRevealId(reveal, false, "")).toBe("castle");
    expect(pendingRevealId(reveal, false, "event-1")).toBeUndefined();
    expect(pendingRevealId(reveal, true, "")).toBeUndefined();
    expect(pendingRevealId(null, false, "")).toBeUndefined();
  });

  it("reports the logical left edge including the offset", () => {
    expect(logicalX(fox, undefined)).toBe(100);
    expect(logicalX(fox, { x: 35.6, y: 0 })).toBe(136);
  });
});
