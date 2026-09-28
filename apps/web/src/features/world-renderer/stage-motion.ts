import type { Entity } from "@storyworld/contracts/model";
import { has, isBlocker, makesRain } from "@storyworld/contracts/entity-traits";
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

export type IdleMotion =
  | "hop"
  | "glide"
  | "sway"
  | "roll"
  | "spring"
  | "drift"
  | "shimmer"
  | "breathe";

/**
 * The idle loop a piece plays between beats, chosen from what it can do:
 * characters stay lively (a hop, or a glide if they fly); weather drifts;
 * flyers glide with a flap; swimmers and floaters sway on a wave line;
 * launchers squash then spring; movers roll; blockers shimmer; anything else
 * breathes with a slight wobble.
 */
export function idleMotionFor(
  entity: Pick<Entity, "role" | "properties">,
): IdleMotion {
  if (entity.role === "character")
    return has(entity, "flies") ? "glide" : "hop";
  if (makesRain(entity)) return "drift";
  if (has(entity, "flies")) return "glide";
  if (has(entity, "swims") || has(entity, "floats")) return "sway";
  if (has(entity, "launches")) return "spring";
  if (has(entity, "moves")) return "roll";
  if (isBlocker(entity)) return "shimmer";
  return "breathe";
}

const periods: Record<IdleMotion, number> = {
  hop: 1200,
  glide: 1800,
  sway: 1600,
  roll: 1400,
  spring: 1500,
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
    case "glide": {
      // A slow bob and sideways glide with four quick flap-like squashes.
      const flap = Math.sin(4 * TAU * phase) ** 2;
      return {
        dx: 5 * wave,
        dy: -5 * Math.sin(TAU * phase + Math.PI / 2),
        scaleX: 1 + 0.02 * flap,
        scaleY: 1 - 0.035 * flap,
        rotation: 0.02 * Math.cos(TAU * phase),
      };
    }
    case "sway":
      // Side to side, bobbing twice per loop as if on a wave line.
      return {
        dx: 5 * wave,
        dy: 2.5 * Math.sin(2 * TAU * phase),
        scaleX: 1,
        scaleY: 1,
        rotation: 0.025 * Math.cos(TAU * phase),
      };
    case "roll":
      // Rolls a little forward and back, leaning into the motion.
      return {
        dx: 6 * wave,
        dy: -1.5 * Math.sin(2 * TAU * phase) ** 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0.02 * wave,
      };
    case "spring": {
      // Squash down for the first half, then spring up and settle.
      if (phase < 0.5) {
        const squash = Math.sin(2 * Math.PI * phase) ** 2;
        return {
          dx: 0,
          dy: 0,
          scaleX: 1 + 0.03 * squash,
          scaleY: 1 - 0.045 * squash,
          rotation: 0,
        };
      }
      const lift = Math.sin(2 * Math.PI * (phase - 0.5)) ** 2;
      return {
        dx: 0,
        dy: -7 * lift,
        scaleX: 1 - 0.02 * lift,
        scaleY: 1 + 0.035 * lift,
        rotation: 0.01 * wave,
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
  fly_over: 760,
  ride: 600,
  launch: 640,
  splash: 620,
  react: 520,
};

/** How long the one-shot flourish for a beat type lasts, in milliseconds. */
export function beatPulseDurationMs(type: StoryAction["type"]) {
  return pulseDurations[type] ?? 0;
}

/** Flourishes that last the whole journey: a flight rises and lands with it. */
const journeyPulses = new Set<StoryAction["type"]>([
  "fly_over",
  "ride",
  "launch",
]);
/** Flourishes that play on arrival: the wobble or dip at the obstacle. */
const arrivalPulses = new Set<StoryAction["type"]>(["blocked_by", "splash"]);

/** Whether a beat's flourish waits until its piece has arrived. */
export function pulsesOnArrival(type: StoryAction["type"]) {
  return arrivalPulses.has(type);
}

/**
 * How far into its flourish a beat is, `elapsedMs` after it started, when the
 * beat also carries its piece for `travelMs`: a flight, ride or launch
 * stretches its flourish across the journey, a blocked wobble or a splash
 * waits until the piece arrives (negative until then, which rests), and every
 * other flourish plays from the start. Without travel it is `elapsedMs`.
 */
export function beatPulseElapsedMs(
  type: StoryAction["type"],
  elapsedMs: number,
  travelMs: number,
) {
  const duration = beatPulseDurationMs(type);
  if (travelMs <= 0 || !duration) return elapsedMs;
  if (journeyPulses.has(type))
    return (elapsedMs * duration) / Math.max(duration, travelMs);
  if (arrivalPulses.has(type)) return elapsedMs - travelMs;
  return elapsedMs;
}

/**
 * The one-shot flourish the active piece plays when a beat starts: a focus
 * glow, a reveal pop, a blocked wobble, a celebration jump, a flyover lift, a
 * ride bounce, a launch squash-and-spring, a splash dip or a startled pop. `height` is the
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
    case "fly_over": {
      // Rises high while it passes over, with quick wing-like squashes.
      const lift = keyframes(p, [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ]);
      const flap = Math.sin(3 * TAU * p) ** 2 * lift;
      return {
        pose: {
          ...RESTING_POSE,
          dy: -0.3 * height * lift,
          scaleX: 1 + 0.04 * flap,
          scaleY: 1 - 0.06 * flap,
          rotation: -0.03 * lift,
        },
        alpha: 1,
        glow: 0,
      };
    }
    case "ride": {
      // Two little bounces, as if carried along.
      const bounce = Math.sin(2 * Math.PI * p) ** 2;
      return {
        pose: {
          ...RESTING_POSE,
          dy: -0.06 * height * bounce,
          rotation: 0.02 * Math.sin(TAU * p),
        },
        alpha: 1,
        glow: 0,
      };
    }
    case "launch": {
      // Squash on the launcher, then spring into the air.
      const squash = keyframes(p, [
        [0, 0],
        [0.3, 1],
        [0.45, 0],
        [1, 0],
      ]);
      const air = keyframes(p, [
        [0, 0],
        [0.3, 0],
        [0.65, 1],
        [1, 0],
      ]);
      return {
        pose: {
          ...RESTING_POSE,
          dy: -0.25 * height * air,
          scaleX: 1 + 0.1 * squash - 0.04 * air,
          scaleY: 1 - 0.12 * squash + 0.06 * air,
          rotation: 0.05 * air,
        },
        alpha: 1,
        glow: 0,
      };
    }
    case "splash": {
      // Tips forward, dips down and wobbles back up, dripping.
      const dip = keyframes(p, [
        [0, 0],
        [0.35, 1],
        [1, 0],
      ]);
      const wobble = Math.sin(3 * TAU * p) * (1 - p);
      return {
        pose: {
          ...RESTING_POSE,
          dx: 3 * wobble,
          dy: 0.08 * height * dip,
          scaleX: 1 + 0.06 * dip,
          scaleY: 1 - 0.08 * dip,
          rotation: 0.05 * dip + 0.02 * wobble,
        },
        alpha: 1,
        glow: 0,
      };
    }
    case "react": {
      // A startled pop: a quick stretch up and a little shake.
      const pop = keyframes(p, [
        [0, 0],
        [0.3, 1],
        [1, 0],
      ]);
      return {
        pose: {
          ...RESTING_POSE,
          dx: 2.5 * Math.sin(4 * TAU * p) * (1 - p),
          dy: -0.06 * height * pop,
          scaleX: 1 - 0.03 * pop,
          scaleY: 1 + 0.06 * pop,
        },
        alpha: 1,
        glow: 0.5 * pop,
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

/** Walking easing: a gentle start, a steady stride and a soft landing. */
function easeInOutSine(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return (1 - Math.cos(Math.PI * clamped)) / 2;
}

/**
 * The displayed offset `elapsedMs` into a move from `from` to `to` that takes
 * `durationMs` (see `beatTravelMs`), so a piece walks the whole way.
 */
export function tweenOffset(
  from: Offset,
  to: Offset,
  elapsedMs: number,
  durationMs: number,
): Offset {
  const t = durationMs <= 0 ? 1 : easeInOutSine(elapsedMs / durationMs);
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
