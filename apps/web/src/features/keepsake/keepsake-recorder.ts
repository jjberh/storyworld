import type { ConfirmedScene } from "@storyworld/contracts";
import { StoryStageRenderer } from "../world-renderer/story-stage-renderer";
import {
  keepsakeSupport,
  movieFilename,
  type MovieFormat,
} from "./keepsake-format";
import {
  KEEPSAKE_BEAT_MS,
  MIN_END_CARD_MS,
  type KeepsakeScript,
  type KeepsakeStep,
} from "./keepsake-script";

// Records a keepsake movie in the browser. The script is replayed into a
// hidden, non-interactive second renderer (the child's own stage keeps
// running and reacting to taps), its canvas is captured with
// `captureStream()`, and MediaRecorder encodes it. Nothing is rendered on a
// server.

/** The movie's size in CSS pixels (5:3 like the stage), recorded at 1x. */
export const MOVIE_WIDTH = 960;
export const MOVIE_HEIGHT = 576;
export const MOVIE_FPS = 30;
export const MOVIE_BITS_PER_SECOND = 2_500_000;
const IMAGE_WAIT_MS = 5000;

export type KeepsakeMovie = {
  blob: Blob;
  mimeType: string;
  extension: MovieFormat["extension"];
  filename: string;
};

export type KeepsakeErrorReason = "unsupported" | "hidden" | "failed";

/** A recording problem with a message fit to show a child's grown-up. */
export class KeepsakeError extends Error {
  constructor(
    readonly reason: KeepsakeErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "KeepsakeError";
  }
}

export const HIDDEN_MESSAGE =
  "The movie stopped because Storyworld went into the background. Keep this page open and try again.";
const FAILED_MESSAGE =
  "Something went wrong while making your movie. Please try again.";

export type RecordKeepsakeOptions = {
  scene: ConfirmedScene;
  script: KeepsakeScript;
  /** Cancels the recording (for example when the button unmounts). */
  signal?: AbortSignal;
  /** Called with 0..1 as the script plays. */
  onProgress?: (fraction: number) => void;
  /** Defaults to the `prefers-reduced-motion` media query. */
  reducedMotion?: boolean;
};

/** Resolves when `signal` aborts (never rejects). */
function whenAborted(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** Waits `milliseconds` of real time, or until `signal` aborts. */
function wallWait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted || milliseconds <= 0) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });
}

function abortError() {
  return new DOMException("The movie was cancelled.", "AbortError");
}

/** Resolves once the drawing has loaded (or failed), so crops are not blank. */
function imageSettled(renderer: StoryStageRenderer, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(done, IMAGE_WAIT_MS);
    function done() {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
    unsubscribe = renderer.subscribe(() => {
      if (renderer.getSnapshot().imageStatus !== "loading") done();
    });
    if (renderer.getSnapshot().imageStatus !== "loading") done();
  });
}

/**
 * Plays `script` into a hidden stage and records it. Resolves with the movie,
 * or rejects with a `KeepsakeError` (or an AbortError when `signal` aborts).
 *
 * The hidden stage's clock stops while the tab is hidden (browsers pause
 * animation frames), which would freeze the video. The simplest honest
 * answer: if the page goes into the background mid-recording, the recording
 * stops with `HIDDEN_MESSAGE` and the child can try again.
 */
