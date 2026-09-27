import { describe, expect, it } from "vitest";
import {
  blockingObstacle,
  defaultPropertiesFor,
  ENTITY_PRESETS,
  has,
  isBlocker,
  isSpanner,
  liesAcross,
  makesRain,
  presetTraits,
  routeBlockers,
  spans,
} from "./entity-traits";
import type { Entity } from "./model";
import { initialWorld } from "./simulation";
import { entityRoleSchema, entitySchema } from "./world-schema";

describe("entity traits", () => {
  it("reads single properties", () => {
    const boat = { role: "helper" as const, properties: ["floats" as const] };
    expect(has(boat, "floats")).toBe(true);
    expect(has(boat, "flies")).toBe(false);
  });

  it("treats anything that blocks as a blocker, whatever its role", () => {
    expect(isBlocker({ role: "obstacle", properties: ["blocks"] })).toBe(true);
    expect(isBlocker({ role: "scenery", properties: ["blocks"] })).toBe(true);
    expect(isBlocker({ role: "obstacle", properties: ["scares"] })).toBe(false);
  });

  it("only lets a helper that carries span a blocker", () => {
    expect(isSpanner({ role: "helper", properties: ["carries"] })).toBe(true);
    expect(
      isSpanner({ role: "helper", properties: ["flies", "carries"] }),
    ).toBe(true);
    expect(isSpanner({ role: "scenery", properties: ["carries"] })).toBe(false);
    expect(isSpanner({ role: "helper", properties: ["shelters"] })).toBe(false);
  });

  it("rains only for weather", () => {
    expect(makesRain({ role: "scenery", properties: ["weather"] })).toBe(true);
    expect(makesRain({ role: "scenery", properties: ["flies"] })).toBe(false);
  });

  it("keeps the presets the fixtures and edit hints rely on", () => {
    expect(isSpanner(ENTITY_PRESETS.bridge)).toBe(true);
    expect(makesRain(ENTITY_PRESETS.cloud)).toBe(true);
    expect(has(ENTITY_PRESETS.shelter, "shelters")).toBe(true);
    const copy = presetTraits("bridge");
    copy.properties.push("flies");
    expect(ENTITY_PRESETS.bridge.properties).toEqual(["carries"]);
  });

  it("gives each role defaults that let it do its job", () => {
    expect(
      isBlocker({
        role: "obstacle",
        properties: defaultPropertiesFor("obstacle"),
      }),
    ).toBe(true);
    expect(
      isSpanner({ role: "helper", properties: defaultPropertiesFor("helper") }),
    ).toBe(true);
    expect(defaultPropertiesFor("scenery")).toEqual([]);
    for (const role of entityRoleSchema.options)
      expect(
        entitySchema.safeParse({
          id: "piece",
          role,
          name: "Piece",
          description: "",
          properties: defaultPropertiesFor(role),
          bounds: { x: 0, y: 0, width: 10, height: 10 },
        }).success,
      ).toBe(true);
  });
});

describe("entity schema", () => {
  const entity = {
    id: "boat",
    role: "helper",
    name: "Boat",
    description: "A little wooden boat.",
    properties: ["floats", "carries"],
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  };

  it("accepts roles, properties and a short description", () => {
    expect(entitySchema.parse(entity)).toEqual(entity);
    expect(entitySchema.safeParse({ ...entity, description: "" }).success).toBe(
      true,
    );
  });

  it("rejects unknown roles or properties, repeats, too many, a long description and the old kind", () => {
    const withoutDescription: Record<string, unknown> = { ...entity };
    delete withoutDescription.description;
    for (const bad of [
      { ...entity, role: "villain" },
      { ...entity, properties: ["teleports"] },
      { ...entity, properties: ["floats", "floats"] },
      {
        ...entity,
        properties: [
          "moves",
          "flies",
          "swims",
          "floats",
          "carries",
          "burns",
          "scares",
        ],
      },
      { ...entity, description: "d".repeat(201) },
      { ...entity, kind: "bridge" },
      withoutDescription,
    ])
      expect(entitySchema.safeParse(bad).success).toBe(false);
  });
});

describe("the goal route", () => {
  const base = initialWorld("route");
  const wall: Entity = {
    id: "wall",
    role: "obstacle",
    name: "Stone wall",
    description: "",
    properties: ["blocks"],
    bounds: { x: 10, y: 250, width: 40, height: 200 },
  };
  const hedge: Entity = {
    ...wall,
    id: "hedge",
    name: "Hedge",
    bounds: { x: 640, y: 200, width: 40, height: 300 },
  };

  it("only counts blockers lying across the route, nearest first", () => {
    const world = {
      ...base,
      rules: [],
      entities: [wall, hedge, ...base.entities],
    };
    expect(routeBlockers(world).map((entity) => entity.id)).toEqual([
      "river",
      "hedge",
    ]);
    expect(blockingObstacle(world)?.id).toBe("river");
    expect(liesAcross(wall, base.entities[0]!, base.entities[2]!)).toBe(false);
  });

  it("prefers a feared blocker on the route, and ignores a feared one off it", () => {
    const world = {
      ...base,
      entities: [wall, hedge, ...base.entities],
      rules: [
        {
          id: "f1",
          subjectId: "nova",
          predicate: "afraid_of" as const,
          objectId: "hedge",
        },
        {
          id: "f2",
          subjectId: "nova",
          predicate: "afraid_of" as const,
          objectId: "wall",
        },
      ],
    };
    expect(blockingObstacle(world)?.id).toBe("hedge");
  });

  it("drops spanned blockers and has nothing to blame without a goal", () => {
    const bridge: Entity = {
      id: "bridge",
      role: "helper",
      name: "Bridge",
      description: "",
      properties: ["carries"],
      bounds: { x: 400, y: 320, width: 160, height: 50 },
    };
    expect(spans(bridge, base.entities[1]!)).toBe(true);
    expect(
      routeBlockers({ ...base, entities: [...base.entities, bridge] }),
    ).toEqual([]);
    expect(blockingObstacle({ ...base, goal: null })).toBeUndefined();
  });

  it("reads a malformed entity without properties as having none", () => {
    const legacy = { role: "obstacle" } as unknown as Pick<
      Entity,
      "role" | "properties"
    >;
    expect(isBlocker(legacy)).toBe(false);
  });
});
