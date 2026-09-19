import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { createInterpreter } from "./services/interpretation";

const API_KEY = "test-gemini-key";
const region = { x: 400, y: 320, width: 200, height: 60 };
const pixel = "data:image/png;base64,iVBORw0KGgo=";

function geminiReply(payload: unknown, status = 200) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status },
  );
}

function liveApp(fetchImpl: typeof fetch) {
  return buildApp({
    interpreter: createInterpreter({ GEMINI_API_KEY: API_KEY }, fetchImpl),
  });
}

async function interpret(app: ReturnType<typeof buildApp>, payload: object) {
  return app.inject({
    method: "POST",
    url: "/api/interpret/edit",
    payload,
  });
}

describe("live Gemini interpretation", () => {
  it("turns narration into a schema-valid bridge operation", async () => {
    const fetchMock = vi.fn(async () =>
      geminiReply({
        candidates: [
          { kind: "cloud", name: "Puffy cloud", confidence: 0.2 },
          { kind: "bridge", name: "Rainbow bridge", confidence: 0.9 },
        ],
        message: "What a lovely bridge!",
      }),
    );
    const app = liveApp(fetchMock as unknown as typeof fetch);
    try {
      const res = await interpret(app, {
        transcript: "a bridge over the river",
        changedRegion: region,
        image: pixel,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mode).toBe("live");
      expect(body.candidates[0].operation).toMatchObject({
        type: "CREATE_ENTITY",
        entity: { kind: "bridge", name: "Rainbow bridge", bounds: region },
      });
      expect(body.candidates[0].operation.entity.id).toMatch(/^bridge-/);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toContain("gemini-3.6-flash:generateContent");
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
        API_KEY,
      );
      const sent = JSON.parse(init.body as string);
      expect(sent.generationConfig.responseMimeType).toBe("application/json");
      expect(sent.generationConfig.responseJsonSchema.$schema).toBeUndefined();
      expect(sent.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
      expect(init.body as string).not.toContain(API_KEY);
    } finally {
      await app.close();
    }
  });

  it("uses the drawn region, not model geometry, for bounds", async () => {
    const app = liveApp((async () =>
      geminiReply({
        candidates: [{ kind: "cloud", name: "Storm cloud", confidence: 1 }],
        message: "A storm is coming!",
        // Extra fields are not part of the schema and must not leak through.
        bounds: { x: 0, y: 0, width: 1000, height: 600 },
      })) as typeof fetch);
    try {
      const res = await interpret(app, { entityKind: "cloud" });
      expect(res.json().candidates[0].operation.entity.bounds).toEqual({
        x: 580,
        y: 80,
        width: 150,
        height: 75,
      });
    } finally {
      await app.close();
    }
  });

  it("ignores thought parts that precede the answer", async () => {
    const answer = {
      candidates: [{ kind: "bridge", name: "Bridge", confidence: 0.8 }],
      message: "Nice bridge!",
    };
    const app = liveApp(
      (async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "Let me think about the drawing...",
                      thought: true,
                    },
                    { text: JSON.stringify(answer) },
                  ],
                },
              },
            ],
          }),
        )) as typeof fetch,
    );
    try {
      const res = await interpret(app, { entityKind: "bridge" });
      expect(res.statusCode).toBe(200);
      expect(res.json().candidates[0].operation.entity.kind).toBe("bridge");
    } finally {
      await app.close();
    }
  });

  it("returns an empty candidate list when nothing is recognized", async () => {
    const app = liveApp((async () =>
      geminiReply({
        candidates: [],
        message: "I could not tell what that is yet.",
      })) as typeof fetch);
    try {
      const res = await interpret(app, { transcript: "scribble" });
      expect(res.statusCode).toBe(200);
      expect(res.json().candidates).toEqual([]);
    } finally {
      await app.close();
    }
  });

  describe("rejects invalid model output without leaking an operation", () => {
    const cases: Record<string, unknown> = {
      "not JSON": "here is a bridge!",
      "wrong shape": { bridge: true },
      "unsupported kind": {
        candidates: [{ kind: "character", name: "Dragon", confidence: 1 }],
        message: "hi",
      },
      "smuggled operation": {
        candidates: [
          { operation: { type: "REMOVE_ENTITY", entityId: "nova" } },
        ],
        message: "hi",
      },
      "confidence out of range": {
        candidates: [{ kind: "bridge", name: "Bridge", confidence: 7 }],
        message: "hi",
      },
    };
    for (const [name, payload] of Object.entries(cases))
      it(name, async () => {
        const app = liveApp((async () => geminiReply(payload)) as typeof fetch);
        try {
          const res = await interpret(app, { entityKind: "bridge" });
          expect(res.statusCode).toBe(502);
          expect(res.json()).toMatchObject({
            code: "INVALID_MODEL_OUTPUT",
            retryable: true,
          });
          expect(res.json().candidates).toBeUndefined();
        } finally {
          await app.close();
        }
      });

    it("empty response envelope", async () => {
      const app = liveApp(
        (async () => new Response(JSON.stringify({}))) as typeof fetch,
      );
      try {
        const res = await interpret(app, { entityKind: "bridge" });
        expect(res.statusCode).toBe(502);
        expect(res.json().code).toBe("INVALID_MODEL_OUTPUT");
      } finally {
        await app.close();
      }
    });
  });

  describe("recoverable provider failures", () => {
    const failures: Array<
      [string, () => Promise<Response>, number, string, boolean]
    > = [
      [
        "server error",
        async () => new Response("{}", { status: 500 }),
        502,
        "PROVIDER_FAILED",
        true,
      ],
      [
        "client error",
        async () => new Response("{}", { status: 400 }),
        502,
        "PROVIDER_FAILED",
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
        "rejected key",
        async () => new Response("{}", { status: 403 }),
        502,
        "PROVIDER_AUTH_FAILED",
        false,
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
        const app = liveApp(respond as unknown as typeof fetch);
        try {
          const res = await interpret(app, { entityKind: "bridge" });
          expect(res.statusCode).toBe(status);
          expect(res.json()).toMatchObject({ code, retryable });
          expect(res.body).not.toContain(API_KEY);
          expect(res.json().message).toContain("drawing is preserved");
        } finally {
          await app.close();
        }
      });
  });

  it("rejects an image that is not a supported data URL", async () => {
    const fetchMock = vi.fn();
    const app = liveApp(fetchMock as unknown as typeof fetch);
    try {
      const res = await interpret(app, {
        entityKind: "bridge",
        image: "https://example.com/drawing.png",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_INPUT");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("asks for something to interpret instead of calling the model", async () => {
    const fetchMock = vi.fn();
    const app = liveApp(fetchMock as unknown as typeof fetch);
    try {
      const res = await interpret(app, {});
      expect(res.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe("keyless fixture mode", () => {
  it("completes the bridge flow without credentials or network", async () => {
    const fetchMock = vi.fn();
    for (const env of [{}, { GEMINI_API_KEY: "  " }]) {
      const app = buildApp({
        interpreter: createInterpreter(
          env,
          fetchMock as unknown as typeof fetch,
        ),
      });
      try {
        const health = await app.inject({ url: "/api/health" });
        expect(health.json().providerMode).toBe("fixture");
        const res = await interpret(app, {
          entityKind: "bridge",
          changedRegion: region,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().mode).toBe("fixture");
        expect(res.json().candidates[0].operation.entity).toMatchObject({
          kind: "bridge",
          bounds: region,
        });
      } finally {
        await app.close();
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports live mode in health when a key is configured", async () => {
    const app = liveApp(vi.fn() as unknown as typeof fetch);
    try {
      const health = await app.inject({ url: "/api/health" });
      expect(health.json().providerMode).toBe("live");
      expect(health.body).not.toContain(API_KEY);
    } finally {
      await app.close();
    }
  });

  it("keeps the scene route on the fixture until its contract is agreed", async () => {
    const fetchMock = vi.fn();
    const app = liveApp(fetchMock as unknown as typeof fetch);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/interpret/scene",
        payload: { entityKind: "bridge" },
      });
      expect(res.json().mode).toBe("fixture");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
