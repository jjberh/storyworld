import type { Entity, WorldState } from "./model";
import type { StoryBeat } from "./story-beat";
import { has } from "./entity-traits";
import { storyCharacter } from "./interaction";

type Beat = Omit<StoryBeat, "id">;

/**
 * Whether the character can walk over to `thing` in free play: its middle is
 * within a band of the character's, so nobody walks up into the sky to a sun
 * or a cloud.
 */
export function withinWalk(
  character: Pick<Entity, "bounds">,
  thing: Pick<Entity, "bounds">,
): boolean {
  const middle = (entity: Pick<Entity, "bounds">) =>
    entity.bounds.y + entity.bounds.height / 2;
  return Math.abs(middle(thing) - middle(character)) <= 150;
}

/**
 * The interaction this world committed at its own revision, if any. A
 * restored or later world still carries its last interaction, but only the
 * event that resolved it presents it.
 */
export function freshInteraction(world: WorldState) {
  return world.interaction?.revision === world.revision
    ? world.interaction
    : undefined;
}

/**
 * Deterministic narration for a freshly committed interaction outcome, used by
 * the keyless story director and the browser's local fallback. This only
 * narrates the outcome Jev chose and the reducer committed; it never decides
 * one. Failures are funny and kind, never "wrong". Returns no beats when the
 * world has no fresh interaction.
 */
export function interactionBeats(
  world: WorldState,
  previous: WorldState | null,
): Beat[] {
  const interaction = freshInteraction(world);
  if (!interaction) return [];
  const find = (id: string | null | undefined): Entity | undefined =>
    world.entities.find((entity) => entity.id === id);
  const actor = find(interaction.entityId);
  if (!actor) return [];
  const character = storyCharacter(world);
  const target = find(world.goal?.targetId);
  const obstacle = find(interaction.obstacleId);
  const opened =
    previous?.pathStatus !== "available" && world.pathStatus === "available";
  const way = obstacle?.name ?? "the way";

  const focusActor = (narration: string): Beat => ({
    narration,
    mood: "curious",
    action: { type: "focus", entityId: actor.id },
  });
  const heads = (narration: string): Beat[] =>
    character && target
      ? [
          {
            narration,
            mood: "delighted",
            action: {
              type: "move_toward",
              entityId: character.id,
              targetId: target.id,
            },
          },
        ]
      : [];
  const celebrate = (): Beat[] =>
    opened && character
      ? [
          {
            narration: `${character.name} made it across!`,
            mood: "delighted",
            action: { type: "celebrate", entityId: character.id },
          },
        ]
      : [];
  const react = (
    reaction: "surprised" | "scared" | "happy",
    narration: string,
    cause: Entity = actor,
  ): Beat[] =>
    character && cause.id !== character.id
      ? [
          {
            narration,
            mood:
              reaction === "scared"
                ? "worried"
                : reaction === "happy"
                  ? "delighted"
                  : "curious",
            action: {
              type: "react",
              entityId: character.id,
              causeId: cause.id,
              reaction,
            },
          },
        ]
      : [];
  const stopped = (
    type: "blocked_by" | "splash",
    narration: string,
    mood: Beat["mood"],
  ): Beat[] =>
    character && obstacle && has(obstacle, "blocks")
      ? [
          {
            narration,
            mood,
            action: { type, entityId: character.id, obstacleId: obstacle.id },
          },
        ]
      : [];

  const name = character?.name ?? "Everyone";
  let beats: Beat[];
  switch (interaction.outcome) {
    case "crosses":
      beats = [
        focusActor(`${actor.name} reaches across ${way}.`),
        ...heads(`${name} crosses ${actor.name} toward ${target?.name}!`),
        ...celebrate(),
      ];
      break;
    case "flies_over": {
      const flight: Beat[] =
        obstacle && has(obstacle, "blocks")
          ? [
              {
                narration: `${actor.name} swoops up over ${obstacle.name}!`,
                mood: "delighted",
                action: {
                  type: "fly_over",
                  entityId: actor.id,
                  obstacleId: obstacle.id,
                },
              },
            ]
          : [focusActor(`${actor.name} takes to the sky.`)];
      const landing: Beat[] =
        character && target && has(actor, "carries")
          ? [
              {
                narration: `${name} rides ${actor.name} through the sky to ${target.name}!`,
                mood: "delighted",
                action: {
                  type: "ride",
                  entityId: character.id,
                  carrierId: actor.id,
                  targetId: target.id,
                },
              },
            ]
          : heads(`${name} floats over and heads for ${target?.name}!`);
      beats = [...flight, ...landing, ...celebrate()];
      break;
    }
    case "rides_across":
      beats = [
        focusActor(`${actor.name} is ready to give a ride.`),
        ...(character && target
          ? [
              {
                narration: `${name} hops on ${actor.name} and rides across ${way}!`,
                mood: "delighted" as const,
                action: {
                  type: "ride" as const,
                  entityId: character.id,
                  carrierId: actor.id,
                  targetId: target.id,
                },
              },
            ]
          : []),
        ...celebrate(),
      ];
      break;
    case "launched_across":
      beats = [
        focusActor(`${actor.name} gets ready to bounce.`),
        ...(character && target
          ? [
              {
                narration: `Boing! ${actor.name} sends ${name} sailing over ${way}!`,
                mood: "delighted" as const,
                action: {
                  type: "launch" as const,
                  entityId: character.id,
                  launcherId: actor.id,
                  targetId: target.id,
                },
              },
            ]
          : []),
        ...celebrate(),
      ];
      break;
    case "almost":
      beats = [
        focusActor(`${name} gives ${actor.name} a try.`),
        ...stopped(
          "blocked_by",
          `So close! ${name} wobbles back from ${way}. What else could help?`,
          "curious",
        ),
      ];
      break;
    case "splash":
      beats = [
        focusActor(`${name} gives ${actor.name} a try.`),
        ...stopped(
          "splash",
          `Splash! ${name} tumbles into ${way} and comes up giggling.`,
          "delighted",
        ),
      ];
      break;
    case "blocked":
      beats = [
        focusActor(`${actor.name} joins the picture.`),
        ...stopped(
          "blocked_by",
          `${obstacle?.name ?? "Something"} is still in the way. What else could help ${name}?`,
          "curious",
        ),
      ];
      break;
    case "scared":
      beats = react("scared", `Eek! ${name} jumps back from ${actor.name}!`);
      break;
    case "sheltered": {
      const shelter = has(actor, "shelters")
        ? actor
        : world.entities.find(
            (entity) => has(entity, "shelters") && entity.id !== character?.id,
          );
      beats = [
        ...(shelter && shelter.id !== actor.id
          ? [focusActor(`${actor.name} joins the picture.`)]
          : []),
        ...react(
          "happy",
          `${name} snuggles in, cozy and dry by ${shelter?.name ?? actor.name}.`,
          shelter ?? actor,
        ),
      ];
      break;
    }
    case "nothing_happens":
      // In free play there is no goal to head for, so the character goes to
      // play with the new drawing instead.
      beats =
        world.pathStatus === "free_play" && character
          ? [
              ...react("happy", `${name} spots ${actor.name} and smiles.`),
              ...(withinWalk(character, actor)
                ? [
                    {
                      narration: `${name} skips over to ${actor.name}.`,
                      mood: "delighted" as const,
                      action: {
                        type: "move_toward" as const,
                        entityId: character.id,
                        targetId: actor.id,
                      },
                    },
                  ]
                : []),
              {
                narration: withinWalk(character, actor)
                  ? `${name} and ${actor.name} play together!`
                  : `${name} waves hello to ${actor.name}!`,
                mood: "delighted",
                action: { type: "celebrate", entityId: character.id },
              },
            ]
          : react("surprised", `${name} spots ${actor.name} and smiles.`);
      break;
  }
  if (beats.length === 0)
    beats = [focusActor(`${actor.name} joins the picture.`)];
  return beats.slice(0, 3);
}

