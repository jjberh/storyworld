import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { createAudio } from "./services/elevenlabs";
import {
  FixtureWorldClient,
  bridgeOperation,
  cloudOperation,
} from "@storyworld/world-fixtures";
import type { WorldOperation } from "@storyworld/contracts";

const API_KEY = "test-elevenlabs-key";
const audioBytes = Buffer.from("fake-mp3-bytes");

type Kind = "character" | "castle" | "river" | "bridge" | "cloud" | "shelter";
const entity = (id: string, kind: Kind, name = id) => ({
  id,
  kind,
  name,
  // Full WorldEvent entities carry bounds; the API must accept and ignore them.
  bounds: { x: 0, y: 0, width: 10, height: 10 },
});
const nova = entity("nova", "character", "Nova");
const river = entity("river", "river", "River");
const castle = entity("castle", "castle", "Castle");
const bridge = entity("bridge-1", "bridge", "Bridge");
const cloud = entity("cloud-1", "cloud", "Storm cloud");

function world(
  entities: ReturnType<typeof entity>[],
  pathStatus: "idle" | "blocked" | "available",
  weather: "clear" | "rain" = "clear",
) {
  return {
    id: "w",
    revision: entities.length,
    entities,
    rules: [],
    goal: { characterId: "nova", targetId: "castle" },
    pathStatus,
    weather,
  };
}

const start = world([nova, river, castle], "blocked");
const withOpenBridge = world([nova, river, castle, bridge], "available");
const withShortBridge = world([nova, river, castle, bridge], "blocked");
const withRain = world([nova, river, castle, cloud], "blocked", "rain");

function reactionBody(
  id: string,
  state: ReturnType<typeof world>,
  previous: ReturnType<typeof world> | null,
) {
  return {
    event: { id, revision: state.revision, actor: "You", summary: "x", state },
    previousState: previous,
  };
}

function ttsReply(status = 200, contentType = "audio/mpeg") {
  return new Response(audioBytes, {
    status,
    headers: { "Content-Type": contentType },
  });
}

function liveApp(fetchImpl: unknown, env: NodeJS.ProcessEnv = {}) {
  return buildApp({
    audio: createAudio(
      { ELEVENLABS_API_KEY: API_KEY, ...env },
      fetchImpl as typeof fetch,
    ),
  });
}

const post = (app: ReturnType<typeof buildApp>, url: string, payload: object) =>
  app.inject({ method: "POST", url, payload });

afterEach(() => vi.restoreAllMocks());

