import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TranscriptionError,
  createTranscriptionSession,
  realtimeUrl,
  type SocketLike,
  type TranscriptionSessionOptions,
} from "./transcription-session";

const TOKEN = "sutkn_secret_value";

class FakeSocket implements SocketLike {
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function start(options: Partial<TranscriptionSessionOptions> = {}) {
  const socket = new FakeSocket();
  const session = createTranscriptionSession({
    url: "wss://example.test/realtime?token=" + TOKEN,
    sampleRate: 48000,
    socketFactory: () => socket,
    ...options,
  });
  return { socket, session };
}

const samples = (...values: number[]) => new Int16Array(values);

afterEach(() => vi.useRealTimers());

describe("realtimeUrl", () => {
  it("asks for the right model, format, and manual commits", () => {
    const url = realtimeUrl(
      {
        token: "sutkn_a b",
        model: "scribe_v2_realtime",
        websocketUrl: "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
        expiresInSeconds: 900,
      },
      44100,
    );
    expect(url).toBe(
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_44100&commit_strategy=manual&token=sutkn_a%20b",
    );
  });
});

describe("transcription session", () => {
  it("becomes ready when the service starts the session", async () => {
    const { socket, session } = start();
    socket.open();
    socket.receive({ message_type: "session_started", session_id: "s" });
    await expect(session.ready).resolves.toBeUndefined();
  });

  it("queues audio sent before the connection opens, in order", () => {
    const { socket, session } = start();
    session.sendAudio(samples(1, 2));
    session.sendAudio(samples(3));
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[0]).toMatchObject({
      message_type: "input_audio_chunk",
      commit: false,
      sample_rate: 48000,
    });
    const first = Buffer.from(String(socket.sent[0]!.audio_base_64), "base64");
    expect([first.readInt16LE(0), first.readInt16LE(2)]).toEqual([1, 2]);
    session.sendAudio(samples(4));
    expect(socket.sent).toHaveLength(3);
  });

  it("ignores empty chunks", () => {
    const { socket, session } = start();
    socket.open();
    session.sendAudio(new Int16Array(0));
    expect(socket.sent).toEqual([]);
  });

  it("reports partial transcripts as they arrive", () => {
    const onPartial = vi.fn();
    const { socket } = start({ onPartial });
    socket.open();
    socket.receive({ message_type: "partial_transcript", text: "I drew" });
    socket.receive({
      message_type: "partial_transcript",
      text: "I drew a bridge",
    });
    expect(onPartial.mock.calls).toEqual([["I drew"], ["I drew a bridge"]]);
  });

  it("commits on finish and resolves with the final text", async () => {
    const { socket, session } = start();
    socket.open();
    const done = session.finish();
    expect(socket.sent.at(-1)).toEqual({
      message_type: "input_audio_chunk",
      audio_base_64: "",
      commit: true,
      sample_rate: 48000,
    });
    socket.receive({
      message_type: "committed_transcript",
      text: " I drew a long wooden bridge. ",
    });
    await expect(done).resolves.toBe("I drew a long wooden bridge.");
    expect(socket.closed).toBe(true);
  });

  it("joins several committed transcripts", async () => {
    const { socket, session } = start();
    socket.open();
    socket.receive({
      message_type: "committed_transcript",
      text: "First part.",
    });
    const done = session.finish();
    socket.receive({
      message_type: "committed_transcript",
      text: "Second part.",
    });
    await expect(done).resolves.toBe("First part. Second part.");
  });

  it("accepts the timestamped committed message too", async () => {
    const { socket, session } = start();
    socket.open();
    const done = session.finish();
    socket.receive({
      message_type: "committed_transcript_with_timestamps",
      text: "hello there",
      words: [],
    });
    await expect(done).resolves.toBe("hello there");
  });

  it("resolves with an empty string when nothing was said", async () => {
    const { socket, session } = start();
    socket.open();
    const done = session.finish();
    socket.receive({ message_type: "committed_transcript", text: "" });
    await expect(done).resolves.toBe("");
  });

  it("commits after the connection opens if finished early", () => {
    const { socket, session } = start();
    void session.finish();
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([expect.objectContaining({ commit: true })]);
  });

  it("falls back to the last partial if the final never arrives", async () => {
    vi.useFakeTimers();
    const { socket, session } = start({ finishTimeoutMs: 1000 });
    socket.open();
    socket.receive({ message_type: "partial_transcript", text: "a bridge" });
    const done = session.finish();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe("a bridge");
    expect(socket.closed).toBe(true);
  });

  it("returns what it has if the connection closes while finishing", async () => {
    const { socket, session } = start();
    socket.open();
    socket.receive({ message_type: "partial_transcript", text: "so far" });
    const done = session.finish();
    socket.onclose?.();
    await expect(done).resolves.toBe("so far");
  });

  it("gives up if the service never starts the session", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { session } = start({ onError, connectTimeoutMs: 500 });
    const failed = expect(session.ready).rejects.toMatchObject({
      code: "TRANSCRIPTION_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(500);
    await failed;
    expect(onError).toHaveBeenCalledTimes(1);
  });

  describe("server errors are child-safe and classified", () => {
    const cases: Array<[string, string, boolean]> = [
      ["auth_error", "TRANSCRIPTION_AUTH_FAILED", false],
      ["quota_exceeded", "TRANSCRIPTION_QUOTA", false],
      ["rate_limited", "TRANSCRIPTION_RATE_LIMITED", true],
      ["input_error", "TRANSCRIPTION_INPUT", true],
      ["transcriber_error", "TRANSCRIPTION_FAILED", true],
      ["error", "TRANSCRIPTION_FAILED", true],
    ];
    for (const [type, code, retryable] of cases)
      it(type, async () => {
        const onError = vi.fn();
        const { socket, session } = start({ onError });
        socket.open();
        socket.receive({
          message_type: type,
          error: "internal detail " + TOKEN,
        });
        const error = onError.mock.calls[0]![0] as TranscriptionError;
        expect(error).toBeInstanceOf(TranscriptionError);
        expect(error).toMatchObject({ code, retryable });
        expect(error.message).toContain("type instead");
        expect(error.message).not.toContain("internal detail");
        expect(error.message).not.toContain(TOKEN);
        await expect(session.ready).rejects.toBe(error);
        expect(socket.closed).toBe(true);
      });
  });

  it("returns what was heard when an error interrupts finishing", async () => {
    const { socket, session } = start({ onError: () => undefined });
    socket.open();
    socket.receive({
      message_type: "partial_transcript",
      text: "half a sentence",
    });
    const done = session.finish();
    socket.receive({ message_type: "rate_limited", error: "slow down" });
    await expect(done).resolves.toBe("half a sentence");
  });

  it("reports a connection failure", async () => {
    const onError = vi.fn();
    const { socket, session } = start({ onError });
    socket.onerror?.();
    expect(onError.mock.calls[0]![0]).toMatchObject({
      code: "TRANSCRIPTION_CONNECTION",
      retryable: true,
    });
    await expect(session.ready).rejects.toBeInstanceOf(TranscriptionError);
  });

  it("treats an unexpected close as a lost connection", () => {
    const onError = vi.fn();
    const { socket } = start({ onError });
    socket.open();
    socket.onclose?.();
    expect(onError.mock.calls[0]![0]).toMatchObject({
      code: "TRANSCRIPTION_CONNECTION",
    });
  });

  it("ignores messages it cannot parse", () => {
    const onPartial = vi.fn();
    const { socket } = start({ onPartial });
    socket.open();
    socket.onmessage?.({ data: "not json" });
    socket.receive({ message_type: "something_new", text: "x" });
    expect(onPartial).not.toHaveBeenCalled();
  });

  it("stops sending once closed", () => {
    const { socket, session } = start();
    socket.open();
    session.close();
    session.sendAudio(samples(1));
    expect(socket.sent).toEqual([]);
    expect(socket.closed).toBe(true);
  });
});
