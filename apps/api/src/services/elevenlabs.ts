import type { ReactionCue, StoryMood } from "@storyworld/contracts";
import { ApiError } from "./errors";

const API = "https://api.elevenlabs.io";
const REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
// Documented lifetime of a single-use realtime token.
const TOKEN_TTL_SECONDS = 900;
const MAX_AUDIO_BYTES = 2_000_000;
const CACHE_LIMIT = 64;

export type ScribeToken = {
  token: string;
  model: string;
  websocketUrl: string;
  expiresInSeconds: number;
};
export type SpokenAudio = { mimeType: "audio/mpeg"; base64: string };

export type AudioService = {
  mode: "live" | "unavailable";
  /** A short-lived credential the browser uses to transcribe directly. */
  scribeToken(): Promise<ScribeToken>;
  speak(cue: ReactionCue): Promise<SpokenAudio>;
};

// Same character, different delivery: only the tone changes with the emotion.
const voiceSettings: Record<StoryMood, Record<string, number>> = {
  delighted: {
    stability: 0.35,
    similarity_boost: 0.75,
    style: 0.6,
    speed: 1.05,
  },
  worried: { stability: 0.55, similarity_boost: 0.75, style: 0.3, speed: 0.95 },
  curious: { stability: 0.45, similarity_boost: 0.75, style: 0.4, speed: 1.0 },
};

function notConfigured() {
  return new ApiError(
    503,
    "PROVIDER_NOT_CONFIGURED",
    "Voice is not set up here, so Storyworld will use text instead.",
  );
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Without a key the service reports itself unavailable instead of faking audio. */
export function createAudio(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): AudioService {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey)
    return {
      mode: "unavailable",
      scribeToken: async () => {
        throw notConfigured();
      },
      speak: async () => {
        throw notConfigured();
      },
    };

  const voiceId = env.ELEVENLABS_VOICE_ID?.trim() || "EXAVITQu4vr4xnSDxMaL";
  const ttsModel = env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5";
  const sttModel = env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2_realtime";
  // Kept below the browser client's abort so the server error wins.
  const timeoutMs = positiveInteger(env.ELEVENLABS_TIMEOUT_MS, 8000);
  const cache = new Map<string, SpokenAudio>();

  // A dropped connection or timeout, whether while sending or while reading.
  function transportFailure(error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError")
      return new ApiError(
        504,
        "PROVIDER_TIMEOUT",
        "The voice helper took too long.",
        true,
      );
    return new ApiError(
      502,
      "PROVIDER_UNAVAILABLE",
      "The voice helper is unavailable.",
      true,
    );
  }

  // Turns every transport or upstream failure into a safe, recoverable error.
  async function request(path: string, init: RequestInit) {
    let response: Response;
    try {
      response = await fetchImpl(API + path, {
        ...init,
        headers: { ...init.headers, "xi-api-key": apiKey! },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw transportFailure(error);
    }
    if (response.status === 429)
      throw new ApiError(
        503,
        "PROVIDER_RATE_LIMITED",
        "The voice helper is busy. Try again in a moment.",
        true,
      );
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        502,
        "PROVIDER_AUTH_FAILED",
        "The voice helper is not set up correctly.",
      );
    if (!response.ok)
      throw new ApiError(
        502,
        "PROVIDER_FAILED",
        "The voice helper had a problem.",
        response.status >= 500,
      );
    return response;
  }

  return {
    mode: "live",

    async scribeToken() {
      const response = await request("/v1/single-use-token/realtime_scribe", {
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);
      const token =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>).token
          : undefined;
      if (typeof token !== "string" || !token)
        throw new ApiError(
          502,
          "PROVIDER_FAILED",
          "The voice helper had a problem.",
          true,
        );
      return {
        token,
        model: sttModel,
        websocketUrl: REALTIME_URL,
        expiresInSeconds: TOKEN_TTL_SECONDS,
      };
    },

    async speak(cue) {
      // The same line is asked for again on every demo run; keep recent ones.
      const cacheKey = [voiceId, ttsModel, cue.emotion, cue.text].join("|");
      const hit = cache.get(cacheKey);
      if (hit) {
        cache.delete(cacheKey);
        cache.set(cacheKey, hit);
        return hit;
      }
      const response = await request(
        "/v1/text-to-speech/" +
          encodeURIComponent(voiceId) +
          "?output_format=mp3_44100_64",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: cue.text,
            model_id: ttsModel,
            voice_settings: voiceSettings[cue.emotion],
          }),
        },
      );
      // The timeout also covers the download, so it can fail after the headers.
      let bytes: Buffer;
      try {
        bytes = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        throw transportFailure(error);
      }
      if (
        !response.headers.get("content-type")?.startsWith("audio/") ||
        bytes.length === 0 ||
        bytes.length > MAX_AUDIO_BYTES
      )
        throw new ApiError(
          502,
          "PROVIDER_FAILED",
          "The voice helper had a problem.",
          true,
        );
      const audio: SpokenAudio = {
        mimeType: "audio/mpeg",
        base64: bytes.toString("base64"),
      };
      cache.set(cacheKey, audio);
      if (cache.size > CACHE_LIMIT)
        cache.delete(cache.keys().next().value as string);
      return audio;
    },
  };
}
