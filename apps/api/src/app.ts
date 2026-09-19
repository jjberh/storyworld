import Fastify from "fastify";
import { z } from "zod";
import { registerAudioRoutes } from "./routes/audio";
import { registerInterpretRoutes } from "./routes/interpret";
import { createAudio, type AudioService } from "./services/elevenlabs";
import { ApiError } from "./services/errors";
import {
  fixtureInterpretation,
  type Interpreter,
} from "./services/interpretation";

export type AppOptions = { interpreter?: Interpreter; audio?: AudioService };

export function buildApp(options: AppOptions = {}) {
  // Like the interpreter, audio is unavailable unless server.ts injects it.
  const audio = options.audio ?? createAudio({});
  // Defaults to the keyless fixture; server.ts injects the env-configured one.
  const interpreter: Interpreter = options.interpreter ?? {
    mode: "fixture",
    interpret: async (input) => fixtureInterpretation(input),
  };
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
    audioMode: audio.mode,
  }));
  registerInterpretRoutes(app, interpreter);
  registerAudioRoutes(app, audio);
  return app;
}
