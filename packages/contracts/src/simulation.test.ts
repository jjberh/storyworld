import { describe, it, expect } from "vitest";
import {
  initialWorld,
  applyOperation,
  deriveWorld,
  summarize,
} from "./simulation";
import { initialSceneResponseSchema } from "./index";
import type { Entity, InteractionOutcome, WorldOperation } from "./model";
import { operationSchema, worldStateSchema } from "./world-schema";
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
const resolve = (
  outcome: InteractionOutcome,
  entityId = "bridge",
  obstacleId: string | null = "river",
  odds: number | null = 0.8,
): WorldOperation => ({
  type: "RESOLVE_INTERACTION",
  entityId,
  outcome,
  odds,
  confidence: 0.9,
  obstacleId,
});
/** A committed bridge whose interaction was resolved with `outcome`. */
const bridgedWith = (outcome: InteractionOutcome) =>
  applyOperation(
    applyOperation(initialWorld("test"), bridge(400, 160)),
    resolve(outcome),
  );
const create = (
  entity: Omit<Entity, "description"> & { description?: string },
): WorldOperation => ({
  type: "CREATE_ENTITY",
  entity: { description: "", ...entity },
});
describe("world causality", () => {
  it("opens the route only through a committed success outcome", () => {
    const w = initialWorld("test");
    // Adding a drawing never opens the route by itself, however it is drawn.
    const added = applyOperation(w, bridge(400, 160));
    expect(added.pathStatus).toBe("blocked");
    expect(added.interaction).toBeNull();
    const crossed = applyOperation(added, resolve("crosses"));
    expect(crossed.pathStatus).toBe("available");
    expect(crossed.crossings).toEqual([
      { obstacleId: "river", helperId: "bridge" },
    ]);
    expect(crossed.interaction).toEqual({
      entityId: "bridge",
      outcome: "crosses",
      odds: 0.8,
      confidence: 0.9,
      obstacleId: "river",
      revision: crossed.revision,
    });
    expect(worldStateSchema.safeParse(crossed).success).toBe(true);
    expect(w.entities).toHaveLength(3);
  });
  it("keeps the route blocked after a funny failure", () => {
    for (const outcome of ["almost", "splash", "blocked", "scared"] as const) {
      const world = bridgedWith(outcome);
      expect(world.pathStatus).toBe("blocked");
      expect(world.crossings).toEqual([]);
      expect(world.interaction?.outcome).toBe(outcome);
      expect(world.interaction?.obstacleId).toBe("river");
    }
  });
  it("leaves the route unchanged for neutral outcomes", () => {
    const withTent = applyOperation(
      bridgedWith("crosses"),
      create({
        id: "tent",
        name: "Tent",
        role: "helper",
        properties: ["shelters"],
        bounds: { x: 100, y: 100, width: 60, height: 60 },
      }),
    );
    expect(
      applyOperation(withTent, resolve("sheltered", "tent")).pathStatus,
    ).toBe("available");
    expect(
      applyOperation(withTent, resolve("nothing_happens", "tent")).pathStatus,
    ).toBe("available");
    expect(
      applyOperation(
        applyOperation(initialWorld("test"), bridge(400, 160)),
        resolve("nothing_happens"),
      ).pathStatus,
    ).toBe("blocked");
  });
  it("blocks the route after removing the helper that opened it", () => {
    const removed = applyOperation(bridgedWith("rides_across"), {
      type: "REMOVE_ENTITY",
      entityId: "bridge",
    });
    expect(removed.pathStatus).toBe("blocked");
    expect(removed.crossings).toEqual([]);
    expect(removed.interaction).toBeNull();
  });
  it("rejects outcomes the drawing cannot present", () => {
    const added = applyOperation(initialWorld("test"), bridge(400, 160));
    // The bridge carries, but it cannot fly or launch.
    expect(() => applyOperation(added, resolve("flies_over"))).toThrow("flies");
    expect(() => applyOperation(added, resolve("launched_across"))).toThrow(
      "launches",
    );
    expect(() => applyOperation(added, resolve("sheltered"))).toThrow(
      "shelter",
    );
    expect(() => applyOperation(added, resolve("crosses", "ghost"))).toThrow(
      "not in this world",
    );
    expect(() => applyOperation(added, resolve("crosses", "nova"))).toThrow(
      "character",
    );
    expect(() =>
      applyOperation(added, { ...resolve("crosses"), odds: 1.5 } as never),
    ).toThrow("odds");
    // Without a goal there is nowhere to cross to, but a reaction still fits
    // (with no odds: there is no goal to give odds for).
    const noGoal = { ...added, goal: null };
    expect(() => applyOperation(noGoal, resolve("crosses"))).toThrow("goal");
    expect(
      applyOperation(noGoal, resolve("scared", "bridge", null, null))
        .pathStatus,
    ).toBe("free_play");
  });
  it("takes odds exactly when there is a goal", () => {
    const added = applyOperation(initialWorld("test"), bridge(400, 160));
    expect(() =>
      applyOperation(added, resolve("crosses", "bridge", "river", null)),
    ).toThrow("needs odds");
    const noGoal = { ...added, goal: null };
    expect(() =>
      applyOperation(noGoal, resolve("nothing_happens", "bridge", null)),
    ).toThrow("no goal to give odds for");
    const played = applyOperation(
      noGoal,
      resolve("nothing_happens", "bridge", null, null),
    );
    expect(played.interaction).toMatchObject({
      outcome: "nothing_happens",
      odds: null,
      obstacleId: null,
    });
    expect(played.crossings).toEqual([]);
    expect(worldStateSchema.parse(played)).toEqual(played);
    expect(() =>
      applyOperation(noGoal, {
        ...resolve("scared", "bridge", null),
        odds: undefined,
      } as never),
    ).toThrow("odds");
  });
  it("is in free play with a character and no goal, idle with no character", () => {
    const world = initialWorld("test");
    const noGoal = deriveWorld({ ...world, goal: null });
    expect(noGoal.pathStatus).toBe("free_play");
    // A blocker in the picture is not in anyone's way without a route.
    expect(noGoal.entities.some((entity) => entity.id === "river")).toBe(true);
    expect(
      deriveWorld({
        ...noGoal,
        entities: noGoal.entities.filter(
          (entity) => entity.role !== "character",
        ),
      }).pathStatus,
    ).toBe("idle");
    // Removing the place to reach turns the story into free play.
    const removed = applyOperation(world, {
      type: "REMOVE_ENTITY",
      entityId: "castle",
    });
    expect(removed.goal).toBeNull();
    expect(removed.pathStatus).toBe("free_play");
    // Crossing and funny misses need a route; reactions still fit.
    const added = applyOperation(noGoal, bridge(400, 160));
    for (const outcome of ["crosses", "almost", "splash", "blocked"] as const)
      expect(() =>
        applyOperation(added, resolve(outcome, "bridge", null, null)),
      ).toThrow("goal");
    // The character itself never resolves an interaction.
    expect(() =>
      applyOperation(added, resolve("nothing_happens", "nova", null, null)),
    ).toThrow("character");
  });
  it("resolves each drawing only once", () => {
    const crossed = bridgedWith("crosses");
    expect(
      crossed.entities.find((entity) => entity.id === "bridge")?.outcome,
    ).toBe("crosses");
    expect(() => applyOperation(crossed, resolve("crosses"))).toThrow(
      "already happened",
    );
    const missed = bridgedWith("almost");
    expect(() => applyOperation(missed, resolve("crosses"))).toThrow(
      "already happened",
    );
    // A drawing cannot arrive already resolved.
    expect(() =>
      applyOperation(initialWorld("test"), {
        type: "CREATE_ENTITY",
        entity: {
          ...(
            bridge(400, 160) as Extract<
              WorldOperation,
              { type: "CREATE_ENTITY" }
            >
          ).entity,
          outcome: "crosses",
        },
      }),
    ).toThrow("outcome");
    // A rewind to before the outcome lets the drawing be resolved again.
    const added = applyOperation(initialWorld("test"), bridge(400, 160));
    expect(
      applyOperation(
        { ...added, revision: crossed.revision + 1 },
        resolve("splash"),
      ).interaction?.outcome,
    ).toBe("splash");
  });
  it("refuses an outcome judged against an obstacle the route no longer has", () => {
    const added = applyOperation(initialWorld("test"), bridge(400, 160));
    // Jev judged the river; meanwhile a wall now closes the route first
    // (with no fear rule, the obstacle nearest the character is blamed).
    const walled = applyOperation(
      { ...added, rules: [] },
      create({
        id: "wall",
        name: "Stone wall",
        role: "obstacle",
        properties: ["blocks"],
        bounds: { x: 300, y: 150, width: 40, height: 400 },
      }),
    );
    expect(() => applyOperation(walled, resolve("crosses"))).toThrow(
      "world changed",
    );
    expect(
      applyOperation(walled, resolve("crosses", "bridge", "wall")).crossings,
    ).toEqual([{ obstacleId: "wall", helperId: "bridge" }]);
    expect(() =>
      applyOperation(added, resolve("crosses", "bridge", null)),
    ).toThrow("world changed");
  });
  it("offers a funny failure only while something is still in the way", () => {
    const open = applyOperation(
      bridgedWith("crosses"),
      create({
        id: "plank",
        name: "Plank",
        role: "helper",
        properties: ["carries"],
        bounds: { x: 420, y: 450, width: 60, height: 30 },
      }),
    );
    expect(open.pathStatus).toBe("available");
    for (const outcome of ["almost", "splash", "blocked"] as const)
      expect(() => applyOperation(open, resolve(outcome, "plank"))).toThrow(
        "in the way",
      );
    // Reactions and further successes still fit an open route.
    expect(applyOperation(open, resolve("scared", "plank")).pathStatus).toBe(
      "available",
    );
  });
  it("validates the resolve operation's shape", () => {
    expect(operationSchema.safeParse(resolve("splash")).success).toBe(true);
    for (const bad of [
      { ...resolve("splash"), outcome: "explodes" },
      { ...resolve("splash"), odds: -0.1 },
      { ...resolve("splash"), confidence: 2 },
      { ...resolve("splash"), obstacleId: 5 },
      (({ obstacleId: _, ...rest }) => rest)(
        resolve("splash") as { obstacleId: unknown },
      ),
      { ...resolve("splash"), extra: true },
    ])
      expect(operationSchema.safeParse(bad).success).toBe(false);
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
const log = (role: Entity["role"], properties: Entity["properties"]) =>
  create({
    id: "log",
    name: "Fallen log",
    role,
    properties,
    bounds: { x: 410, y: 300, width: 140, height: 40 },
  });
describe("property-based world rules", () => {
  it("lets any drawing open the route once its outcome is a success", () => {
    const start = initialWorld("test");
    const raft = applyOperation(start, log("helper", ["carries", "floats"]));
    expect(raft.pathStatus).toBe("blocked");
    expect(
      applyOperation(raft, resolve("rides_across", "log")).pathStatus,
    ).toBe("available");
    // Scenery without `carries` cannot give a ride, but can still be crossed.
    const scenery = applyOperation(start, log("scenery", []));
    expect(() =>
      applyOperation(scenery, resolve("rides_across", "log")),
    ).toThrow("carries");
    expect(applyOperation(scenery, resolve("crosses", "log")).pathStatus).toBe(
      "available",
    );
  });

  it("blocks the route with any obstacle that blocks, not just a river", () => {
    const bridged = bridgedWith("crosses");
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

  it("opens only the obstacle it crossed when two block the route", () => {
    const walled = applyOperation(
      applyOperation(initialWorld("test"), bridge(400, 160)),
      create({
        id: "wall",
        name: "Stone wall",
        role: "obstacle",
        properties: ["blocks"],
        bounds: { x: 620, y: 150, width: 40, height: 400 },
      }),
    );
    const crossed = applyOperation(walled, resolve("crosses"));
    expect(crossed.crossings).toEqual([
      { obstacleId: "river", helperId: "bridge" },
    ]);
    expect(crossed.pathStatus).toBe("blocked");
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

  it("summarizes additions plainly and outcomes with their route change", () => {
    const added = applyOperation(initialWorld("test"), bridge(420, 119));
    expect(summarize(bridge(420, 119), added)).toBe("Bridge added");
    const crossed = applyOperation(added, resolve("crosses"));
    expect(summarize(resolve("crosses"), crossed)).toBe(
      "Bridge: a way across · route opened",
    );
    const splashed = applyOperation(added, resolve("splash"));
    expect(summarize(resolve("splash"), splashed)).toBe("Bridge: splash!");
    const noGoal = { ...added, goal: null };
    const scared = resolve("scared", "bridge", null, null);
    expect(summarize(scared, applyOperation(noGoal, scared))).toBe(
      "Bridge: a big scare",
    );
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
      operations: [bridge(420, 120), bridge(420, 120)],
      openingNarration: "Nova needs a way across the river.",
      character: { id: "nova", name: "Nova" },
      moodHints: ["worried", "curious"],
    });
    expect(response.operations).toHaveLength(2);
    expect(response.operations[0]).toMatchObject({ type: "CREATE_ENTITY" });
    expect(response.character.id).toBe("nova");
  });

  it("refuses an interaction outcome proposed by the scene model", () => {
    expect(
      initialSceneResponseSchema.safeParse({
        operations: [bridge(420, 120), resolve("crosses")],
        openingNarration: "Nova needs a way across the river.",
        character: { id: "nova", name: "Nova" },
        moodHints: ["worried"],
      }).success,
    ).toBe(false);
  });
});
