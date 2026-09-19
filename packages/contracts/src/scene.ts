import { confirmedSceneSchema, type ConfirmedScene } from "./index";
import { SCHEMA_VERSION, type WorldOperation, type WorldState } from "./model";
import { applyOperation } from "./simulation";

/** Validate the complete proposal before deriving any committed state. */
export function worldFromScene(id: string, input: ConfirmedScene): WorldState {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error("Invalid world ID.");
  const scene = confirmedSceneSchema.parse(input);
  const operations: WorldOperation[] = scene.objects.map((object) => ({
    type: "CREATE_ENTITY",
    entity: {
      id: object.id,
      name: object.name,
      kind: object.kind,
      bounds: {
        x: object.imageBounds.x * 1000,
        y: object.imageBounds.y * 600,
        width: Math.min(
          object.imageBounds.width * 1000,
          1000 - object.imageBounds.x * 1000,
        ),
        height: Math.min(
          object.imageBounds.height * 600,
          600 - object.imageBounds.y * 600,
        ),
      },
    },
  }));
  if (scene.goalId)
    operations.push({
      type: "SET_GOAL",
      characterId: scene.characterId,
      targetId: scene.goalId,
    });
  if (scene.fearedRiverId)
    operations.push({
      type: "ADD_RULE",
      rule: {
        id: "initial-fear",
        subjectId: scene.characterId,
        predicate: "afraid_of",
        objectId: scene.fearedRiverId,
      },
    });
  const empty: WorldState = {
    id,
    revision: 0,
    schemaVersion: SCHEMA_VERSION,
    entities: [],
    rules: [],
    goal: null,
    weather: "clear",
    pathStatus: "idle",
  };
  return { ...operations.reduce(applyOperation, empty), revision: 0 };
}
