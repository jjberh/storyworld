import {
  storySequenceRequestSchema,
  type StorySequenceRequest,
} from "@storyworld/contracts/story-sequence";
import {
  storySequenceSchema,
  type StorySequence,
} from "@storyworld/contracts/story-beat";
import { z } from "zod";

const DEFAULT_MESSAGE = "The story director is unavailable.";

function optionalGuidance(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const apiErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    retryable: z.boolean().optional(),
  })
  .passthrough();

export class StorySequenceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StorySequenceError";
  }
}

export type StorySequenceClientOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export async function requestStorySequence(
  request: StorySequenceRequest,
  options: StorySequenceClientOptions = {},
): Promise<StorySequence> {
  const parsedRequest = storySequenceRequestSchema.safeParse({
    ...request,
    childDescription: optionalGuidance(request.childDescription),
    openingNarration: optionalGuidance(request.openingNarration),
  });
  if (!parsedRequest.success)
    throw new StorySequenceError(
      "The committed story moment could not be directed.",
      "INVALID_REQUEST",
      false,
    );

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 12_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/story/sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedRequest.data),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted)
      throw new StorySequenceError(
        "The story request was cancelled.",
        "REQUEST_ABORTED",
        true,
      );
    const timedOut =
      timeoutSignal.aborted ||
      (error instanceof Error && error.name === "TimeoutError");
    throw new StorySequenceError(
      DEFAULT_MESSAGE,
      timedOut ? "CLIENT_TIMEOUT" : "NETWORK_ERROR",
      true,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body);
    throw new StorySequenceError(
      parsedError.success ? parsedError.data.message : DEFAULT_MESSAGE,
      parsedError.success ? parsedError.data.code : "REQUEST_FAILED",
      parsedError.success && parsedError.data.retryable === true,
    );
  }

  const sequence = storySequenceSchema.safeParse(body);
  if (!sequence.success)
    throw new StorySequenceError(
      "The story director returned an unusable moment.",
      "INVALID_RESPONSE",
      true,
    );
  return sequence.data;
}
