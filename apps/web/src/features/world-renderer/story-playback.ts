import type { Bounds, Entity, WorldState } from "@storyworld/contracts/model";
import type {
  StoryAction,
  StorySequence,
} from "@storyworld/contracts/story-beat";

// Pure beat-playback rules for the Story Room stage. The renderer owns timing
// and visuals; these functions only decide where pieces go and how long a beat
// holds, so they can be tested without a canvas.

export type Offset = { x: number; y: number };
export type Placement = "source" | "near-obstacle" | "target-side";
export type Movement = { offset: Offset; placement: Placement };

/** How long a beat holds before the next one starts, in milliseconds. */
export const BEAT_HOLD_MS = 650;
export const REDUCED_MOTION_BEAT_HOLD_MS = 40;
export const CELEBRATE_EXTRA_MS = 280;

export function center(bounds: Bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * Where `entity` should stand when heading for `target`. A blocked route (or a
 * `blocked_by` beat coming next) parks it on the near bank of the obstacle
 * instead; otherwise it stops beside the target.
 */
export function movementFor(
  entity: Entity,
  target: Entity,
  world: WorldState,
  blockedNext: StoryAction | undefined,
): Movement {
  const from = center(entity.bounds);
  if (blockedNext?.type === "blocked_by" || world.pathStatus === "blocked") {
    const obstacleId =
      blockedNext?.type === "blocked_by"
        ? blockedNext.obstacleId
        : world.entities.find((candidate) => candidate.kind === "river")?.id;
    const obstacle = world.entities.find((item) => item.id === obstacleId);
    if (obstacle) {
      const obstacleCenter = center(obstacle.bounds);
      const leftToRight = from.x < obstacleCenter.x;
      const destinationX = leftToRight
        ? obstacle.bounds.x - entity.bounds.width / 2 - 14
        : obstacle.bounds.x +
          obstacle.bounds.width +
          entity.bounds.width / 2 +
          14;
      return {
        offset: {
          x: destinationX - from.x,
          y: Math.max(-80, Math.min(80, obstacleCenter.y - from.y)),
        },
        placement: "near-obstacle",
      };
    }
  }

  const destination = center(target.bounds);
  const direction = destination.x >= from.x ? 1 : -1;
  const destinationX =
    destination.x -
    direction * (target.bounds.width / 2 + entity.bounds.width / 2 + 24);
  return {
    offset: {
      x: destinationX - from.x,
      y: destination.y - from.y,
    },
    placement: "target-side",
  };
}

/** The piece a beat moves, if any: `move_toward` and `blocked_by` beats. */
export function beatMovement(
  action: StoryAction,
  nextAction: StoryAction | undefined,
  world: WorldState,
): { entityId: string; movement: Movement } | undefined {
  const find = (id: string) => world.entities.find((item) => item.id === id);
  if (action.type === "move_toward") {
    const entity = find(action.entityId);
    const target = find(action.targetId);
    if (!entity || !target) return undefined;
    return {
      entityId: entity.id,
      movement: movementFor(entity, target, world, nextAction),
    };
  }
  if (action.type === "blocked_by") {
    const entity = find(action.entityId);
    const obstacle = find(action.obstacleId);
    if (!entity || !obstacle) return undefined;
    return {
      entityId: entity.id,
      movement: movementFor(entity, obstacle, world, action),
    };
  }
  return undefined;
}

/** How long a beat holds the stage before the next beat. */
export function beatHoldMs(action: StoryAction, reducedMotion: boolean) {
  if (reducedMotion) return REDUCED_MOTION_BEAT_HOLD_MS;
  return action.type === "celebrate"
    ? BEAT_HOLD_MS + CELEBRATE_EXTRA_MS
    : BEAT_HOLD_MS;
}

/**
 * Rain shown when a sequence starts: the committed weather, unless the
 * sequence itself will present a weather shift.
 */
export function restingRain(world: WorldState, sequence: StorySequence | null) {
  return (
    world.weather === "rain" &&
    !sequence?.beats.some((item) => item.action.type === "weather_shift")
  );
}

/**
 * The entity kept hidden until its reveal beat plays, or undefined. Rooms that
 * keep committed reveals visible never hide anything.
 */
export function pendingRevealId(
  sequence: StorySequence | null,
  keepCommittedRevealsVisible: boolean,
  completedRevealEventId: string,
) {
  if (!sequence || keepCommittedRevealsVisible) return undefined;
  if (completedRevealEventId === sequence.sourceEventId) return undefined;
  const reveal = sequence.beats.find(
    (item) => item.action.type === "reveal",
  )?.action;
  return reveal?.type === "reveal" ? reveal.entityId : undefined;
}

/** The logical left edge of a piece in the 1000x600 world. */
export function logicalX(entity: Entity, offset: Offset | undefined) {
  return Math.round(entity.bounds.x + (offset?.x ?? 0));
}
