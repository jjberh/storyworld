import type { WorldOperation, WorldState } from "@storyworld/contracts/model";
import {
  blockingObstacle,
  isBlocker,
  presetTraits,
} from "@storyworld/contracts/entity-traits";

/**
 * The obstacle a sample bridge should span: the one closing the goal route,
 * else (with no goal, or nothing on the route) the first thing that blocks.
 */
function obstacleToSpan(world: WorldState) {
  return (
    blockingObstacle(world) ??
    world.entities.find(
      (entity) =>
        isBlocker(entity) &&
        entity.id !== world.goal?.characterId &&
        entity.id !== world.goal?.targetId,
    )
  );
}

/** Creates a bounded bridge that spans the committed blocker geometry. */
export function bridgeOperationForWorld(
  world: WorldState,
  id = `bridge-${crypto.randomUUID()}`,
): WorldOperation {
  const river = obstacleToSpan(world);
  if (!river)
    return {
      type: "CREATE_ENTITY",
      entity: {
        id,
        ...presetTraits("bridge"),
        name: "Paper bridge",
        description: "A paper bridge laid across the way.",
        bounds: { x: 405, y: 320, width: 190, height: 55 },
      },
    };

  const left = Math.max(0, river.bounds.x - 20);
  const right = Math.min(1000, river.bounds.x + river.bounds.width + 20);
  const height = Math.min(55, river.bounds.height);
  const y = Math.max(
    0,
    Math.min(
      600 - height,
      river.bounds.y + river.bounds.height / 2 - height / 2,
    ),
  );
  return {
    type: "CREATE_ENTITY",
    entity: {
      id,
      ...presetTraits("bridge"),
      name: "Paper bridge",
      description: "A paper bridge laid across the way.",
      bounds: { x: left, y, width: right - left, height },
    },
  };
}
