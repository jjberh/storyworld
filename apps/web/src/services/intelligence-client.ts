import {
  interpretationOutput,
  sceneInterpretationResponseSchema,
  type InterpretationInput,
} from "@storyworld/contracts";

const FALLBACK_MESSAGE =
  "Interpretation unavailable. Your drawing is preserved; try again.";

/** A failed interpretation. The drawing is untouched; `retryable` says whether trying again can help. */
export class InterpretationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "InterpretationError";
  }
}

async function requestInterpretation(
  path: "/api/interpret/edit" | "/api/interpret/scene",
  input: InterpretationInput,
  timeoutMs: number,
) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new InterpretationError(
      FALLBACK_MESSAGE,
      timedOut ? "CLIENT_TIMEOUT" : "NETWORK_ERROR",
      true,
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const fields = typeof body === "object" && body !== null ? body : {};
    const { code, message, retryable } = fields as Record<string, unknown>;
    throw new InterpretationError(
      typeof message === "string" ? message : FALLBACK_MESSAGE,
      typeof code === "string" ? code : "REQUEST_FAILED",
      retryable === true,
    );
  }
  return response.json();
}

export async function interpretEdit(input: InterpretationInput) {
  return interpretationOutput.parse(
    await requestInterpretation("/api/interpret/edit", input, 10000),
  );
}

/** Whole-picture interpretation is slower; callers should show a non-blocking reading state. */
export async function interpretScene(input: InterpretationInput) {
  return sceneInterpretationResponseSchema.parse(
    await requestInterpretation("/api/interpret/scene", input, 25000),
  );
}
