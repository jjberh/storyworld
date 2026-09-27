import type { Entity } from "@storyworld/contracts/model";
import type { StoryAction } from "@storyworld/contracts/story-beat";
import type { Offset } from "./story-playback";

// Pure procedural motion for the Story Room stage. Everything here is a
// function of time so a second renderer replaying the same sequence (for
// example while recording) produces the same poses.

/** A small transform layered on top of a piece's resting position. */
export type Pose = {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
};

export const RESTING_POSE: Pose = {
  dx: 0,
  dy: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
};

export type IdleMotion = "hop" | "drift" | "shimmer" | "breathe";

/**
 * The idle loop a piece plays between beats. Chosen from its kind for now;
 * later this reads entity properties (flies, swims, moves, weather...).
 */
export function idleMotionFor(entity: Pick<Entity, "kind">): IdleMotion {
  switch (entity.kind) {
    case "character":
      return "hop";
    case "cloud":
      return "drift";
    case "river":
      return "shimmer";
    default:
      return "breathe";
  }
}

const periods: Record<IdleMotion, number> = {
  hop: 1200,
  drift: 2000,
  shimmer: 1600,
  breathe: 2000,
};

/** One full loop of an idle motion, in milliseconds. */
export function motionPeriodMs(motion: IdleMotion) {
  return periods[motion];
}

