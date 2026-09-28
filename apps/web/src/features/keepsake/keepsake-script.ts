import type { WorldEvent, WorldState } from "@storyworld/contracts/model";
import type {
  StoryAction,
  StorySequence,
} from "@storyworld/contracts/story-beat";
import {
  introDurationMs,
  KEEPSAKE_INTRO,
} from "../world-renderer/intro-motion";
import { beatHoldMs } from "../world-renderer/story-playback";
import type { StageTitleCard } from "../world-renderer/story-stage-renderer";

// The keepsake movie's script, built from the room's committed history: the
// reveal (pieces lifting off the paper, then the opening sequence) and the
// best story moment, padded with an idle hold and an end card to 10–15 s.
// Pure: the recorder replays it into a hidden renderer.

export const MIN_MOVIE_MS = 10_000;
export const MAX_MOVIE_MS = 15_000;
/**
 * The script plans within this, leaving the recorder room for the frames it
 * records before the first step and after the end card.
 */
export const PLANNED_MAX_MS = MAX_MOVIE_MS - 500;
/**
 * Beats hold at least this long in the movie so captions stay readable. They
 * keep their live 2–4 s holds unless the movie would run too long, and are
 * never shortened below this.
 */
export const KEEPSAKE_BEAT_MS = 1400;
/** How finely the planner shortens long beat holds to fit the budget. */
const BEAT_CAP_STEP_MS = 50;
/** The end card's scripted length. The recorder may shorten it in real time
 * (to absorb a slow device) but never below `MIN_END_CARD_MS`. */
export const END_CARD_MS = 1800;
export const MIN_END_CARD_MS = 1000;
/** The renderer waits two frames before a reveal beat lands. */
const REVEAL_FRAMES_MS = 50;

export type KeepsakeStep =
  | {
      kind: "intro";
      startMs: number;
      durationMs: number;
      world: WorldState;
      caption: string;
    }
  | {
      kind: "play";
      startMs: number;
      durationMs: number;
      role: "opening" | "moment";
      /** Shown when the step starts, before the sequence's own world. */
      before: WorldState;
      world: WorldState;
      sequence: StorySequence;
    }
  | {
      kind: "hold";
      startMs: number;
      durationMs: number;
      titleCard: StageTitleCard | null;
    };

export type KeepsakeScript = {
  title: string;
  heroName: string | undefined;
  steps: KeepsakeStep[];
  totalMs: number;
  /** The event chosen as the best story moment, if any. */
  momentEventId: string | undefined;
  /**
   * The longest a beat holds in this movie (at least `KEEPSAKE_BEAT_MS`), or
   * undefined when every beat keeps its live hold. The recorder passes it to
   * the stage so beats play exactly as long as planned.
   */
  maxBeatMs: number | undefined;
};

export type KeepsakeHistory = {
  /** Committed events, oldest first (the client snapshot's `events`). */
  events: readonly WorldEvent[];
  /** Sequences the room has played, by source event ID. */
  sequences: ReadonlyMap<string, StorySequence>;
  openingNarration?: string;
  reducedMotion?: boolean;
};

const actionWeight: Record<StoryAction["type"], number> = {
  celebrate: 3,
  move_toward: 2,
  reveal: 1,
  blocked_by: 1,
  weather_shift: 1,
  fly_over: 2,
  ride: 2,
  launch: 2,
  splash: 1,
  react: 1,
  focus: 0,
};

/**
 * How much happens in a sequence: a celebration outweighs a journey (moving,
 * flying over, riding or launching), which outweighs a plain reveal, blocked
 * moment, splash, reaction or weather change; a focus beat adds nothing.
 */
export function momentScore(sequence: StorySequence) {
  return sequence.beats.reduce(
    (total, item) => total + actionWeight[item.action.type],
    0,
  );
}

/**
 * The best story moment: among events after the opening that have a played
 * sequence, the one with the highest `momentScore`; the most recent wins a
 * tie. Sequences that score 0 (only focus beats) are not moments. The opening
 * event is never the moment: its sequence already plays as part of the reveal.
 */
export function pickBestMoment(
  events: readonly WorldEvent[],
  sequences: ReadonlyMap<string, StorySequence>,
): number | undefined {
  let best: { index: number; score: number } | undefined;
  for (let index = 1; index < events.length; index++) {
    const sequence = sequences.get(events[index].id);
    if (!sequence) continue;
    const score = momentScore(sequence);
    if (score > 0 && (!best || score >= best.score)) best = { index, score };
  }
  return best?.index;
}

/**
 * How long one beat holds in the movie: its live hold, at least
 * `KEEPSAKE_BEAT_MS`, and at most `maxBeatMs` when the budget needs it.
 */
export function keepsakeBeatMs(action: StoryAction, maxBeatMs = Infinity) {
  return Math.min(
    Math.max(beatHoldMs(action), KEEPSAKE_BEAT_MS),
    Math.max(maxBeatMs, KEEPSAKE_BEAT_MS),
  );
}

/** How long a sequence plays in the movie, in milliseconds. */
export function sequenceDurationMs(
  sequence: StorySequence,
  reducedMotion = false,
  maxBeatMs?: number,
) {
  return sequence.beats.reduce(
    (total, item) =>
      total +
      keepsakeBeatMs(item.action, maxBeatMs) +
      (item.action.type === "reveal" && !reducedMotion ? REVEAL_FRAMES_MS : 0),
    0,
  );
}

/**
 * Fits whole sequences into `budgetMs` by shortening the longest beat holds,
 * never below `KEEPSAKE_BEAT_MS`. Returns the beat cap to use (undefined when
 * every beat keeps its hold), or null when they do not fit even then. Beats
 * are shortened, never cut: each still plays its whole (shorter) hold.
 */
