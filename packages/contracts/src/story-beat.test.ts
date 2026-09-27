import { describe, expect, it } from "vitest";
import type { WorldState } from "./model";
import { initialWorld } from "./simulation";
import {
  storyActionSchema,
  storySequenceSchema,
  validateStorySequenceForWorld,
  type StoryBeat,
  type StorySequence,
} from "./story-beat";

// Nova's world plus a cloud, a flying dragon, a boat, a catapult and a wall,
// so every semantic role and property has an entity to point at.
// These ids exist only in this test; the contract itself hardcodes none.
const world: WorldState = (() => {
  const base = initialWorld("story-test");
  return {
    ...base,
    revision: 4,
    entities: [
      ...base.entities,
      {
        id: "cloud",
        role: "scenery",
        description: "",
        properties: ["weather"],
        name: "Storm cloud",
        bounds: { x: 600, y: 60, width: 150, height: 80 },
      },
      {
        id: "dragon",
        role: "helper",
        description: "",
        properties: ["flies", "carries"],
        name: "Dragon",
        bounds: { x: 200, y: 60, width: 120, height: 80 },
      },
      {
        id: "boat",
        role: "helper",
        description: "",
        properties: ["floats", "carries"],
        name: "Boat",
        bounds: { x: 430, y: 400, width: 100, height: 50 },
      },
      {
        id: "catapult",
        role: "helper",
        description: "",
        properties: ["launches"],
        name: "Catapult",
        bounds: { x: 300, y: 400, width: 80, height: 60 },
      },
      {
        id: "wall",
        role: "obstacle",
        description: "",
        properties: ["blocks"],
        name: "Stone wall",
        bounds: { x: 650, y: 200, width: 40, height: 300 },
      },
    ],
  };
})();

const beat = (id: string, action: StoryBeat["action"]): StoryBeat => ({
  id,
  narration: "Nova looks toward the castle.",
  mood: "curious",
  action,
});
const sequence = (beats: StoryBeat[]): StorySequence => ({
  mode: "fixture",
  requestId: "request-1",
  sourceRevision: 4,
  sourceEventId: "event-4",
  beats,
});
const focusNova = beat("b1", { type: "focus", entityId: "nova" });

/** The demo arc from the handoff: focus, move toward the goal, meet the river. */
const goldenArc = sequence([
  focusNova,
  beat("b2", { type: "move_toward", entityId: "nova", targetId: "castle" }),
  beat("b3", { type: "blocked_by", entityId: "nova", obstacleId: "river" }),
]);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
const accepted = (input: unknown) =>
  validateStorySequenceForWorld(input, world).ok;
const errorsFor = (input: unknown) => {
  const result = validateStorySequenceForWorld(input, world);
  if (result.ok) throw new Error("Expected the sequence to be rejected.");
  return result.errors;
};

