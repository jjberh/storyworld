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
  kind: "character",
  name: "Hero",
  bounds: { x: 100, y: 300, width: 100, height: 100 },
};
const river: Entity = {
  id: "river",
  kind: "river",
  name: "River",
  bounds: { x: 430, y: 0, width: 100, height: 600 },
};
const goal: Entity = {
  id: "goal",
  kind: "castle",
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
    weather: entities.some((entity) => entity.kind === "cloud")
      ? "rain"
      : "clear",
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

  it("crosses and celebrates only after a committed bridge opens the route", () => {
    const before = state(3);
    const bridge: Entity = {
      id: "bridge",
      kind: "bridge",
      name: "Paper Bridge",
      bounds: { x: 410, y: 320, width: 140, height: 55 },
    };
    const latest = state(4, [...before.entities, bridge], "available");
    const sequence = sequenceFor(latest, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "reveal",
      "move_toward",
      "celebrate",
    ]);
    expect(sequence?.sourceRevision).toBe(4);
    expect(sequence?.sourceEventId).toBe("event-4");
    expectValid(sequence);
  });

  it("reveals a short bridge but keeps the character blocked", () => {
    const before = state(5);
    const shortBridge: Entity = {
      id: "short-bridge",
      kind: "bridge",
      name: "Short Bridge",
      bounds: { x: 440, y: 320, width: 40, height: 55 },
    };
    const latest = state(6, [...before.entities, shortBridge], "blocked");
    const sequence = sequenceFor(latest, before);
    expect(sequence?.beats.map((item) => item.action.type)).toEqual([
      "reveal",
      "blocked_by",
    ]);
    expectValid(sequence);
  });

  it("only reveals an added bridge when the route was already available", () => {
    const firstBridge: Entity = {
      id: "first-bridge",
      kind: "bridge",
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
      kind: "cloud",
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
      kind: "shelter",
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
});
