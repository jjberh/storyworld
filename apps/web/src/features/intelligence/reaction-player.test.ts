import { describe, expect, it, vi } from "vitest";
import type {
  ReactionCue,
  WorldEvent,
  WorldState,
} from "@storyworld/contracts";
import type { ReactionSpeech } from "../../services/audio-client";
import {
  createReactionPlayer,
  type AudioPlayback,
  type ReactionPlayerOptions,
} from "./reaction-player";

function state(revision: number): WorldState {
  return {
    id: "w",
    revision,
    schemaVersion: 1,
    entities: [],
    rules: [],
    goal: null,
    pathStatus: "blocked",
    weather: "clear",
  };
}
const event = (id: string, revision: number): WorldEvent => ({
  id,
  revision,
  actor: "You",
  summary: id,
  state: state(revision),
});

const cue = (eventId: string): ReactionCue => ({
  eventId,
  text: "Hooray for " + eventId,
  emotion: "delighted",
});
const speech = (eventId: string, overrides: Partial<ReactionSpeech> = {}) =>
  ({
    reaction: cue(eventId),
    audio: { mimeType: "audio/mpeg", base64: "AAAA" },
    audioStatus: "ready",
    ...overrides,
  }) as ReactionSpeech;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function setup(
  overrides: Partial<ReactionPlayerOptions> = {},
  { manual = false }: { manual?: boolean } = {},
) {
  const log: string[] = [];
  const playbacks: Array<{
    playback: AudioPlayback;
    finish(): void;
    stopped: boolean;
  }> = [];
  const options: ReactionPlayerOptions = {
    fetchCue: vi.fn(async (e: WorldEvent) => cue(e.id)),
    fetchSpeech: vi.fn(async (e: WorldEvent) => speech(e.id)),
    play: vi.fn(() => {
      const finished = deferred<void>();
      // Audio ends instantly unless a test wants to control when it ends.
      if (!manual) finished.resolve();
      const entry = {
        stopped: false,
        finish: () => finished.resolve(),
        playback: {
          finished: finished.promise,
          stop: () => {
            entry.stopped = true;
            finished.resolve();
          },
        },
      };
      playbacks.push(entry);
      return entry.playback;
    }),
    onCaption: (c) => log.push("caption:" + c.eventId),
    onAudio: (s, c) => log.push(s + ":" + c.eventId),
    storage: memoryStorage(),
    ...overrides,
  };
  return { options, player: createReactionPlayer(options), log, playbacks };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("reaction player", () => {
  it("only records existing history the first time, without speaking", async () => {
    const { player, options, log } = setup();
    await player.observe([event("e1", 1), event("e2", 2)]);
    expect(options.fetchCue).not.toHaveBeenCalled();
    expect(options.fetchSpeech).not.toHaveBeenCalled();
    expect(log).toEqual([]);
    expect(player.hasPlayed("e2")).toBe(true);
  });

  it("captions, then speaks, a new confirmed event", async () => {
    const { player, options, log, playbacks } = setup({}, { manual: true });
    await player.observe([event("e1", 1)]);
    const done = player.observe([event("e1", 1), event("e2", 2)]);
    await flush();
    expect(log).toEqual(["caption:e2", "playing:e2"]);
    playbacks[0]!.finish();
    await done;
    expect(log).toEqual(["caption:e2", "playing:e2", "ended:e2"]);
    expect(options.play).toHaveBeenCalledWith({
      mimeType: "audio/mpeg",
      base64: "AAAA",
    });
  });

  it("passes the previous event's state for comparison", async () => {
    const { player, options } = setup();
    await player.observe([event("e1", 1)]);
    void player.observe([event("e1", 1), event("e2", 2)]);
    await flush();
    const [sent, previous] = (options.fetchCue as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(sent.id).toBe("e2");
    expect(previous.revision).toBe(1);
  });

  it("passes null when the event is the first in the history", async () => {
    const { player, options } = setup();
    await player.observe([]);
    void player.observe([event("e1", 1)]);
    await flush();
    expect(
      (options.fetchCue as ReturnType<typeof vi.fn>).mock.calls[0]![1],
    ).toBeNull();
  });

  it("shows the caption immediately without waiting for slow speech", async () => {
    const slow = deferred<ReactionSpeech>();
    const { player, log } = setup({ fetchSpeech: vi.fn(() => slow.promise) });
    await player.observe([]);
    void player.observe([event("e1", 1)]);
    await flush();
    expect(log).toEqual(["caption:e1"]);
    slow.resolve(speech("e1"));
    await flush();
    expect(log).toEqual(["caption:e1", "playing:e1", "ended:e1"]);
  });

  it("never reacts to the same event twice across re-renders", async () => {
    const { player, options } = setup();
    await player.observe([]);
    const events = [event("e1", 1)];
    await Promise.all([
      player.observe(events),
      player.observe(events),
      player.observe([...events]),
    ]);
    await player.observe(events);
    expect(options.fetchCue).toHaveBeenCalledTimes(1);
    expect(options.fetchSpeech).toHaveBeenCalledTimes(1);
    expect(options.play).toHaveBeenCalledTimes(1);
  });

  it("does not repeat after a reload of the same session", async () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    await first.player.observe([]);
    void first.player.observe([event("e1", 1)]);
    await flush();
    expect(first.options.fetchSpeech).toHaveBeenCalledTimes(1);

    // A reload: a new player, the same session storage, the same history.
    const second = setup({ storage });
    await second.player.observe([]);
    await second.player.observe([event("e1", 1)]);
    expect(second.options.fetchCue).not.toHaveBeenCalled();
    expect(second.player.hasPlayed("e1")).toBe(true);
  });

  it("does not speak for history that loads after connecting", async () => {
    const { player, options } = setup();
    await player.observe([event("h1", 1), event("h2", 2), event("h3", 3)]);
    await player.observe([event("h1", 1), event("h2", 2), event("h3", 3)]);
    expect(options.fetchSpeech).not.toHaveBeenCalled();
  });

  it("reacts only to the newest of several new events but remembers all", async () => {
    const { player, options, log } = setup();
    await player.observe([]);
    void player.observe([event("a", 1), event("b", 2), event("c", 3)]);
    await flush();
    expect(log[0]).toBe("caption:c");
    expect(options.fetchCue).toHaveBeenCalledTimes(1);
    for (const id of ["a", "b", "c"]) expect(player.hasPlayed(id)).toBe(true);
  });

  it("stays silent, but still remembers, when an event needs no reaction", async () => {
    const { player, log, options } = setup({
      fetchCue: vi.fn(async () => null),
      fetchSpeech: vi.fn(async () => ({
        reaction: null,
        audio: null,
        audioStatus: "none" as const,
      })),
    });
    await player.observe([]);
    await player.observe([event("e1", 1)]);
    expect(log).toEqual([]);
    expect(options.play).not.toHaveBeenCalled();
    expect(player.hasPlayed("e1")).toBe(true);
  });

  describe("degrades to captions when audio cannot play", () => {
    it("the voice request fails", async () => {
      const { player, log } = setup({
        fetchSpeech: vi.fn(async () => {
          throw new Error("network");
        }),
      });
      await player.observe([]);
      await player.observe([event("e1", 1)]);
      expect(log).toEqual(["caption:e1"]);
    });

    it("the server reports the voice failed", async () => {
      const { player, log } = setup({
        fetchSpeech: vi.fn(async (e: WorldEvent) =>
          speech(e.id, { audio: null, audioStatus: "failed" }),
        ),
      });
      await player.observe([]);
      await player.observe([event("e1", 1)]);
      expect(log).toEqual(["caption:e1", "failed:e1"]);
    });

    it("voice is not configured", async () => {
      const { player, log } = setup({
        fetchSpeech: vi.fn(async (e: WorldEvent) =>
          speech(e.id, { audio: null, audioStatus: "unavailable" }),
        ),
      });
      await player.observe([]);
      await player.observe([event("e1", 1)]);
      expect(log).toEqual(["caption:e1", "unavailable:e1"]);
    });

    it("the browser blocks playback", async () => {
      const { player, log } = setup({
        play: vi.fn(() => {
          throw new Error("NotAllowedError");
        }),
      });
      await player.observe([]);
      await player.observe([event("e1", 1)]);
      expect(log).toEqual(["caption:e1", "failed:e1"]);
    });

    it("playback ends in an error", async () => {
      const { player, log } = setup({
        play: vi.fn(() => ({
          finished: Promise.reject(new Error("decode")),
          stop: () => undefined,
        })),
      });
      await player.observe([]);
      await player.observe([event("e1", 1)]);
      expect(log).toEqual(["caption:e1", "playing:e1", "failed:e1"]);
    });

    it("the caption request fails but the voice request works", async () => {
      const { player, log } = setup({
        fetchCue: vi.fn(async () => {
          throw new Error("cue failed");
        }),
      });
      await player.observe([]);
      void player.observe([event("e1", 1)]);
      await flush();
      expect(log).toEqual(["caption:e1", "playing:e1", "ended:e1"]);
    });
  });

  it("replaces narration that is still playing when a newer event arrives", async () => {
    const { player, log, playbacks } = setup({}, { manual: true });
    await player.observe([]);
    void player.observe([event("e1", 1)]);
    await flush();
    expect(playbacks).toHaveLength(1);

    void player.observe([event("e1", 1), event("e2", 2)]);
    await flush();
    expect(playbacks[0]!.stopped).toBe(true);
    expect(playbacks).toHaveLength(2);
    // The interrupted line is not reported as finished.
    expect(log).not.toContain("ended:e1");
    expect(log).toContain("playing:e2");
  });

  it("drops a late voice for an event that was already replaced", async () => {
    const slow = deferred<ReactionSpeech>();
    const { player, log, options } = setup({
      fetchSpeech: vi.fn((e: WorldEvent) =>
        e.id === "e1" ? slow.promise : Promise.resolve(speech(e.id)),
      ),
    });
    await player.observe([]);
    void player.observe([event("e1", 1)]);
    await flush();
    void player.observe([event("e1", 1), event("e2", 2)]);
    await flush();
    slow.resolve(speech("e1"));
    await flush();
    expect(options.play).toHaveBeenCalledTimes(1);
    expect(log).not.toContain("playing:e1");
    expect(log).toContain("playing:e2");
  });

  it("stops everything and ignores pending work when disposed", async () => {
    const slow = deferred<ReactionSpeech>();
    const { player, log, options, playbacks } = setup({
      fetchSpeech: vi.fn(() => slow.promise),
    });
    await player.observe([]);
    void player.observe([event("e1", 1)]);
    await flush();
    player.dispose();
    slow.resolve(speech("e1"));
    await flush();
    expect(options.play).not.toHaveBeenCalled();
    expect(playbacks).toHaveLength(0);
    expect(log).toEqual(["caption:e1"]);
  });

  it("still dedupes in memory when storage is unavailable", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { player, options } = setup({ storage: broken });
    await player.observe([]);
    await player.observe([event("e1", 1)]);
    await player.observe([event("e1", 1)]);
    expect(options.fetchCue).toHaveBeenCalledTimes(1);
  });

  it("ignores corrupt stored data", async () => {
    const { player, options } = setup({
      storage: memoryStorage({ "storyworld:reactions:seen": "{not json" }),
    });
    await player.observe([]);
    await player.observe([event("e1", 1)]);
    expect(options.fetchCue).toHaveBeenCalledTimes(1);
  });

  it("keeps only a bounded number of remembered ids", async () => {
    const storage = memoryStorage();
    const { player } = setup({ storage });
    const many = Array.from({ length: 300 }, (_, i) => event("h" + i, i));
    await player.observe(many);
    const stored = JSON.parse(storage.data["storyworld:reactions:seen"]!);
    expect(stored).toHaveLength(200);
    expect(stored.at(-1)).toBe("h299");
  });
});
