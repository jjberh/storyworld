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
// A boat that spans the river: carries Nova across and opens the route.
const withBoat = applyOperation(start, {
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
