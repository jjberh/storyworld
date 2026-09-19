import type {
  ReactionCue,
  WorldEvent,
  WorldState,
} from "@storyworld/contracts";
import {
  fetchReactionCue,
  fetchReactionSpeech,
  type ReactionSpeech,
  type SpokenAudio,
} from "../../services/audio-client";

export type AudioPlayback = { finished: Promise<void>; stop(): void };
/** What the audio is doing, for the UI's speaking indicator. */
export type ReactionAudioState = "playing" | "ended" | "unavailable" | "failed";

export type ReactionPlayerOptions = {
  fetchCue(
    event: WorldEvent,
    previous: WorldState | null,
  ): Promise<ReactionCue | null>;
  fetchSpeech(
    event: WorldEvent,
    previous: WorldState | null,
  ): Promise<ReactionSpeech>;
  play(audio: SpokenAudio): AudioPlayback;
  /** Called at most once per reaction, as soon as the text is known. */
  onCaption?(cue: ReactionCue): void;
  onAudio?(state: ReactionAudioState, cue: ReactionCue): void;
  /** Remembers spoken events across a reload. Defaults to sessionStorage. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  storageKey?: string;
};

export type ReactionPlayer = {
  /**
   * Call with the confirmed events whenever they change, once the world is
   * connected. The first call only records the history that already exists, so
   * loading or reconnecting never speaks for old events. After that, an event
   * is reacted to at most once, and only the newest unseen one is spoken.
   *
   * The promise settles when the reaction is over, including playback, so call
   * it without awaiting (`void player.observe(events)`) to keep the scene from
   * waiting on speech.
   */
  observe(events: readonly WorldEvent[]): Promise<void>;
  hasPlayed(eventId: string): boolean;
  /** Stops any audio and ignores reactions that are still loading. */
  dispose(): void;
};

const DEFAULT_KEY = "storyworld:reactions:seen";
const REMEMBER_LIMIT = 200;

function defaultStorage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function createReactionPlayer(
  options: ReactionPlayerOptions,
): ReactionPlayer {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const storageKey = options.storageKey ?? DEFAULT_KEY;
  const seen = new Set<string>();
  try {
    const stored: unknown = JSON.parse(storage?.getItem(storageKey) ?? "[]");
    if (Array.isArray(stored))
      for (const id of stored) if (typeof id === "string") seen.add(id);
  } catch {
    // Unreadable storage only means a reload may repeat a reaction.
  }

  let seeded = false;
  let generation = 0;
  let current: AudioPlayback | null = null;

  function remember(ids: string[]) {
    for (const id of ids) seen.add(id);
    try {
      storage?.setItem(
        storageKey,
        JSON.stringify([...seen].slice(-REMEMBER_LIMIT)),
      );
    } catch {
      // Storage can be full or blocked; the in-memory set still dedupes.
    }
  }

  async function react(event: WorldEvent, previous: WorldState | null) {
    const mine = ++generation;
    // A newer event replaces narration that is still playing.
    current?.stop();
    current = null;
    const superseded = () => mine !== generation;

    let captioned = false;
    const caption = (cue: ReactionCue) => {
      if (captioned || superseded()) return;
      captioned = true;
      options.onCaption?.(cue);
    };

    // Ask for both at once: the caption is instant, and the audio joins later.
    const cuePromise = options.fetchCue(event, previous).then(
      (cue) => {
        if (cue) caption(cue);
      },
      () => undefined,
    );
    const speechPromise = options
      .fetchSpeech(event, previous)
      .catch(() => null);

    await cuePromise;
    const speech = await speechPromise;
    if (superseded() || !speech?.reaction) return;
    const cue = speech.reaction;
    caption(cue);

    if (!speech.audio) {
      if (speech.audioStatus !== "none")
        options.onAudio?.(
          speech.audioStatus === "unavailable" ? "unavailable" : "failed",
          cue,
        );
      return;
    }
    try {
      const playback = options.play(speech.audio);
      current = playback;
      options.onAudio?.("playing", cue);
      await playback.finished;
      if (superseded()) return;
      current = null;
      options.onAudio?.("ended", cue);
    } catch {
      if (!superseded()) options.onAudio?.("failed", cue);
    }
  }

  return {
    async observe(events) {
      if (!seeded) {
        seeded = true;
        remember(events.map((event) => event.id));
        return;
      }
      const unseen = events.filter((event) => !seen.has(event.id));
      const newest = unseen.at(-1);
      if (!newest) return;
      // Recorded before any await, so a re-render cannot trigger it twice.
      remember(unseen.map((event) => event.id));
      await react(newest, events[events.indexOf(newest) - 1]?.state ?? null);
    },
    hasPlayed: (eventId) => seen.has(eventId),
    dispose() {
      generation++;
      current?.stop();
      current = null;
    },
  };
}

/** Plays base64 audio with an <audio> element. Rejects if the browser blocks it. */
export function playBrowserAudio(audio: SpokenAudio): AudioPlayback {
  const element = new Audio(
    "data:" + audio.mimeType + ";base64," + audio.base64,
  );
  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    element.addEventListener("ended", () => resolve());
    element.addEventListener("error", () =>
      reject(new Error("The audio could not be played.")),
    );
    element.play().catch(reject);
  });
  return {
    finished,
    stop() {
      element.pause();
      resolveFinished();
    },
  };
}

/** The player wired to the real API and the browser's audio output. */
export function createBrowserReactionPlayer(
  callbacks: Pick<ReactionPlayerOptions, "onCaption" | "onAudio"> = {},
) {
  return createReactionPlayer({
    fetchCue: fetchReactionCue,
    fetchSpeech: fetchReactionSpeech,
    play: playBrowserAudio,
    ...callbacks,
  });
}
