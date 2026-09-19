import type { FastifyInstance } from "fastify";
import { interpretationInput } from "@storyworld/contracts";
import {
  fixtureInterpretation,
  type Interpreter,
} from "../services/interpretation";

export function registerInterpretRoutes(
  app: FastifyInstance,
  interpreter: Interpreter,
) {
  // Initial-scene interpretation stays fixture-only until the shared
  // scene-response type is agreed with the world-engine owner.
  app.post("/api/interpret/scene", async (request) =>
    fixtureInterpretation(interpretationInput.parse(request.body)),
  );
  app.post("/api/interpret/edit", async (request) =>
    interpreter.interpret(interpretationInput.parse(request.body)),
  );
}
