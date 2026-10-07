import type { Entity } from "@storyworld/contracts/model";
import { RESTING_POSE, type Pose } from "./stage-motion";

// The "lift off the paper" reveal: the child's drawing sits flat on the
// paper, then the pieces peel up together (a small stagger apart), rise with
// a small shake, and settle into their idle loops. Nothing is saved for last
// and nothing waves at the end. Pure functions of time so the live Story Room
// and the keepsake movie can replay it exactly.

/** The shape of one lift-off: how long each part takes. */
export type IntroTiming = {
  /** The flat drawing shows alone for this long before anything lifts. */
  leadMs: number;
  /** How long one piece takes to lift, shake and land. */
  liftMs: number;
  /** Quiet time after the last piece lands. */
  settleMs: number;
  /** Gap between one piece starting to lift and the next. */
  staggerMs: number;
  /** The stagger shrinks for busy drawings so the whole reveal stays short. */
  maxStaggerTotalMs: number;
  /**
   * Pieces fade in over the flat drawing as they peel up. Off when the piece
   * is already showing, e.g. a new drawing whose paper cutout hands over.
   */
  fadeIn: boolean;
};

/**
 * The live reveal when the Story Room first opens: about 3 s for a small
 * scene, never more than 3.7 s for a busy one (the plan asks for 3 to 5 s).
 */
export const LIVE_INTRO: IntroTiming = {
  leadMs: 1000,
  liftMs: 1600,
  settleMs: 400,
  staggerMs: 120,
  maxStaggerTotalMs: 700,
  fadeIn: true,
};

/** The movie's tighter reveal, so the whole keepsake fits in 10–15 s. */
export const KEEPSAKE_INTRO: IntroTiming = {
  leadMs: 500,
  liftMs: 1000,
  settleMs: 450,
  staggerMs: 220,
  maxStaggerTotalMs: 1300,
  fadeIn: true,
};

/**
 * A new mid-story drawing's own short lift-off once it is committed: its
 * cutout is already on the paper, so it rises and lands straight away.
 */
export const DRAWING_LIFT: IntroTiming = {
  leadMs: 0,
  liftMs: 900,
  settleMs: 0,
  staggerMs: 0,
  maxStaggerTotalMs: 0,
  fadeIn: false,
};

/** Backdrop alpha once the pieces have lifted (matches the resting stage). */
export const RESTING_BACKDROP_ALPHA = 0.42;

export type IntroSample = {
  /** Extra pose layered over the piece's other motion. */
  pose: Pose;
  alpha: number;
  /** How much of the idle loop to blend in, 0..1. */
  idle: number;
};

export type IntroBackdrop = { backdropAlpha: number; matteAlpha: number };

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function staggerMs(count: number, timing: IntroTiming) {
  if (count <= 1) return 0;
  return Math.min(timing.staggerMs, timing.maxStaggerTotalMs / (count - 1));
}

/**
 * The order pieces lift in: left to right across the paper (top to bottom
 * for pieces in line), whatever they are. The hero is not saved for last.
 */
export function liftOrder(
  entities: readonly Pick<Entity, "id" | "bounds">[],
): string[] {
  const middle = (entity: Pick<Entity, "bounds">) => ({
    x: entity.bounds.x + entity.bounds.width / 2,
    y: entity.bounds.y + entity.bounds.height / 2,
  });
  return [...entities]
    .sort((a, b) => middle(a).x - middle(b).x || middle(a).y - middle(b).y)
    .map((entity) => entity.id);
}

/** When piece `index` of `count` starts lifting, in ms from the intro start. */
export function introPieceStartMs(
  index: number,
  count: number,
  timing: IntroTiming,
) {
  return timing.leadMs + staggerMs(count, timing) * index;
}

/** Total intro length for `count` pieces (the gentle intro is the same). */
export function introDurationMs(count: number, timing: IntroTiming) {
  return (
    introPieceStartMs(Math.max(0, count - 1), count, timing) +
    timing.liftMs +
    timing.settleMs
  );
}

/**
 * One piece `elapsedMs` into the intro. Before its turn a fading piece is
 * fully transparent, so the backdrop drawing underneath shows in its place.
 * The gentle variant (reduced motion) only fades the piece in: no rise or
 * shake. A piece that does not fade in stays as it is.
 */
export function sampleIntro(
  elapsedMs: number,
  index: number,
  count: number,
  gentle: boolean,
  timing: IntroTiming,
): IntroSample {
  const t =
    (elapsedMs - introPieceStartMs(index, count, timing)) / timing.liftMs;
  if (t >= 1) return { pose: RESTING_POSE, alpha: 1, idle: 1 };
  if (t <= 0)
    return { pose: RESTING_POSE, alpha: timing.fadeIn ? 0 : 1, idle: 0 };
  if (gentle)
    return {
      pose: RESTING_POSE,
      alpha: timing.fadeIn ? smoothstep(t) : 1,
      idle: 1,
    };

  // Peel up quickly, hang in the air with a little shake, then land.
  const rise =
    t < 0.35 ? smoothstep(t / 0.35) : 1 - smoothstep((t - 0.35) / 0.65);
  const shake = t > 0.2 && t < 0.85 ? Math.sin((t - 0.2) * Math.PI * 7) : 0;
  const damping = 1 - smoothstep((t - 0.2) / 0.65);
  return {
    pose: {
      dx: 0,
      dy: -22 * rise,
      scaleX: 1 + 0.07 * rise,
      scaleY: 1 + 0.07 * rise,
      rotation: 0.05 * shake * damping,
    },
    alpha: timing.fadeIn ? smoothstep(t / 0.12) : 1,
    idle: smoothstep((t - 0.7) / 0.3),
  };
}

/**
 * The drawing starts at full strength and fades back to the resting stage as
 * the pieces lift; the paper mattes (the "holes" the pieces leave) fade in.
 */
export function introBackdrop(
  elapsedMs: number,
  count: number,
  timing: IntroTiming,
): IntroBackdrop {
  const first = introPieceStartMs(0, count, timing);
  const last =
    introPieceStartMs(Math.max(0, count - 1), count, timing) + timing.liftMs;
  const progress = smoothstep((elapsedMs - first) / Math.max(1, last - first));
  return {
    backdropAlpha:
      progress >= 1
        ? RESTING_BACKDROP_ALPHA
        : 1 - (1 - RESTING_BACKDROP_ALPHA) * progress,
    matteAlpha: progress,
  };
}

/** Scales a pose's deviation from rest by `weight` (0 = rest, 1 = pose). */
export function weightPose(pose: Pose, weight: number): Pose {
  if (weight >= 1) return pose;
  if (weight <= 0) return RESTING_POSE;
  return {
    dx: pose.dx * weight,
    dy: pose.dy * weight,
    scaleX: 1 + (pose.scaleX - 1) * weight,
    scaleY: 1 + (pose.scaleY - 1) * weight,
    rotation: pose.rotation * weight,
  };
}