export async function recordKeepsake(
  options: RecordKeepsakeOptions,
): Promise<KeepsakeMovie> {
  const { scene, script, onProgress } = options;
  const support = keepsakeSupport();
  if (!support.supported)
    throw new KeepsakeError("unsupported", support.reason);
  const format = support.format;
  const firstWorld = script.steps.find((step) => step.kind === "intro")?.world;
  if (!firstWorld) throw new KeepsakeError("failed", FAILED_MESSAGE);
  if (options.signal?.aborted) throw abortError();
  if (document.hidden) throw new KeepsakeError("hidden", HIDDEN_MESSAGE);

  const run = new AbortController();
  let failure: Error | undefined;
  const stop = (error: Error) => {
    failure ??= error;
    run.abort();
  };
  const onAbort = () => stop(abortError());
  const onVisibility = () => {
    if (document.hidden) stop(new KeepsakeError("hidden", HIDDEN_MESSAGE));
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  document.addEventListener("visibilitychange", onVisibility);

  // Off-screen rather than display:none, so the browser keeps painting it.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.keepsakeStage = "";
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: MOVIE_WIDTH + "px",
    height: MOVIE_HEIGHT + "px",
    overflow: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(host);
  const renderer = new StoryStageRenderer({
    scene,
    world: firstWorld,
    interactive: false,
    canvasCaptions: true,
    minBeatHoldMs: KEEPSAKE_BEAT_MS,
    reducedMotion: options.reducedMotion,
    resolution: 1,
    width: MOVIE_WIDTH,
    height: MOVIE_HEIGHT,
  });
  host.appendChild(renderer.canvas);

  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  try {
    // Pixi's init cannot be interrupted, but the recording can stop waiting.
    await Promise.race([renderer.ready, whenAborted(run.signal)]);
    if (failure) throw failure;
    if (renderer.getSnapshot().canvasFailed)
      throw new KeepsakeError("failed", FAILED_MESSAGE);
    await imageSettled(renderer, run.signal);
    if (failure) throw failure;

    stream = renderer.canvas.captureStream(MOVIE_FPS);
    const active = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: MOVIE_BITS_PER_SECOND,
    });
    recorder = active;
    const chunks: Blob[] = [];
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      active.onstop = () => resolve();
      active.onerror = () => {
        stop(new KeepsakeError("failed", FAILED_MESSAGE));
        resolve();
      };
    });

    // Beats run on the stage clock so their animation is exact, but the video
    // runs on real time. On a janky device the stage clock falls behind (its
    // ticker caps each frame), so holds are measured in real time from the
    // moment recording started: they shrink to absorb any overrun and keep
    // the file within 10–15 s where the beats themselves allow it.
    let wallStart = performance.now();
    const lastStep = script.steps.at(-1);
    const playStep = (step: KeepsakeStep) => {
      renderer.showTitleCard(step.kind === "hold" ? step.titleCard : null);
      switch (step.kind) {
        case "intro":
          renderer.setWorld(step.world);
          return renderer.playIntro(run.signal, { caption: step.caption });
        case "play":
          renderer.setWorld(step.before);
          return renderer.playSequence(step.sequence, run.signal, step.world);
        case "hold": {
          const remaining =
            wallStart + step.startMs + step.durationMs - performance.now();
          // The end card always gets a moment on screen.
          return wallWait(
            step === lastStep && step.titleCard
              ? Math.max(remaining, MIN_END_CARD_MS)
              : remaining,
            run.signal,
          );
        }
      }
    };

    // Start the first step, let one frame draw it, then start recording so
    // the movie opens on the flat drawing rather than the resting stage.
    const [first, ...rest] = script.steps;
    const firstDone = playStep(first);
    await renderer.hold(1, run.signal);
    if (failure) throw failure;
    active.start(250);
    wallStart = performance.now();
    progressTimer = setInterval(() => {
      const fraction = (performance.now() - wallStart) / script.totalMs;
      onProgress?.(Math.min(1, Math.max(0, fraction)));
    }, 100);
    await firstDone;
    for (const step of rest) {
      if (failure) break;
      await playStep(step);
    }
    // A couple more frames so the last one lands in the file.
    await wallWait(80, run.signal);
    if (active.state !== "inactive") active.stop();
    await stopped;
    if (failure) throw failure;
    onProgress?.(1);
    const blob = new Blob(chunks, { type: format.fileType });
    if (blob.size === 0) throw new KeepsakeError("failed", FAILED_MESSAGE);
    return {
      blob,
      mimeType: format.fileType,
      extension: format.extension,
      filename: movieFilename(script.heroName, format.extension),
    };
  } catch (error) {
    if (error instanceof KeepsakeError) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new KeepsakeError("failed", FAILED_MESSAGE);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    options.signal?.removeEventListener("abort", onAbort);
    document.removeEventListener("visibilitychange", onVisibility);
    run.abort();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    for (const track of stream?.getTracks() ?? []) track.stop();
    renderer.destroy();
    host.remove();
  }
}
