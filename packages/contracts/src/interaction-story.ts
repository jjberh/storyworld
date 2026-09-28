import type { Entity, WorldState } from "./model";
import type { StoryBeat } from "./story-beat";
import { has } from "./entity-traits";
import { storyCharacter } from "./interaction";

type Beat = Omit<StoryBeat, "id">;

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
      beats = react("surprised", `${name} spots ${actor.name} and smiles.`);
      break;
  }
  if (beats.length === 0)
    beats = [focusActor(`${actor.name} joins the picture.`)];
  return beats.slice(0, 3);
}
