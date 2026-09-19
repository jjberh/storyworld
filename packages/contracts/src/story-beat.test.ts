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

// Nova's world plus a cloud, so every semantic role has an entity to point at.
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
        kind: "cloud",
        name: "Storm cloud",
        bounds: { x: 600, y: 60, width: 150, height: 80 },
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

  it("accepts a weather shift with no cause or with a real cloud", () => {
    for (const action of [
      { type: "weather_shift", weather: "rain" },
      { type: "weather_shift", weather: "clear" },
      { type: "weather_shift", weather: "rain", causeEntityId: "cloud" },
    ] as const)
      expect(
        validateStorySequenceForWorld(sequence([beat("b1", action)]), world).ok,
      ).toBe(true);
  });

  it("rejects an unknown weather cause and a cause that is not a cloud", () => {
    expect(
      errorsFor(
        sequence([
          beat("b1", {
            type: "weather_shift",
            weather: "rain",
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
            weather: "rain",
            causeEntityId: "castle",
          }),
        ]),
      ),
    ).toEqual(['Beat "b1": causeEntityId "castle" must be a cloud.']);
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
      'Beat "o": obstacleId "castle" must be a river.',
    ]);
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
          kind: "character",
          name: "Fox",
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        },
        {
          id: "creek-1",
          kind: "river",
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
