import { it, expect } from "vitest";
import { buildApp } from "./app";
it("returns explicit fixture operations and rejects malformed input", async () => {
  const app = buildApp();
  try {
    const good = await app.inject({
      method: "POST",
      url: "/api/interpret/edit",
      payload: { entityKind: "cloud" },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().mode).toBe("fixture");
    expect(good.json().candidates[0].operation.entity.kind).toBe("cloud");
    const bad = await app.inject({
      method: "POST",
      url: "/api/interpret/edit",
      payload: { entityKind: "execute-code" },
    });
    expect(bad.statusCode).toBe(400);
    const unavailable = await app.inject({
      url: "/api/elevenlabs/scribe-token",
    });
    expect(unavailable.statusCode).toBe(501);
  } finally {
    await app.close();
  }
});
