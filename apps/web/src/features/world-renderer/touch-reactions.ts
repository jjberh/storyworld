import type { Entity } from "@storyworld/contracts/model";
import { RESTING_POSE, type Pose } from "./stage-motion";

// Pure rules for tap reactions in the Story Room. A tap is local play: it never
// touches the world, so nothing here knows about reducers or beats. The
// renderer layers the sampled pose on top of the idle loop and any beat
// movement, on its own clock.

export type TouchReaction = "giggle" | "jump" | "spin" | "wave";
/** Reduced-motion users get a soft glow instead of any movement. */
export type ReactionKind = TouchReaction | "highlight";

const durations: Record<ReactionKind, number> = {
  giggle: 520,
  jump: 620,
  spin: 700,
  wave: 640,
  highlight: 600,
};

/**
 * A short pause after a reaction ends before the piece reacts again. Taps
 * during a reaction or this pause are ignored rather than queued: a queued
 * reaction would start up to a second after its tap, which breaks the "I
 * touched it and it moved" link for a child. Ignoring keeps every visible
 * reaction tied to the tap that caused it.
 */
export const REACTION_COOLDOWN_MS = 150;

/** How long a reaction plays, in milliseconds (always under one second). */
export function reactionDurationMs(reaction: ReactionKind) {
  return durations[reaction];
}

const reactionsByKind: Record<Entity["kind"], TouchReaction[]> = {
  character: ["giggle", "jump", "spin", "wave"],
  cloud: ["giggle", "spin", "wave"],
  castle: ["giggle", "jump", "wave"],
  shelter: ["giggle", "jump", "wave"],
  // Long, ground-bound pieces: no leaping or spinning a river off its banks.
  river: ["giggle", "wave"],
  bridge: ["giggle", "wave"],
};

/** The reactions that suit a piece of this kind. */
export function reactionsFor(kind: Entity["kind"]): readonly TouchReaction[] {
  return reactionsByKind[kind];
}

