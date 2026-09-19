import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldEvent, WorldState } from "@storyworld/contracts";
import {
  AudioError,
  fetchReactionCue,
  fetchReactionSpeech,
  fetchScribeToken,
} from "./audio-client";

const world = (revision: number): WorldState => ({
  id: "w",
  revision,
  schemaVersion: 1,
  entities: [
    {
      id: "nova",
      kind: "character",
      name: "Nova",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    },
    {
      id: "bridge-1",
      kind: "bridge",
      name: "Bridge",
      bounds: { x: 5, y: 6, width: 7, height: 8 },
    },
  ],
  rules: [
    { id: "r", subjectId: "nova", predicate: "afraid_of", objectId: "river" },
  ],
  goal: { characterId: "nova", targetId: "castle" },
  pathStatus: "available",
  weather: "clear",
});
const event: WorldEvent = {
  id: "evt-1",
  revision: 2,
  actor: "private-actor-name",
  summary: "Bridge added",
  state: world(2),
};

function stubFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>,
) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("reaction requests", () => {
  it("send only the confirmed event and the previous state, minimized", async () => {
    const mock = stubFetch(async () => json({ reaction: null }));
    await fetchReactionCue(event, world(1));
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/reactions/cue");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({
      event: {
        id: "evt-1",
        revision: 2,
        state: {
          pathStatus: "available",
          weather: "clear",
          goal: { characterId: "nova" },
          entities: [
            { id: "nova", kind: "character", name: "Nova" },
            { id: "bridge-1", kind: "bridge", name: "Bridge" },
          ],
        },
      },
      previousState: {
        pathStatus: "available",
        weather: "clear",
        goal: { characterId: "nova" },
        entities: expect.any(Array),
      },
    });
    // Geometry, rules, and the actor are not needed and are not sent.
    expect(init.body as string).not.toContain("bounds");
    expect(init.body as string).not.toContain("private-actor-name");
    expect(init.body as string).not.toContain("afraid_of");
  });

  it("send a null previous state for the first event", async () => {
    const mock = stubFetch(async () => json({ reaction: null }));
    await fetchReactionCue(event, null);
    expect(
      JSON.parse(mock.mock.calls[0]![1].body as string).previousState,
    ).toBeNull();
  });

  it("return the cue, or null when none is needed", async () => {
    const reaction = { eventId: "evt-1", text: "Yay", emotion: "delighted" };
    stubFetch(async () => json({ reaction }));
    expect(await fetchReactionCue(event, null)).toEqual(reaction);
    stubFetch(async () => json({ reaction: null }));
    expect(await fetchReactionCue(event, null)).toBeNull();
  });

  it("return speech with its caption and audio", async () => {
    const body = {
      reaction: { eventId: "evt-1", text: "Yay", emotion: "delighted" },
      audio: { mimeType: "audio/mpeg", base64: "AAAA" },
      audioStatus: "ready",
    };
    const mock = stubFetch(async () => json(body));
    expect(await fetchReactionSpeech(event, world(1))).toEqual(body);
    expect(mock.mock.calls[0]![0]).toBe("/api/reactions/speech");
  });

  it("keep the caption when the server says the voice failed", async () => {
    const body = {
      reaction: { eventId: "evt-1", text: "Yay", emotion: "delighted" },
      audio: null,
      audioStatus: "failed",
      error: { code: "PROVIDER_TIMEOUT", message: "slow", retryable: true },
    };
    stubFetch(async () => json(body));
    const result = await fetchReactionSpeech(event, null);
    expect(result.reaction?.text).toBe("Yay");
    expect(result.audio).toBeNull();
    expect(result.audioStatus).toBe("failed");
    expect(result.error?.code).toBe("PROVIDER_TIMEOUT");
  });

  it("treat an unreadable success body as a failed voice, not a crash", async () => {
    stubFetch(async () => new Response("not json"));
    expect(await fetchReactionSpeech(event, null)).toEqual({
      reaction: null,
      audio: null,
      audioStatus: "failed",
    });
  });
});

describe("audio errors", () => {
  it("surface the server's code, message, and retryable flag", async () => {
    stubFetch(async () =>
      json(
        { code: "INVALID_INPUT", message: "Check it.", retryable: false },
        400,
      ),
    );
    const error = await fetchReactionCue(event, null).catch((e) => e);
    expect(error).toBeInstanceOf(AudioError);
    expect(error).toMatchObject({
      code: "INVALID_INPUT",
      message: "Check it.",
      retryable: false,
    });
  });

  it("fall back to a friendly message when the body is not JSON", async () => {
    stubFetch(
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
    );
    const error = await fetchReactionCue(event, null).catch((e) => e);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", retryable: false });
    expect(error.message).toContain("text instead");
    expect(error.message).not.toContain("html");
  });

  it("report a network failure as retryable", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchReactionCue(event, null).catch((e) => e)).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });

  it("report a client-side timeout as retryable", async () => {
    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(
      await fetchReactionSpeech(event, null).catch((e) => e),
    ).toMatchObject({
      code: "CLIENT_TIMEOUT",
      retryable: true,
    });
  });
});

describe("fetchScribeToken", () => {
  const token = {
    token: "sutkn_abc",
    model: "scribe_v2_realtime",
    websocketUrl: "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    expiresInSeconds: 900,
  };

  it("returns the token and never caches it", async () => {
    const mock = stubFetch(async () => json(token));
    expect(await fetchScribeToken()).toEqual(token);
    expect(mock.mock.calls[0]![0]).toBe("/api/elevenlabs/scribe-token");
    expect(mock.mock.calls[0]![1].cache).toBe("no-store");
  });

  it("lets the caller fall back to typing when voice is not set up", async () => {
    stubFetch(async () =>
      json(
        {
          code: "PROVIDER_NOT_CONFIGURED",
          message:
            "Voice is not set up here, so Storyworld will use text instead.",
          retryable: false,
        },
        503,
      ),
    );
    expect(await fetchScribeToken().catch((e) => e)).toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
      retryable: false,
    });
  });

  it("rejects a response without a usable token", async () => {
    stubFetch(async () => json({ model: "scribe_v2_realtime" }));
    expect(await fetchScribeToken().catch((e) => e)).toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("defaults the lifetime if the server omits it", async () => {
    stubFetch(async () =>
      json({ token: "t", model: "m", websocketUrl: "wss://x.test" }),
    );
    expect((await fetchScribeToken()).expiresInSeconds).toBe(900);
  });
});
