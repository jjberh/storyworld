import type {
  ReactionCue,
  WorldEvent,
  WorldState,
} from "@storyworld/contracts";

const FALLBACK_MESSAGE =
  "The voice is unavailable right now. Storyworld will use text instead.";

/** A failed audio request. `retryable` says whether trying again can help. */
export class AudioError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AudioError";
  }
}

export type ScribeToken = {
  token: string;
  model: string;
  websocketUrl: string;
  expiresInSeconds: number;
};

export type SpokenAudio = { mimeType: string; base64: string };

export type ReactionSpeech = {
  reaction: ReactionCue | null;
  audio: SpokenAudio | null;
  /** `none`: no reaction was needed. `unavailable`: voice is not set up. */
  audioStatus: "ready" | "unavailable" | "failed" | "none";
  error?: { code: string; message: string; retryable: boolean };
};

/** The few fields of a committed world the reaction is derived from. */
function reactionState(world: WorldState) {
  return {
    pathStatus: world.pathStatus,
    weather: world.weather,
    goal: world.goal ? { characterId: world.goal.characterId } : null,
    entities: world.entities.map(({ id, kind, name }) => ({ id, kind, name })),
  };
}

/** Only a confirmed event and the state before it are sent, never raw input. */
function reactionBody(event: WorldEvent, previous: WorldState | null) {
  return JSON.stringify({
    event: {
      id: event.id,
      revision: event.revision,
      state: reactionState(event.state),
    },
    previousState: previous ? reactionState(previous) : null,
  });
}

async function send(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AudioError(
      FALLBACK_MESSAGE,
      timedOut ? "CLIENT_TIMEOUT" : "NETWORK_ERROR",
      true,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = (
      typeof body === "object" && body !== null ? body : {}
    ) as Record<string, unknown>;
    throw new AudioError(
      typeof fields.message === "string" ? fields.message : FALLBACK_MESSAGE,
      typeof fields.code === "string" ? fields.code : "REQUEST_FAILED",
      fields.retryable === true,
    );
  }
  return body;
}

/**
 * A single-use credential for transcribing straight from the browser. Throws
 * an AudioError with code PROVIDER_NOT_CONFIGURED when voice is not set up, so
 * the caller can fall back to the text box.
 */
export async function fetchScribeToken(): Promise<ScribeToken> {
  const body = (await send(
    "/api/elevenlabs/scribe-token",
    { cache: "no-store" },
    10_000,
  )) as Partial<ScribeToken> | null;
  if (
    typeof body?.token !== "string" ||
    typeof body.websocketUrl !== "string" ||
    typeof body.model !== "string"
  )
    throw new AudioError(FALLBACK_MESSAGE, "INVALID_RESPONSE", true);
  return {
    token: body.token,
    model: body.model,
    websocketUrl: body.websocketUrl,
    expiresInSeconds:
      typeof body.expiresInSeconds === "number" ? body.expiresInSeconds : 900,
  };
}

const jsonHeaders = { "Content-Type": "application/json" };

/** The caption for a committed event, or null when it needs none. Instant. */
export async function fetchReactionCue(
  event: WorldEvent,
  previous: WorldState | null,
): Promise<ReactionCue | null> {
  const body = (await send(
    "/api/reactions/cue",
    {
      method: "POST",
      headers: jsonHeaders,
      body: reactionBody(event, previous),
    },
    3_000,
  )) as { reaction?: ReactionCue | null } | null;
  return body?.reaction ?? null;
}

/** The caption plus audio. A voice failure still returns the caption. */
export async function fetchReactionSpeech(
  event: WorldEvent,
  previous: WorldState | null,
): Promise<ReactionSpeech> {
  const body = (await send(
    "/api/reactions/speech",
    {
      method: "POST",
      headers: jsonHeaders,
      body: reactionBody(event, previous),
    },
    12_000,
  )) as Partial<ReactionSpeech> | null;
  return {
    reaction: body?.reaction ?? null,
    audio: body?.audio ?? null,
    audioStatus: body?.audioStatus ?? "failed",
    ...(body?.error ? { error: body.error } : {}),
  };
}
