import type { Entity } from "@storyworld/contracts/model";
import {
  has,
  isBlocker,
  isSpanner,
  makesRain,
} from "@storyworld/contracts/entity-traits";

/**
 * How the stage draws a piece that has no drawing to cut out, and which layer
 * it sits on. Derived from role and properties, never from its name.
 */
export type EntityLook =
  | "character"
  | "goal"
  | "water"
  | "barrier"
  | "span"
  | "cloud"
  | "shelter"
  | "thing";

// Only a blocker that reads as water draws as water; a wall is a barrier.
const WATERY_NAME =
  /\b(river|stream|creek|brook|lake|pond|sea|ocean|water|waves?|puddle|moat)\b/i;

export function entityLook(
  entity: Pick<Entity, "role" | "properties" | "name">,
): EntityLook {
  if (entity.role === "character") return "character";
  if (entity.role === "goal") return "goal";
  if (makesRain(entity)) return "cloud";
  if (isSpanner(entity)) return "span";
  if (has(entity, "shelters")) return "shelter";
  if (isBlocker(entity))
    return has(entity, "swims") ||
      has(entity, "floats") ||
      WATERY_NAME.test(entity.name)
      ? "water"
      : "barrier";
  return "thing";
}

/** Scenery below, travellers above, sky on top. */
export const paintLayer: Record<EntityLook, number> = {
  water: 0,
  span: 1,
  barrier: 2,
  goal: 2,
  shelter: 2,
  thing: 2,
  character: 3,
  cloud: 4,
};

/** Paint order for a piece: flying things share the sky layer with clouds. */
export function paintLayerFor(
  entity: Pick<Entity, "role" | "properties" | "name">,
) {
  const look = entityLook(entity);
  return look === "thing" && has(entity, "flies")
    ? paintLayer.cloud
    : paintLayer[look];
}
