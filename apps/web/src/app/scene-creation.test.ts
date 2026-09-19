import { describe, expect, it } from "vitest";
import type { ConfirmedScene } from "@storyworld/contracts";
import {
  creationReducer,
  initialCreation,
  type CreationAttempt,
  type CreationState,
} from "./scene-creation";

const scene: ConfirmedScene = {
  document: {
    sourceImage: "picture",
    drawing: { strokes: [], compositeImage: "picture" },
  },
  mode: "live",
  objects: [
    {
      id: "fox",
      name: "Fox",
      kind: "character",
      confidence: 1,
      imageBounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
    },
  ],
  characterId: "fox",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};
const first: CreationAttempt = { id: "story-1", requestId: "request-1", scene };
const second: CreationAttempt = {
  id: "story-2",
  requestId: "request-2",
  scene,
};

function failedAfter(attempt: CreationAttempt): CreationState {
  return [
    { type: "start", attempt } as const,
    { type: "failed", error: "Database is offline." } as const,
  ].reduce(creationReducer, initialCreation);
}

describe("scene creation attempts", () => {
  it("freezes the attempt while creating and locks editing", () => {
    const state = creationReducer(initialCreation, {
      type: "start",
      attempt: first,
    });
    expect(state).toEqual({ status: "creating", attempt: first, error: "" });
  });

  it("keeps the same world ID, request ID and payload across retries", () => {
    let state = failedAfter(first);
    expect(state).toMatchObject({ status: "failed", attempt: first });
    for (let retry = 0; retry < 3; retry += 1) {
      // A retry offers a brand-new attempt; the frozen one must win.
      state = creationReducer(state, { type: "start", attempt: second });
      expect(state.status).toBe("creating");
      expect(state.attempt).toBe(first);
      state = creationReducer(state, { type: "failed", error: "Still down." });
    }
    expect(state.attempt).toBe(first);
    expect(state.error).toBe("Still down.");
  });

  it("ignores a second start while creating or after committing", () => {
    const creating = creationReducer(initialCreation, {
      type: "start",
      attempt: first,
    });
    expect(creationReducer(creating, { type: "start", attempt: second })).toBe(
      creating,
    );
    const committed = creationReducer(creating, { type: "committed" });
    expect(committed.status).toBe("committed");
    expect(creationReducer(committed, { type: "start", attempt: second })).toBe(
      committed,
    );
    expect(creationReducer(committed, { type: "review" })).toBe(committed);
    expect(
      creationReducer(committed, { type: "failed", error: "Late error." }),
    ).toBe(committed);
  });

  it("returning to review clears the pending attempt and error", () => {
    const state = creationReducer(failedAfter(first), { type: "review" });
    expect(state).toEqual(initialCreation);
    expect(state.attempt).toBeUndefined();
    // Review is the state in which the UI is not locked.
    expect(state.status).toBe("review");
  });

  it("gives the next attempt after review a new world and request ID", () => {
    const reviewed = creationReducer(failedAfter(first), { type: "review" });
    const next = creationReducer(reviewed, { type: "start", attempt: second });
    expect(next.attempt).toBe(second);
    expect(next.attempt?.id).not.toBe(first.id);
    expect(next.attempt?.requestId).not.toBe(first.requestId);
  });

  it("only abandons an attempt from the failed state", () => {
    const creating = creationReducer(initialCreation, {
      type: "start",
      attempt: first,
    });
    expect(creationReducer(creating, { type: "review" })).toBe(creating);
    expect(creationReducer(initialCreation, { type: "review" })).toBe(
      initialCreation,
    );
  });

  it("a successful retry commits with the original attempt", () => {
    let state = failedAfter(first);
    state = creationReducer(state, { type: "start", attempt: second });
    state = creationReducer(state, { type: "committed" });
    expect(state).toEqual({ status: "committed", attempt: first, error: "" });
  });
});
