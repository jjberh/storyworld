import {
  interpretationOutput,
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

export async function interpretEdit(input: InterpretationInput) {
  let response: Response;
  try {
    response = await fetch("/api/interpret/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
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
  return interpretationOutput.parse(await response.json());
}
