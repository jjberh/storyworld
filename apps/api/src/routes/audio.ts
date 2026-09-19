import type { FastifyInstance } from "fastify";
import { ApiError } from "../services/errors";
import type { AudioService } from "../services/elevenlabs";
import { reactionFor, reactionRequest } from "../services/reactions";

export function registerAudioRoutes(app: FastifyInstance, audio: AudioService) {
  // Each call mints a new single-use token, so it must never be cached.
  app.get("/api/elevenlabs/scribe-token", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return audio.scribeToken();
  });

  // Instant and local: the caption can appear the moment an event commits.
  app.post("/api/reactions/cue", async (request) => ({
    reaction: reactionFor(reactionRequest.parse(request.body)),
  }));

  // Audio for the same cue. A voice failure is not an error here: the caption
  // is still returned so the UI can carry on without sound.
  app.post("/api/reactions/speech", async (request) => {
    const reaction = reactionFor(reactionRequest.parse(request.body));
    if (!reaction) return { reaction: null, audio: null, audioStatus: "none" };
    try {
      return {
        reaction,
        audio: await audio.speak(reaction),
        audioStatus: "ready",
      };
    } catch (error) {
      const known = error instanceof ApiError ? error : null;
      return {
        reaction,
        audio: null,
        audioStatus:
          known?.code === "PROVIDER_NOT_CONFIGURED" ? "unavailable" : "failed",
        error: {
          code: known?.code ?? "REQUEST_FAILED",
          message: known?.message ?? "The voice could not be played.",
          retryable: known?.retryable ?? false,
        },
      };
    }
  });
}
