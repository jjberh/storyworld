import {
  SCHEMA_VERSION,
  type WorldState,
  type WorldOperation,
  type Entity,
} from "./model";
import {
  blockingObstacle,
  isSpanner,
  makesRain,
  routeBlockers,
} from "./entity-traits";
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
    revision: state.revision + 1,
  };
  switch (op.type) {
    case "CREATE_ENTITY":
      validateEntity(op.entity);
      if (state.entities.length >= 100) throw new Error("This world is full.");
      if (state.entities.some((e) => e.id === op.entity.id))
        throw new Error("That entity already exists.");
      next.entities.push(op.entity);
      break;
    case "REMOVE_ENTITY":
      if (!state.entities.some((e) => e.id === op.entityId))
        throw new Error("Entity no longer exists.");
      next.entities = next.entities.filter((e) => e.id !== op.entityId);
      next.rules = next.rules.filter(
        (r) => r.subjectId !== op.entityId && r.objectId !== op.entityId,
      );
      if (
        next.goal?.characterId === op.entityId ||
        next.goal?.targetId === op.entityId
      )
        next.goal = null;
      break;
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
    default: {
      const exhaustive: never = op;
      throw new Error("Unsupported operation: " + String(exhaustive));
    }
  }
  next = deriveWorld(next);
  return next;
}
/** How a new helper left the goal route, naming what still blocks it. */
function routeNote(state: WorldState) {
  if (state.pathStatus === "available") return " · route opened";
  const blocker = blockingObstacle(state);
  return blocker
    ? ` · ${blocker.name} still blocks the route`
    : " · the way is still blocked";
}
export function summarize(op: WorldOperation, state: WorldState) {
  if (op.type === "CREATE_ENTITY")
    return (
      op.entity.name +
      " added" +
      (isSpanner(op.entity) && state.goal ? routeNote(state) : "")
    );
  return op.type === "REMOVE_ENTITY"
    ? "Object removed"
    : op.type === "ADD_RULE"
      ? "World rule added"
      : "Goal updated";
}
