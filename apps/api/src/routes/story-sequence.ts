import type { FastifyInstance } from "fastify";
import { storySequenceRequestSchema } from "@storyworld/contracts/story-sequence";
import {
  directStorySequence,
  type StoryDirector,
} from "../services/story-director";

export function registerStorySequenceRoute(
  app: FastifyInstance,
  director: StoryDirector,
) {
  app.post("/api/story/sequence", { bodyLimit: 1024 * 1024 }, async (request) =>
    directStorySequence(
      director,
      storySequenceRequestSchema.parse(request.body),
    ),
  );
}
