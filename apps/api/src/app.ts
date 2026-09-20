import Fastify from "fastify";
import { z } from "zod";
import { registerInterpretRoutes } from "./routes/interpret";
import { registerStorySequenceRoute } from "./routes/story-sequence";
import { ApiError } from "./services/errors";
import { createInterpreter, type Interpreter } from "./services/interpretation";
import {
  createStoryDirector,
  type StoryDirector,
} from "./services/story-director";

export type AppOptions = {
  interpreter?: Interpreter;
  storyDirector?: StoryDirector;
};

export function buildApp(options: AppOptions = {}) {
  // Defaults to the keyless fixture; server.ts injects the env-configured one.
  const interpreter = options.interpreter ?? createInterpreter({});
  const storyDirector = options.storyDirector ?? createStoryDirector({});
  const app = Fastify({ bodyLimit: 5_000_000, logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    const parserError = error as { statusCode?: number; code?: string };
    if (parserError.statusCode === 413)
      return reply.status(413).send({
        code: "PAYLOAD_TOO_LARGE",
        message: "The request is too large.",
      });
    if (
      parserError.statusCode === 400 &&
      parserError.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    )
      return reply.status(400).send({
        code: "INVALID_INPUT",
        message: "Please check the request fields.",
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
    storyProviderMode: storyDirector.mode,
  }));
  registerInterpretRoutes(app, interpreter);
  registerStorySequenceRoute(app, storyDirector);
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