export function fitBeats(
  sequences: readonly StorySequence[],
  budgetMs: number,
  reducedMotion = false,
): { maxBeatMs: number | undefined } | null {
  const total = (maxBeatMs?: number) =>
    sequences.reduce(
      (sum, item) => sum + sequenceDurationMs(item, reducedMotion, maxBeatMs),
      0,
    );
  if (total() <= budgetMs) return { maxBeatMs: undefined };
  const longest = Math.max(
    ...sequences.flatMap((item) =>
      item.beats.map((beat) => keepsakeBeatMs(beat.action)),
    ),
  );
  for (
    let cap = longest - BEAT_CAP_STEP_MS;
    cap > KEEPSAKE_BEAT_MS;
    cap -= BEAT_CAP_STEP_MS
  )
    if (total(cap) <= budgetMs) return { maxBeatMs: cap };
  return total(KEEPSAKE_BEAT_MS) <= budgetMs
    ? { maxBeatMs: KEEPSAKE_BEAT_MS }
    : null;
}

/**
 * The opening as the movie plays it. The intro has already lifted every piece
 * of the first world off the paper, so a reveal beat would hide a piece that
 * is showing and pop it in again; it becomes a focus beat instead.
 */
export function openingAfterIntro(sequence: StorySequence): StorySequence {
  return {
    ...sequence,
    beats: sequence.beats.map((item) =>
      item.action.type === "reveal"
        ? { ...item, action: { type: "focus", entityId: item.action.entityId } }
        : item,
    ),
  };
}

function heroOf(world: WorldState) {
  return (
    world.entities.find((entity) => entity.id === world.goal?.characterId) ??
    world.entities.find((entity) => entity.role === "character")
  );
}

/** "Fox's story", or a generic title without a hero. */
export function movieTitle(heroName: string | undefined) {
  const name = heroName?.trim();
  return name ? `${name}'s story` : "Our Storyworld story";
}

/**
 * Builds the movie from the room's history, or null before the first commit.
 *
 * Reveal: the first committed world, its pieces lifting off the paper, then
 * the opening sequence if the room played one. Moment: the best later event
 * (`pickBestMoment`), starting from the world before it. Then an idle hold
 * and an end card fill the movie to at least 10 s.
 *
 * The length is planned up front to fit `PLANNED_MAX_MS`, from the stage's
 * own beat holds: if the sequences would run too long, the longest holds are
 * shortened toward `KEEPSAKE_BEAT_MS` (`fitBeats`), and if that is not
 * enough the opening sequence is dropped. The moment alone always fits: a
 * sequence has at most three beats (the contract's cap), under 4.5 s at the
 * shortest hold, after an intro of at most 3.25 s. No beat is cut mid-way.
 */
export function buildKeepsakeScript(
  history: KeepsakeHistory,
): KeepsakeScript | null {
  const { events, sequences } = history;
  const reducedMotion = history.reducedMotion ?? false;
  const first = events[0];
  if (!first) return null;

  const momentIndex = pickBestMoment(events, sequences);
  const momentEvent =
    momentIndex === undefined ? undefined : events[momentIndex];
  const moment = momentEvent ? sequences.get(momentEvent.id) : undefined;
  const played = sequences.get(first.id);
  let opening = played && openingAfterIntro(played);

  const introMs = introDurationMs(first.state.entities.length, KEEPSAKE_INTRO);
  const budgetMs = PLANNED_MAX_MS - introMs - END_CARD_MS;
  const plays = () =>
    [opening, moment].filter((item): item is StorySequence => !!item);
  let fit = fitBeats(plays(), budgetMs, reducedMotion);
  if (!fit && opening) {
    opening = undefined;
    fit = fitBeats(plays(), budgetMs, reducedMotion);
  }
  const maxBeatMs = fit ? fit.maxBeatMs : KEEPSAKE_BEAT_MS;
  const openingMs = opening
    ? sequenceDurationMs(opening, reducedMotion, maxBeatMs)
    : 0;
  const momentMs = moment
    ? sequenceDurationMs(moment, reducedMotion, maxBeatMs)
    : 0;

  const steps: KeepsakeStep[] = [];
  let at = 0;
  const push = (step: KeepsakeStep) => {
    steps.push(step);
    at += step.durationMs;
  };

  push({
    kind: "intro",
    startMs: at,
    durationMs: introMs,
    world: first.state,
    caption: history.openingNarration?.trim() || "A drawing comes to life.",
  });
  if (opening)
    push({
      kind: "play",
      startMs: at,
      durationMs: openingMs,
      role: "opening",
      before: first.state,
      world: first.state,
      sequence: opening,
    });
  if (momentEvent && moment)
    push({
      kind: "play",
      startMs: at,
      durationMs: momentMs,
      role: "moment",
      before: events[momentIndex! - 1].state,
      world: momentEvent.state,
      sequence: moment,
    });

  const tailMs = Math.max(END_CARD_MS, MIN_MOVIE_MS - at);
  const heroName = heroOf(momentEvent?.state ?? first.state)?.name;
  const title = movieTitle(heroName);
  if (tailMs > END_CARD_MS)
    push({
      kind: "hold",
      startMs: at,
      durationMs: tailMs - END_CARD_MS,
      titleCard: null,
    });
  push({
    kind: "hold",
    startMs: at,
    durationMs: END_CARD_MS,
    titleCard: { title, subtitle: "Made with Storyworld" },
  });

  return {
    title,
    heroName,
    steps,
    totalMs: at,
    momentEventId: momentEvent?.id,
    maxBeatMs,
  };
}
