import { describe, expect, it, vi } from "vitest";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { WorldEvent } from "@storyworld/contracts/model";
import { applyOperation, initialWorld } from "@storyworld/contracts/simulation";
import type { StorySequence } from "@storyworld/contracts/story-beat";
import { DirectedStoryController } from "./use-directed-story-sequence";

const scene: ConfirmedScene = {
  document: {
    sourceImage: "picture",
    drawing: { strokes: [], compositeImage: "picture" },
    description: "A brave crossing",
  },
  mode: "live",
  objects: [
    {
      id: "nova",
      name: "Nova",
      kind: "character",
      confidence: 1,
      imageBounds: { x: 0, y: 0, width: 0.2, height: 0.2 },
    },
  ],
  characterId: "nova",
  openingNarration: "Nova explores.",
  moodHints: ["curious"],
};

const first: WorldEvent = {
  id: "event-0",
  revision: 0,
  actor: "director",
  summary: "World opened",
  state: initialWorld("world-1"),
};
const second: WorldEvent = {
  id: "event-1",
  revision: 1,
  actor: "director",
  summary: "Bridge added",
  state: applyOperation(first.state, {
    type: "CREATE_ENTITY",
    entity: {
      id: "bridge-1",
      kind: "bridge",
      name: "Bridge",
      bounds: { x: 400, y: 280, width: 160, height: 80 },
    },
  }),
};

function response(event: WorldEvent, requestId: string): StorySequence {
  return {
    mode: "live",
    requestId,
    sourceRevision: event.revision,
    sourceEventId: event.id,
    beats: [
      {
        id: "beat-1",
        narration: "Nova looks on.",
        mood: "curious",
        action: { type: "focus", entityId: "nova" },
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("directed story controller", () => {
  it("lets event B win over a delayed response for event A", async () => {
    const a = deferred<StorySequence>();
    const b = deferred<StorySequence>();
    const publish = vi.fn();
    const request = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const ids = ["request-a", "request-b"];
    const controller = new DirectedStoryController(publish, request, () =>
      ids.shift()!,
    );

    controller.direct(first, undefined, scene);
    controller.direct(second, first, scene);
    b.resolve(response(second, "request-b"));
    await settle();
    a.resolve(response(first, "request-a"));
    await settle();

    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sequence: expect.objectContaining({ sourceEventId: "event-1" }),
        status: "",
      }),
    );
  });

  it("falls back visibly when response source metadata does not match", async () => {
    const publish = vi.fn();
    const controller = new DirectedStoryController(
      publish,
      async () => response(second, "wrong-request"),
      () => "request-1",
    );
    controller.direct(second, first, scene);
    await settle();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sequence: expect.objectContaining({ sourceEventId: "event-1" }),
        status:
          "Story director unavailable; playing the committed moment locally.",
      }),
    );
  });

  it("aborts cleanly and publishes nothing after cancellation", async () => {
    const pending = deferred<StorySequence>();
    const publish = vi.fn();
    const controller = new DirectedStoryController(
      publish,
      () => pending.promise,
      () => "request-1",
    );
    controller.direct(first, undefined, scene);
    controller.cancel("event-0");
    pending.resolve(response(first, "request-1"));
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ directing: true }),
    );
  });

  it("installs deterministic fallback on current request failure", async () => {
    const publish = vi.fn();
    const controller = new DirectedStoryController(
      publish,
      async () => {
        throw new Error("offline");
      },
      () => "request-1",
    );
    controller.direct(first, undefined, scene);
    await settle();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sequence: expect.objectContaining({ mode: "fixture" }),
        directing: false,
      }),
    );
  });

  it("does not request again for proposal or presence rerenders", async () => {
    const request = vi.fn(async () => response(first, "request-1"));
    const controller = new DirectedStoryController(
      vi.fn(),
      request,
      () => "request-1",
    );
    controller.direct(first, undefined, scene);
    await settle();
    controller.direct(first, undefined, scene);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("omits blank guidance and sends a null previous world at revision 0", async () => {
    const request = vi.fn(async () => response(first, "request-1"));
    const controller = new DirectedStoryController(
      vi.fn(),
      request,
      () => "request-1",
    );
    controller.direct(first, undefined, {
      ...scene,
      document: { ...scene.document, description: "   " },
      openingNarration: "Nova explores.",
    });
    await settle();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-1",
        committedEvent: {
          id: "event-0",
          revision: 0,
          summary: "World opened",
        },
        committedWorld: first.state,
        previousCommittedWorld: null,
        childDescription: undefined,
        openingNarration: "Nova explores.",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sends the previous committed world for a later event", async () => {
    const request = vi.fn(async () => response(second, "request-1"));
    const controller = new DirectedStoryController(
      vi.fn(),
      request,
      () => "request-1",
    );
    controller.direct(second, first, scene);
    await settle();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        committedWorld: second.state,
        previousCommittedWorld: first.state,
        childDescription: "A brave crossing",
      }),
      expect.any(Object),
    );
  });

  it("falls back when the sequence is not valid for the committed world", async () => {
    const publish = vi.fn();
    const controller = new DirectedStoryController(
      publish,
      async () => ({
        ...response(first, "request-1"),
        beats: [
          {
            id: "beat-1",
            narration: "A missing friend appears.",
            mood: "curious",
            action: { type: "reveal", entityId: "ghost" },
          },
        ],
      }),
      () => "request-1",
    );
    controller.direct(first, undefined, scene);
    await settle();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sequence: expect.objectContaining({
          mode: "fixture",
          sourceEventId: "event-0",
        }),
        status:
          "Story director unavailable; playing the committed moment locally.",
      }),
    );
  });
});
