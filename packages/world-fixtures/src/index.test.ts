import { describe, expect, it } from "vitest";
import type { ConfirmedScene } from "@storyworld/contracts";
import { cloudOperation, FixtureWorldClient } from "./index";

const scene: ConfirmedScene = {
  document: {
    sourceImage: "picture",
    drawing: { strokes: [], compositeImage: "picture" },
  },
  mode: "fixture",
  objects: [
    {
      id: "fox",
      name: "Fox",
      role: "character",
      description: "",
      properties: ["moves"],
      confidence: 1,
      imageBounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
    },
  ],
  characterId: "fox",
  openingNarration: "Fox explores.",
  moodHints: ["curious"],
};

describe("FixtureWorldClient", () => {
  it("records stable committed events and rewinds semantic state as a new revision", async () => {
    const client = new FixtureWorldClient();
    await client.apply({
      type: "CREATE_ENTITY",
      entity: {
        id: "near-miss",
        role: "helper",
        description: "",
        properties: ["carries"],
        name: "Near miss bridge",
        bounds: { x: 420, y: 330, width: 119, height: 50 },
      },
    });
    // A funny failure is committed as an outcome and keeps the route blocked.
    await client.apply({
      type: "RESOLVE_INTERACTION",
      entityId: "near-miss",
      outcome: "almost",
      odds: 0.4,
      confidence: 0.7,
      obstacleId: "river",
    });
    const nearMiss = client.getSnapshot().events[1]!;
    expect(nearMiss).toMatchObject({
      revision: 2,
      summary: "Near miss bridge: almost!",
      state: {
        pathStatus: "blocked",
        weather: "clear",
        interaction: { entityId: "near-miss", outcome: "almost" },
      },
    });
    expect(nearMiss.id).not.toBe("");

    await client.apply(cloudOperation());
    const cloudEvent = client.getSnapshot().events[2]!;
    expect(cloudEvent.id).not.toBe(nearMiss.id);
    expect(cloudEvent).toMatchObject({
      revision: 3,
      state: { weather: "rain" },
    });

    await client.rewind(0);
    const restored = client.getSnapshot().events[3]!;
    expect(restored).toMatchObject({
      revision: 4,
      summary: "Restored revision 0",
      state: {
        revision: 4,
        pathStatus: "blocked",
        weather: "clear",
        interaction: null,
      },
    });
    expect(restored.id).not.toBe(cloudEvent.id);
  });

  it("exposes one local director after initializeScene", async () => {
    const client = new FixtureWorldClient(true);
    expect(client.getSnapshot().participants).toEqual([]);
    await client.initializeScene("story-presence", "request", scene);
    expect(client.getSnapshot().participants).toEqual([
      {
        id: "story-presence:you",
        identity: "you",
        role: "director",
        isYou: true,
      },
    ]);
  });
});

describe("FixtureWorldClient proposals", () => {
  it("refuses a guest proposal that decides an outcome", async () => {
    const client = new FixtureWorldClient();
    await expect(
      client.propose({
        type: "RESOLVE_INTERACTION",
        entityId: "river",
        outcome: "crosses",
        odds: 1,
        confidence: 1,
        obstacleId: "river",
      }),
    ).rejects.toThrow("director");
    expect(client.getSnapshot().proposals).toEqual([]);
  });
});
