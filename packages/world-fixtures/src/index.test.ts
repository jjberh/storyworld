import { describe, expect, it } from "vitest";
import { cloudOperation, FixtureWorldClient } from "./index";

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
});
