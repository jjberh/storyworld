import { describe, expect, it } from "vitest";
import type {
  StoryAction,
  StorySequenceRequest,
  WorldState,
} from "@storyworld/contracts";
import { applyOperation, initialWorld } from "@storyworld/contracts/simulation";
import { storyBeatsMatchEventDelta } from "./services/story-relevance";

function request(
  world: WorldState,
  previous: WorldState,
): StorySequenceRequest {
  return {
    requestId: "request-1",
    committedEvent: {
      id: `event-${world.revision}`,
      revision: world.revision,
      summary: "Something changed",
    },
    committedWorld: world,
    previousCommittedWorld: previous,
  };
}

const matches = (
  actions: StoryAction[],
  world: WorldState,
  previous: WorldState,
) =>
  storyBeatsMatchEventDelta(
    actions.map((action, index) => ({
      id: `beat-${index + 1}`,
      narration: "Something happens.",
      mood: "curious",
      action,
    })),
    request(world, previous),
  );

const start = initialWorld("world-1");
const boatAdded = applyOperation(start, {
  type: "CREATE_ENTITY",
  entity: {
    id: "boat",
    role: "helper",
    name: "Boat",
    description: "",
    properties: ["floats", "carries"],
    bounds: { x: 400, y: 300, width: 160, height: 60 },
  },
});
// A boat whose committed outcome carries Nova across and opens the route.
const withBoat = applyOperation(boatAdded, {
  type: "RESOLVE_INTERACTION",
  entityId: "boat",
  outcome: "rides_across",
  odds: 0.8,
  confidence: 0.9,
  obstacleId: "river",
});
// A dragon that flies but does not change the route.
const withDragon = applyOperation(start, {
  type: "CREATE_ENTITY",
  entity: {
    id: "dragon",
    role: "scenery",
    name: "Dragon",
    description: "",
    properties: ["flies"],
    bounds: { x: 100, y: 40, width: 120, height: 80 },
  },
});

describe("story relevance for the richer actions", () => {
  it("counts an added piece referenced by fly_over, launch or react", () => {
    expect(withDragon.pathStatus).toBe("blocked");
    expect(
      matches(
        [{ type: "fly_over", entityId: "dragon", obstacleId: "river" }],
        withDragon,
        start,
      ),
    ).toBe(true);
    expect(
      matches(
        [
          {
            type: "react",
            entityId: "nova",
            causeId: "dragon",
            reaction: "surprised",
          },
        ],
        withDragon,
        start,
      ),
    ).toBe(true);
    expect(
      matches(
        [{ type: "launch", entityId: "dragon", launcherId: "castle" }],
        withDragon,
        start,
      ),
    ).toBe(true);
    // A beat that ignores the new piece is still unrelated.
    expect(
      matches(
        [
          {
            type: "react",
            entityId: "nova",
            causeId: "castle",
            reaction: "happy",
          },
        ],
        withDragon,
        start,
      ),
    ).toBe(false);
  });

  it("accepts riding to the goal as the journey when the route opens", () => {
    expect(withBoat.pathStatus).toBe("available");
    expect(
      matches(
        [
          {
            type: "ride",
            entityId: "nova",
            carrierId: "boat",
            targetId: "castle",
          },
        ],
        withBoat,
        start,
      ),
    ).toBe(true);
    // Riding without heading for the goal does not show the opened route.
    expect(
      matches(
        [{ type: "ride", entityId: "nova", carrierId: "boat" }],
        withBoat,
        start,
      ),
    ).toBe(false);
  });

  it("requires a freshly resolved interaction to show its drawing or character", () => {
    // The resolve event itself: nothing new was added, but the outcome is.
    expect(
      matches(
        [
          { type: "focus", entityId: "boat" },
          { type: "move_toward", entityId: "nova", targetId: "castle" },
        ],
        withBoat,
        boatAdded,
      ),
    ).toBe(true);
    // Crossing is naturally the character's own move to the goal.
    expect(
      matches(
        [{ type: "move_toward", entityId: "nova", targetId: "castle" }],
        withBoat,
        boatAdded,
      ),
    ).toBe(true);
    const ignored = applyOperation(boatAdded, {
      type: "RESOLVE_INTERACTION",
      entityId: "boat",
      outcome: "nothing_happens",
      odds: 0.1,
      confidence: 0.9,
      obstacleId: "river",
    });
    expect(
      matches([{ type: "focus", entityId: "castle" }], ignored, boatAdded),
    ).toBe(false);
    expect(
      matches(
        [
          {
            type: "react",
            entityId: "nova",
            causeId: "boat",
            reaction: "surprised",
          },
        ],
        ignored,
        boatAdded,
      ),
    ).toBe(true);
  });

  it("accepts a launch to the goal as the journey when the route opens", () => {
    const trampoline = applyOperation(
      applyOperation(start, {
        type: "CREATE_ENTITY",
        entity: {
          id: "trampoline",
          role: "helper",
          name: "Trampoline",
          description: "",
          properties: ["launches"],
          bounds: { x: 300, y: 330, width: 80, height: 40 },
        },
      }),
      {
        type: "RESOLVE_INTERACTION",
        entityId: "trampoline",
        outcome: "launched_across",
        odds: 0.7,
        confidence: 0.8,
        obstacleId: "river",
      },
    );
    expect(trampoline.pathStatus).toBe("available");
    expect(
      matches(
        [
          {
            type: "launch",
            entityId: "nova",
            launcherId: "trampoline",
            targetId: "castle",
          },
        ],
        trampoline,
        start,
      ),
    ).toBe(true);
  });

  it("only accepts the blocker on the route when several things block", () => {
    const walled: WorldState = {
      ...start,
      rules: [],
      entities: [
        {
          id: "wall",
          role: "obstacle",
          name: "Stone wall",
          description: "",
          properties: ["blocks"],
          bounds: { x: 10, y: 250, width: 40, height: 200 },
        },
        ...start.entities,
      ],
    };
    const open = { ...walled, pathStatus: "available" as const, revision: 0 };
    const closed = { ...walled, revision: 1 };
    expect(
      matches(
        [{ type: "blocked_by", entityId: "nova", obstacleId: "wall" }],
        closed,
        open,
      ),
    ).toBe(false);
    expect(
      matches(
        [{ type: "blocked_by", entityId: "nova", obstacleId: "river" }],
        closed,
        open,
      ),
    ).toBe(true);
  });

  it("accepts a splash into the blocking obstacle when the route closes", () => {
    expect(
      matches(
        [{ type: "splash", entityId: "nova", obstacleId: "river" }],
        start,
        withBoat,
      ),
    ).toBe(true);
    expect(
      matches(
        [{ type: "fly_over", entityId: "nova", obstacleId: "river" }],
        start,
        withBoat,
      ),
    ).toBe(false);
    // A blocked route is authoritative: riding to the goal does not show it.
    expect(
      matches(
        [
          {
            type: "ride",
            entityId: "nova",
            carrierId: "boat",
            targetId: "castle",
          },
        ],
        start,
        withBoat,
      ),
    ).toBe(false);
  });
});
