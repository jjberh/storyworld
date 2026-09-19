import { describe, it, expect } from "vitest";
import { confirmedSceneSchema, type ConfirmedScene } from "./index";
import { worldFromScene } from "./scene";
import { FixtureWorldClient } from "../../world-fixtures/src/index";

const scene: ConfirmedScene = {
  document: {
    sourceImage: "picture",
    drawing: { strokes: [], compositeImage: "picture" },
    description: "A fox explores",
  },
  mode: "live",
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
describe("confirmed scene initialization", () => {
  it("creates exactly the confirmed entities with image-space conversion and no inferred rules", () => {
    const world = worldFromScene("fox-world", scene);
    expect(world.entities).toEqual([
      {
        id: "fox",
        name: "Fox",
        kind: "character",
        bounds: { x: 100, y: 120, width: 200, height: 120 },
      },
    ]);
    expect(world.revision).toBe(0);
    expect(world.rules).toEqual([]);
    expect(world.goal).toBeNull();
  });
  it("rejects invalid references, duplicate IDs, extra characters and out-of-image boxes", () => {
    for (const invalid of [
      { ...scene, goalId: "fox" },
      { ...scene, fearedRiverId: "missing" },
      { ...scene, objects: [...scene.objects, scene.objects[0]] },
      {
        ...scene,
        objects: [...scene.objects, { ...scene.objects[0], id: "other" }],
      },
      {
        ...scene,
        objects: [
          {
            ...scene.objects[0],
            imageBounds: { x: 0.9, y: 0, width: 0.2, height: 1 },
          },
        ],
      },
    ])
      expect(confirmedSceneSchema.safeParse(invalid).success).toBe(false);
  });
  describe("river detection and fear rules", () => {
    const withRiver: ConfirmedScene = {
      ...scene,
      objects: [
        ...scene.objects,
        {
          id: "castle",
          name: "Castle",
          kind: "castle",
          confidence: 1,
          imageBounds: { x: 0.75, y: 0.2, width: 0.15, height: 0.3 },
        },
        {
          id: "creek",
          name: "Creek",
          kind: "river",
          confidence: 1,
          imageBounds: { x: 0.45, y: 0, width: 0.1, height: 1 },
        },
      ],
      goalId: "castle",
    };

    it("creates a river without any fear rule unless one is explicit", () => {
      const world = worldFromScene("fox-world", withRiver);
      expect(world.entities.map((entity) => entity.id)).toEqual([
        "fox",
        "castle",
        "creek",
      ]);
      expect(world.rules).toEqual([]);
    });

    it("creates exactly one afraid_of rule for an explicit valid river", () => {
      const world = worldFromScene("fox-world", {
        ...withRiver,
        fearedRiverId: "creek",
      });
      expect(world.rules).toEqual([
        {
          id: "initial-fear",
          subjectId: "fox",
          predicate: "afraid_of",
          objectId: "creek",
        },
      ]);
    });

    it("rejects a fear reference that is missing or not a river", () => {
      for (const fearedRiverId of ["missing", "fox", "castle"])
        expect(
          confirmedSceneSchema.safeParse({ ...withRiver, fearedRiverId })
            .success,
        ).toBe(false);
      expect(
        confirmedSceneSchema.safeParse({ ...scene, fearedRiverId: "fox" })
          .success,
      ).toBe(false);
    });

    it("blocks the route from geometry alone, independent of fear rules", () => {
      const feared = { ...withRiver, fearedRiverId: "creek" };
      expect(worldFromScene("fox-world", withRiver).pathStatus).toBe("blocked");
      expect(worldFromScene("fox-world", feared).pathStatus).toBe("blocked");
    });
  });

  it("fixture creation is atomic, retains the document and is safe to retry", async () => {
    const client = new FixtureWorldClient(true);
    await expect(
      client.initializeScene("test", "request", {
        ...scene,
        goalId: "missing",
      }),
    ).rejects.toThrow();
    expect(client.getSnapshot().world).toBeNull();
    await client.initializeScene("test", "request", scene);
    await client.initializeScene("test", "request", scene);
    expect(client.getSnapshot().events).toHaveLength(1);
    expect(client.getSnapshot().scene?.document).toEqual(scene.document);
    await expect(
      client.initializeScene("test", "request", {
        ...scene,
        openingNarration: "Changed",
      }),
    ).rejects.toThrow();
    expect(client.getSnapshot().events).toHaveLength(1);
  });
  it("repeated retries of one request observe a single world and event", async () => {
    const client = new FixtureWorldClient(true);
    for (let attempt = 0; attempt < 4; attempt += 1)
      await client.initializeScene("retry-world", "same-request", scene);
    const snapshot = client.getSnapshot();
    expect(snapshot.world?.id).toBe("retry-world");
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.world?.revision).toBe(snapshot.events[0]?.revision);
  });
});
