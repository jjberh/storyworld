import { describe, expect, it } from "vitest";
import type {
  Entity,
  WorldEvent,
  WorldState,
} from "@storyworld/contracts/model";
import { validateStorySequenceForWorld } from "@storyworld/contracts/story-beat";
import { sequenceFromCommittedEvents } from "./committed-story-sequence";

const character: Entity = {
  id: "hero",
  role: "character",
  description: "",
  properties: ["moves"],
  name: "Hero",
  bounds: { x: 100, y: 300, width: 100, height: 100 },
};
const river: Entity = {
  id: "river",
  role: "obstacle",
  description: "",
  properties: ["blocks"],
  name: "River",
  bounds: { x: 430, y: 0, width: 100, height: 600 },
};
const goal: Entity = {
  id: "goal",
  role: "goal",
  description: "",
  properties: ["goal"],
  name: "Castle",
  bounds: { x: 760, y: 220, width: 120, height: 160 },
};

function state(
  revision: number,
  entities: Entity[] = [character, river, goal],
  pathStatus: WorldState["pathStatus"] = "blocked",
): WorldState {
  return {
    id: "world",
    revision,
    schemaVersion: 1,
    entities,
    rules: [],
    goal: entities.some((entity) => entity.id === goal.id)
      ? { characterId: character.id, targetId: goal.id }
      : null,
    pathStatus,
    weather: entities.some((entity) => entity.properties.includes("weather"))
      ? "rain"
      : "clear",
    interaction: null,
    crossings: [],
  };
}

function event(world: WorldState): WorldEvent {
  return {
    id: `event-${world.revision}`,
    revision: world.revision,
    actor: "director",
    summary: "Deliberately unused by sequencing",
    state: world,
  };
}

function expectValid(sequence: ReturnType<typeof sequenceFromCommittedEvents>) {
  expect(sequence).not.toBeNull();
  expect(sequence!.beats.length).toBeGreaterThanOrEqual(1);
  expect(sequence!.beats.length).toBeLessThanOrEqual(3);
  expect(
    validateStorySequenceForWorld(
      sequence,
      sequenceFromWorld(sequence!.sourceRevision),
    ).ok,
  ).toBe(true);
}

const worlds = new Map<number, WorldState>();
function sequenceFromWorld(revision: number) {
  return worlds.get(revision)!;
}
function sequenceFor(latest: WorldState, previous?: WorldState) {
  worlds.set(latest.revision, latest);
  return sequenceFromCommittedEvents(
    event(latest),
    previous ? event(previous) : undefined,
  );
}

