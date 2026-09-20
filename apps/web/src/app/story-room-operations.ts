import type {
  Entity,
  WorldOperation,
  WorldState,
} from "@storyworld/contracts/model";

function centerX(entity: Entity) {
  return entity.bounds.x + entity.bounds.width / 2;
}

function blockingRiver(world: WorldState) {
  const character = world.entities.find(
    (entity) => entity.id === world.goal?.characterId,
  );
  const target = world.entities.find(
    (entity) => entity.id === world.goal?.targetId,
  );
  const rivers = world.entities.filter((entity) => entity.kind === "river");
  if (!character || !target) return rivers[0];
  const start = centerX(character);
  const end = centerX(target);
  return (
    rivers.find(
      (river) =>
        Math.min(start, end) < river.bounds.x &&
        Math.max(start, end) > river.bounds.x + river.bounds.width,
    ) ?? rivers[0]
  );
}

/** Creates a bounded bridge that spans the committed river geometry. */
export function bridgeOperationForWorld(
  world: WorldState,
  id = `bridge-${crypto.randomUUID()}`,
): WorldOperation {
  const river = blockingRiver(world);
  if (!river)
    return {
      type: "CREATE_ENTITY",
      entity: {
        id,
        kind: "bridge",
        name: "Paper bridge",
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
      kind: "bridge",
      name: "Paper bridge",
      bounds: { x: left, y, width: right - left, height },
    },
  };
}
