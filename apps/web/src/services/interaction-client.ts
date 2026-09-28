import {
  interactionRequestSchema,
  interactionResponseSchema,
  type InteractionResponse,
} from "@storyworld/contracts";
import type { WorldState } from "@storyworld/contracts/model";
import { withoutSketches } from "@storyworld/contracts/interaction";

const FALLBACK_MESSAGE =
  "The world could not decide what happens this time. Your drawing is still in the story.";

/** A failed interaction request. The drawing stays in the world regardless. */
export class InteractionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "InteractionError";
  }
}

/**
 * Asks the API (and through it Jev) what happens now that `entityId` is in
 * the committed `world`. Without a Jev key the API answers
 * PROVIDER_NOT_CONFIGURED; callers treat that as a normal, kind outcome.
 */
export async function requestInteraction(
  world: WorldState,
  entityId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<InteractionResponse> {
  // Jev judges structure; the child's strokes stay in the browser.
  const request = interactionRequestSchema.safeParse({
    world: withoutSketches(world),
    entityId,
  });
  if (!request.success)
    throw new InteractionError(FALLBACK_MESSAGE, "INVALID_REQUEST", false);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 8000);
  let response: Response;
  try {
    response = await fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.data),
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
    });
  } catch (error) {
    const timedOut =
      timeout.aborted ||
      (error instanceof Error && error.name === "TimeoutError");
    throw new InteractionError(
      FALLBACK_MESSAGE,
      options.signal?.aborted
        ? "REQUEST_ABORTED"
        : timedOut
          ? "CLIENT_TIMEOUT"
          : "NETWORK_ERROR",
      true,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = (
      typeof body === "object" && body !== null ? body : {}
    ) as Record<string, unknown>;
    throw new InteractionError(
      typeof fields.message === "string" ? fields.message : FALLBACK_MESSAGE,
      typeof fields.code === "string" ? fields.code : "REQUEST_FAILED",
      fields.retryable === true,
    );
  }
  const parsed = interactionResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.actorId !== entityId)
    throw new InteractionError(FALLBACK_MESSAGE, "INVALID_RESPONSE", true);
  return parsed.data;
}
