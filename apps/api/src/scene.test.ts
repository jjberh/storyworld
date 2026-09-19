import { afterEach, describe, expect, it, vi } from "vitest";
import { sceneInterpretationResponseSchema } from "@storyworld/contracts";
import { buildApp } from "./app";
import { createInterpreter } from "./services/interpretation";
import { fixtureScene } from "./services/scene";

const API_KEY = "test-gemini-key-scene";
const png = "data:image/png;base64,iVBORw0KGgo=";
const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const webp =
  "data:image/webp;base64," +
  Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]).toString("base64");

const hero = {
  kind: "character",
  name: "Sunny the Dragon",
  confidence: 0.96,
  box: { xMin: 120, yMin: 480, xMax: 210, yMax: 620 },
};
const river = {
  kind: "river",
  name: "Blue River",
  confidence: 0.93,
  box: { xMin: 420, yMin: 0, xMax: 540, yMax: 1000 },
};
const castle = {
  kind: "castle",
  name: "Tall Castle",
  confidence: 0.9,
  box: { xMin: 730, yMin: 370, xMax: 880, yMax: 640 },
};
const goodScene = {
  objects: [hero, river, castle],
  openingNarration: "Sunny wants to visit the castle across the river.",
  moodHints: ["curious", "worried"],
  message: "What a wonderful picture!",
};

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

function asFetch(fn: unknown) {
  return fn as typeof fetch;
}

async function scene(app: ReturnType<typeof buildApp>, payload: object) {
  return app.inject({ method: "POST", url: "/api/interpret/scene", payload });
}

afterEach(() => vi.restoreAllMocks());

