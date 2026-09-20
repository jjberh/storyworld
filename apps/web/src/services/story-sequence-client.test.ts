import { describe, expect, it, vi } from "vitest";
import { initialWorld } from "@storyworld/contracts/simulation";
import {
  requestStorySequence,
  StorySequenceError,
} from "./story-sequence-client";

function request() {
  const world = initialWorld("world-1");
  return {
    requestId: "request-1",
    committedEvent: { id: "event-0", revision: 0, summary: "World opened" },
    committedWorld: world,
    previousCommittedWorld: null,
  };
}

function sequence() {
  return {
    mode: "fixture",
    requestId: "request-1",
    sourceRevision: 0,
    sourceEventId: "event-0",
    beats: [
      {
        id: "beat-1",
        narration: "Nova waits.",
        mood: "curious",
        action: { type: "focus", entityId: "nova" },
      },
    ],
  };
}

describe("story sequence client", () => {
  it("returns a contract-valid server sequence", async () => {
    const fetchMock = vi.fn(async () => Response.json(sequence()));
    await expect(
      requestStorySequence(request(), { fetch: fetchMock as typeof fetch }),
    ).resolves.toEqual(sequence());
  });

  it("strictly parses a successful response", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ...sequence(), unexpected: true }),
    );
    await expect(
      requestStorySequence(request(), { fetch: fetchMock as typeof fetch }),
    ).rejects.toMatchObject({
      name: "StorySequenceError",
      code: "INVALID_RESPONSE",
    });
  });

  it("parses only safe API error fields", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          code: "PROVIDER_FAILED",
          message: "The story director had a problem.",
          retryable: true,
          stack: "do not expose",
        },
        { status: 502 },
      ),
    );
    await expect(
      requestStorySequence(request(), { fetch: fetchMock as typeof fetch }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "The story director had a problem.",
        code: "PROVIDER_FAILED",
        retryable: true,
      }),
    );
  });

  it("returns a typed timeout without trusting a thrown network error", async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        }),
    );
    await expect(
      requestStorySequence(request(), {
        fetch: fetchMock as typeof fetch,
        timeoutMs: 5,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StorySequenceError>>({
        code: "CLIENT_TIMEOUT",
        retryable: true,
      }),
    );
  });

  it("omits blank optional guidance before sending", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body)).childDescription).toBeUndefined();
        return Response.json(sequence());
      },
    );
    await expect(
      requestStorySequence(
        { ...request(), childDescription: "   " },
        { fetch: fetchMock as typeof fetch },
      ),
    ).resolves.toEqual(sequence());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces caller cancellation without treating it as a timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = requestStorySequence(request(), {
      fetch: fetchMock as typeof fetch,
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    controller.abort();
    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<StorySequenceError>>({
        code: "REQUEST_ABORTED",
        retryable: true,
      }),
    );
  });
});
