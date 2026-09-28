import { describe, expect, it, vi } from "vitest";
import { LIVE_INTRO } from "./intro-motion";
import { RevealHandoff } from "./reveal-handoff";

/** A stage whose intro finishes (or is torn down) when the test says so. */
function fakeStage() {
  const runs: { signal: AbortSignal; finish: () => void }[] = [];
  const stage = {
    playIntro: vi.fn(
      (signal: AbortSignal, options: { timing: unknown }) =>
        new Promise<void>((resolve) => {
          expect(options.timing).toBe(LIVE_INTRO);
          runs.push({ signal, finish: resolve });
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    ),
  };
  return { stage, runs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RevealHandoff", () => {
  it("survives a StrictMode-style mount, unmount and mount", async () => {
    const handoff = new RevealHandoff(true);
    const onStarted = vi.fn();
    // First mount: the renderer starts the reveal, then is torn down at once.
    const first = fakeStage();
    const stopFirst = handoff.play(first.stage, onStarted);
    stopFirst();
    await settle();
    expect(handoff.pending).toBe(true);
    // Second mount: the reveal still plays, on the renderer that stays.
    const second = fakeStage();
    handoff.play(second.stage, onStarted);
    expect(second.stage.playIntro).toHaveBeenCalledOnce();
    second.runs[0]!.finish();
    await settle();
    expect(handoff.pending).toBe(false);
    expect(onStarted).toHaveBeenCalledTimes(2);
  });

  it("never replays a finished reveal on a rebuilt renderer", async () => {
    const handoff = new RevealHandoff(true);
    const first = fakeStage();
    const stop = handoff.play(first.stage);
    first.runs[0]!.finish();
    await settle();
    stop();
    const rebuilt = fakeStage();
    const onStarted = vi.fn();
    handoff.play(rebuilt.stage, onStarted);
    expect(rebuilt.stage.playIntro).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("plays nothing when no reveal is owed", () => {
    const handoff = new RevealHandoff(false);
    const { stage } = fakeStage();
    const onStarted = vi.fn();
    handoff.play(stage, onStarted);
    expect(stage.playIntro).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
