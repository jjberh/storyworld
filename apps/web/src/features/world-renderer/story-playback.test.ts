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
  TRAVEL_EXTRA_MS,
  beatHoldMs,
  beatMovement,
  logicalX,
  movementFor,
  pendingRevealId,
  restingRain,
} from "./story-playback";

const fox: Entity = {
  id: "fox",
  role: "character",
  description: "",
  properties: ["moves"],
  name: "Fox",
  bounds: { x: 100, y: 120, width: 200, height: 120 },
};
const river: Entity = {
  id: "river",
  role: "obstacle",
  description: "",
  properties: ["blocks"],
  name: "River",
  bounds: { x: 450, y: 30, width: 120, height: 540 },
};
const castle: Entity = {
  id: "castle",
  role: "goal",
  description: "",
  properties: ["goal"],
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
    interaction: null,
    crossings: [],
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
    // Mirrored so the river still lies on the route: the castle is west.
    const eastFox = { ...fox, bounds: { ...fox.bounds, x: 650, y: 180 } };
    const westCastle = { ...castle, bounds: { ...castle.bounds, x: 50 } };
    const movement = movementFor(
      eastFox,
      westCastle,
      world({ entities: [eastFox, river, westCastle] }),
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

  it("carries a flyer to the far side of the obstacle", () => {
    const bird: Entity = {
      id: "bird",
      role: "helper",
      description: "",
      properties: ["flies", "carries"],
      name: "Bird",
      bounds: { x: 200, y: 40, width: 100, height: 60 },
    };
    const moved = beatMovement(
      { type: "fly_over", entityId: "bird", obstacleId: "river" },
      undefined,
      world({ entities: [fox, river, castle, bird] }),
    );
    expect(moved?.entityId).toBe("bird");
    expect(moved?.movement.placement).toBe("beyond-obstacle");
    // Left edge lands 14 units past the river's far bank.
    expect(bird.bounds.x + moved!.movement.offset.x).toBe(
      river.bounds.x + river.bounds.width + 14,
    );
  });

  it("rides to the target, or onto the carrier without one", () => {
    const boat: Entity = {
      id: "boat",
      role: "helper",
      description: "",
      properties: ["floats", "carries"],
      name: "Boat",
      bounds: { x: 440, y: 300, width: 140, height: 50 },
    };
    // The boat spans the river, so the committed route is open.
    const riding = world({
      entities: [fox, river, castle, boat],
      pathStatus: "available",
    });
    const toCastle = beatMovement(
      { type: "ride", entityId: "fox", carrierId: "boat", targetId: "castle" },
      undefined,
      riding,
    );
    expect(toCastle?.movement.placement).toBe("target-side");
    const aboard = beatMovement(
      { type: "ride", entityId: "fox", carrierId: "boat" },
      undefined,
      riding,
    );
    expect(aboard?.movement.placement).toBe("on-carrier");
    expect(fox.bounds.y + fox.bounds.height + aboard!.movement.offset.y).toBe(
      boat.bounds.y,
    );
  });

  it("launches toward a target and stays put without one", () => {
    expect(
      beatMovement(
        {
          type: "launch",
          entityId: "fox",
          launcherId: "castle",
          targetId: "castle",
        },
        undefined,
        world({ pathStatus: "available" }),
      )?.movement.placement,
    ).toBe("target-side");
    expect(
      beatMovement(
        { type: "launch", entityId: "fox", launcherId: "castle" },
        undefined,
        world(),
      ),
    ).toBeUndefined();
  });

  it("never carries the goal's character past a blocked route", () => {
    // The committed path status is authoritative, whatever the beat says.
    const raft: Entity = {
      id: "raft",
      role: "helper",
      description: "",
      properties: ["floats", "carries"],
      name: "Raft",
      bounds: { x: 150, y: 400, width: 100, height: 40 },
    };
    const blocked = world({ entities: [fox, river, castle, raft] });
    for (const action of [
      { type: "ride", entityId: "fox", carrierId: "raft", targetId: "castle" },
      {
        type: "launch",
        entityId: "fox",
        launcherId: "raft",
        targetId: "castle",
      },
      { type: "fly_over", entityId: "fox", obstacleId: "river" },
    ] as const) {
      const moved = beatMovement(action, undefined, blocked);
      expect(moved?.movement.placement).toBe("near-obstacle");
      expect(fox.bounds.x + moved!.movement.offset.x + fox.bounds.width).toBe(
        river.bounds.x - 14,
      );
    }
    // A flyer that is not the goal's character still crosses.
    const bird: Entity = {
      id: "bird",
      role: "scenery",
      description: "",
      properties: ["flies"],
      name: "Bird",
      bounds: { x: 200, y: 40, width: 60, height: 40 },
    };
    expect(
      beatMovement(
        { type: "fly_over", entityId: "bird", obstacleId: "river" },
        undefined,
        world({ entities: [fox, river, castle, bird] }),
      )?.movement.placement,
    ).toBe("beyond-obstacle");
  });

  it("parks at the obstacle on the route, not a blocker behind the hero", () => {
    const wall: Entity = {
      id: "wall",
      role: "obstacle",
      description: "",
      properties: ["blocks"],
      name: "Stone wall",
      bounds: { x: 10, y: 100, width: 40, height: 300 },
    };
    const movement = movementFor(
      fox,
      castle,
      world({ entities: [wall, fox, river, castle] }),
      undefined,
    );
    expect(movement.placement).toBe("near-obstacle");
    // Forward to the river's near bank, never backwards to the wall.
    expect(movement.offset.x).toBeGreaterThan(0);
    expect(fox.bounds.x + movement.offset.x + fox.bounds.width).toBe(
      river.bounds.x - 14,
    );
  });

  it("splashes at the near bank, and a move before a splash stops there", () => {
    expect(
      beatMovement(
        { type: "splash", entityId: "fox", obstacleId: "river" },
        undefined,
        world({ pathStatus: "available" }),
      )?.movement.placement,
    ).toBe("near-obstacle");
    expect(
      beatMovement(
        { type: "move_toward", entityId: "fox", targetId: "castle" },
        { type: "splash", entityId: "fox", obstacleId: "river" },
        world({ pathStatus: "available" }),
      )?.movement.placement,
    ).toBe("near-obstacle");
    expect(
      beatMovement(
        {
          type: "react",
          entityId: "fox",
          causeId: "river",
          reaction: "scared",
        },
        undefined,
        world(),
      ),
    ).toBeUndefined();
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

  it("holds travelling beats a little longer so the move can land", () => {
    for (const action of [
      { type: "fly_over", entityId: "fox", obstacleId: "river" },
      { type: "ride", entityId: "fox", carrierId: "castle" },
      { type: "launch", entityId: "fox", launcherId: "castle" },
      { type: "splash", entityId: "fox", obstacleId: "river" },
    ] as const) {
      expect(beatHoldMs(action, false)).toBe(BEAT_HOLD_MS + TRAVEL_EXTRA_MS);
      expect(beatHoldMs(action, true)).toBe(REDUCED_MOTION_BEAT_HOLD_MS);
    }
    expect(
      beatHoldMs(
        { type: "react", entityId: "fox", causeId: "river", reaction: "happy" },
        false,
      ),
    ).toBe(BEAT_HOLD_MS);
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
