import type { WorldEvent, WorldState } from "@storyworld/contracts/model";
import {
  validateStorySequenceForWorld,
  type StoryBeat,
  type StorySequence,
} from "@storyworld/contracts/story-beat";

function beat(
  event: WorldEvent,
  index: number,
  input: Omit<StoryBeat, "id">,
): StoryBeat {
  return { id: `${event.id}:${index}`, ...input };
}

function fallbackBeat(event: WorldEvent): StoryBeat | undefined {
  const character = event.state.entities.find(
    (entity) => entity.kind === "character",
  );
  const entity = character ?? event.state.entities[0];
  if (!entity) return undefined;
  return beat(event, 0, {
    narration: character
      ? `Here is ${character.name}, ready for the next part.`
      : `${entity.name} is part of the story.`,
    mood: "curious",
    action: {
      type: character ? "focus" : "reveal",
      entityId: entity.id,
    },
  });
}

function openingBeats(event: WorldEvent): StoryBeat[] {
  const { state } = event;
  const character =
    state.entities.find((entity) => entity.id === state.goal?.characterId) ??
    state.entities.find((entity) => entity.kind === "character");
  const target = state.entities.find(
    (entity) => entity.id === state.goal?.targetId,
  );
  const river = state.entities.find((entity) => entity.kind === "river");

  if (character && target && river && state.pathStatus === "blocked")
    return [
      beat(event, 0, {
        narration: `${character.name} steps into the story.`,
        mood: "curious",
        action: { type: "focus", entityId: character.id },
      }),
      beat(event, 1, {
        narration: `${character.name} heads toward ${target.name}.`,
        mood: "curious",
        action: {
          type: "move_toward",
          entityId: character.id,
          targetId: target.id,
        },
      }),
      beat(event, 2, {
        narration: `${river.name} stops the way.`,
        mood: "worried",
        action: {
          type: "blocked_by",
          entityId: character.id,
          obstacleId: river.id,
        },
      }),
    ];

  const fallback = fallbackBeat(event);
  return fallback ? [fallback] : [];
}

function addedEntities(latest: WorldState, previous?: WorldState) {
  if (!previous) return [];
  const previousIds = new Set(previous.entities.map((entity) => entity.id));
  return latest.entities.filter((entity) => !previousIds.has(entity.id));
}

/**
 * Builds presentation beats exclusively from committed event snapshots.
 * Pending proposals cannot enter this boundary.
 */
export function sequenceFromCommittedEvents(
  latest: WorldEvent,
  previous?: WorldEvent,
): StorySequence | null {
  let beats: StoryBeat[] = [];
  const additions = addedEntities(latest.state, previous?.state);
  const bridge = additions.find((entity) => entity.kind === "bridge");
  const cloud = additions.find((entity) => entity.kind === "cloud");
  const character = latest.state.entities.find(
    (entity) => entity.id === latest.state.goal?.characterId,
  );
  const target = latest.state.entities.find(
    (entity) => entity.id === latest.state.goal?.targetId,
  );
  const river = latest.state.entities.find((entity) => entity.kind === "river");

  if (!previous) {
    beats = openingBeats(latest);
  } else if (bridge) {
    beats.push(
      beat(latest, 0, {
        narration: `${bridge.name} unfolds across the water.`,
        mood: "curious",
        action: { type: "reveal", entityId: bridge.id },
      }),
    );
    if (
      previous.state.pathStatus !== "available" &&
      latest.state.pathStatus === "available" &&
      character &&
      target
    ) {
      beats.push(
        beat(latest, 1, {
          narration: `${character.name} can cross toward ${target.name}!`,
          mood: "delighted",
          action: {
            type: "move_toward",
            entityId: character.id,
            targetId: target.id,
          },
        }),
        beat(latest, 2, {
          narration: `${character.name} made it across!`,
          mood: "delighted",
          action: { type: "celebrate", entityId: character.id },
        }),
      );
    } else if (latest.state.pathStatus === "blocked" && character && river) {
      beats.push(
        beat(latest, 1, {
          narration: `${character.name} still needs a bridge that reaches both banks.`,
          mood: "worried",
          action: {
            type: "blocked_by",
            entityId: character.id,
            obstacleId: river.id,
          },
        }),
      );
    }
  } else if (cloud) {
    beats = [
      beat(latest, 0, {
        narration: `${cloud.name} drifts into the picture.`,
        mood: "curious",
        action: { type: "reveal", entityId: cloud.id },
      }),
      beat(latest, 1, {
        narration:
          latest.state.weather === "rain"
            ? "Paper raindrops begin to fall."
            : "The sky clears again.",
        mood: latest.state.weather === "rain" ? "worried" : "curious",
        action: {
          type: "weather_shift",
          weather: latest.state.weather,
          causeEntityId: latest.state.weather === "rain" ? cloud.id : undefined,
        },
      }),
    ];
  } else if (additions[0]) {
    beats = [
      beat(latest, 0, {
        narration: `${additions[0].name} joins the paper world.`,
        mood: "curious",
        action: { type: "reveal", entityId: additions[0].id },
      }),
    ];
  } else {
    if (latest.state.pathStatus === "blocked" && character && target && river)
      beats = [
        beat(latest, 0, {
          narration: `${character.name} returns to the riverbank.`,
          mood: "curious",
          action: {
            type: "move_toward",
            entityId: character.id,
            targetId: target.id,
          },
        }),
        beat(latest, 1, {
          narration: `${river.name} blocks the way again.`,
          mood: "worried",
          action: {
            type: "blocked_by",
            entityId: character.id,
            obstacleId: river.id,
          },
        }),
      ];
    else if (latest.state.pathStatus === "available" && character && target)
      beats = [
        beat(latest, 0, {
          narration: `${character.name} has a clear path to ${target.name}.`,
          mood: "curious",
          action: {
            type: "move_toward",
            entityId: character.id,
            targetId: target.id,
          },
        }),
      ];
    else {
      const fallback = fallbackBeat(latest);
      beats = fallback ? [fallback] : [];
    }
  }

  if (beats.length === 0) return null;
  const candidate: StorySequence = {
    mode: "fixture",
    requestId: `committed:${latest.id}`,
    sourceRevision: latest.revision,
    sourceEventId: latest.id,
    beats: beats.slice(0, 3),
  };
  const validation = validateStorySequenceForWorld(candidate, latest.state);
  return validation.ok ? validation.sequence : null;
}
