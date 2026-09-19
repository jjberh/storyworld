import type { FastifyInstance } from "fastify";
import { interpretationInput } from "@storyworld/contracts";
import type { Interpreter } from "../services/interpretation";

export function registerInterpretRoutes(
  app: FastifyInstance,
  interpreter: Interpreter,
) {
  app.post("/api/interpret/scene", async (request) =>
    interpreter.interpretScene(interpretationInput.parse(request.body)),
  );
  app.post("/api/interpret/edit", async (request) =>
    interpreter.interpret(interpretationInput.parse(request.body)),
  );
}
