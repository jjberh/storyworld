import Fastify from "fastify";
import { z } from "zod";
import { registerInterpretRoutes } from "./routes/interpret";
import { ApiError } from "./services/errors";
import { createInterpreter, type Interpreter } from "./services/interpretation";

export type AppOptions = { interpreter?: Interpreter };

export function buildApp(options: AppOptions = {}) {
  // Defaults to the keyless fixture; server.ts injects the env-configured one.
  const interpreter = options.interpreter ?? createInterpreter({});
  const app = Fastify({ bodyLimit: 5_000_000, logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    if (error instanceof z.ZodError)
      return reply.status(400).send({
        code: "INVALID_INPUT",
        message: "Please check the request fields.",
      });
    return reply.status(500).send({
      code: "REQUEST_FAILED",
      message: "The request could not be completed.",
    });
  });
  app.get("/api/health", async () => ({
    status: "ok",
    service: "storyworld-api",
    providerMode: interpreter.mode,
  }));
  registerInterpretRoutes(app, interpreter);
  app.get("/api/elevenlabs/scribe-token", async (_request, reply) =>
    reply.status(501).send({
      code: "PROVIDER_NOT_IMPLEMENTED",
      message:
        "Realtime transcription is reserved for the intelligence implementation.",
    }),
  );
  app.post("/api/reactions/speech", async (_request, reply) =>
    reply.status(501).send({
      code: "PROVIDER_NOT_IMPLEMENTED",
      message:
        "ElevenLabs streaming speech is reserved for the intelligence implementation.",
    }),
  );
  return app;
}
