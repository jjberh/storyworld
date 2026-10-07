import type {
  StoryAction,
  StoryBeat,
  StorySequenceRequest,
} from "@storyworld/contracts";
import { isBlocker, routeBlockers } from "@storyworld/contracts/entity-traits";
import { storyCharacter } from "@storyworld/contracts/interaction";
import { freshInteraction } from "@storyworld/contracts/interaction-story";

function referencedIds(action: StoryAction) {
  switch (action.type) {
    case "focus":
    case "reveal":
    case "celebrate":
      return [action.entityId];
    case "move_toward":
      return [action.entityId, action.targetId];
    case "blocked_by":
      return [action.entityId, action.obstacleId];
    case "weather_shift":
      return action.causeEntityId ? [action.causeEntityId] : [];
    case "fly_over":
    case "splash":
      return [action.entityId, action.obstacleId];
    case "ride":
      return [action.entityId, action.carrierId, action.targetId].filter(
        (id): id is string => id !== undefined,
      );
    case "launch":
      return [action.entityId, action.launcherId, action.targetId].filter(
        (id): id is string => id !== undefined,
      );
    case "react":
      return [action.entityId, action.causeId];
  }
}

export function storyBeatsMatchEventDelta(
  beats: StoryBeat[],
  request: StorySequenceRequest,
): boolean {
  const current = request.committedWorld;
  const previous = request.previousCommittedWorld;
  const actions = beats.map((beat) => beat.action);
  const currentEntityIds = new Set(current.entities.map((entity) => entity.id));
  const previousEntityIds = new Set(
    previous?.entities.map((entity) => entity.id) ?? [],
  );
  const addedEntityIds = new Set(
    current.entities
      .filter((entity) => !previousEntityIds.has(entity.id))
      .map((entity) => entity.id),
  );

  if (
    addedEntityIds.size > 0 &&
    !actions.some((action) =>
      referencedIds(action).some((id) => addedEntityIds.has(id)),
    )
  )
    return false;

  // Free play has no route, so nothing stops the character, trips it up or
  // has to be flown over.
  if (
    current.pathStatus === "free_play" &&
    actions.some(
      (action) =>
        action.type === "blocked_by" ||
        action.type === "splash" ||
        action.type === "fly_over",
    )
  )
    return false;

  if (!previous) return true;

  // A freshly resolved interaction must show the drawing that acted or the
  // character it happened to (a crossing is naturally the character's move,
  // a funny miss is the character stopped by the obstacle).
  const interaction = freshInteraction(current);
  const involved = [interaction?.entityId, storyCharacter(current)?.id];
  if (
    interaction &&
    previous.interaction?.revision !== interaction.revision &&
    !actions.some((action) =>
      referencedIds(action).some((id) => involved.includes(id)),
    )
  )
    return false;

  const removedEntityIds = previous.entities
    .filter((entity) => !currentEntityIds.has(entity.id))
    .map((entity) => entity.id);
  if (
    previous.weather !== current.weather &&
    !actions.some(
      (action) =>
        action.type === "weather_shift" && action.weather === current.weather,
    )
  )
    return false;

  const goal = current.goal;
  // Riding or being launched to the goal counts as heading there, but only on
  // an open route: the committed path status is authoritative.
  const goalMoveMatches =
    goal &&
    actions.some(
      (action) =>
        (action.type === "move_toward" ||
          ((action.type === "ride" || action.type === "launch") &&
            current.pathStatus === "available")) &&
        action.entityId === goal.characterId &&
        action.targetId === goal.targetId,
    );
  if (
    previous.pathStatus === "blocked" &&
    current.pathStatus === "available" &&
    goal &&
    !goalMoveMatches
  )
    return false;

  // The blockers actually closing the route, narrowed to feared ones if any.
  const routeBlockerIds = routeBlockers(current).map((entity) => entity.id);
  const fearedBlockers = goal
    ? routeBlockerIds.filter((id) =>
        current.rules.some(
          (rule) =>
            rule.predicate === "afraid_of" &&
            rule.subjectId === goal.characterId &&
            rule.objectId === id,
        ),
      )
    : [];
  const relevantBlockers =
    fearedBlockers.length > 0 ? fearedBlockers : routeBlockerIds;
  // Tumbling into the obstacle (splash) also shows the way is blocked.
  const goalBlockMatches =
    goal &&
    actions.some(
      (action) =>
        (action.type === "blocked_by" || action.type === "splash") &&
        action.entityId === goal.characterId &&
        relevantBlockers.includes(action.obstacleId),
    );
  if (
    previous.pathStatus !== "blocked" &&
    current.pathStatus === "blocked" &&
    goal
  ) {
    if (relevantBlockers.length > 0 && !goalBlockMatches) return false;
  }

  const goalChanged =
    previous.goal?.characterId !== goal?.characterId ||
    previous.goal?.targetId !== goal?.targetId;
  if (
    goalChanged &&
    goal &&
    !actions.some((action) =>
      referencedIds(action).some(
        (id) => id === goal.characterId || id === goal.targetId,
      ),
    )
  )
    return false;

  const addedFearRules = current.rules.filter(
    (rule) =>
      rule.predicate === "afraid_of" &&
      !previous.rules.some((oldRule) => oldRule.id === rule.id),
  );
  if (
    current.pathStatus === "blocked" &&
    addedFearRules.some(
      (rule) =>
        current.entities.some(
          (entity) =>
            entity.id === rule.subjectId && entity.role === "character",
        ) &&
        current.entities.some(
          (entity) => entity.id === rule.objectId && isBlocker(entity),
        ) &&
        !actions.some(
          (action) =>
            (action.type === "blocked_by" || action.type === "splash") &&
            action.entityId === rule.subjectId &&
            action.obstacleId === rule.objectId,
        ),
    )
  )
    return false;

  const representedTransition =
    previous.weather !== current.weather ||
    previous.pathStatus !== current.pathStatus ||
    goalChanged ||
    addedFearRules.length > 0;
  if (removedEntityIds.length > 0 && !representedTransition) {
    if (
      current.pathStatus === "blocked" &&
      goal &&
      relevantBlockers.length > 0 &&
      !goalBlockMatches
    )
      return false;
    if (current.pathStatus === "available" && goal && !goalMoveMatches)
      return false;
  }

  return true;
}