describe("story sequence shape", () => {
  it("accepts a one-beat sequence", () => {
    expect(storySequenceSchema.safeParse(sequence([focusNova])).success).toBe(
      true,
    );
  });

  it("accepts the three-beat focus, move, blocked arc", () => {
    const result = validateStorySequenceForWorld(goldenArc, world);
    expect(result).toEqual({ ok: true, sequence: goldenArc });
  });

  it("rejects an empty beat list and more than three beats", () => {
    expect(storySequenceSchema.safeParse(sequence([])).success).toBe(false);
    const four = ["a", "b", "c", "d"].map((id) => beat(id, focusNova.action));
    expect(storySequenceSchema.safeParse(sequence(four)).success).toBe(false);
  });

  it("rejects empty, blank and overlong narration but allows 240 characters", () => {
    for (const narration of ["", "   ", "x".repeat(241)])
      expect(
        storySequenceSchema.safeParse(sequence([{ ...focusNova, narration }]))
          .success,
      ).toBe(false);
    expect(
      storySequenceSchema.safeParse(
        sequence([{ ...focusNova, narration: "x".repeat(240) }]),
      ).success,
    ).toBe(true);
  });

  it("trims narration", () => {
    const parsed = storySequenceSchema.parse(
      sequence([{ ...focusNova, narration: "  Hello.  " }]),
    );
    expect(parsed.beats[0]?.narration).toBe("Hello.");
  });

  it("rejects an unknown mood, and empty or overlong beat IDs", () => {
    for (const patch of [{ mood: "angry" }, { id: "" }, { id: "x".repeat(81) }])
      expect(
        storySequenceSchema.safeParse(
          sequence([{ ...focusNova, ...patch } as StoryBeat]),
        ).success,
      ).toBe(false);
  });

  it("rejects unknown action types", () => {
    for (const action of [
      { type: "teleport", entityId: "nova" },
      { type: "run_script", entityId: "nova" },
      { entityId: "nova" },
    ])
      expect(storyActionSchema.safeParse(action).success).toBe(false);
  });

  it("rejects unknown fields on the sequence, beat and action", () => {
    const extras: unknown[] = [
      { ...sequence([focusNova]), extra: true },
      sequence([{ ...focusNova, durationMs: 800 } as StoryBeat]),
      sequence([
        beat("b1", { type: "focus", entityId: "nova", x: 10 } as never),
      ]),
    ];
    for (const input of extras)
      expect(storySequenceSchema.safeParse(input).success).toBe(false);
  });

  it("rejects presentation and world-mutation fields Gemini must not choose", () => {
    for (const extra of [
      { x: 1, y: 2 },
      { easing: "linear" },
      { className: "spin" },
      { component: "Sparkle" },
      { audioUrl: "https://example.com/a.mp3" },
      { operation: { type: "REMOVE_ENTITY", entityId: "nova" } },
    ])
      expect(
        storySequenceSchema.safeParse(
          sequence([beat("b1", { type: "focus", entityId: "nova", ...extra })]),
        ).success,
      ).toBe(false);
  });

  it("rejects duplicate beat IDs", () => {
    const result = storySequenceSchema.safeParse(
      sequence([
        focusNova,
        beat("b1", { type: "celebrate", entityId: "nova" }),
      ]),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain('"b1"');
  });

  it("rejects a negative or non-integer source revision", () => {
    for (const sourceRevision of [-1, 1.5, Number.NaN])
      expect(
        storySequenceSchema.safeParse({
          ...sequence([focusNova]),
          sourceRevision,
        }).success,
      ).toBe(false);
    expect(
      storySequenceSchema.safeParse({
        ...sequence([focusNova]),
        sourceRevision: 0,
      }).success,
    ).toBe(true);
  });

  it("requires non-empty request and source event IDs of bounded length", () => {
    for (const patch of [
      { requestId: "" },
      { requestId: "x".repeat(101) },
      { sourceEventId: "" },
      { sourceEventId: "x".repeat(101) },
      { mode: "guess" },
    ])
      expect(
        storySequenceSchema.safeParse({ ...sequence([focusNova]), ...patch })
          .success,
      ).toBe(false);
    for (const missing of ["requestId", "sourceRevision", "sourceEventId"]) {
      const incomplete: Record<string, unknown> = { ...sequence([focusNova]) };
      delete incomplete[missing];
      expect(storySequenceSchema.safeParse(incomplete).success).toBe(false);
    }
  });
});

describe("story sequence references against a world", () => {
  it("rejects an unknown entityId for every action that takes one", () => {
    for (const action of [
      { type: "focus", entityId: "ghost" },
      { type: "reveal", entityId: "ghost" },
      { type: "celebrate", entityId: "ghost" },
      { type: "move_toward", entityId: "ghost", targetId: "castle" },
      { type: "blocked_by", entityId: "ghost", obstacleId: "river" },
    ] as const) {
      const errors = errorsFor(sequence([beat("b9", action)]));
      expect(errors).toEqual([
        'Beat "b9": entityId "ghost" is not in this world.',
      ]);
    }
  });

  it("rejects an unknown targetId", () => {
    expect(
      errorsFor(
        sequence([
          beat("b1", {
            type: "move_toward",
            entityId: "nova",
            targetId: "moon",
          }),
        ]),
      ),
    ).toEqual(['Beat "b1": targetId "moon" is not in this world.']);
  });

  it("rejects an unknown obstacleId", () => {
    expect(
      errorsFor(
        sequence([
          beat("b1", {
            type: "blocked_by",
            entityId: "nova",
            obstacleId: "sea",
          }),
        ]),
      ),
    ).toEqual(['Beat "b1": obstacleId "sea" is not in this world.']);
  });

  it("accepts committed weather with no cause or with a real cloud", () => {
    expect(
      validateStorySequenceForWorld(
        sequence([beat("b1", { type: "weather_shift", weather: "clear" })]),
        world,
      ).ok,
    ).toBe(true);
    expect(
      validateStorySequenceForWorld(
        sequence([
          beat("b1", {
            type: "weather_shift",
            weather: "rain",
            causeEntityId: "cloud",
          }),
        ]),
        { ...world, weather: "rain" },
      ).ok,
    ).toBe(true);
  });

  it("rejects weather that contradicts the committed world", () => {
    expect(
      errorsFor(
        sequence([beat("b1", { type: "weather_shift", weather: "rain" })]),
      ),
    ).toEqual([
      'Beat "b1": weather "rain" does not match this world\'s committed weather "clear".',
    ]);
    const result = validateStorySequenceForWorld(
      sequence([beat("b1", { type: "weather_shift", weather: "clear" })]),
      { ...world, weather: "rain" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        'Beat "b1": weather "clear" does not match this world\'s committed weather "rain".',
      ]);
  });

  it("rejects an unknown weather cause and a cause that is not a cloud", () => {
    expect(
      errorsFor(
        sequence([
          beat("b1", {
            type: "weather_shift",
            weather: "clear",
            causeEntityId: "ghost",
          }),
        ]),
      ),
    ).toEqual(['Beat "b1": causeEntityId "ghost" is not in this world.']);
    expect(
      errorsFor(
        sequence([
          beat("b1", {
            type: "weather_shift",
            weather: "clear",
            causeEntityId: "castle",
          }),
        ]),
      ),
    ).toEqual([
      'Beat "b1": causeEntityId "castle" must be something that changes the weather.',
    ]);
  });

  it("enforces the bounded semantic roles", () => {
    expect(
      errorsFor(
        sequence([
          beat("m", {
            type: "move_toward",
            entityId: "river",
            targetId: "castle",
          }),
          beat("b", {
            type: "blocked_by",
            entityId: "castle",
            obstacleId: "river",
          }),
          beat("o", {
            type: "blocked_by",
            entityId: "nova",
            obstacleId: "castle",
          }),
        ]),
      ),
    ).toEqual([
      'Beat "m": entityId "river" must be a character.',
      'Beat "b": entityId "castle" must be a character.',
      'Beat "o": obstacleId "castle" must be something that blocks.',
    ]);
  });

  it("accepts any obstacle that blocks, not only a river", () => {
    expect(
      accepted(
        sequence([
          beat("w", {
            type: "blocked_by",
            entityId: "nova",
            obstacleId: "wall",
          }),
        ]),
      ),
    ).toBe(true);
  });

  describe("richer actions", () => {
    it("accepts each new action when roles and properties fit", () => {
      const result = validateStorySequenceForWorld(
        sequence([
          beat("f", {
            type: "fly_over",
            entityId: "dragon",
            obstacleId: "river",
          }),
          beat("r", {
            type: "ride",
            entityId: "nova",
            carrierId: "boat",
            targetId: "castle",
          }),
          beat("l", {
            type: "launch",
            entityId: "nova",
            launcherId: "catapult",
            targetId: "castle",
          }),
        ]),
        world,
      );
      expect(result.ok).toBe(true);
      expect(
        accepted(
          sequence([
            beat("r", { type: "ride", entityId: "nova", carrierId: "dragon" }),
            beat("l", {
              type: "launch",
              entityId: "boat",
              launcherId: "catapult",
            }),
            beat("s", {
              type: "splash",
              entityId: "nova",
              obstacleId: "river",
            }),
          ]),
        ),
      ).toBe(true);
      for (const reaction of ["surprised", "scared", "happy"] as const)
        expect(
          accepted(
            sequence([
              beat("x", {
                type: "react",
                entityId: "nova",
                causeId: "cloud",
                reaction,
              }),
            ]),
          ),
        ).toBe(true);
    });

    it("rejects a fly_over by a non-flyer or over something that does not block", () => {
      expect(
        errorsFor(
          sequence([
            beat("a", {
              type: "fly_over",
              entityId: "nova",
              obstacleId: "river",
            }),
            beat("b", {
              type: "fly_over",
              entityId: "dragon",
              obstacleId: "castle",
            }),
            beat("c", {
              type: "fly_over",
              entityId: "ghost",
              obstacleId: "river",
            }),
          ]),
        ),
      ).toEqual([
        'Beat "a": entityId "nova" must be something that flies.',
        'Beat "b": obstacleId "castle" must be something that blocks.',
        'Beat "c": entityId "ghost" is not in this world.',
      ]);
    });

    it("rejects a ride that is not a character on a carrier", () => {
      expect(
        errorsFor(
          sequence([
            beat("a", { type: "ride", entityId: "boat", carrierId: "dragon" }),
            beat("b", {
              type: "ride",
              entityId: "nova",
              carrierId: "catapult",
            }),
            beat("c", {
              type: "ride",
              entityId: "nova",
              carrierId: "boat",
              targetId: "ghost",
            }),
          ]),
        ),
      ).toEqual([
        'Beat "a": entityId "boat" must be a character.',
        'Beat "b": carrierId "catapult" must be something that carries.',
        'Beat "c": targetId "ghost" is not in this world.',
      ]);
    });

    it("rejects a launch without a launcher or with missing pieces", () => {
      expect(
        errorsFor(
          sequence([
            beat("a", { type: "launch", entityId: "nova", launcherId: "boat" }),
            beat("b", {
              type: "launch",
              entityId: "ghost",
              launcherId: "catapult",
            }),
            beat("c", {
              type: "launch",
              entityId: "nova",
              launcherId: "catapult",
              targetId: "ghost",
            }),
          ]),
        ),
      ).toEqual([
        'Beat "a": launcherId "boat" must be something that launches.',
        'Beat "b": entityId "ghost" is not in this world.',
        'Beat "c": targetId "ghost" is not in this world.',
      ]);
    });

    it("rejects a splash that is not a character into something that blocks", () => {
      expect(
        errorsFor(
          sequence([
            beat("a", {
              type: "splash",
              entityId: "boat",
              obstacleId: "river",
            }),
            beat("b", { type: "splash", entityId: "nova", obstacleId: "boat" }),
          ]),
        ),
      ).toEqual([
        'Beat "a": entityId "boat" must be a character.',
        'Beat "b": obstacleId "boat" must be something that blocks.',
      ]);
    });

    it("rejects a reaction by a non-character, to a missing cause, or to itself", () => {
      expect(
        errorsFor(
          sequence([
            beat("a", {
              type: "react",
              entityId: "castle",
              causeId: "cloud",
              reaction: "happy",
            }),
            beat("b", {
              type: "react",
              entityId: "nova",
              causeId: "ghost",
              reaction: "scared",
            }),
          ]),
        ),
      ).toEqual([
        'Beat "a": entityId "castle" must be a character.',
        'Beat "b": causeId "ghost" is not in this world.',
      ]);
      expect(
        storyActionSchema.safeParse({
          type: "react",
          entityId: "nova",
          causeId: "nova",
          reaction: "happy",
        }).success,
      ).toBe(false);
      expect(
        storyActionSchema.safeParse({
          type: "react",
          entityId: "nova",
          causeId: "cloud",
          reaction: "angry",
        }).success,
      ).toBe(false);
    });

    it("keeps the new actions strict and complete", () => {
      for (const action of [
        { type: "fly_over", entityId: "dragon", obstacleId: "river", x: 1 },
        { type: "ride", entityId: "nova", carrierId: "boat", bounds: {} },
        { type: "launch", entityId: "nova", launcherId: "catapult", speed: 9 },
        { type: "splash", entityId: "nova", obstacleId: "river", depth: 2 },
        { type: "fly_over", entityId: "dragon" },
        { type: "ride", entityId: "nova" },
        { type: "launch", entityId: "nova" },
        { type: "splash", entityId: "nova" },
        { type: "react", entityId: "nova", causeId: "cloud" },
      ])
        expect(storyActionSchema.safeParse(action).success).toBe(false);
    });
  });

  it("reports every problem in a sequence, not just the first", () => {
    const errors = errorsFor(
      sequence([
        beat("a", { type: "focus", entityId: "ghost" }),
        beat("b", { type: "reveal", entityId: "phantom" }),
      ]),
    );
    expect(errors).toHaveLength(2);
  });

  it("returns parse errors for malformed input instead of throwing", () => {
    for (const input of [null, "text", 7, {}, { beats: [] }])
      expect(errorsFor(input).length).toBeGreaterThan(0);
  });

  it("works for any child's world, not just Nova's ids", () => {
    const foxWorld: WorldState = {
      ...world,
      entities: [
        {
          id: "fox-1",
          role: "character",
          description: "",
          properties: ["moves"],
          name: "Fox",
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        },
        {
          id: "creek-1",
          role: "obstacle",
          description: "",
          properties: ["blocks"],
          name: "Creek",
          bounds: { x: 300, y: 0, width: 80, height: 600 },
        },
      ],
    };
    const result = validateStorySequenceForWorld(
      sequence([
        beat("b1", {
          type: "blocked_by",
          entityId: "fox-1",
          obstacleId: "creek-1",
        }),
      ]),
      foxWorld,
    );
    expect(result.ok).toBe(true);
    expect(validateStorySequenceForWorld(goldenArc, foxWorld).ok).toBe(false);
  });

  it("does not mutate the world or the sequence, and returns a copy", () => {
    const frozenWorld = deepFreeze(structuredClone(world));
    const frozenSequence = deepFreeze(structuredClone(goldenArc));
    const result = validateStorySequenceForWorld(frozenSequence, frozenWorld);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sequence).not.toBe(frozenSequence);
    expect(frozenWorld).toEqual(world);
    expect(frozenSequence).toEqual(goldenArc);
    // A rejected sequence is left untouched too.
    const bad = deepFreeze(
      sequence([beat("b1", { type: "focus", entityId: "ghost" })]),
    );
    expect(validateStorySequenceForWorld(bad, frozenWorld).ok).toBe(false);
    expect(frozenWorld).toEqual(world);
  });

  it("carries the source metadata a client needs to discard a stale sequence", () => {
    const result = validateStorySequenceForWorld(goldenArc, world);
    if (!result.ok) throw new Error("Expected a valid sequence.");
    expect(result.sequence).toMatchObject({
      requestId: "request-1",
      sourceRevision: world.revision,
      sourceEventId: "event-4",
    });
  });
});
