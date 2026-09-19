import {
  fetchScribeToken,
  type ScribeToken,
} from "../../services/audio-client";
import { floatToPcm16 } from "./pcm";
import {
  SUPPORTED_SAMPLE_RATES,
  TranscriptionError,
  createTranscriptionSession,
  realtimeUrl,
  type SocketLike,
  type TranscriptionSession,
} from "./transcription-session";

export type TranscriberOptions = {
  onPartial?(text: string): void;
  onError?(error: TranscriptionError): void;
  fetchToken?: () => Promise<ScribeToken>;
  /** Where the audio comes from. Defaults to the microphone. */
  getStream?: () => Promise<MediaStream>;
  socketFactory?: (url: string) => SocketLike;
};

export type Transcriber = {
  /** Starts listening. Throws if voice input cannot be used. */
  start(): Promise<void>;
  /** Stops listening and resolves with the final text ("" if nothing heard). */
  stop(): Promise<string>;
  /** Stops listening and throws away what was heard. */
  cancel(): void;
};

/** Whether this browser can capture and stream microphone audio. */
export function isVoiceInputSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebSocket !== "undefined"
  );
}

// Runs on the audio thread and hands each block of samples to the page.
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

// About 85 ms at 48 kHz: small enough to feel live, large enough to be cheap.
const SAMPLES_PER_CHUNK = 4096;

const MIC_BLOCKED = new TranscriptionError(
  "The microphone is blocked. You can type instead.",
  "MICROPHONE_BLOCKED",
  false,
);

async function openMicrophone() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch {
    throw MIC_BLOCKED;
  }
}

export function createTranscriber(
  options: TranscriberOptions = {},
): Transcriber {
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let session: TranscriptionSession | null = null;
  // Sends whatever audio is still buffered; replaced once capture starts.
  let flushPending: () => void = () => undefined;

  function release() {
    stream?.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => undefined);
    stream = null;
    context = null;
  }

  return {
    async start() {
      if (session) return;
      try {
        const token = await (options.fetchToken ?? fetchScribeToken)();
        stream = await (options.getStream ?? openMicrophone)();

        context = new AudioContext();
        const rate = context.sampleRate;
        if (!(SUPPORTED_SAMPLE_RATES as readonly number[]).includes(rate))
          throw new TranscriptionError(
            "This browser's microphone cannot be used. You can type instead.",
            "UNSUPPORTED_SAMPLE_RATE",
            false,
          );
        await context.resume();
        const url = URL.createObjectURL(
          new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
        );
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }

        // Audio captured before the connection opens is queued, not lost.
        const active = createTranscriptionSession({
          url: realtimeUrl(token, rate),
          sampleRate: rate,
          socketFactory: options.socketFactory,
          onPartial: options.onPartial,
          onError: (error) => {
            options.onError?.(error);
            release();
          },
        });
        session = active;

        let buffered: Float32Array[] = [];
        let count = 0;
        const flush = () => {
          if (count === 0) return;
          const samples = new Float32Array(count);
          let offset = 0;
          for (const block of buffered) {
            samples.set(block, offset);
            offset += block.length;
          }
          buffered = [];
          count = 0;
          active.sendAudio(floatToPcm16(samples));
        };
        const capture = new AudioWorkletNode(context, "pcm-capture");
        capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
          buffered.push(event.data);
          count += event.data.length;
          if (count >= SAMPLES_PER_CHUNK) flush();
        };
        // Some browsers only run a node that reaches the output, so it is
        // routed through a muted gain to stay silent (no echo of the mic).
        const mute = context.createGain();
        mute.gain.value = 0;
        context.createMediaStreamSource(stream).connect(capture);
        capture.connect(mute).connect(context.destination);
        flushPending = flush;
      } catch (error) {
        release();
        session?.close();
        session = null;
        throw error;
      }
    },

    async stop() {
      const active = session;
      if (!active) return "";
      session = null;
      flushPending();
      release();
      return active.finish();
    },

    cancel() {
      session?.close();
      session = null;
      release();
    },
  };
}