/** A small deterministic integer hash of a seed in [0, 1) and a tap count. */
function mix(seed: number, tap: number) {
  let hash = Math.floor(seed * 0x100000000) ^ Math.imul(tap + 1, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Picks the reaction for the `tap`-th accepted tap on a piece. Deterministic
 * for a given seed and tap count, and never repeats the previous reaction when
 * the kind has more than one to choose from.
 */
export function chooseReaction(
  kind: Entity["kind"],
  seed: number,
  tap: number,
  previous?: TouchReaction,
): TouchReaction {
  const options = reactionsFor(kind);
  const fresh =
    previous && options.length > 1
      ? options.filter((option) => option !== previous)
      : options;
  return fresh[mix(seed, tap) % fresh.length];
}

export type ActiveReaction = { reaction: ReactionKind; startMs: number };

/** Per-piece tap state. Start from `IDLE_REACTIONS`. */
export type ReactionState = {
  active: ActiveReaction | undefined;
  /** Accepted taps so far. */
  taps: number;
  last: TouchReaction | undefined;
  /** Clock time from which the next tap is accepted. */
  readyAtMs: number;
};

export const IDLE_REACTIONS: ReactionState = {
  active: undefined,
  taps: 0,
  last: undefined,
  readyAtMs: -Infinity,
};

/**
 * Handles a tap at `nowMs`. Returns the new state and the reaction it started,
 * or `started: undefined` (and the same state) when the tap falls inside a
 * reaction or its cooldown.
 */
export function tapReaction(
  state: ReactionState,
  kind: Entity["kind"],
  seed: number,
  nowMs: number,
  reducedMotion: boolean,
): { state: ReactionState; started: ReactionKind | undefined } {
  if (nowMs < state.readyAtMs) return { state, started: undefined };
  const reaction: ReactionKind = reducedMotion
    ? "highlight"
    : chooseReaction(kind, seed, state.taps, state.last);
  return {
    started: reaction,
    state: {
      active: { reaction, startMs: nowMs },
      taps: state.taps + 1,
      last: reaction === "highlight" ? state.last : reaction,
      readyAtMs: nowMs + reactionDurationMs(reaction) + REACTION_COOLDOWN_MS,
    },
  };
}

/** Drops the active reaction once it has finished playing. */
export function settleReaction(
  state: ReactionState,
  nowMs: number,
): ReactionState {
  const { active } = state;
  if (!active) return state;
  if (nowMs - active.startMs < reactionDurationMs(active.reaction))
    return state;
  return { ...state, active: undefined };
}

export type ReactionFrame = { pose: Pose; glow: number };

const REST_FRAME: ReactionFrame = { pose: RESTING_POSE, glow: 0 };
const TAU = Math.PI * 2;

/** 0 → 1 → 0 over the reaction, with zero slope at both ends. */
function envelope(p: number) {
  return Math.sin(Math.PI * p) ** 2;
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Keeps a piece's feet planted: the offset that makes a scale about its centre
 * look like a scale about its bottom edge.
 */
function feetForScale(scaleY: number, height: number) {
  return (height / 2) * (1 - scaleY);
}

/** A rotation about the bottom centre, as a centre rotation plus an offset. */
function rockOnFeet(rotation: number, height: number): Pose {
  const half = height / 2;
  return {
    ...RESTING_POSE,
    dx: half * Math.sin(rotation),
    dy: half * (1 - Math.cos(rotation)),
    rotation,
  };
}

/**
 * The pose a reaction adds `elapsedMs` after it started, for a piece of the
 * given size in world units. Returns the resting frame outside the reaction.
 * Every reaction starts and ends at rest so it blends into the idle loop.
 */
export function sampleReaction(
  reaction: ReactionKind,
  elapsedMs: number,
  size: { width: number; height: number },
): ReactionFrame {
  const duration = reactionDurationMs(reaction);
  if (elapsedMs < 0 || elapsedMs >= duration) return REST_FRAME;
  const p = elapsedMs / duration;
  const { height } = size;
  // Big pieces move less so a river's far end does not swing off the page.
  const reach = Math.min(1, 150 / Math.max(1, height));
  switch (reaction) {
    case "giggle": {
      // Quick decaying squash-and-stretch wobble, planted on its feet, with
      // a little side-to-side shake so even a big piece visibly giggles.
      const decay = (1 - p) * Math.min(1, p * 8);
      const wobble = reach * Math.sin(TAU * 2.5 * p) * decay;
      const scaleY = 1 + 0.18 * wobble;
      return {
        pose: {
          ...RESTING_POSE,
          dx: 5 * Math.sin(TAU * 5 * p) * decay,
          scaleX: 1 - 0.14 * wobble,
          scaleY,
          dy: feetForScale(scaleY, height),
        },
        glow: 0,
      };
    }
    case "jump": {
      // Crouch, leap, land with a little squash.
      const crouch = p < 0.2 ? envelope(p / 0.2) : 0;
      const air = p >= 0.15 && p < 0.8 ? envelope((p - 0.15) / 0.65) : 0;
      const land = p >= 0.75 ? envelope((p - 0.75) / 0.25) : 0;
      const squash = reach * (0.1 * crouch + 0.1 * land);
      const stretch = reach * 0.06 * air;
      const scaleY = 1 - squash + stretch;
      return {
        pose: {
          ...RESTING_POSE,
          dy: -Math.min(70, 0.45 * height) * air + feetForScale(scaleY, height),
          scaleX: 1 + squash - stretch * 0.66,
          scaleY,
        },
        glow: 0,
      };
    }
    case "spin": {
      // One full turn about its centre with a small lift so it clears the ground.
      return {
        pose: {
          ...RESTING_POSE,
          dy: -Math.min(24, 0.15 * height) * envelope(p),
          rotation: TAU * easeInOut(p),
        },
        glow: 0,
      };
    }
    case "wave":
      // A quick side-to-side rock about its feet.
      return {
        pose: rockOnFeet(
          0.2 * reach * Math.sin(TAU * 2 * p) * envelope(p),
          height,
        ),
        glow: 0,
      };
    case "highlight":
      return { pose: RESTING_POSE, glow: 0.85 * envelope(p) };
  }
}

/** Smallest comfortable touch target, in CSS pixels. */
export const MIN_TOUCH_TARGET_PX = 44;

/**
 * A piece's tappable rectangle in its own local coordinates (centred on the
 * piece), padded so thin drawings still make at least a `MIN_TOUCH_TARGET_PX`
 * target when the world is drawn at `cssPerWorldUnit` CSS pixels per unit.
 */
export function touchTarget(
  size: { width: number; height: number },
  cssPerWorldUnit: number,
) {
  const minimum =
    cssPerWorldUnit > 0 ? MIN_TOUCH_TARGET_PX / cssPerWorldUnit : 0;
  const width = Math.max(size.width, minimum);
  const height = Math.max(size.height, minimum);
  return { x: -width / 2, y: -height / 2, width, height };
}