/** A stable phase offset in [0, 1) so pieces do not move in lockstep. */
export function seedFor(id: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

const TAU = Math.PI * 2;

/**
 * Samples an idle loop at `timeMs`. Poses are small (a few world units, a few
 * percent of scale, about a degree of rotation), smooth, and repeat exactly
 * every `motionPeriodMs(motion)`. `seed` in [0, 1) shifts the phase.
 */
export function sampleMotion(
  motion: IdleMotion,
  timeMs: number,
  seed: number,
): Pose {
  const phase = (((timeMs / periods[motion] + seed) % 1) + 1) % 1;
  const wave = Math.sin(TAU * phase);
  switch (motion) {
    case "hop": {
      // Airborne for the first part of the loop, then a soft landing squash.
      // sin² keeps height and squash continuous with zero slope at the joins.
      const airborne = 0.55;
      if (phase < airborne) {
        const lift = Math.sin((Math.PI * phase) / airborne) ** 2;
        return {
          dx: 0,
          dy: -8 * lift,
          scaleX: 1 - 0.02 * lift,
          scaleY: 1 + 0.03 * lift,
          rotation: 0.02 * wave,
        };
      }
      const squash =
        Math.sin((Math.PI * (phase - airborne)) / (1 - airborne)) ** 2;
      return {
        dx: 0,
        dy: 0,
        scaleX: 1 + 0.03 * squash,
        scaleY: 1 - 0.04 * squash,
        rotation: 0.02 * wave,
      };
    }
    case "drift":
      return {
        dx: 7 * wave,
        dy: 3 * Math.sin(2 * TAU * phase + 0.8),
        scaleX: 1,
        scaleY: 1,
        rotation: 0.01 * wave,
      };
    case "shimmer":
      return {
        dx: 1.5 * wave,
        dy: 0,
        scaleX: 1 + 0.008 * wave,
        scaleY: 1 + 0.008 * Math.cos(TAU * phase),
        rotation: 0.006 * wave,
      };
    case "breathe":
      return {
        dx: 0,
        dy: 0,
        scaleX: 1 + 0.018 * wave,
        scaleY: 1 + 0.018 * wave,
        rotation: 0.012 * Math.sin(TAU * phase + Math.PI / 3),
      };
  }
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Interpolates keyframe values with smoothstep easing between stops. */
function keyframes(progress: number, stops: [number, number][]) {
  for (let index = 1; index < stops.length; index++) {
    const [endT, endValue] = stops[index];
    if (progress <= endT) {
      const [startT, startValue] = stops[index - 1];
      const t = (progress - startT) / (endT - startT);
      return startValue + (endValue - startValue) * smoothstep(t);
    }
  }
  return stops.at(-1)![1];
}

export type BeatPulse = { pose: Pose; alpha: number; glow: number };

const REST_PULSE: BeatPulse = { pose: RESTING_POSE, alpha: 1, glow: 0 };

const pulseDurations: Partial<Record<StoryAction["type"], number>> = {
  focus: 600,
  reveal: 300,
  blocked_by: 480,
  celebrate: 720,
};

/** How long the one-shot flourish for a beat type lasts, in milliseconds. */
export function beatPulseDurationMs(type: StoryAction["type"]) {
  return pulseDurations[type] ?? 0;
}

/**
 * The one-shot flourish the active piece plays when a beat starts: a focus
 * glow, a reveal pop, a blocked wobble or a celebration jump. `height` is the
 * piece height in world units. Returns the resting pulse once it has ended.
 */
export function beatPulse(
  type: StoryAction["type"],
  elapsedMs: number,
  height: number,
): BeatPulse {
  const duration = beatPulseDurationMs(type);
  if (!duration || elapsedMs >= duration || elapsedMs < 0) return REST_PULSE;
  const p = elapsedMs / duration;
  switch (type) {
    case "focus": {
      const bump = keyframes(p, [
        [0, 0],
        [0.45, 1],
        [1, 0],
      ]);
      const scale = 1 + 0.04 * bump;
      return {
        pose: { ...RESTING_POSE, scaleX: scale, scaleY: scale },
        alpha: 1,
        glow: bump,
      };
    }
    case "reveal": {
      const eased = 1 - (1 - p) ** 3;
      const scale = 0.82 + 0.18 * eased;
      return {
        pose: { ...RESTING_POSE, scaleX: scale, scaleY: scale },
        alpha: eased,
        glow: 0,
      };
    }
    case "blocked_by": {
      const stops = (a: number, b: number): [number, number][] => [
        [0, 0],
        [0.25, a],
        [0.7, b],
        [1, 0],
      ];
      return {
        pose: {
          ...RESTING_POSE,
          dx: keyframes(p, stops(-5, 4)),
          rotation: keyframes(p, stops(-0.035, 0.035)),
        },
        alpha: 1,
        glow: 0,
      };
    }
    case "celebrate": {
      const jump = keyframes(p, [
        [0, 0],
        [0.45, 1],
        [1, 0],
      ]);
      return {
        pose: {
          ...RESTING_POSE,
          dy: -0.15 * height * jump,
          rotation: 0.035 * jump,
        },
        alpha: 1,
        glow: 0,
      };
    }
    default:
      return REST_PULSE;
  }
}

/** Combines poses: offsets and rotations add, scales multiply. */
export function combinePoses(...poses: Pose[]): Pose {
  return poses.reduce(
    (total, pose) => ({
      dx: total.dx + pose.dx,
      dy: total.dy + pose.dy,
      scaleX: total.scaleX * pose.scaleX,
      scaleY: total.scaleY * pose.scaleY,
      rotation: total.rotation + pose.rotation,
    }),
    RESTING_POSE,
  );
}

export const MOVE_TWEEN_MS = 600;

/** Paper-slide easing: quick start, soft landing. */
export function easeOutCubic(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** The displayed offset `elapsedMs` into a move from `from` to `to`. */
export function tweenOffset(
  from: Offset,
  to: Offset,
  elapsedMs: number,
  durationMs = MOVE_TWEEN_MS,
): Offset {
  const t = durationMs <= 0 ? 1 : easeOutCubic(elapsedMs / durationMs);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

/** Moves `current` linearly toward `target`, covering 0→1 in `durationMs`. */
export function approach(
  current: number,
  target: number,
  deltaMs: number,
  durationMs: number,
) {
  if (durationMs <= 0) return target;
  const step = deltaMs / durationMs;
  return current < target
    ? Math.min(target, current + step)
    : Math.max(target, current - step);
}
