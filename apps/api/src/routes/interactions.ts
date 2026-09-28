import type { FastifyInstance } from "fastify";
import { interactionRequestSchema } from "@storyworld/contracts/interaction";
import type { InteractionResolver } from "../services/interaction";

export function registerInteractionRoute(
  app: FastifyInstance,
  resolver: InteractionResolver,
) {
  app.post("/api/interactions", { bodyLimit: 1024 * 1024 }, async (request) =>
    resolver.resolve(interactionRequestSchema.parse(request.body)),
  );
}
