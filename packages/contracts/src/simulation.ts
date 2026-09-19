import {
  SCHEMA_VERSION,
  type WorldState,
  type WorldOperation,
  type Entity,
} from "./model";
export function initialWorld(id: string): WorldState {
  return {
    id,
    revision: 0,
    schemaVersion: SCHEMA_VERSION,
    entities: [
      {
        id: "nova",
        kind: "character",
        name: "Nova",
        bounds: { x: 150, y: 300, width: 80, height: 70 },
      },
      {
        id: "river",
        kind: "river",
        name: "River",
        bounds: { x: 420, y: 0, width: 120, height: 600 },
      },
      {
        id: "castle",
        kind: "castle",
        name: "Castle",
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
  const rivers = state.entities.filter((e) => e.kind === "river");
  const bridges = state.entities.filter((e) => e.kind === "bridge");
  const character = state.entities.find(
    (e) => e.id === state.goal?.characterId,
  );
  const target = state.entities.find((e) => e.id === state.goal?.targetId);
  let blocked = false;
  if (character && target)
    for (const river of rivers) {
      const b = river.bounds,
        start = character.bounds.x + character.bounds.width / 2,
        end = target.bounds.x + target.bounds.width / 2;
      const between =
        Math.min(start, end) < b.x && Math.max(start, end) > b.x + b.width;
      if (
        between &&
        !bridges.some(
          (e) =>
            e.bounds.x <= b.x &&
            e.bounds.x + e.bounds.width >= b.x + b.width &&
            e.bounds.y + e.bounds.height > b.y &&
            e.bounds.y < b.y + b.height,
        )
      )
        blocked = true;
    }
  return {
    ...state,
    pathStatus:
      !character || !target ? "idle" : blocked ? "blocked" : "available",
    weather: state.entities.some((e) => e.kind === "cloud") ? "rain" : "clear",
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
          (e) => e.id === op.characterId && e.kind === "character",
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
export function summarize(op: WorldOperation, state: WorldState) {
  if (op.type === "CREATE_ENTITY")
    return (
      op.entity.name +
      " added" +
      (op.entity.kind === "bridge"
        ? state.pathStatus === "available"
          ? " · route opened"
          : " · river still blocks the route"
        : "")
    );
  return op.type === "REMOVE_ENTITY"
    ? "Object removed"
    : op.type === "ADD_RULE"
      ? "World rule added"
      : "Goal updated";
}
