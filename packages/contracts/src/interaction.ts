import { z } from "zod";
import type {
  Entity,
  InteractionOutcome,
  WorldOperation,
  WorldState,
} from "./model";
import {
  blockingObstacle,
  has,
  hasReachableGoal,
  routeBlockers,
  routeObstacles,
} from "./entity-traits";
import {
  entityIdSchema,
  interactionOutcomeSchema,
  worldStateSchema,
} from "./world-schema";

// What happens when a new drawing meets the story. Jev (the interaction
// resolver) picks the outcome; these rules only say which outcomes a world
// can present, and what a committed outcome does to the route.

export { interactionOutcomeSchema };

export const INTERACTION_OUTCOMES = interactionOutcomeSchema.options;

/** Outcomes that get the character past the obstacle and open the route. */
export const SUCCESS_OUTCOMES: readonly InteractionOutcome[] = [
  "crosses",
  "flies_over",
  "rides_across",
  "launched_across",
];

/** Funny failures: the route stays as it was. */
export const FAILURE_OUTCOMES: readonly InteractionOutcome[] = [
  "almost",
  "splash",
  "blocked",
  "scared",
];

/**
 * What can happen in free play (a character but no goal). Crossing and the
 * funny misses need a route to cross or fall short of, so without a goal
 * they never fit, even when something that blocks is in the picture: there
 * is nowhere to get past it to. A new drawing can still scare, shelter or
 * simply delight the character.
 */
export const FREE_PLAY_OUTCOMES: readonly InteractionOutcome[] = [
  "nothing_happens",
  "scared",
  "sheltered",
];

export function opensRoute(outcome: InteractionOutcome): boolean {
  return SUCCESS_OUTCOMES.includes(outcome);
}

/** The goal's character, else the first character. */
export function storyCharacter(
  world: Pick<WorldState, "entities" | "goal">,
): Entity | undefined {
  return (
    world.entities.find((entity) => entity.id === world.goal?.characterId) ??
    world.entities.find((entity) => entity.role === "character")
  );
}

/**
 * The route obstacle `actorId`'s interaction is about: the one still closing
 * the way (a feared one first), else the nearest one already crossed. The
 * actor is never its own obstacle.
 */
export function interactionObstacle(
  world: Pick<WorldState, "entities" | "goal" | "rules" | "crossings">,
  actorId: string,
): Entity | undefined {
  return blockingObstacle(world, actorId) ?? routeObstacles(world, actorId)[0];
}

/**
 * Why `outcome` cannot be presented for `entityId` in this world, or
 * undefined when it can. Checks only what the story beats need to show it:
 * a goal to travel to, an obstacle to tumble into, a flyer to fly, a carrier
 * to ride, a launcher to bounce, a character to react.
 */
export function interactionProblem(
  world: Pick<WorldState, "entities" | "goal" | "rules" | "crossings">,
  entityId: string,
  outcome: InteractionOutcome,
): string | undefined {
  const actor = world.entities.find((entity) => entity.id === entityId);
  if (!actor) return "That drawing is not in this world.";
  const character = storyCharacter(world);
  // Without a goal (free play) only FREE_PLAY_OUTCOMES can fit.
  const hasGoal = hasReachableGoal(world);
  if (
    actor.id === character?.id ||
    actor.id === world.goal?.characterId ||
    actor.id === world.goal?.targetId
  )
    return "The character and its goal cannot resolve an interaction.";
  // Something that itself closes the route cannot carry anyone past it (a
  // river never crosses itself); it can still fail, scare or just be there.
  if (
    opensRoute(outcome) &&
    routeBlockers(world).some((entity) => entity.id === actor.id)
  )
    return "Something in the way cannot get anyone past itself.";
  switch (outcome) {
    case "crosses":
      return hasGoal ? undefined : "There is no goal to reach.";
    case "flies_over":
      if (!hasGoal) return "There is no goal to reach.";
      return has(actor, "flies")
        ? undefined
        : "Only something that flies can fly over.";
    case "rides_across":
      if (!hasGoal) return "There is no goal to reach.";
      return has(actor, "carries")
        ? undefined
        : "Only something that carries can give a ride.";
    case "launched_across":
      if (!hasGoal) return "There is no goal to reach.";
      return has(actor, "launches")
        ? undefined
        : "Only something that launches can launch.";
    case "almost":
    case "splash":
    case "blocked":
      // A funny failure needs something still in the way to fail against.
      if (!hasGoal) return "There is no goal to reach.";
      return blockingObstacle(world, actor.id)
        ? undefined
        : "Nothing is in the way any more.";
    case "scared":
      return character ? undefined : "There is no character to react.";
    case "sheltered":
      if (!character) return "There is no character to shelter.";
      return world.entities.some((entity) => has(entity, "shelters"))
        ? undefined
        : "Nothing here gives shelter.";
    case "nothing_happens":
      return undefined;
  }
}

