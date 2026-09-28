import {
  SCHEMA_VERSION,
  type WorldState,
  type WorldOperation,
  type Entity,
  type InteractionOutcome,
} from "./model";
import { blockingObstacle, makesRain, routeBlockers } from "./entity-traits";
import {
  interactionObstacle,
  interactionProblem,
  opensRoute,
  removalProblem,
} from "./interaction";
export function initialWorld(id: string): WorldState {
  return {
    id,
    revision: 0,
    schemaVersion: SCHEMA_VERSION,
    entities: [
      {
        id: "nova",
        role: "character",
        name: "Nova",
        description: "A small explorer who wants to reach the castle.",
        properties: ["moves"],
        bounds: { x: 150, y: 300, width: 80, height: 70 },
      },
      {
        id: "river",
        role: "obstacle",
        name: "River",
        description: "A wide river running across the land.",
        properties: ["blocks"],
        bounds: { x: 420, y: 0, width: 120, height: 600 },
      },
      {
        id: "castle",
        role: "goal",
        name: "Castle",
        description: "A castle on the far bank.",
        properties: ["goal"],
        bounds: { x: 740, y: 230, width: 140, height: 150 },
      },
    ],
    rules: [
      {
        id: "fear-water",
        subjectId: "nova",
        predicate: "afraid_of",
        objectId: "river",
      },
    ],
    goal: { characterId: "nova", targetId: "castle" },
    pathStatus: "blocked",
    weather: "clear",
    interaction: null,
    crossings: [],
  };
}
function validateEntity(e: Entity) {
  if (!e.id || e.id.length > 80 || !e.name || e.name.length > 80)
    throw new Error("Invalid entity name or ID.");
  const b = e.bounds;
  if (
    !Object.values(b).every(Number.isFinite) ||
    b.width <= 0 ||
    b.height <= 0 ||
    b.x < 0 ||
    b.y < 0 ||
    b.x + b.width > 1000 ||
    b.y + b.height > 600
  )
    throw new Error("Draw inside the world.");
}
/**
 * Route and weather from committed facts: the route is open once every
 * obstacle across it has a committed crossing (see RESOLVE_INTERACTION), and
 * anything with `weather` brings rain.
 */
