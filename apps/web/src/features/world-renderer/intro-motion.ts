import { RESTING_POSE, type Pose } from "./stage-motion";

// The "lift off the paper" reveal: the child's drawing sits flat on the
// paper, then each piece peels up, rises with a small shake, and settles into
// its idle loop. Pure functions of time so the keepsake movie (and later the
// live reveal) can replay it exactly.

/** The flat drawing shows alone for this long before anything lifts. */
export const INTRO_LEAD_MS = 500;
/** How long one piece takes to lift, shake and land. */
export const INTRO_LIFT_MS = 1000;
/** Quiet time after the last piece lands. */
export const INTRO_SETTLE_MS = 450;
/** Gap between one piece starting to lift and the next. */
export const INTRO_STAGGER_MS = 220;
/** The stagger shrinks for busy drawings so the intro stays short. */
export const INTRO_MAX_STAGGER_TOTAL_MS = 1300;
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

function staggerMs(count: number) {
  if (count <= 1) return 0;
  return Math.min(INTRO_STAGGER_MS, INTRO_MAX_STAGGER_TOTAL_MS / (count - 1));
}

/** When piece `index` of `count` starts lifting, in ms from the intro start. */
export function introPieceStartMs(index: number, count: number) {
  return INTRO_LEAD_MS + staggerMs(count) * index;
}

/** Total intro length for `count` pieces (the gentle intro is the same). */
export function introDurationMs(count: number) {
  return (
    introPieceStartMs(Math.max(0, count - 1), count) +
    INTRO_LIFT_MS +
    INTRO_SETTLE_MS
  );
}

/**
 * One piece `elapsedMs` into the intro. Before its turn the piece is fully
 * transparent, so the backdrop drawing underneath shows in its place. The
 * gentle variant (reduced motion) only fades the piece in: no rise or shake.
 */
export function sampleIntro(
  elapsedMs: number,
  index: number,
  count: number,
  gentle: boolean,
): IntroSample {
  const t = (elapsedMs - introPieceStartMs(index, count)) / INTRO_LIFT_MS;
  if (t >= 1) return { pose: RESTING_POSE, alpha: 1, idle: 1 };
  if (t <= 0) return { pose: RESTING_POSE, alpha: 0, idle: 0 };
  if (gentle) return { pose: RESTING_POSE, alpha: smoothstep(t), idle: 1 };

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
    alpha: smoothstep(t / 0.12),
    idle: smoothstep((t - 0.7) / 0.3),
  };
}

/**
 * The drawing starts at full strength and fades back to the resting stage as
 * the pieces lift; the paper mattes (the "holes" the pieces leave) fade in.
 */
export function introBackdrop(elapsedMs: number, count: number): IntroBackdrop {
  const first = introPieceStartMs(0, count);
  const last = introPieceStartMs(Math.max(0, count - 1), count) + INTRO_LIFT_MS;
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
