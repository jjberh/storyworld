import type {
  StoryAction,
  StoryBeat,
  StorySequenceRequest,
} from "@storyworld/contracts";

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

  if (!previous) return true;

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
  const goalMoveMatches =
    goal &&
    actions.some(
      (action) =>
        action.type === "move_toward" &&
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

  const fearedRivers = goal
    ? current.rules
        .filter(
          (rule) =>
            rule.predicate === "afraid_of" &&
            rule.subjectId === goal.characterId &&
            current.entities.some(
              (entity) =>
                entity.id === rule.objectId && entity.kind === "river",
            ),
        )
        .map((rule) => rule.objectId)
    : [];
  const relevantRivers =
    fearedRivers.length > 0
      ? fearedRivers
      : current.entities
          .filter((entity) => entity.kind === "river")
          .map((entity) => entity.id);
  const goalBlockMatches =
    goal &&
    actions.some(
      (action) =>
        action.type === "blocked_by" &&
        action.entityId === goal.characterId &&
        relevantRivers.includes(action.obstacleId),
    );
  if (
    previous.pathStatus !== "blocked" &&
    current.pathStatus === "blocked" &&
    goal
  ) {
    if (relevantRivers.length > 0 && !goalBlockMatches) return false;
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
            entity.id === rule.subjectId && entity.kind === "character",
        ) &&
        current.entities.some(
          (entity) => entity.id === rule.objectId && entity.kind === "river",
        ) &&
        !actions.some(
          (action) =>
            action.type === "blocked_by" &&
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
      relevantRivers.length > 0 &&
      !goalBlockMatches
    )
      return false;
    if (current.pathStatus === "available" && goal && !goalMoveMatches)
      return false;
  }

  return true;
}
