import { useEffect, useRef, useState } from "react";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { WorldEvent } from "@storyworld/contracts/model";
import type { StorySequence } from "@storyworld/contracts/story-beat";
import { keepsakeSupport } from "./keepsake-format";
import { KeepsakeError, recordKeepsake } from "./keepsake-recorder";
import { buildKeepsakeScript } from "./keepsake-script";
import { downloadMovie, shareMovie, shouldShareMovie } from "./save-movie";

type KeepsakeState =
  | { status: "idle" }
  | { status: "recording"; progress: number }
  | { status: "share-ready"; file: File; title: string; sharing: boolean }
  | { status: "saved" }
  | { status: "shared" }
  | { status: "error"; message: string };

const RETRY_MESSAGE =
  "Your movie didn't finish this time. Tap the button to try again.";

function reducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * "Save my movie": records a 10–15 second keepsake of the room (the reveal
 * and the best story moment) in the browser, then shares or downloads it.
 */
export function KeepsakeButton({
  scene,
  events,
  sequences,
}: {
  scene: ConfirmedScene;
  events: readonly WorldEvent[];
  sequences: ReadonlyMap<string, StorySequence>;
}) {
  const [support] = useState(() => keepsakeSupport());
  const [state, setState] = useState<KeepsakeState>({ status: "idle" });
  const recording = useRef<AbortController | null>(null);
  const sharing = useRef(false);

  useEffect(() => () => recording.current?.abort(), []);

  // A finished movie (and the File it holds) belongs to the story as it was;
  // once the room commits something new, offer a fresh movie instead.
  const latestEventId = events.at(-1)?.id;
  useEffect(() => {
    if (sharing.current) return;
    setState((current) =>
      current.status === "idle" || current.status === "recording"
        ? current
        : { status: "idle" },
    );
  }, [latestEventId]);

  async function makeMovie() {
    const script = buildKeepsakeScript({
      events,
      sequences,
      openingNarration: scene.openingNarration,
      reducedMotion: reducedMotion(),
    });
    if (!script) {
      setState({ status: "error", message: RETRY_MESSAGE });
      return;
    }
    recording.current?.abort();
    const controller = new AbortController();
    recording.current = controller;
    setState({ status: "recording", progress: 0 });
    try {
      const movie = await recordKeepsake({
        scene,
        script,
        signal: controller.signal,
        reducedMotion: reducedMotion(),
        onProgress: (progress) => {
          if (!controller.signal.aborted)
            setState({ status: "recording", progress });
        },
      });
      if (controller.signal.aborted) return;
      const file = new File([movie.blob], movie.filename, {
        type: movie.mimeType,
      });
      if (shouldShareMovie(file)) {
        // Sharing needs a fresh tap; recording outlasts the first one.
        setState({
          status: "share-ready",
          file,
          title: script.title,
          sharing: false,
        });
        return;
      }
      downloadMovie(movie.blob, movie.filename);
      setState({ status: "saved" });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof KeepsakeError ? error.message : RETRY_MESSAGE,
      });
    } finally {
      if (recording.current === controller) recording.current = null;
    }
  }

  async function share(file: File, title: string) {
    // A second tap while the sheet is open would be rejected by the browser.
    if (sharing.current) return;
    sharing.current = true;
    setState((current) =>
      current.status === "share-ready"
        ? { ...current, sharing: true }
        : current,
    );
    try {
      const result = await shareMovie(file, title);
      if (result === "shared") setState({ status: "shared" });
      else
        setState((current) =>
          current.status === "share-ready"
            ? { ...current, sharing: false }
            : current,
        );
    } catch {
      // The sheet refused (for example the tap expired): download instead.
      downloadMovie(file, file.name);
      setState({ status: "saved" });
    } finally {
      sharing.current = false;
    }
  }

  const busy = state.status === "recording";
  let help = "Make a short movie of your story to keep.";
  if (!support.supported) help = support.reason;
  else if (state.status === "recording") help = "Making your movie…";
  else if (state.status === "share-ready") help = "Your movie is ready!";
  else if (state.status === "saved")
    help = "Saved! Your movie is in your downloads.";
  else if (state.status === "shared") help = "Shared!";
  else if (state.status === "error") help = state.message;

  return (
    <div className="movie-card" data-testid="keepsake">
      <h2>Your Movie</h2>
      <p
        className={
          state.status === "error" ? "card-help movie-error" : "card-help"
        }
        role={state.status === "error" ? "alert" : undefined}
        aria-live="polite"
      >
        {help}
      </p>
      {busy && (
        <progress
          className="movie-progress"
          max={1}
          value={state.progress}
          aria-label="Movie progress"
        />
      )}
      {state.status === "share-ready" ? (
        <>
          <button
            type="button"
            className="primary-action"
            disabled={state.sharing}
            onClick={() => void share(state.file, state.title)}
          >
            Share my movie
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={state.sharing}
            onClick={() => void makeMovie()}
          >
            Make a new movie
          </button>
        </>
      ) : (
        <button
          type="button"
          className="primary-action"
          disabled={!support.supported || busy}
          aria-busy={busy}
          onClick={() => void makeMovie()}
        >
          {busy
            ? "Making your movie…"
            : state.status === "error"
              ? "Try again"
              : "Save my movie"}
        </button>
      )}
    </div>
  );
}
