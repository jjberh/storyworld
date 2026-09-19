import { randomUUID } from "node:crypto";
import {
  interpretationOutput,
  type Bounds,
  type EntityKind,
  type InterpretationInput,
  type InterpretationOutput,
} from "@storyworld/contracts";
import { ApiError } from "./errors";
import { proposeWithGemini } from "./gemini";

export type Interpreter = {
  mode: "fixture" | "live";
  interpret(input: InterpretationInput): Promise<InterpretationOutput>;
};

type ProposableKind = Extract<EntityKind, "bridge" | "cloud" | "shelter">;

const defaultBounds: Record<ProposableKind, Bounds> = {
  bridge: { x: 385, y: 330, width: 190, height: 55 },
  cloud: { x: 580, y: 80, width: 150, height: 75 },
  shelter: { x: 580, y: 80, width: 150, height: 75 },
};
const fixtureNames: Record<ProposableKind, string> = {
  bridge: "Bridge",
  cloud: "Storm cloud",
  shelter: "Shelter",
};

/** Deterministic keyless response: trusts the selected tool and drawn bounds. */
export function fixtureInterpretation(
  input: InterpretationInput,
): InterpretationOutput {
  const kind = input.entityKind ?? "bridge";
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
            name: fixtureNames[kind],
            bounds: input.changedRegion ?? defaultBounds[kind],
          },
        },
      },
    ],
  });
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Live Gemini when GEMINI_API_KEY is set, otherwise the fixture. A live
 * failure is returned as a recoverable error instead of silently falling back
 * to fixture output, so the UI can offer a retry.
 */
export function createInterpreter(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Interpreter {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey)
    return {
      mode: "fixture",
      interpret: async (input) => fixtureInterpretation(input),
    };
  const options = {
    apiKey,
    model: env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
    // Kept below the browser client's 10 s abort so the server error wins.
    timeoutMs: positiveInteger(env.GEMINI_TIMEOUT_MS, 8000),
    fetch: fetchImpl,
  };
  return {
    mode: "live",
    async interpret(input) {
      if (!input.transcript && !input.image && !input.entityKind)
        throw new ApiError(
          400,
          "INVALID_INPUT",
          "Draw something or describe it so we know what to add.",
        );
      const proposal = await proposeWithGemini(input, options);
      const result = interpretationOutput.safeParse({
        mode: "live",
        message: proposal.message,
        candidates: [...proposal.candidates]
          .sort((a, b) => b.confidence - a.confidence)
          .map((candidate) => ({
            confidence: candidate.confidence,
            operation: {
              type: "CREATE_ENTITY",
              entity: {
                id: candidate.kind + "-" + randomUUID(),
                kind: candidate.kind,
                name: candidate.name,
                bounds: input.changedRegion ?? defaultBounds[candidate.kind],
              },
            },
          })),
      });
      if (!result.success)
        throw new ApiError(
          502,
          "INVALID_MODEL_OUTPUT",
          "The drawing helper gave an answer we could not use. Your drawing is preserved; try again.",
          true,
        );
      return result.data;
    },
  };
}
