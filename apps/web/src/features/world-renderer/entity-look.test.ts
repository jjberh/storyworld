import { describe, expect, it } from "vitest";
import type { Entity } from "@storyworld/contracts/model";
import { entityLook, paintLayerFor, type EntityLook } from "./entity-look";

describe("entityLook", () => {
  it.each<[Entity["role"], Entity["properties"], string, EntityLook]>([
    ["character", ["moves"], "Nova", "character"],
    ["character", ["flies"], "Sparkle", "character"],
    ["goal", ["goal"], "Castle", "goal"],
    ["obstacle", ["blocks"], "River", "water"],
    ["obstacle", ["blocks"], "Blue stream", "water"],
    ["obstacle", ["blocks", "floats"], "Ice", "water"],
    // A blocker that is not water is a neutral barrier, not a river.
    ["obstacle", ["blocks"], "Stone wall", "barrier"],
    ["obstacle", ["blocks"], "Seat", "barrier"],
    ["helper", ["carries"], "Bridge", "span"],
    ["scenery", ["weather"], "Storm cloud", "cloud"],
    ["helper", ["shelters"], "Tent", "shelter"],
    ["scenery", [], "Sun", "thing"],
    // A carrier that is not a helper never draws as a bridge.
    ["scenery", ["carries"], "Cart", "thing"],
  ])("draws a %s with %j named %s as %s", (role, properties, name, look) => {
    expect(entityLook({ role, properties, name })).toBe(look);
  });

  it("paints water below bridges, travellers above, and the sky on top", () => {
    const layer = (role: Entity["role"], properties: Entity["properties"]) =>
      paintLayerFor({ role, properties, name: "River" });
    expect(layer("obstacle", ["blocks"])).toBeLessThan(
      layer("helper", ["carries"]),
    );
    expect(layer("helper", ["carries"])).toBeLessThan(
      layer("character", ["moves"]),
    );
    expect(layer("character", ["moves"])).toBeLessThan(
      layer("scenery", ["weather"]),
    );
    expect(layer("scenery", ["flies"])).toBe(layer("scenery", ["weather"]));
  });
});
