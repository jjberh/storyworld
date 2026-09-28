import { LIVE_INTRO, type IntroTiming } from "./intro-motion";

type IntroStage = {
  playIntro(
    signal: AbortSignal,
    options: { timing: IntroTiming },
  ): Promise<void>;
};

/**
 * Hands the live lift-off reveal from one stage renderer to the next until
 * one of them plays it to the end. A renderer torn down mid-reveal (React
 * StrictMode's mount, unmount, mount, or a rebuild) passes it on, so the
 * reveal is never lost; once a renderer has finished it, later renderers of
 * the same stage never replay it.
 */
export class RevealHandoff {
  private owed: boolean;

  constructor(owed: boolean) {
    this.owed = owed;
  }

  /** The reveal has not finished on any renderer yet. */
  get pending() {
    return this.owed;
  }

  /**
   * Plays the reveal on `stage` if it is still owed, calling `onStarted`
   * first. Returns a cleanup that stops it when the renderer goes away.
   */
  play(stage: IntroStage, onStarted?: () => void): () => void {
    if (!this.owed) return () => undefined;
    const controller = new AbortController();
    onStarted?.();
    void stage.playIntro(controller.signal, { timing: LIVE_INTRO }).then(() => {
      if (!controller.signal.aborted) this.owed = false;
    });
    return () => controller.abort();
  }
}
