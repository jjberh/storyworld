import { describe, expect, it } from "vitest";
import type { Entity, WorldState } from "./model";
import {
  INTERACTION_OUTCOMES,
  interactionObstacle,
  interactionProblem,
  interactionRequestSchema,
  interactionResponseSchema,
  opensRoute,
  proposalProblem,
  withoutSketches,
} from "./interaction";
import { applyOperation, initialWorld } from "./simulation";
import { entitySchema, MAX_SKETCH_NUMBERS } from "./world-schema";
import { initialSceneResponseSchema, interpretationOutput } from "./index";

const piece = (
  id: string,
  properties: Entity["properties"],
  role: Entity["role"] = "helper",
): Entity => ({
  id,
  role,
  name: id,
  description: "",
  properties,
  bounds: { x: 400, y: 320, width: 160, height: 50 },
});

const withPiece = (entity: Entity, world: WorldState = initialWorld("t")) =>
  applyOperation(world, { type: "CREATE_ENTITY", entity });

describe("interaction outcomes", () => {
  it("opens the route only for the four successes", () => {
    expect(INTERACTION_OUTCOMES.filter(opensRoute)).toEqual([
      "crosses",
      "flies_over",
      "rides_across",
      "launched_across",
    ]);
  });

  it("checks each outcome against what the drawing can do", () => {
    const dragon = withPiece(piece("dragon", ["flies", "carries"]));
    const boat = withPiece(piece("boat", ["floats", "carries"]));
    const trampoline = withPiece(piece("trampoline", ["launches"]));
    const rock = withPiece(piece("rock", [], "scenery"));
    expect(interactionProblem(dragon, "dragon", "flies_over")).toBeUndefined();
    expect(
      interactionProblem(dragon, "dragon", "rides_across"),
    ).toBeUndefined();
    expect(interactionProblem(boat, "boat", "flies_over")).toMatch(/flies/);
    expect(interactionProblem(boat, "boat", "splash")).toBeUndefined();
    expect(
      interactionProblem(trampoline, "trampoline", "launched_across"),
    ).toBeUndefined();
    expect(interactionProblem(rock, "rock", "launched_across")).toMatch(
      /launches/,
    );
    for (const outcome of [
      "crosses",
      "blocked",
      "almost",
      "scared",
      "nothing_happens",
    ] as const)
      expect(interactionProblem(rock, "rock", outcome)).toBeUndefined();
    expect(interactionProblem(rock, "rock", "sheltered")).toMatch(/shelter/);
    expect(
      interactionProblem(
        withPiece(piece("tent", ["shelters"]), rock),
        "rock",
        "sheltered",
      ),
    ).toBeUndefined();
  });

  it("needs an obstacle on the route for a tumble, and a goal to cross to", () => {
    const noRiver = withPiece(piece("boat", ["carries"]), {
      ...initialWorld("t"),
      entities: initialWorld("t").entities.filter((e) => e.id !== "river"),
      rules: [],
    });
    expect(interactionProblem(noRiver, "boat", "splash")).toMatch(/in the way/);
    expect(interactionProblem(noRiver, "boat", "crosses")).toBeUndefined();
    const noGoal = { ...noRiver, goal: null };
    expect(interactionProblem(noGoal, "boat", "crosses")).toMatch(/goal/);
    expect(
      interactionProblem(noGoal, "boat", "nothing_happens"),
    ).toBeUndefined();
  });

  it("blames the uncrossed obstacle first, then a crossed one", () => {
    const world = withPiece(piece("bridge", ["carries"]));
    expect(interactionObstacle(world, "bridge")?.id).toBe("river");
    const crossed = applyOperation(world, {
      type: "RESOLVE_INTERACTION",
      entityId: "bridge",
      outcome: "crosses",
      odds: 0.9,
      confidence: 0.8,
      obstacleId: "river",
    });
    expect(interactionObstacle(crossed, "bridge")?.id).toBe("river");
  });
});

