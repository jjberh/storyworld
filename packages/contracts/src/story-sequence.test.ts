import { describe, expect, it } from "vitest";
import { initialWorld } from "./simulation";
import { storySequenceRequestSchema } from "./story-sequence";

const validRequest = {
  requestId: "request-1",
  committedEvent: {
    id: "event-0",
    revision: 0,
    summary: "Scene initialized",
  },
  committedWorld: initialWorld("world-1"),
  previousCommittedWorld: null,
  childDescription: "Nova should find a way across.",
  openingNarration: "Nova begins her adventure.",
};

describe("story sequence request contract", () => {
  it("accepts a bounded committed event and world", () => {
    expect(storySequenceRequestSchema.parse(validRequest)).toEqual(
      validRequest,
    );
  });

  it("is strict at every request boundary", () => {
    for (const input of [
      { ...validRequest, extra: true },
      {
        ...validRequest,
        committedEvent: { ...validRequest.committedEvent, actor: "guest" },
      },
      {
        ...validRequest,
        committedWorld: { ...validRequest.committedWorld, secret: true },
      },
      {
        ...validRequest,
        committedWorld: {
          ...validRequest.committedWorld,
          entities: [
            {
              ...validRequest.committedWorld.entities[0],
              duration: 500,
            },
            ...validRequest.committedWorld.entities.slice(1),
          ],
        },
      },
    ])
      expect(storySequenceRequestSchema.safeParse(input).success).toBe(false);
  });

  it("rejects mismatched revisions and impractical text", () => {
    expect(
      storySequenceRequestSchema.safeParse({
        ...validRequest,
        committedEvent: { ...validRequest.committedEvent, revision: 1 },
      }).success,
    ).toBe(false);
    expect(
      storySequenceRequestSchema.safeParse({
        ...validRequest,
        childDescription: "x".repeat(2_001),
      }).success,
    ).toBe(false);
  });

  it("validates the previous world structurally", () => {
    const current = {
      ...initialWorld("world-1"),
      revision: 2,
    };
    expect(
      storySequenceRequestSchema.safeParse({
        ...validRequest,
        committedEvent: { ...validRequest.committedEvent, revision: 2 },
        committedWorld: current,
        previousCommittedWorld: {
          ...initialWorld("world-1"),
          revision: 1,
        },
      }).success,
    ).toBe(true);
    for (const previousCommittedWorld of [
      null,
      { ...initialWorld("other-world"), revision: 1 },
      { ...initialWorld("world-1"), revision: 0 },
      { ...initialWorld("world-1"), revision: 2 },
    ])
      expect(
        storySequenceRequestSchema.safeParse({
          ...validRequest,
          committedEvent: { ...validRequest.committedEvent, revision: 2 },
          committedWorld: current,
          previousCommittedWorld,
        }).success,
      ).toBe(false);
  });

  it("allows a valid empty world at the shared contract boundary", () => {
    expect(
      storySequenceRequestSchema.safeParse({
        ...validRequest,
        committedWorld: {
          ...validRequest.committedWorld,
          entities: [],
          rules: [],
          goal: null,
          pathStatus: "idle",
        },
      }).success,
    ).toBe(true);
  });
});
