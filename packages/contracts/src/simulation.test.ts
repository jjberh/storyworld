import { describe, it, expect } from "vitest";
import { initialWorld, applyOperation } from "./simulation";
import { initialSceneResponseSchema } from "./index";
import type { WorldOperation } from "./model";
const bridge = (x: number, width: number): WorldOperation => ({
  type: "CREATE_ENTITY",
  entity: {
    id: "bridge",
    name: "Bridge",
    kind: "bridge",
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
        kind: "cloud",
        bounds: { x: 580, y: 80, width: 150, height: 75 },
      },
    });
    expect(world.weather).toBe("rain");
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