describe("realtime transcription token", () => {
  it("mints a single-use token without exposing the API key", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ token: "sutkn_abc123" })),
    );
    const app = liveApp(fetchMock);
    try {
      const res = await app.inject({ url: "/api/elevenlabs/scribe-token" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        token: "sutkn_abc123",
        model: "scribe_v2_realtime",
        websocketUrl: "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
        expiresInSeconds: 900,
      });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).not.toContain(API_KEY);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      );
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(
        API_KEY,
      );
    } finally {
      await app.close();
    }
  });

  it("is unavailable without a key and never calls the provider", async () => {
    const fetchMock = vi.fn();
    for (const env of [{}, { ELEVENLABS_API_KEY: "  " }]) {
      const app = buildApp({
        audio: createAudio(env, fetchMock as unknown as typeof fetch),
      });
      try {
        const res = await app.inject({ url: "/api/elevenlabs/scribe-token" });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({
          code: "PROVIDER_NOT_CONFIGURED",
          retryable: false,
        });
      } finally {
        await app.close();
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("provider failures are safe and recoverable", () => {
    const failures: Array<
      [string, () => Promise<Response>, number, string, boolean]
    > = [
      [
        "rejected key",
        async () => new Response("{}", { status: 401 }),
        502,
        "PROVIDER_AUTH_FAILED",
        false,
      ],
      [
        "rate limit",
        async () => new Response("{}", { status: 429 }),
        503,
        "PROVIDER_RATE_LIMITED",
        true,
      ],
      [
        "server error",
        async () => new Response("{}", { status: 500 }),
        502,
        "PROVIDER_FAILED",
        true,
      ],
      [
        "client error",
        async () => new Response("{}", { status: 422 }),
        502,
        "PROVIDER_FAILED",
        false,
      ],
      [
        "missing token",
        async () => new Response(JSON.stringify({})),
        502,
        "PROVIDER_FAILED",
        true,
      ],
      [
        "not JSON",
        async () => new Response("oops"),
        502,
        "PROVIDER_FAILED",
        true,
      ],
      [
        "network failure",
        async () => {
          throw new TypeError("fetch failed");
        },
        502,
        "PROVIDER_UNAVAILABLE",
        true,
      ],
      [
        "timeout",
        async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
        504,
        "PROVIDER_TIMEOUT",
        true,
      ],
    ];
    for (const [name, respond, status, code, retryable] of failures)
      it(name, async () => {
        const app = liveApp(respond);
        try {
          const res = await app.inject({ url: "/api/elevenlabs/scribe-token" });
          expect(res.statusCode).toBe(status);
          expect(res.json()).toMatchObject({ code, retryable });
          expect(res.body).not.toContain(API_KEY);
        } finally {
          await app.close();
        }
      });
  });
});

describe("reaction cues from committed events", () => {
  const cue = async (
    id: string,
    state: ReturnType<typeof world>,
    previous: ReturnType<typeof world> | null,
  ) => {
    const app = buildApp();
    try {
      const res = await post(
        app,
        "/api/reactions/cue",
        reactionBody(id, state, previous),
      );
      expect(res.statusCode).toBe(200);
      return res.json().reaction as {
        eventId: string;
        text: string;
        emotion: string;
      } | null;
    } finally {
      await app.close();
    }
  };

  it("celebrates when the route opens", async () => {
    const reaction = await cue("evt-open", withOpenBridge, start);
    expect(reaction).toMatchObject({
      eventId: "evt-open",
      emotion: "delighted",
    });
    expect(reaction!.text.length).toBeGreaterThan(10);
  });

  it("is worried when a bridge still does not span the river", async () => {
    expect(await cue("evt-short", withShortBridge, start)).toMatchObject({
      eventId: "evt-short",
      emotion: "worried",
    });
  });

  it("is curious when the storm brings rain", async () => {
    expect(await cue("evt-rain", withRain, start)).toMatchObject({
      eventId: "evt-rain",
      emotion: "curious",
    });
  });

  it("gives the three reactions clearly different text and emotion", async () => {
    const [open, short, rain] = await Promise.all([
      cue("same-id", withOpenBridge, start),
      cue("same-id", withShortBridge, start),
      cue("same-id", withRain, start),
    ]);
    expect(new Set([open!.text, short!.text, rain!.text]).size).toBe(3);
    expect(new Set([open!.emotion, short!.emotion, rain!.emotion]).size).toBe(
      3,
    );
  });

  it("mentions the hero by name when the line is about them", async () => {
    // Every event id maps to one of the lines; at least one names Nova.
    const texts = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((id) =>
        cue(id, withOpenBridge, start),
      ),
    );
    expect(texts.some((r) => r!.text.includes("Nova"))).toBe(true);
  });

  it("uses a stable line per event and varies across events", async () => {
    const again = await Promise.all([
      cue("evt-x", withOpenBridge, start),
      cue("evt-x", withOpenBridge, start),
    ]);
    expect(again[0]!.text).toBe(again[1]!.text);
    const many = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        cue("evt-" + i, withOpenBridge, start),
      ),
    );
    expect(new Set(many.map((r) => r!.text)).size).toBeGreaterThan(1);
  });

  it("reacts to a first event that has no previous state", async () => {
    expect(await cue("evt-first", withOpenBridge, null)).toMatchObject({
      emotion: "delighted",
    });
  });

  it("stays quiet for events that are not a reaction moment", async () => {
    const shelter = world(
      [nova, river, castle, entity("s", "shelter")],
      "blocked",
    );
    const secondBridge = world(
      [nova, river, castle, bridge, entity("bridge-2", "bridge")],
      "available",
    );
    const cases: Array<
      [string, ReturnType<typeof world>, ReturnType<typeof world>]
    > = [
      ["nothing changed", start, start],
      ["a shelter was added", shelter, start],
      [
        "a bridge was added to an already open route",
        secondBridge,
        withOpenBridge,
      ],
      ["a reset removed things", start, withRain],
      ["a rewind removed the bridge", start, withOpenBridge],
    ];
    for (const [name, state, previous] of cases)
      expect(await cue("evt-" + name, state, previous), name).toBeNull();
  });

  it("does not call any provider to produce a cue", async () => {
    const fetchMock = vi.fn();
    const app = liveApp(fetchMock);
    try {
      await post(
        app,
        "/api/reactions/cue",
        reactionBody("e", withOpenBridge, start),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects malformed requests", async () => {
    const app = buildApp();
    try {
      for (const payload of [
        {},
        { event: { id: "", revision: 1, state: start } },
        { event: { id: "e", revision: -1, state: start } },
        {
          event: { id: "e", revision: 1, state: { ...start, weather: "snow" } },
        },
        { event: { id: "e", revision: 1, state: { ...start, pathStatus: 5 } } },
      ]) {
        const res = await post(app, "/api/reactions/cue", payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      }
    } finally {
      await app.close();
    }
  });

  it("cleans hero names before they are spoken", async () => {
    const odd = {
      ...nova,
      name:
        "  Sunny" +
        String.fromCharCode(0, 31) +
        " the very long named dragon of the far away mountains  ",
    };
    const start2 = world([odd, river, castle], "blocked");
    const open2 = world([odd, river, castle, bridge], "available");
    const texts = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((id) => cue(id, open2, start2)),
    );
    for (const r of texts)
      expect([...r!.text].every((c) => c.charCodeAt(0) >= 32)).toBe(true);
    const named = texts.find((r) => r!.text.includes("Sunny"));
    expect(named!.text).not.toContain("mountains");
  });
});

describe("reaction speech", () => {
  it("returns the caption and audio for a committed event", async () => {
    const fetchMock = vi.fn(async () => ttsReply());
    const app = liveApp(fetchMock);
    try {
      const res = await post(
        app,
        "/api/reactions/speech",
        reactionBody("evt-open", withOpenBridge, start),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.audioStatus).toBe("ready");
      expect(body.reaction).toMatchObject({
        eventId: "evt-open",
        emotion: "delighted",
      });
      expect(body.audio).toEqual({
        mimeType: "audio/mpeg",
        base64: audioBytes.toString("base64"),
      });
      expect(res.body).not.toContain(API_KEY);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_64",
      );
      expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(
        API_KEY,
      );
      const sent = JSON.parse(init.body as string);
      expect(sent.text).toBe(body.reaction.text);
      expect(sent.model_id).toBe("eleven_flash_v2_5");
    } finally {
      await app.close();
    }
  });

  it("speaks each emotion with a different delivery", async () => {
    const fetchMock = vi.fn(async () => ttsReply());
    const app = liveApp(fetchMock);
    try {
      for (const [id, state] of [
        ["a", withOpenBridge],
        ["a", withShortBridge],
        ["a", withRain],
      ] as const)
        await post(
          app,
          "/api/reactions/speech",
          reactionBody(id, state, start),
        );
      const settings = fetchMock.mock.calls.map((call) =>
        JSON.stringify(
          JSON.parse(
            (call as unknown as [string, RequestInit])[1].body as string,
          ).voice_settings,
        ),
      );
      expect(new Set(settings).size).toBe(3);
    } finally {
      await app.close();
    }
  });

  it("honours a configured voice and model", async () => {
    const fetchMock = vi.fn(async () => ttsReply());
    const app = liveApp(fetchMock, {
      ELEVENLABS_VOICE_ID: "custom-voice",
      ELEVENLABS_TTS_MODEL: "custom-model",
    });
    try {
      await post(
        app,
        "/api/reactions/speech",
        reactionBody("e", withOpenBridge, start),
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toContain("/text-to-speech/custom-voice");
      expect(JSON.parse(init.body as string).model_id).toBe("custom-model");
    } finally {
      await app.close();
    }
  });

  it("reuses audio for a line it has already generated", async () => {
    const fetchMock = vi.fn(async () => ttsReply());
    const app = liveApp(fetchMock);
    try {
      const request = reactionBody("evt-same", withOpenBridge, start);
      const first = await post(app, "/api/reactions/speech", request);
      const second = await post(app, "/api/reactions/speech", request);
      expect(second.json().audio).toEqual(first.json().audio);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("returns nothing to say for events that need no reaction", async () => {
    const fetchMock = vi.fn();
    const app = liveApp(fetchMock);
    try {
      const res = await post(
        app,
        "/api/reactions/speech",
        reactionBody("e", start, start),
      );
      expect(res.json()).toEqual({
        reaction: null,
        audio: null,
        audioStatus: "none",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("keeps the caption when there is no key", async () => {
    const app = buildApp();
    try {
      const res = await post(
        app,
        "/api/reactions/speech",
        reactionBody("e", withOpenBridge, start),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        reaction: { emotion: "delighted" },
        audio: null,
        audioStatus: "unavailable",
        error: { code: "PROVIDER_NOT_CONFIGURED" },
      });
    } finally {
      await app.close();
    }
  });

  it("classifies a timeout while the audio downloads", async () => {
    const stalled = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException("timed out", "TimeoutError"));
          },
        }),
        { headers: { "Content-Type": "audio/mpeg" } },
      );
    const app = liveApp(stalled);
    try {
      const res = await post(
        app,
        "/api/reactions/speech",
        reactionBody("e", withOpenBridge, start),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reaction).toMatchObject({ emotion: "delighted" });
      expect(body.audio).toBeNull();
      expect(body.audioStatus).toBe("failed");
      expect(body.error).toMatchObject({
        code: "PROVIDER_TIMEOUT",
        retryable: true,
      });
    } finally {
      await app.close();
    }
  });

  describe("keeps the caption when the voice fails", () => {
    const failures: Array<[string, () => Promise<Response>, string, boolean]> =
      [
        [
          "server error",
          async () => new Response("{}", { status: 500 }),
          "PROVIDER_FAILED",
          true,
        ],
        [
          "rate limit",
          async () => new Response("{}", { status: 429 }),
          "PROVIDER_RATE_LIMITED",
          true,
        ],
        [
          "rejected key",
          async () => new Response("{}", { status: 401 }),
          "PROVIDER_AUTH_FAILED",
          false,
        ],
        [
          "not audio",
          async () => ttsReply(200, "application/json"),
          "PROVIDER_FAILED",
          true,
        ],
        [
          "empty audio",
          async () =>
            new Response("", { headers: { "Content-Type": "audio/mpeg" } }),
          "PROVIDER_FAILED",
          true,
        ],
        [
          "network failure",
          async () => {
            throw new TypeError("fetch failed");
          },
          "PROVIDER_UNAVAILABLE",
          true,
        ],
        [
          "timeout",
          async () => {
            throw new DOMException("timed out", "TimeoutError");
          },
          "PROVIDER_TIMEOUT",
          true,
        ],
      ];
    for (const [name, respond, code, retryable] of failures)
      it(name, async () => {
        const app = liveApp(respond);
        try {
          const res = await post(
            app,
            "/api/reactions/speech",
            reactionBody("e", withShortBridge, start),
          );
          expect(res.statusCode).toBe(200);
          const body = res.json();
          expect(body.audio).toBeNull();
          expect(body.audioStatus).toBe("failed");
          expect(body.reaction).toMatchObject({ emotion: "worried" });
          expect(body.error).toMatchObject({ code, retryable });
          expect(res.body).not.toContain(API_KEY);
        } finally {
          await app.close();
        }
      });
  });

  it("does not cache a failed generation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(ttsReply());
    const app = liveApp(fetchMock);
    try {
      const request = reactionBody("evt-retry", withOpenBridge, start);
      expect(
        (await post(app, "/api/reactions/speech", request)).json().audioStatus,
      ).toBe("failed");
      expect(
        (await post(app, "/api/reactions/speech", request)).json().audioStatus,
      ).toBe("ready");
    } finally {
      await app.close();
    }
  });

  it("rejects malformed requests", async () => {
    const app = liveApp(vi.fn());
    try {
      expect(
        (await post(app, "/api/reactions/speech", { nope: 1 })).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("audio health and secrecy", () => {
  it("reports whether audio is configured", async () => {
    for (const [app, expected] of [
      [buildApp(), "unavailable"],
      [liveApp(vi.fn()), "live"],
    ] as const) {
      try {
        const res = await app.inject({ url: "/api/health" });
        expect(res.json().audioMode).toBe(expected);
        expect(res.body).not.toContain(API_KEY);
      } finally {
        await app.close();
      }
    }
  });

  it("never writes the provider key to responses or logs", async () => {
    const writes: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args) => {
        writes.push(args.map(String).join(" "));
      });
    for (const stream of [process.stdout, process.stderr])
      vi.spyOn(stream, "write").mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as typeof stream.write);

    const bodies: string[] = [];
    for (const respond of [
      async () => ttsReply(),
      async () => new Response("{}", { status: 401 }),
      async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    ]) {
      const app = liveApp(respond);
      try {
        bodies.push(
          (await app.inject({ url: "/api/elevenlabs/scribe-token" })).body,
          (
            await post(
              app,
              "/api/reactions/speech",
              reactionBody("k" + bodies.length, withOpenBridge, start),
            )
          ).body,
          (await app.inject({ url: "/api/health" })).body,
        );
      } finally {
        await app.close();
      }
    }
    expect(bodies).toHaveLength(9);
    for (const text of [...bodies, ...writes])
      expect(text).not.toContain(API_KEY);
  });
});

// The hand-built states above prove the rules; these prove the rules hold for
// the events the real simulation commits.
describe("reactions to events from the real fixture world", () => {
  const shortBridge = (): WorldOperation => ({
    type: "CREATE_ENTITY",
    entity: {
      id: "short-bridge",
      kind: "bridge",
      name: "Bridge",
      bounds: { x: 385, y: 330, width: 100, height: 55 },
    },
  });

  async function reactionAfter(
    ...steps: Array<(client: FixtureWorldClient) => Promise<void>>
  ) {
    const client = new FixtureWorldClient();
    const initial = client.getSnapshot().world!;
    for (const step of steps) await step(client);
    const events = client.getSnapshot().events;
    const last = events.at(-1)!;
    const app = buildApp();
    try {
      const res = await post(app, "/api/reactions/cue", {
        event: last,
        previousState: events.at(-2)?.state ?? initial,
      });
      expect(res.statusCode).toBe(200);
      return res.json().reaction as { emotion: string } | null;
    } finally {
      await app.close();
    }
  }

  it("a bridge across the river opens the route", async () => {
    expect(
      await reactionAfter((c) => c.apply(bridgeOperation())),
    ).toMatchObject({ emotion: "delighted" });
  });

  it("a bridge that stops short leaves the river blocking", async () => {
    expect(await reactionAfter((c) => c.apply(shortBridge()))).toMatchObject({
      emotion: "worried",
    });
  });

  it("a storm cloud brings rain", async () => {
    expect(await reactionAfter((c) => c.apply(cloudOperation()))).toMatchObject(
      { emotion: "curious" },
    );
  });

  it("rain after the route is open is still a rain reaction", async () => {
    expect(
      await reactionAfter(
        (c) => c.apply(bridgeOperation()),
        (c) => c.apply(cloudOperation()),
      ),
    ).toMatchObject({ emotion: "curious" });
  });

  it("stays quiet for a reset, a rewind, and a second bridge", async () => {
    expect(
      await reactionAfter(
        (c) => c.apply(bridgeOperation()),
        (c) => c.reset(),
      ),
    ).toBeNull();
    expect(
      await reactionAfter(
        (c) => c.apply(bridgeOperation()),
        (c) => c.rewind(0),
      ),
    ).toBeNull();
    expect(
      await reactionAfter(
        (c) => c.apply(bridgeOperation()),
        (c) => c.apply(bridgeOperation()),
      ),
    ).toBeNull();
  });
});
