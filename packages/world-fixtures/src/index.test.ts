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
      kind: "character",
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
        kind: "bridge",
        name: "Near miss bridge",
        bounds: { x: 420, y: 330, width: 119, height: 50 },
      },
    });
    const nearMiss = client.getSnapshot().events[0]!;
    expect(nearMiss).toMatchObject({
      revision: 1,
      summary: "Near miss bridge added · river still blocks the route",
      state: { pathStatus: "blocked", weather: "clear" },
    });
    expect(nearMiss.id).not.toBe("");

    await client.apply(cloudOperation());
    const cloudEvent = client.getSnapshot().events[1]!;
    expect(cloudEvent.id).not.toBe(nearMiss.id);
    expect(cloudEvent).toMatchObject({
      revision: 2,
      state: { weather: "rain" },
    });

    await client.rewind(0);
    const restored = client.getSnapshot().events[2]!;
    expect(restored).toMatchObject({
      revision: 3,
      summary: "Restored revision 0",
      state: { revision: 3, pathStatus: "blocked", weather: "clear" },
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
