import { randomUUID } from "node:crypto";
import {
  interpretationOutput,
  presetTraits,
  type Bounds,
  type EntityPreset,
  type EntityProperty,
  type InterpretationInput,
  type InterpretationOutput,
  type SceneInterpretationResponse,
} from "@storyworld/contracts";
import { ApiError } from "./errors";
import { propertiesFor, proposeWithGemini } from "./gemini";
import { fixtureScene, interpretSceneWithGemini } from "./scene";

export type Interpreter = {
  mode: "fixture" | "live";
  interpret(input: InterpretationInput): Promise<InterpretationOutput>;
  interpretScene(
    input: InterpretationInput,
  ): Promise<SceneInterpretationResponse>;
};

const groundBounds: Bounds = { x: 385, y: 330, width: 190, height: 55 };
const skyBounds: Bounds = { x: 580, y: 80, width: 150, height: 75 };

const presetBounds: Record<EntityPreset, Bounds> = {
  bridge: groundBounds,
  cloud: skyBounds,
  shelter: skyBounds,
};
const fixtureNames: Record<EntityPreset, string> = {
  bridge: "Bridge",
  cloud: "Storm cloud",
  shelter: "Shelter",
};
const fixtureDescriptions: Record<EntityPreset, string> = {
  bridge: "A sturdy bridge drawn by the child.",
  cloud: "A grey cloud full of rain.",
  shelter: "A cozy place to stay dry.",
};

/** Where an object goes when the child did not draw a region for it. */
function defaultBoundsFor(properties: readonly EntityProperty[]): Bounds {
  return properties.includes("weather") || properties.includes("flies")
    ? skyBounds
    : groundBounds;
}

/** Deterministic keyless response: trusts the selected tool and drawn bounds. */
export function fixtureInterpretation(
  input: InterpretationInput,
): InterpretationOutput {
  const hint = input.hint ?? "bridge";
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
            ...presetTraits(hint),
            name: fixtureNames[hint],
            description: fixtureDescriptions[hint],
            bounds: input.changedRegion ?? presetBounds[hint],
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
      interpretScene: async () => fixtureScene(),
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
      if (!input.transcript && !input.image && !input.hint)
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
          .map((candidate) => {
            const properties = propertiesFor(
              candidate.role,
              candidate.properties,
            );
            return {
              confidence: candidate.confidence,
              operation: {
                type: "CREATE_ENTITY",
                entity: {
                  id: candidate.role + "-" + randomUUID(),
                  role: candidate.role,
                  name: candidate.name,
                  description: candidate.description,
                  properties,
                  bounds: input.changedRegion ?? defaultBoundsFor(properties),
                },
              },
            };
          }),
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
    // A whole scene takes far longer than a single edit (about 7-9 s measured
    // against gemini-3.6-flash), so it gets its own, longer limit.
    interpretScene: (input) =>
      interpretSceneWithGemini(input, {
        ...options,
        timeoutMs: positiveInteger(env.GEMINI_SCENE_TIMEOUT_MS, 20000),
      }),
  };
}