describe("live scene interpretation", () => {
  it("turns an uploaded picture into a schema-valid initial scene", async () => {
    const fetchMock = vi.fn(async () => geminiReply(goodScene));
    const app = liveApp(asFetch(fetchMock));
    try {
      const res = await scene(app, {
        image: png,
        transcript: "Sunny the dragon wants to visit the castle",
      });
      expect(res.statusCode).toBe(200);
      const body = sceneInterpretationResponseSchema.parse(res.json());
      expect(body.mode).toBe("live");
      expect(body.candidates.map(({ kind }) => kind)).toEqual([
        "character",
        "castle",
        "river",
      ]);
      // IDs are minted by the server, never taken from the model.
      for (const candidate of body.candidates)
        expect(candidate.id).toMatch(/^[a-z]+-[0-9a-f-]{36}$/);
      expect(body.characterCandidateId).toBe(body.candidates[0]!.id);
      expect(body.goalCandidateId).toBe(body.candidates[1]!.id);
      expect(body.candidates.map(({ confidence }) => confidence)).toEqual([
        0.96, 0.9, 0.93,
      ]);
      expect(body.moodHints).toEqual(["curious", "worried"]);
      expect(body.openingNarration).toContain("Sunny");

      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toContain(":generateContent");
      const sent = JSON.parse(init.body as string);
      expect(sent.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
      expect(sent.generationConfig.responseJsonSchema.$schema).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("keeps confirmation references semantically valid", () => {
    const valid = fixtureScene();
    expect(
      sceneInterpretationResponseSchema.safeParse({
        ...valid,
        characterCandidateId: "castle",
      }).success,
    ).toBe(false);
    expect(
      sceneInterpretationResponseSchema.safeParse({
        ...valid,
        candidates: [...valid.candidates, valid.candidates[0]],
      }).success,
    ).toBe(false);
  });

  it("returns image-normalized boxes for confirmation overlays", async () => {
    const app = liveApp(asFetch(async () => geminiReply(goodScene)));
    try {
      const res = await scene(app, { image: png });
      const [heroCandidate, castleCandidate, riverCandidate] =
        res.json().candidates;
      expect(heroCandidate.imageBounds).toEqual({
        x: 0.12,
        y: 0.48,
        width: 0.09,
        height: 0.14,
      });
      expect(castleCandidate.imageBounds).toEqual({
        x: 0.73,
        y: 0.37,
        width: 0.15,
        height: 0.27,
      });
      expect(riverCandidate.imageBounds).toEqual({
        x: 0.42,
        y: 0,
        width: 0.12,
        height: 1,
      });
    } finally {
      await app.close();
    }
  });

  it("keeps small boxes inside normalized image space", async () => {
    const sprawling = {
      ...goodScene,
      objects: [
        { ...hero, box: { xMin: 995, yMin: 998, xMax: 1000, yMax: 1000 } },
        { ...river, box: { xMin: 300.6, yMin: 10.4, xMax: 302.8, yMax: 11.4 } },
      ],
    };
    const app = liveApp(asFetch(async () => geminiReply(sprawling)));
    try {
      const res = await scene(app, { image: png });
      expect(res.statusCode).toBe(200);
      for (const { imageBounds } of res.json().candidates) {
        expect(imageBounds.x + imageBounds.width).toBeLessThanOrEqual(1);
        expect(imageBounds.y + imageBounds.height).toBeLessThanOrEqual(1);
        expect(imageBounds.width).toBeGreaterThan(0);
        expect(imageBounds.height).toBeGreaterThan(0);
      }
    } finally {
      await app.close();
    }
  });

  it("uses the narration to identify an ambiguous object", async () => {
    // The same tall block: a shelter without context, a castle when named.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { narration } = JSON.parse(
        JSON.parse(init.body as string).contents[0].parts[0].text,
      );
      const building = {
        ...castle,
        kind: /castle/i.test(narration ?? "") ? "castle" : "shelter",
      };
      return geminiReply({ ...goodScene, objects: [hero, river, building] });
    });
    const app = liveApp(asFetch(fetchMock));
    try {
      const kinds = async (payload: object) =>
        (await scene(app, payload))
          .json()
          .candidates.map(({ kind }: { kind: string }) => kind);
      expect(await kinds({ image: png })).toContain("shelter");
      const named = await kinds({
        image: png,
        transcript: "the big building is my castle",
      });
      expect(named).toContain("castle");
      expect(named).not.toContain("shelter");
    } finally {
      await app.close();
    }
  });

  it("keeps one hero, castle, and river and drops extra copies", async () => {
    const crowded = {
      ...goodScene,
      objects: [
        { ...river, name: "Small stream", confidence: 0.3 },
        hero,
        { ...hero, name: "Second hero", confidence: 0.5 },
        river,
        castle,
        { ...castle, name: "Other castle", confidence: 0.4 },
      ],
    };
    const app = liveApp(asFetch(async () => geminiReply(crowded)));
    try {
      const res = await scene(app, { image: png });
      const names = res
        .json()
        .candidates.map(({ name }: { name: string }) => name);
      expect(names).toEqual(["Sunny the Dragon", "Tall Castle", "Blue River"]);
    } finally {
      await app.close();
    }
  });

  it("accepts jpeg and webp pictures and scenes without a castle", async () => {
    const noCastle = { ...goodScene, objects: [hero, river] };
    const app = liveApp(asFetch(async () => geminiReply(noCastle)));
    try {
      for (const image of [jpeg, webp]) {
        const res = await scene(app, { image });
        expect(res.statusCode).toBe(200);
        expect(res.json().goalCandidateId).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });

  describe("rejects empty or invalid model output", () => {
    const cases: Record<string, unknown> = {
      "not JSON": "here is your scene!",
      "wrong shape": { scene: true },
      "unsupported kind": {
        ...goodScene,
        objects: [{ ...hero, kind: "dragon-lair" }],
      },
      "arbitrary operation": {
        ...goodScene,
        operations: [{ type: "REMOVE_ENTITY", entityId: "nova" }],
        objects: [{ operation: { type: "REMOVE_ENTITY", entityId: "nova" } }],
      },
      "box outside the picture": {
        ...goodScene,
        objects: [
          { ...hero, box: { xMin: 5000, yMin: 0, xMax: 6000, yMax: 10 } },
        ],
      },
      "box with no area": {
        ...goodScene,
        objects: [
          { ...hero, box: { xMin: 300, yMin: 300, xMax: 300, yMax: 400 } },
        ],
      },
      "inverted box": {
        ...goodScene,
        objects: [
          { ...hero, box: { xMin: 500, yMin: 100, xMax: 200, yMax: 400 } },
        ],
      },
      "confidence out of range": {
        ...goodScene,
        objects: [{ ...hero, confidence: 3 }],
      },
      "no mood hints": { ...goodScene, moodHints: [] },
      "empty narration": { ...goodScene, openingNarration: "" },
    };
    for (const [name, payload] of Object.entries(cases))
      it(name, async () => {
        const app = liveApp(asFetch(async () => geminiReply(payload)));
        try {
          const res = await scene(app, { image: png });
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

    for (const [name, objects] of [
      ["no objects", []],
      ["no character", [river, castle]],
    ] as const)
      it(name + " asks for a picture with a hero", async () => {
        const app = liveApp(
          asFetch(async () => geminiReply({ ...goodScene, objects })),
        );
        try {
          const res = await scene(app, { image: png });
          expect(res.statusCode).toBe(422);
          expect(res.json()).toMatchObject({
            code: "SCENE_NOT_RECOGNIZED",
            retryable: true,
          });
          expect(res.json().candidates).toBeUndefined();
        } finally {
          await app.close();
        }
      });
  });

  describe("provider failures are safe and recoverable", () => {
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
        const app = liveApp(asFetch(respond));
        try {
          const res = await scene(app, { image: png });
          expect(res.statusCode).toBe(status);
          expect(res.json()).toMatchObject({ code, retryable });
          expect(res.body).not.toContain(API_KEY);
        } finally {
          await app.close();
        }
      });
  });

  describe("rejects unsupported image data before calling the model", () => {
    const images: Record<string, string> = {
      "a remote URL": "https://example.com/picture.png",
      "an svg data URL": "data:image/svg+xml;base64,PHN2Zy8+",
      "a gif data URL": "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      "text labelled as png":
        "data:image/png;base64," +
        Buffer.from("not really a png").toString("base64"),
      "a png labelled as jpeg": jpeg.replace(
        "/9j/4AAQSkZJRg==",
        "iVBORw0KGgo=",
      ),
      "malformed base64": "data:image/png;base64,***",
    };
    for (const [name, image] of Object.entries(images))
      it(name, async () => {
        const fetchMock = vi.fn();
        const app = liveApp(asFetch(fetchMock));
        try {
          const res = await scene(app, { image });
          expect(res.statusCode).toBe(400);
          expect(res.json().code).toBe("UNSUPPORTED_IMAGE");
          expect(fetchMock).not.toHaveBeenCalled();
        } finally {
          await app.close();
        }
      });

    it("a missing image", async () => {
      const fetchMock = vi.fn();
      const app = liveApp(asFetch(fetchMock));
      try {
        const res = await scene(app, { transcript: "a dragon" });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe("IMAGE_REQUIRED");
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
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
      async () => geminiReply(goodScene),
      async () => geminiReply("garbage"),
      async () => new Response("{}", { status: 403 }),
      async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    ]) {
      const app = liveApp(asFetch(respond));
      try {
        const res = await scene(app, { image: png });
        bodies.push(res.body);
        const health = await app.inject({ url: "/api/health" });
        bodies.push(health.body);
      } finally {
        await app.close();
      }
    }
    expect(bodies).toHaveLength(8);
    for (const text of [...bodies, ...writes])
      expect(text).not.toContain(API_KEY);
  });
});

describe("scene timeout", () => {
  // Rejects with the signal's reason, like a real fetch that hits its timeout.
  const hangs = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) =>
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
    )) as unknown as typeof fetch;

  it("uses its own limit, longer than the edit limit", async () => {
    const slowButFine = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return geminiReply(goodScene);
    }) as typeof fetch;
    const app = buildApp({
      interpreter: createInterpreter(
        { GEMINI_API_KEY: API_KEY, GEMINI_TIMEOUT_MS: "20" },
        slowButFine,
      ),
    });
    try {
      expect((await scene(app, { image: png })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("returns a retryable timeout error when it is exceeded", async () => {
    const app = buildApp({
      interpreter: createInterpreter(
        { GEMINI_API_KEY: API_KEY, GEMINI_SCENE_TIMEOUT_MS: "20" },
        hangs,
      ),
    });
    try {
      const res = await scene(app, { image: png });
      expect(res.statusCode).toBe(504);
      expect(res.json()).toMatchObject({
        code: "PROVIDER_TIMEOUT",
        retryable: true,
      });
    } finally {
      await app.close();
    }
  });
});

describe("keyless scene fixture", () => {
  it("returns the golden scene without credentials or network", async () => {
    const fetchMock = vi.fn();
    for (const env of [{}, { GEMINI_API_KEY: "  " }]) {
      const app = buildApp({
        interpreter: createInterpreter(env, asFetch(fetchMock)),
      });
      try {
        // No image is needed: the fixture never reads the picture.
        const res = await scene(app, {});
        expect(res.statusCode).toBe(200);
        const body = sceneInterpretationResponseSchema.parse(res.json());
        expect(body.mode).toBe("fixture");
        expect(body.characterCandidateId).toBe("nova");
        expect(body.goalCandidateId).toBe("castle");
        expect(body.moodHints).toEqual(["curious", "worried"]);
        expect(body.candidates.map(({ id }) => id).sort()).toEqual([
          "castle",
          "nova",
          "river",
        ]);
      } finally {
        await app.close();
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still rejects a malformed request body", async () => {
    const app = buildApp();
    try {
      const res = await scene(app, { image: 42 });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
