import { describe, it, expect } from "vitest";
import { initialWorld, applyOperation, summarize } from "./simulation";
import { initialSceneResponseSchema } from "./index";
import type { Entity, WorldOperation } from "./model";
const bridge = (x: number, width: number): WorldOperation => ({
  type: "CREATE_ENTITY",
  entity: {
    id: "bridge",
    name: "Bridge",
    role: "helper",
    description: "",
    properties: ["carries"],
    bounds: { x, y: 330, width, height: 50 },
  },
});
describe("world causality", () => {
  it("opens the route only when a bridge spans both riverbanks", () => {
    const w = initialWorld("test");
    expect(applyOperation(w, bridge(420, 119)).pathStatus).toBe("blocked");
    expect(applyOperation(w, bridge(420, 120)).pathStatus).toBe("available");
    expect(w.entities).toHaveLength(3);
  });
  it("blocks the route after removing its bridge", () => {
    const w = applyOperation(initialWorld("test"), bridge(400, 160));
    expect(
      applyOperation(w, { type: "REMOVE_ENTITY", entityId: "bridge" })
        .pathStatus,
    ).toBe("blocked");
  });
  it("rejects duplicate IDs and out-of-bounds entities", () => {
    const w = applyOperation(initialWorld("test"), bridge(400, 160));
    expect(() => applyOperation(w, bridge(400, 160))).toThrow("already exists");
    expect(() =>
      applyOperation(initialWorld("test"), bridge(950, 160)),
    ).toThrow("inside");
  });
  it("rejects a goal referencing a missing character", () => {
    expect(() =>
      applyOperation(initialWorld("test"), {
        type: "SET_GOAL",
        characterId: "missing",
        targetId: "castle",
      }),
    ).toThrow("Invalid goal");
  });
  it("derives rain from a committed cloud", () => {
    const world = applyOperation(initialWorld("test"), {
      type: "CREATE_ENTITY",
      entity: {
        id: "cloud",
        name: "Storm cloud",
        role: "scenery",
        description: "",
        properties: ["weather"],
        bounds: { x: 580, y: 80, width: 150, height: 75 },
      },
    });
    expect(world.weather).toBe("rain");
  });
});
const create = (
  entity: Omit<Entity, "description"> & { description?: string },
): WorldOperation => ({
  type: "CREATE_ENTITY",
  entity: { description: "", ...entity },
});
const log = (role: Entity["role"], properties: Entity["properties"]) =>
  create({
    id: "log",
    name: "Fallen log",
    role,
    properties,
    bounds: { x: 410, y: 300, width: 140, height: 40 },
  });
describe("property-based world rules", () => {
  it("lets any helper that carries span the river, not just a bridge", () => {
    const start = initialWorld("test");
    expect(
      applyOperation(start, log("helper", ["carries", "floats"])).pathStatus,
    ).toBe("available");
    // The same geometry without `carries`, or as scenery, does not help.
    expect(applyOperation(start, log("helper", ["floats"])).pathStatus).toBe(
      "blocked",
    );
    expect(applyOperation(start, log("scenery", ["carries"])).pathStatus).toBe(
      "blocked",
    );
  });

  it("blocks the route with any obstacle that blocks, not just a river", () => {
    const bridged = applyOperation(initialWorld("test"), bridge(400, 160));
    expect(bridged.pathStatus).toBe("available");
    const across = { x: 620, y: 150, width: 40, height: 400 };
    expect(
      applyOperation(
        bridged,
        create({
          id: "wall",
          name: "Stone wall",
          role: "obstacle",
          properties: ["blocks"],
          bounds: across,
        }),
      ).pathStatus,
    ).toBe("blocked");
    // An obstacle that does not block leaves the way open.
    expect(
      applyOperation(
        bridged,
        create({
          id: "bush",
          name: "Scary bush",
          role: "obstacle",
          properties: ["scares"],
          bounds: across,
        }),
      ).pathStatus,
    ).toBe("available");
    // A blocker beside the route, not across it, does not block.
    expect(
      applyOperation(
        bridged,
        create({
          id: "rock",
          name: "Rock",
          role: "obstacle",
          properties: ["blocks"],
          bounds: { x: 20, y: 20, width: 60, height: 60 },
        }),
      ).pathStatus,
    ).toBe("available");
  });

  it("rains for anything with weather and stays clear otherwise", () => {
    const sun = applyOperation(
      initialWorld("test"),
      create({
        id: "sun",
        name: "Sun",
        role: "scenery",
        properties: [],
        bounds: { x: 800, y: 20, width: 80, height: 80 },
      }),
    );
    expect(sun.weather).toBe("clear");
    expect(
      applyOperation(
        sun,
        create({
          id: "storm-dragon",
          name: "Storm dragon",
          role: "helper",
          properties: ["flies", "weather"],
          bounds: { x: 600, y: 20, width: 120, height: 80 },
        }),
      ).weather,
    ).toBe("rain");
  });

  it("names the actual blocker in a helper's summary, only with a goal", () => {
    const start = initialWorld("test");
    const nearMiss = applyOperation(start, bridge(420, 119));
    expect(summarize(bridge(420, 119), nearMiss)).toBe(
      "Bridge added · River still blocks the route",
    );
    const opened = applyOperation(start, bridge(400, 160));
    expect(summarize(bridge(400, 160), opened)).toBe(
      "Bridge added · route opened",
    );
    const walled = applyOperation(
      applyOperation(start, bridge(400, 160)),
      create({
        id: "wall",
        name: "Stone wall",
        role: "obstacle",
        properties: ["blocks"],
        bounds: { x: 620, y: 150, width: 40, height: 400 },
      }),
    );
    const log = create({
      id: "log",
      name: "Log",
      role: "helper",
      properties: ["carries"],
      bounds: { x: 20, y: 20, width: 60, height: 30 },
    });
    expect(summarize(log, applyOperation(walled, log))).toBe(
      "Log added · Stone wall still blocks the route",
    );
    const noGoal = { ...start, goal: null };
    expect(
      summarize(bridge(420, 119), applyOperation(noGoal, bridge(420, 119))),
    ).toBe("Bridge added");
  });

  it("only sets a goal for a character", () => {
    expect(() =>
      applyOperation(initialWorld("test"), {
        type: "SET_GOAL",
        characterId: "river",
        targetId: "castle",
      }),
    ).toThrow("Invalid goal");
  });
});
describe("initial scene contract", () => {
  it("preserves ordered operations and validates character mood hints", () => {
    const response = initialSceneResponseSchema.parse({
      operations: [bridge(420, 120)],
      openingNarration: "Nova needs a way across the river.",
      character: { id: "nova", name: "Nova" },
      moodHints: ["worried", "curious"],
    });
    expect(response.operations[0]).toMatchObject({ type: "CREATE_ENTITY" });
    expect(response.character.id).toBe("nova");
  });
});