/**
 * Why nobody may remove `entityId`, or undefined when it may go. Something
 * that still closes the route is passed only through a committed outcome,
 * never by taking it away (rewind and reset remain the way back).
 */
export function removalProblem(
  world: Pick<WorldState, "entities" | "goal" | "crossings">,
  entityId: string,
): string | undefined {
  return routeBlockers(world).some((entity) => entity.id === entityId)
    ? "Something in the way can't be taken away. Draw something to help instead!"
    : undefined;
}

/**
 * Why a guest may not propose `operation` in `world`, or undefined when it
 * may. Only the director resolves what a drawing does: outcomes come from
 * Jev through the director's client, never from a proposal.
 */
export function proposalProblem(
  operation: WorldOperation,
  world: Pick<WorldState, "entities" | "goal" | "crossings">,
): string | undefined {
  if (operation.type === "RESOLVE_INTERACTION")
    return "Only the director decides what happens.";
  if (operation.type === "CREATE_ENTITY" && operation.entity.outcome)
    return "A new drawing cannot arrive with an outcome.";
  if (operation.type === "REMOVE_ENTITY")
    return removalProblem(world, operation.entityId);
  return undefined;
}

/**
 * The world without the child's stroke data, for requests that only need
 * structure (the story director and Jev). Sketches can be large.
 */
export function withoutSketches<T extends Pick<WorldState, "entities">>(
  world: T,
): T {
  if (!world.entities.some((entity) => entity.sketch)) return world;
  return {
    ...world,
    entities: world.entities.map((entity) => {
      if (!entity.sketch) return entity;
      const copy = { ...entity };
      delete copy.sketch;
      return copy;
    }),
  };
}

// ---- POST /api/interactions ------------------------------------------------

/** The committed world after the drawing was added, and the drawing's ID. */
export const interactionRequestSchema = z
  .object({ world: worldStateSchema, entityId: entityIdSchema })
  .strict()
  .superRefine((request, ctx) => {
    if (
      !request.world.entities.some((entity) => entity.id === request.entityId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["entityId"],
        message: "The drawing must be in the committed world.",
      });
  });

export const interactionResponseSchema = z
  .object({
    mode: z.literal("live"),
    outcome: interactionOutcomeSchema,
    /**
     * How likely the drawing gets the character to the goal (Jev Score).
     * Null in free play: with no goal the question is not asked.
     */
    odds: z.number().min(0).max(1).nullable(),
    /** Jev's confidence in the outcome choice. */
    confidence: z.number().min(0).max(1),
    /** The new drawing. */
    actorId: entityIdSchema,
    /** The character the outcome happens to, if any. */
    characterId: entityIdSchema.nullable(),
    /** The route obstacle the outcome is about, if any. */
    obstacleId: entityIdSchema.nullable(),
  })
  .strict()
  .superRefine((response, ctx) => {
    // Free play has no route, so no obstacle and no route outcome.
    if (response.odds !== null) return;
    if (response.obstacleId !== null)
      ctx.addIssue({
        code: "custom",
        path: ["obstacleId"],
        message: "Free play has no route obstacle.",
      });
    if (!FREE_PLAY_OUTCOMES.includes(response.outcome))
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Free play has no route to cross or miss.",
      });
  });

export type InteractionRequest = z.infer<typeof interactionRequestSchema>;
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;