describe("sequenceFromCommittedEvents", () => {
  it("plays the opening blocked arc in order", () => {
    const sequence = sequenceFor(state(0));
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "focus",
      "move_toward",
      "blocked_by",
    ]);
    expectValid(sequence);
  });

  it("blames the obstacle on the route, not a blocker behind the hero", () => {
    const wall: Entity = {
      id: "wall",
      role: "obstacle",
      description: "",
      properties: ["blocks"],
      name: "Stone wall",
      bounds: { x: 10, y: 250, width: 40, height: 200 },
    };
    const previous = { ...state(10, [wall, character, river, goal]) };
    const latest = { ...previous, revision: 11 };
    const opening = sequenceFor(state(12, [wall, character, river, goal]));
    expect(opening?.beats.at(-1)?.action).toEqual({
      type: "blocked_by",
      entityId: character.id,
      obstacleId: river.id,
    });
    const again = sequenceFor(latest, previous);
    expect(JSON.stringify(again)).not.toContain('"wall"');
    expect(again?.beats.at(-1)?.action).toEqual({
      type: "blocked_by",
      entityId: character.id,
      obstacleId: river.id,
    });
  });

  it("uses the smallest valid opening for fewer scene pieces", () => {
    const onlyHero = state(1, [character], "idle");
    const sequence = sequenceFor(onlyHero);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual(["focus"]);
    expectValid(sequence);
  });

  it("reveals an opening entity when no character exists", () => {
    const onlyRiver = {
      ...state(2, [river], "idle"),
      goal: null,
    };
    const sequence = sequenceFor(onlyRiver);
    expect(sequence?.beats[0].action).toEqual({
      type: "reveal",
      entityId: river.id,
    });
    expectValid(sequence);
  });

  it("crosses and celebrates only after a committed outcome opens the route", () => {
    const bridge: Entity = {
      id: "bridge",
      role: "helper",
      description: "",
      properties: ["carries"],
      name: "Paper Bridge",
      bounds: { x: 410, y: 320, width: 140, height: 55 },
    };
    const before = state(3, [...state(3).entities, bridge]);
    const latest: WorldState = {
      ...state(4, before.entities, "available"),
      interaction: {
        entityId: "bridge",
        outcome: "crosses",
        odds: 0.9,
        confidence: 0.8,
        obstacleId: "river",
        revision: 4,
      },
      crossings: [{ obstacleId: "river", helperId: "bridge" }],
    };
    const sequence = sequenceFor(latest, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "focus",
      "move_toward",
      "celebrate",
    ]);
    expect(sequence?.beats[0]?.action).toMatchObject({ entityId: "bridge" });
    expect(sequence?.sourceRevision).toBe(4);
    expect(sequence?.sourceEventId).toBe("event-4");
    expectValid(sequence);
  });

  it("only reveals a new bridge until its outcome is committed, then keeps a miss blocked", () => {
    const before = state(5);
    const shortBridge: Entity = {
      id: "short-bridge",
      role: "helper",
      description: "",
      properties: ["carries"],
      name: "Short Bridge",
      bounds: { x: 440, y: 320, width: 40, height: 55 },
    };
    const added = state(6, [...before.entities, shortBridge], "blocked");
    const revealed = sequenceFor(added, before);
    expect(revealed?.beats.map((item) => item.action.type)).toEqual(["reveal"]);
    expectValid(revealed);
    const missed: WorldState = {
      ...state(7, added.entities, "blocked"),
      interaction: {
        entityId: "short-bridge",
        outcome: "almost",
        odds: 0.3,
        confidence: 0.7,
        obstacleId: "river",
        revision: 7,
      },
    };
    const sequence = sequenceFor(missed, added);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "focus",
      "blocked_by",
    ]);
    expectValid(sequence);
  });

  it("only reveals an added bridge when the route was already available", () => {
    const firstBridge: Entity = {
      id: "first-bridge",
      role: "helper",
      description: "",
      properties: ["carries"],
      name: "First Bridge",
      bounds: { x: 410, y: 250, width: 140, height: 55 },
    };
    const before = state(14, [...state(14).entities, firstBridge], "available");
    const extraBridge: Entity = {
      ...firstBridge,
      id: "extra-bridge",
      name: "Extra Bridge",
      bounds: { ...firstBridge.bounds, y: 340 },
    };
    const latest = state(15, [...before.entities, extraBridge], "available");
    const sequence = sequenceFor(latest, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual(["reveal"]);
    expectValid(sequence);
  });

  it("reveals a committed cloud and shifts to committed rain", () => {
    const before = state(7);
    const cloud: Entity = {
      id: "cloud",
      role: "scenery",
      description: "",
      properties: ["weather"],
      name: "Cloud",
      bounds: { x: 600, y: 80, width: 150, height: 75 },
    };
    const latest = state(8, [...before.entities, cloud], "blocked");
    const sequence = sequenceFor(latest, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "reveal",
      "weather_shift",
    ]);
    expectValid(sequence);
  });

  it("uses reveal for a generic committed addition", () => {
    const before = state(9);
    const shelter: Entity = {
      id: "shelter",
      role: "helper",
      description: "",
      properties: ["shelters"],
      name: "Tent",
      bounds: { x: 250, y: 200, width: 100, height: 100 },
    };
    const latest = state(10, [...before.entities, shelter], "blocked");
    const sequence = sequenceFor(latest, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual(["reveal"]);
    expectValid(sequence);
  });

  it("returns a restored blocked world to the near bank", () => {
    const before = state(11);
    const restored = { ...state(12), weather: "clear" as const };
    const sequence = sequenceFor(restored, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "move_toward",
      "blocked_by",
    ]);
    expectValid(sequence);
  });

  it("places a restored available world on the target side", () => {
    const before = state(16);
    const restored = state(17, before.entities, "available");
    const sequence = sequenceFor(restored, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "move_toward",
    ]);
    expectValid(sequence);
  });

  it("cannot animate a pending proposal because its boundary accepts events", () => {
    const committed = event(state(13));
    const sequence = sequenceFromCommittedEvents(committed);
    expect(sequence?.sourceEventId).toBe(committed.id);
    expect(Object.keys(sequence ?? {})).not.toContain("proposal");
  });

  it("explores in free play instead of heading for a goal", () => {
    const tree: Entity = {
      id: "tree",
      role: "scenery",
      description: "",
      properties: [],
      name: "Tree",
      bounds: { x: 400, y: 280, width: 120, height: 180 },
    };
    const sun: Entity = {
      id: "sun",
      role: "scenery",
      description: "",
      properties: [],
      name: "Sun",
      bounds: { x: 150, y: 20, width: 80, height: 80 },
    };
    const opening = state(0, [character, sun, tree], "free_play");
    expect(opening.goal).toBeNull();
    const first = sequenceFor(opening);
    // The hero walks to the tree beside it, not up to the nearer sun.
    expect(first?.beats.map((item) => item.action)).toEqual([
      { type: "focus", entityId: "hero" },
      { type: "move_toward", entityId: "hero", targetId: "tree" },
    ]);
    expectValid(first);

    const ball: Entity = {
      id: "ball",
      role: "helper",
      description: "",
      properties: [],
      name: "Ball",
      bounds: { x: 250, y: 320, width: 60, height: 60 },
    };
    const added = state(1, [character, sun, tree, ball], "free_play");
    const addition = sequenceFor(added, opening);
    expect(addition?.beats.map((item) => item.action.type)).toEqual([
      "reveal",
      "react",
    ]);
    expectValid(addition);

    const played: WorldState = {
      ...state(
        2,
        [character, sun, tree, { ...ball, outcome: "nothing_happens" }],
        "free_play",
      ),
      interaction: {
        entityId: "ball",
        outcome: "nothing_happens",
        odds: null,
        confidence: 0.8,
        obstacleId: null,
        revision: 2,
      },
    };
    const moment = sequenceFor(played, added);
    expect(moment?.beats.map((item) => item.action.type)).toEqual([
      "react",
      "move_toward",
      "celebrate",
    ]);
    expect(JSON.stringify(moment)).not.toMatch(/route|in the way/i);
    expectValid(moment);
  });
});
