import type { ScribeToken } from "../../services/audio-client";
import { pcm16ToBase64 } from "./pcm";

/** Sample rates the realtime service accepts as `pcm_<rate>`. */
export const SUPPORTED_SAMPLE_RATES = [
  8000, 16000, 22050, 24000, 44100, 48000,
] as const;

/** The small part of a WebSocket the session uses, so tests can fake it. */
export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
};

/** A transcription failure with a message that is safe to show a child. */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

const GENERIC = "We could not hear that. You can type instead.";

// Server message types that mean the session cannot continue.
const failures: Record<string, [string, boolean]> = {
  auth_error: ["TRANSCRIPTION_AUTH_FAILED", false],
  quota_exceeded: ["TRANSCRIPTION_QUOTA", false],
  rate_limited: ["TRANSCRIPTION_RATE_LIMITED", true],
  input_error: ["TRANSCRIPTION_INPUT", true],
  transcriber_error: ["TRANSCRIPTION_FAILED", true],
  error: ["TRANSCRIPTION_FAILED", true],
};

/** The realtime WebSocket URL for a token. Manual commit: we commit on stop. */
export function realtimeUrl(token: ScribeToken, sampleRate: number) {
  return (
    token.websocketUrl +
    "?model_id=" +
    encodeURIComponent(token.model) +
    "&audio_format=pcm_" +
    sampleRate +
    "&commit_strategy=manual&token=" +
    encodeURIComponent(token.token)
  );
}

export type TranscriptionSessionOptions = {
  url: string;
  sampleRate: number;
  socketFactory?: (url: string) => SocketLike;
  onPartial?(text: string): void;
  onError?(error: TranscriptionError): void;
  /** How long to wait for the final transcript after stopping. */
  finishTimeoutMs?: number;
  /** How long to wait for the connection before giving up. */
  connectTimeoutMs?: number;
};

export type TranscriptionSession = {
  /** Resolves once the service accepts the session. */
  ready: Promise<void>;
  sendAudio(samples: Int16Array): void;
  /** Commits what was said and resolves with the final text ("" if nothing). */
  finish(): Promise<string>;
  close(): void;
};

export function createTranscriptionSession(
  options: TranscriptionSessionOptions,
): TranscriptionSession {
  const socket = (
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as SocketLike)
  )(options.url);

  const committed: string[] = [];
  let lastPartial = "";
  let isOpen = false;
  let closed = false;
  const queued: string[] = [];
  let settleFinish: ((text: string) => void) | null = null;

  const best = () => committed.join(" ").trim() || lastPartial.trim();
  const message = (audio: string, commit: boolean) =>
    JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: audio,
      commit,
      sample_rate: options.sampleRate,
    });

  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: TranscriptionError) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A failed connection is reported through onError too; do not also raise an
  // unhandled rejection when nobody awaits `ready`.
  ready.catch(() => undefined);

  const connectTimer = setTimeout(
    () => fail(new TranscriptionError(GENERIC, "TRANSCRIPTION_TIMEOUT", true)),
    options.connectTimeoutMs ?? 8000,
  );

  function shutdown() {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  function fail(error: TranscriptionError) {
    rejectReady(error);
    options.onError?.(error);
    // Whatever was heard so far is still worth returning.
    settleFinish?.(best());
    settleFinish = null;
    shutdown();
  }

  socket.onopen = () => {
    isOpen = true;
    for (const chunk of queued.splice(0)) socket.send(chunk);
  };

  socket.onmessage = (event) => {
    let data: { message_type?: unknown; text?: unknown };
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const type = String(data.message_type);
    const text = typeof data.text === "string" ? data.text : "";
    if (type === "session_started") {
      clearTimeout(connectTimer);
      resolveReady();
    } else if (type === "partial_transcript") {
      lastPartial = text;
      options.onPartial?.(text);
    } else if (
      type === "committed_transcript" ||
      type === "committed_transcript_with_timestamps"
    ) {
      if (text.trim()) committed.push(text.trim());
      if (settleFinish) {
        settleFinish(best());
        settleFinish = null;
        shutdown();
      }
    } else if (type in failures) {
      const [code, retryable] = failures[type]!;
      fail(new TranscriptionError(GENERIC, code, retryable));
    }
  };

  socket.onerror = () =>
    fail(new TranscriptionError(GENERIC, "TRANSCRIPTION_CONNECTION", true));
  socket.onclose = () => {
    if (closed) return;
    // A close before we asked to finish means the connection was lost.
    if (settleFinish) {
      settleFinish(best());
      settleFinish = null;
      shutdown();
    } else
      fail(new TranscriptionError(GENERIC, "TRANSCRIPTION_CONNECTION", true));
  };

  return {
    ready,
    sendAudio(samples) {
      if (closed || samples.length === 0) return;
      const chunk = message(pcm16ToBase64(samples), false);
      if (isOpen) socket.send(chunk);
      else queued.push(chunk);
    },
    finish() {
      if (closed) return Promise.resolve(best());
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          settleFinish = null;
          resolve(best());
          shutdown();
        }, options.finishTimeoutMs ?? 5000);
        settleFinish = (text) => {
          clearTimeout(timer);
          resolve(text);
        };
        const commit = message("", true);
        if (isOpen) socket.send(commit);
        else queued.push(commit);
      });
    },
    close: shutdown,
  };
}
