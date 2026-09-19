import Fastify from "fastify";
import {
  interpretationInput,
  interpretationOutput,
} from "@storyworld/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export function buildApp() {
  const app = Fastify({ bodyLimit: 5_000_000, logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .status(400)
        .send({
          code: "INVALID_INPUT",
          message: "Please check the request fields.",
        });
    return reply
      .status(500)
      .send({
        code: "REQUEST_FAILED",
        message: "The request could not be completed.",
      });
  });
  app.get("/api/health", async () => ({
    status: "ok",
    service: "storyworld-api",
    providerMode: "fixture",
  }));
  for (const route of ["/api/interpret/scene", "/api/interpret/edit"])
    app.post(route, async (request) => {
      const input = interpretationInput.parse(request.body);
      const kind = input.entityKind ?? "bridge";
      const bounds =
        input.changedRegion ??
        (kind === "bridge"
          ? { x: 385, y: 330, width: 190, height: 55 }
          : { x: 580, y: 80, width: 150, height: 75 });
      return interpretationOutput.parse({
        mode: "fixture",
        message:
          "Fixture interpretation: selected object and drawn bounds. Live Gemini integration is pending.",
        candidates: [
          {
            confidence: 1,
            operation: {
              type: "CREATE_ENTITY",
              entity: {
                id: randomUUID(),
                kind,
                name:
                  kind === "bridge"
                    ? "Bridge"
                    : kind === "cloud"
                      ? "Storm cloud"
                      : "Shelter",
                bounds,
              },
            },
          },
        ],
      });
    });
  app.get("/api/elevenlabs/scribe-token", async (_request, reply) =>
    reply
      .status(501)
      .send({
        code: "PROVIDER_NOT_IMPLEMENTED",
        message:
          "Realtime transcription is reserved for the intelligence implementation.",
      }),
  );
  app.post("/api/reactions/speech", async (_request, reply) =>
    reply
      .status(501)
      .send({
        code: "PROVIDER_NOT_IMPLEMENTED",
        message:
          "ElevenLabs streaming speech is reserved for the intelligence implementation.",
      }),
  );
  return app;
}
