import type { Bounds, Entity, WorldState } from "@storyworld/contracts/model";
import type {
  StoryAction,
  StorySequence,
} from "@storyworld/contracts/story-beat";
import { blockingObstacle } from "@storyworld/contracts/entity-traits";

// Pure beat-playback rules for the Story Room stage. The renderer owns timing
// and visuals; these functions only decide where pieces go and how long a beat
// holds, so they can be tested without a canvas.

export type Offset = { x: number; y: number };
export type Placement =
  "source" | "near-obstacle" | "beyond-obstacle" | "on-carrier" | "target-side";
export type Movement = { offset: Offset; placement: Placement };

/** How long a beat holds before the next one starts, in milliseconds. */
export const BEAT_HOLD_MS = 650;
export const REDUCED_MOTION_BEAT_HOLD_MS = 40;
export const CELEBRATE_EXTRA_MS = 280;
/** Extra hold for beats that carry a piece across the stage. */
export const TRAVEL_EXTRA_MS = 250;

export function center(bounds: Bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/** Beats that leave the character stuck on the near side of an obstacle. */
function stopsAtObstacle(
  action: StoryAction | undefined,
): action is Extract<StoryAction, { type: "blocked_by" | "splash" }> {
  return action?.type === "blocked_by" || action?.type === "splash";
}

/** Beside `target`, on the side `entity` comes from. */
function besideTarget(entity: Entity, target: Entity): Movement {
  const from = center(entity.bounds);
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

/** On the near (`side` = -1) or far (`side` = 1) edge of an obstacle. */
function byObstacle(entity: Entity, obstacle: Entity, side: 1 | -1) {
  const from = center(entity.bounds);
  const obstacleCenter = center(obstacle.bounds);
  const leftToRight = from.x < obstacleCenter.x;
  const nearLeft = leftToRight === (side === -1);
  const destinationX = nearLeft
    ? obstacle.bounds.x - entity.bounds.width / 2 - 14
    : obstacle.bounds.x + obstacle.bounds.width + entity.bounds.width / 2 + 14;
  return {
    x: destinationX - from.x,
    y: Math.max(-80, Math.min(80, obstacleCenter.y - from.y)),
  };
}

/**
 * Where `entity` should stand when heading for `target`. A blocked route (or a
 * `blocked_by` or `splash` beat coming next) parks it on the near bank of the
 * obstacle instead; otherwise it stops beside the target.
 */
export function movementFor(
  entity: Entity,
  target: Entity,
  world: WorldState,
  blockedNext: StoryAction | undefined,
): Movement {
  if (stopsAtObstacle(blockedNext) || world.pathStatus === "blocked") {
    const obstacleId = stopsAtObstacle(blockedNext)
      ? blockedNext.obstacleId
      : blockingObstacle(world)?.id;
    const obstacle = world.entities.find((item) => item.id === obstacleId);
    if (obstacle)
      return {
        offset: byObstacle(entity, obstacle, -1),
        placement: "near-obstacle",
      };
  }
  return besideTarget(entity, target);
}

/**
 * The piece a beat moves, if any: `move_toward`, `blocked_by` and `splash`
 * walk the character to (or up to) something; `fly_over` carries a flyer to
 * the far side of an obstacle; `ride` and `launch` take a piece to their
 * target (a ride with no target climbs onto the carrier). The committed path
 * status is authoritative: on a blocked route the goal's character never
 * travels past the obstacle, whatever the beat says; it parks on the near
 * bank like `move_toward`. `focus`, `reveal`, `celebrate`, `react` and
 * `weather_shift` only pulse in place.
 */
export function beatMovement(
  action: StoryAction,
  nextAction: StoryAction | undefined,
  world: WorldState,
): { entityId: string; movement: Movement } | undefined {
  const find = (id: string) => world.entities.find((item) => item.id === id);
  const heldBack = (entity: Entity) =>
    world.pathStatus === "blocked" && entity.id === world.goal?.characterId;
  switch (action.type) {
    case "move_toward": {
      const entity = find(action.entityId);
      const target = find(action.targetId);
      if (!entity || !target) return undefined;
      return {
        entityId: entity.id,
        movement: movementFor(entity, target, world, nextAction),
      };
    }
    case "blocked_by":
    case "splash": {
      const entity = find(action.entityId);
      const obstacle = find(action.obstacleId);
      if (!entity || !obstacle) return undefined;
      return {
        entityId: entity.id,
        movement: movementFor(entity, obstacle, world, action),
      };
    }
    case "fly_over": {
      const entity = find(action.entityId);
      const obstacle = find(action.obstacleId);
      if (!entity || !obstacle) return undefined;
      if (heldBack(entity))
        return {
          entityId: entity.id,
          movement: movementFor(entity, obstacle, world, undefined),
        };
      return {
        entityId: entity.id,
        movement: {
          offset: byObstacle(entity, obstacle, 1),
          placement: "beyond-obstacle",
        },
      };
    }
    case "ride": {
      const entity = find(action.entityId);
      const carrier = find(action.carrierId);
      if (!entity || !carrier) return undefined;
      const target = action.targetId ? find(action.targetId) : undefined;
      if (target)
        return {
          entityId: entity.id,
          movement: heldBack(entity)
            ? movementFor(entity, target, world, undefined)
            : besideTarget(entity, target),
        };
      const from = center(entity.bounds);
      const onto = center(carrier.bounds);
      return {
        entityId: entity.id,
        movement: {
          offset: {
            x: onto.x - from.x,
            y: carrier.bounds.y - entity.bounds.height / 2 - from.y,
          },
          placement: "on-carrier",
        },
      };
    }
    case "launch": {
      const entity = find(action.entityId);
      const target = action.targetId ? find(action.targetId) : undefined;
      if (!entity || !target) return undefined;
      return {
        entityId: entity.id,
        movement: heldBack(entity)
          ? movementFor(entity, target, world, undefined)
          : besideTarget(entity, target),
      };
    }
    default:
      return undefined;
  }
}

const holdExtras: Partial<Record<StoryAction["type"], number>> = {
  celebrate: CELEBRATE_EXTRA_MS,
  fly_over: TRAVEL_EXTRA_MS,
  ride: TRAVEL_EXTRA_MS,
  launch: TRAVEL_EXTRA_MS,
  splash: TRAVEL_EXTRA_MS,
};

/** How long a beat holds the stage before the next beat. */
export function beatHoldMs(action: StoryAction, reducedMotion: boolean) {
  if (reducedMotion) return REDUCED_MOTION_BEAT_HOLD_MS;
  return BEAT_HOLD_MS + (holdExtras[action.type] ?? 0);
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