describe("guest proposals and request payloads", () => {
  it("never lets a guest propose an outcome", () => {
    const world = initialWorld("t");
    expect(
      proposalProblem(
        {
          type: "RESOLVE_INTERACTION",
          entityId: "bridge",
          outcome: "crosses",
          odds: 1,
          confidence: 1,
          obstacleId: "river",
        },
        world,
      ),
    ).toMatch(/director/);
    const entity = piece("bridge", ["carries"]);
    expect(
      proposalProblem({ type: "CREATE_ENTITY", entity }, world),
    ).toBeUndefined();
    expect(
      proposalProblem(
        { type: "CREATE_ENTITY", entity: { ...entity, outcome: "crosses" } },
        world,
      ),
    ).toMatch(/outcome/);
  });

  it("never lets anyone take away what blocks the route", () => {
    const world = withPiece(piece("bridge", ["carries"]));
    const removeRiver = { type: "REMOVE_ENTITY" as const, entityId: "river" };
    expect(proposalProblem(removeRiver, world)).toMatch(/can't be taken away/);
    // The director cannot either: only a committed outcome passes it.
    expect(() => applyOperation(world, removeRiver)).toThrow(
      "can't be taken away",
    );
    // Anything else, including a drawing, can still be removed.
    expect(
      proposalProblem({ type: "REMOVE_ENTITY", entityId: "bridge" }, world),
    ).toBeUndefined();
    // Once crossed, the river no longer blocks and may go.
    const crossed = applyOperation(world, {
      type: "RESOLVE_INTERACTION",
      entityId: "bridge",
      outcome: "crosses",
      odds: 0.9,
      confidence: 0.9,
      obstacleId: "river",
    });
    expect(proposalProblem(removeRiver, crossed)).toBeUndefined();
    expect(applyOperation(crossed, removeRiver).pathStatus).toBe("available");
  });

  it("strips sketches without touching the world", () => {
    const sketched = withPiece({
      ...piece("bridge", ["carries"]),
      sketch: { strokes: [[400, 340, 560, 345]] },
    });
    const stripped = withoutSketches(sketched);
    expect(stripped.entities.some((entity) => entity.sketch)).toBe(false);
    expect(stripped.entities).toHaveLength(sketched.entities.length);
    expect(sketched.entities.at(-1)?.sketch).toBeDefined();
    const plain = initialWorld("t");
    expect(withoutSketches(plain)).toBe(plain);
  });
});

describe("the drawing being judged", () => {
  // Nova's world without the fear rule, so the nearest blocker is blamed.
  const noFear = { ...initialWorld("t"), rules: [] };
  const log: Entity = {
    ...piece("log", ["blocks"], "obstacle"),
    name: "Fallen log",
    bounds: { x: 300, y: 250, width: 60, height: 200 },
  };

  it("is never its own obstacle", () => {
    const world = withPiece(log, noFear);
    expect(interactionObstacle(world, "log")?.id).toBe("river");
    // Without the exclusion the log would be blamed for itself.
    expect(interactionObstacle(world, "someone-else")?.id).toBe("log");
  });

  it("cannot get anyone past itself when it blocks the route", () => {
    const world = withPiece(log, noFear);
    for (const outcome of ["crosses", "flies_over"] as const)
      expect(interactionProblem(world, "log", outcome)).toMatch(/past itself/);
    expect(() =>
      applyOperation(world, {
        type: "RESOLVE_INTERACTION",
        entityId: "log",
        outcome: "crosses",
        odds: 0.9,
        confidence: 0.9,
        obstacleId: "river",
      }),
    ).toThrow("past itself");
    // A log across the way can still be a funny failure.
    expect(
      applyOperation(world, {
        type: "RESOLVE_INTERACTION",
        entityId: "log",
        outcome: "blocked",
        odds: 0.1,
        confidence: 0.9,
        obstacleId: "river",
      }).interaction,
    ).toMatchObject({ outcome: "blocked", obstacleId: "river" });
  });

  it("never lets the river cross itself", () => {
    const world = initialWorld("t");
    expect(() =>
      applyOperation(world, {
        type: "RESOLVE_INTERACTION",
        entityId: "river",
        outcome: "crosses",
        odds: 1,
        confidence: 1,
        obstacleId: null,
      }),
    ).toThrow("past itself");
    expect(interactionProblem(world, "river", "almost")).toMatch(
      /Nothing is in the way/,
    );
  });
});

describe("model-facing schemas", () => {
  const resolveOp = {
    type: "RESOLVE_INTERACTION",
    entityId: "bridge",
    outcome: "crosses",
    odds: 1,
    confidence: 1,
    obstacleId: "river",
  };

  it("never accept an interaction outcome from a model", () => {
    expect(
      interpretationOutput.safeParse({
        mode: "live",
        message: "A bridge.",
        candidates: [{ operation: resolveOp, confidence: 0.9 }],
      }).success,
    ).toBe(false);
    expect(
      initialSceneResponseSchema.safeParse({
        operations: [resolveOp],
        openingNarration: "Nova wonders.",
        character: { id: "nova", name: "Nova" },
        moodHints: ["curious"],
      }).success,
    ).toBe(false);
  });
});

describe("interaction API contract", () => {
  const world = withPiece(piece("bridge", ["carries"]));

  it("requires the drawing to be in the committed world", () => {
    expect(
      interactionRequestSchema.safeParse({ world, entityId: "bridge" }).success,
    ).toBe(true);
    expect(
      interactionRequestSchema.safeParse({ world, entityId: "ghost" }).success,
    ).toBe(false);
  });

  it("accepts a bounded live response only", () => {
    const response = {
      mode: "live",
      outcome: "crosses",
      odds: 0.75,
      confidence: 0.6,
      actorId: "bridge",
      characterId: "nova",
      obstacleId: "river",
    };
    expect(interactionResponseSchema.parse(response)).toEqual(response);
    for (const bad of [
      { ...response, mode: "fixture" },
      { ...response, odds: 1.2 },
      { ...response, outcome: "teleports" },
    ])
      expect(interactionResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("entity sketches", () => {
  const entity = piece("bridge", ["carries"]);

  it("stores the child's strokes as integer x, y pairs inside the page", () => {
    const sketch = { strokes: [[400, 340, 480, 350, 560, 345]] };
    expect(entitySchema.parse({ ...entity, sketch })).toEqual({
      ...entity,
      sketch,
    });
    // An entity without a sketch parses without gaining one.
    expect(entitySchema.parse(entity)).not.toHaveProperty("sketch");
  });

  it("rejects odd, off-page, fractional or oversized sketches", () => {
    for (const strokes of [
      [[400, 340, 480]],
      [[400, 640, 480, 350]],
      [[400.5, 340, 480, 350]],
      [[1, 2]],
      [],
      [Array.from({ length: MAX_SKETCH_NUMBERS + 2 }, () => 10)],
    ])
      expect(
        entitySchema.safeParse({ ...entity, sketch: { strokes } }).success,
      ).toBe(false);
  });
});
