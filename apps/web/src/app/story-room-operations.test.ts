import { describe, expect, it } from "vitest";
import type { Entity, WorldState } from "@storyworld/contracts/model";
import { applyOperation } from "@storyworld/contracts/simulation";
import { bridgeOperationForWorld } from "./story-room-operations";

function world(river: Entity): WorldState {
  return {
    id: "drawing",
    revision: 0,
    schemaVersion: 1,
    entities: [
      {
        id: "hero",
        name: "Hero",
        kind: "character",
        bounds: { x: 40, y: 300, width: 60, height: 70 },
      },
      river,
      {
        id: "goal",
        name: "Goal",
        kind: "castle",
        bounds: { x: 900, y: 250, width: 80, height: 100 },
      },
    ],
    rules: [],
    goal: { characterId: "hero", targetId: "goal" },
    pathStatus: "blocked",
    weather: "clear",
  };
}

describe("bridgeOperationForWorld", () => {
  it("spans an arbitrary blocking river and opens the route", () => {
    const initial = world({
      id: "river",
      name: "Wide River",
      kind: "river",
      bounds: { x: 365, y: 100, width: 210, height: 410 },
    });
    const operation = bridgeOperationForWorld(initial, "bridge");
    expect(operation.type).toBe("CREATE_ENTITY");
    if (operation.type !== "CREATE_ENTITY") return;
    expect(operation.entity.bounds.x).toBeLessThanOrEqual(365);
    expect(
      operation.entity.bounds.x + operation.entity.bounds.width,
    ).toBeGreaterThanOrEqual(575);
    expect(applyOperation(initial, operation).pathStatus).toBe("available");
  });

  it("keeps bridge bounds inside the world at either edge", () => {
    for (const bounds of [
      { x: 0, y: 0, width: 120, height: 600 },
      { x: 880, y: 540, width: 120, height: 60 },
    ]) {
      const operation = bridgeOperationForWorld(
        world({
          id: "river",
          name: "Edge River",
          kind: "river",
          bounds,
        }),
        `bridge-${bounds.x}`,
      );
      if (operation.type !== "CREATE_ENTITY")
        throw new Error("Expected bridge");
      const bridge = operation.entity.bounds;
      expect(bridge.x).toBeGreaterThanOrEqual(0);
      expect(bridge.y).toBeGreaterThanOrEqual(0);
      expect(bridge.x + bridge.width).toBeLessThanOrEqual(1000);
      expect(bridge.y + bridge.height).toBeLessThanOrEqual(600);
    }
  });

  it("falls back safely when the scene has no river", () => {
    const initial = world({
      id: "river",
      name: "Removed",
      kind: "river",
      bounds: { x: 400, y: 0, width: 100, height: 600 },
    });
    initial.entities = initial.entities.filter(
      (entity) => entity.kind !== "river",
    );
    const operation = bridgeOperationForWorld(initial, "fallback");
    if (operation.type !== "CREATE_ENTITY") throw new Error("Expected bridge");
    expect(operation.entity.bounds).toEqual({
      x: 405,
      y: 320,
      width: 190,
      height: 55,
    });
  });
});