export function deriveWorld(state: WorldState): WorldState {
  const character = state.entities.find(
    (e) => e.id === state.goal?.characterId,
  );
  const target = state.entities.find((e) => e.id === state.goal?.targetId);
  return {
    ...state,
    pathStatus:
      !character || !target
        ? "idle"
        : routeBlockers(state).length > 0
          ? "blocked"
          : "available",
    weather: state.entities.some(makesRain) ? "rain" : "clear",
  };
}
export function applyOperation(
  state: WorldState,
  op: WorldOperation,
): WorldState {
  let next: WorldState = {
    ...state,
    entities: [...state.entities],
    rules: [...state.rules],
    crossings: [...state.crossings],
    revision: state.revision + 1,
  };
  switch (op.type) {
    case "CREATE_ENTITY":
      validateEntity(op.entity);
      if (op.entity.outcome)
        throw new Error("A new drawing cannot arrive with an outcome.");
      if (state.entities.length >= 100) throw new Error("This world is full.");
      if (state.entities.some((e) => e.id === op.entity.id))
        throw new Error("That entity already exists.");
      next.entities.push(op.entity);
      break;
    case "REMOVE_ENTITY": {
      if (!state.entities.some((e) => e.id === op.entityId))
        throw new Error("Entity no longer exists.");
      const problem = removalProblem(state, op.entityId);
      if (problem) throw new Error(problem);
      next.entities = next.entities.filter((e) => e.id !== op.entityId);
      next.rules = next.rules.filter(
        (r) => r.subjectId !== op.entityId && r.objectId !== op.entityId,
      );
      if (
        next.goal?.characterId === op.entityId ||
        next.goal?.targetId === op.entityId
      )
        next.goal = null;
      // A removed helper no longer holds its crossing open.
      next.crossings = next.crossings.filter(
        (crossing) =>
          crossing.helperId !== op.entityId &&
          crossing.obstacleId !== op.entityId,
      );
      if (
        next.interaction?.entityId === op.entityId ||
        next.interaction?.obstacleId === op.entityId
      )
        next.interaction = null;
      break;
    }
    case "ADD_RULE":
      if (
        !state.entities.some((e) => e.id === op.rule.subjectId) ||
        !state.entities.some((e) => e.id === op.rule.objectId)
      )
        throw new Error("Rule refers to a missing entity.");
      if (state.rules.some((r) => r.id === op.rule.id))
        throw new Error("Rule already exists.");
      next.rules.push(op.rule);
      break;
    case "SET_GOAL":
      if (
        !state.entities.some(
          (e) => e.id === op.characterId && e.role === "character",
        ) ||
        !state.entities.some((e) => e.id === op.targetId)
      )
        throw new Error("Invalid goal.");
      next.goal = { characterId: op.characterId, targetId: op.targetId };
      break;
    case "RESOLVE_INTERACTION": {
      if (
        ![op.odds, op.confidence].every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        )
      )
        throw new Error("Invalid interaction odds.");
      const problem = interactionProblem(state, op.entityId, op.outcome);
      if (problem) throw new Error(problem);
      const actor = state.entities.find((entity) => entity.id === op.entityId)!;
      if (actor.outcome)
        throw new Error("That drawing's moment has already happened.");
      const obstacle = interactionObstacle(state, op.entityId);
      // Jev judged a particular obstacle; if the route has changed since,
      // the outcome no longer describes this world.
      if (op.obstacleId !== (obstacle?.id ?? null))
        throw new Error("The world changed before this moment could play.");
      next.entities = next.entities.map((entity) =>
        entity.id === op.entityId ? { ...entity, outcome: op.outcome } : entity,
      );
      next.interaction = {
        entityId: op.entityId,
        outcome: op.outcome,
        odds: op.odds,
        confidence: op.confidence,
        obstacleId: obstacle?.id ?? null,
        revision: next.revision,
      };
      // Only a success opens the way, and only past the obstacle still
      // closing it. Failures and neutral outcomes leave the route as it was.
      const blocker = blockingObstacle(state, op.entityId);
      if (opensRoute(op.outcome) && blocker)
        next.crossings.push({ obstacleId: blocker.id, helperId: op.entityId });
      break;
    }
    default: {
      const exhaustive: never = op;
      throw new Error("Unsupported operation: " + String(exhaustive));
    }
  }
  next = deriveWorld(next);
  return next;
}
const outcomeSummaries: Record<InteractionOutcome, string> = {
  crosses: "a way across",
  flies_over: "a flight over",
  rides_across: "a ride across",
  launched_across: "a launch across",
  almost: "almost!",
  splash: "splash!",
  blocked: "still in the way",
  scared: "a big scare",
  sheltered: "a cozy shelter",
  nothing_happens: "a new friend",
};

export function summarize(op: WorldOperation, state: WorldState) {
  switch (op.type) {
    case "CREATE_ENTITY":
      return op.entity.name + " added";
    case "REMOVE_ENTITY":
      return "Object removed";
    case "ADD_RULE":
      return "World rule added";
    case "SET_GOAL":
      return "Goal updated";
    case "RESOLVE_INTERACTION": {
      const name =
        state.entities.find((entity) => entity.id === op.entityId)?.name ??
        "Drawing";
      const opened =
        opensRoute(op.outcome) &&
        state.pathStatus === "available" &&
        state.crossings.some((crossing) => crossing.helperId === op.entityId);
      return (
        name +
        ": " +
        outcomeSummaries[op.outcome] +
        (opened ? " · route opened" : "")
      );
    }
  }
}