/**
 * A free-play opening: there is no goal to head for, so the character steps
 * into the story and wanders over to the nearest friendly thing on its
 * ground (never into something that blocks or scares), if there is one.
 * Empty without a character.
 */
export function freePlayOpeningBeats(
  world: WorldState,
  openingNarration?: string,
): Beat[] {
  const character = storyCharacter(world);
  if (!character) return [];
  const middle = (entity: Entity) => ({
    x: entity.bounds.x + entity.bounds.width / 2,
    y: entity.bounds.y + entity.bounds.height / 2,
  });
  const from = middle(character);
  const distance = (entity: Entity) =>
    Math.hypot(middle(entity).x - from.x, middle(entity).y - from.y);
  const friend = world.entities
    .filter(
      (entity) =>
        entity.id !== character.id &&
        !has(entity, "blocks") &&
        !has(entity, "scares") &&
        withinWalk(character, entity),
    )
    .sort((a, b) => distance(a) - distance(b))[0];
  return [
    {
      narration:
        openingNarration?.trim().slice(0, 240) ||
        `${character.name} steps into the story.`,
      mood: "curious",
      action: { type: "focus", entityId: character.id },
    },
    ...(friend
      ? [
          {
            narration: `${character.name} wanders over to ${friend.name}.`,
            mood: "delighted" as const,
            action: {
              type: "move_toward" as const,
              entityId: character.id,
              targetId: friend.id,
            },
          },
        ]
      : []),
  ];
}

/**
 * In free play, the character notices something new in the picture. Nothing
 * when there is no character or the new thing is the character.
 */
export function freePlaySpotBeat(
  world: WorldState,
  thing: Entity,
): Beat | undefined {
  const character = storyCharacter(world);
  return character && character.id !== thing.id
    ? {
        narration: `${character.name} spots ${thing.name}!`,
        mood: "curious",
        action: {
          type: "react",
          entityId: character.id,
          causeId: thing.id,
          reaction: "surprised",
        },
      }
    : undefined;
}
