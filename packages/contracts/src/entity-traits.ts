import type { Entity, EntityProperty, EntityRole, WorldState } from "./model";

// The engine's reading of roles and properties, in one place so the
// simulation, story validation, API and renderer agree.

type Traits = Pick<Entity, "role" | "properties">;

export function has(entity: Traits, property: EntityProperty): boolean {
  // Tolerates a malformed snapshot with no properties rather than throwing.
  return (
    Array.isArray(entity.properties) && entity.properties.includes(property)
  );
}

/** Stops the character's way when it lies across the path. */
export function isBlocker(entity: Traits): boolean {
  return has(entity, "blocks");
}

/** A helper that can carry the character (a bridge, a raft). */
export function isSpanner(entity: Traits): boolean {
  return entity.role === "helper" && has(entity, "carries");
}

/** Brings rain to the world while it is present. */
export function makesRain(entity: Traits): boolean {
  return has(entity, "weather");
}

// ---- the route between the character and its goal ------------------------

function centerX(entity: Pick<Entity, "bounds">) {
  return entity.bounds.x + entity.bounds.width / 2;
}

/**
 * Does `blocker` lie across the straight route from `from` to `to`? Only the
 * horizontal extent counts: the blocker must sit strictly between their
 * centres.
 */
export function liesAcross(
  blocker: Pick<Entity, "bounds">,
  from: Pick<Entity, "bounds">,
  to: Pick<Entity, "bounds">,
): boolean {
  const start = centerX(from);
  const end = centerX(to);
  const b = blocker.bounds;
  return Math.min(start, end) < b.x && Math.max(start, end) > b.x + b.width;
}

type Route = Pick<WorldState, "entities" | "goal"> &
  Partial<Pick<WorldState, "crossings">>;

/**
 * Everything that `blocks` and lies across the route from the goal's
 * character to its target, crossed or not. Nearest to the character first;
 * empty without a goal. `excluding` leaves one entity out (the drawing
 * being judged is never its own obstacle).
 */
export function routeObstacles(world: Route, excluding?: string): Entity[] {
  const character = world.entities.find(
    (entity) => entity.id === world.goal?.characterId,
  );
  const target = world.entities.find(
    (entity) => entity.id === world.goal?.targetId,
  );
  if (!character || !target) return [];
  return world.entities
    .filter(
      (entity) =>
        isBlocker(entity) &&
        entity.id !== excluding &&
        entity.id !== character.id &&
        entity.id !== target.id &&
        liesAcross(entity, character, target),
    )
    .sort(
      (a, b) =>
        Math.abs(centerX(a) - centerX(character)) -
        Math.abs(centerX(b) - centerX(character)),
    );
}

/**
 * The route obstacles that still close the way: those no committed
 * interaction has got the character past (see `crossings`). Only a resolved
 * interaction opens a route; a drawing's geometry alone never does.
 */
export function routeBlockers(world: Route, excluding?: string): Entity[] {
  const crossed = new Set(
    (world.crossings ?? []).map((crossing) => crossing.obstacleId),
  );
  return routeObstacles(world, excluding).filter(
    (entity) => !crossed.has(entity.id),
  );
}

/**
 * The obstacle to blame for a blocked route: one the character is afraid of
 * if it is among the route's blockers, else the nearest. Undefined when
 * nothing blocks the route.
 */
export function blockingObstacle(
  world: Route & Pick<WorldState, "rules">,
  excluding?: string,
): Entity | undefined {
  const blockers = routeBlockers(world, excluding);
  const feared = blockers.find((blocker) =>
    world.rules.some(
      (rule) =>
        rule.predicate === "afraid_of" &&
        rule.subjectId === world.goal?.characterId &&
        rule.objectId === blocker.id,
    ),
  );
  return feared ?? blockers[0];
}

export type EntityPreset = "bridge" | "cloud" | "shelter";

/** Role and properties for the sample objects and the edit tool's hints. */
export const ENTITY_PRESETS: Record<
  EntityPreset,
  { role: EntityRole; properties: EntityProperty[] }
> = {
  bridge: { role: "helper", properties: ["carries"] },
  cloud: { role: "scenery", properties: ["weather"] },
  shelter: { role: "helper", properties: ["shelters"] },
};

/** A fresh copy of a preset's role and properties, safe to store. */
export function presetTraits(preset: EntityPreset): {
  role: EntityRole;
  properties: EntityProperty[];
} {
  const { role, properties } = ENTITY_PRESETS[preset];
  return { role, properties: [...properties] };
}

/**
 * Properties a hand-added or retyped object starts with, so a child who marks
 * "Something in the way" gets a thing that actually blocks.
 */
export function defaultPropertiesFor(role: EntityRole): EntityProperty[] {
  switch (role) {
    case "character":
      return ["moves"];
    case "goal":
      return ["goal"];
    case "obstacle":
      return ["blocks"];
    case "helper":
      return ["carries"];
    case "scenery":
      return [];
  }
}
