import assert from "node:assert/strict";
import { DbConnection } from "../apps/web/src/module_bindings";
import { bridgeOperation, cloudOperation } from "@storyworld/world-fixtures";
import { SCHEMA_VERSION, type ConfirmedScene } from "@storyworld/contracts";
import { applyOperation } from "@storyworld/contracts/simulation";
const uri = process.env.TEST_DB_URI ?? "http://127.0.0.1:3010";
const database = process.env.TEST_DB_NAME ?? "storyworld-foundation-check";
if (!new URL(uri).hostname.match(/^(127\.0\.0\.1|localhost)$/))
  throw new Error("This check is restricted to local databases.");
function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((c) => {
        c.subscriptionBuilder()
          .onApplied(() => resolve(c))
          .onError(() => reject(new Error("Subscription failed")))
          .subscribeToAllTables();
      })
      .onConnectError((_ctx, error) => reject(error))
      .build();
    setTimeout(() => {
      if (!conn.isActive) {
        conn.disconnect();
        reject(new Error("Connection timeout"));
      }
    }, 10000).unref();
  });
}
async function until(fn: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("Subscription did not converge");
    await new Promise((r) => setTimeout(r, 30));
  }
}
const director = await connect(),
  guest = await connect();
const worldId = "verify-" + Date.now();
try {
  // Connecting upserts the schema row, so a database republished over older
  // data (without --delete-data) still reports this module's version.
  await until(
    () => guest.db.metadata.id.find("schema")?.schemaVersion === SCHEMA_VERSION,
  );
  const sceneId = "scene-" + Date.now();
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
  const sceneArgs = {
    worldId: sceneId,
    requestId: "scene-once",
    scene: JSON.stringify(scene),
  };
  await assert.rejects(() =>
    director.reducers.initializeScene({
      ...sceneArgs,
      scene: JSON.stringify({ ...scene, goalId: "missing" }),
    }),
  );
  assert.equal(director.db.world.id.find(sceneId), null);
  await director.reducers.initializeScene(sceneArgs);
  await director.reducers.initializeScene(sceneArgs);
  await until(() => !!guest.db.storyDocument.worldId.find(sceneId));
  assert.equal(
    [...guest.db.worldEvent.iter()].filter((e) => e.worldId === sceneId).length,
    1,
  );
  assert.deepEqual(
    JSON.parse(guest.db.storyDocument.worldId.find(sceneId)!.scene).document,
    scene.document,
  );
  assert.deepEqual(
    JSON.parse(
      guest.db.worldEvent.id.find(sceneId + ":0")!.snapshot,
    ).entities.map((e: { id: string }) => e.id),
    ["fox"],
  );
  // A scene with no place to reach starts in free play.
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(sceneId + ":0")!.snapshot)
      .pathStatus,
    "free_play",
  );
  await assert.rejects(() => guest.reducers.initializeScene(sceneArgs));
  await assert.rejects(() =>
    director.reducers.initializeScene({
      ...sceneArgs,
      scene: JSON.stringify({ ...scene, openingNarration: "Different" }),
    }),
  );
  // Free play: a new drawing still gets its moment, with no odds (Jev is not
  // asked about a goal) and no route outcome, and the world stays in free play.
  await director.reducers.applyOperationCommand({
    worldId: sceneId,
    expectedRevision: 0,
    requestId: "free-play-ball",
    operation: JSON.stringify({
      type: "CREATE_ENTITY",
      entity: {
        id: "ball",
        role: "helper",
        name: "Ball",
        description: "",
        properties: [],
        bounds: { x: 400, y: 300, width: 60, height: 60 },
      },
    }),
  });
  await until(() => guest.db.world.id.find(sceneId)?.revision === 1);
  const freePlayOutcome = (outcome: string, odds: number | null) =>
    JSON.stringify({
      type: "RESOLVE_INTERACTION",
      entityId: "ball",
      outcome,
      odds,
      confidence: 0.8,
      obstacleId: null,
    });
  for (const [requestId, operation] of [
    ["free-play-odds", freePlayOutcome("nothing_happens", 0.5)],
    ["free-play-crossing", freePlayOutcome("crosses", null)],
    ["free-play-splash", freePlayOutcome("splash", null)],
  ] as const)
    await assert.rejects(() =>
      director.reducers.applyOperationCommand({
        worldId: sceneId,
        expectedRevision: 1,
        requestId,
        operation,
      }),
    );
  await director.reducers.applyOperationCommand({
    worldId: sceneId,
    expectedRevision: 1,
    requestId: "free-play-outcome",
    operation: freePlayOutcome("nothing_happens", null),
  });
  await until(() => guest.db.world.id.find(sceneId)?.revision === 2);
  const played = guest.db.worldEvent.id.find(sceneId + ":2")!;
  const playedState = JSON.parse(played.snapshot);
  assert.equal(playedState.pathStatus, "free_play");
  assert.equal(playedState.goal, null);
  assert.deepEqual(playedState.interaction, {
    entityId: "ball",
    outcome: "nothing_happens",
    odds: null,
    confidence: 0.8,
    obstacleId: null,
    revision: 2,
  });
  assert.equal(played.summary, "Ball: a new friend");
  await director.reducers.createWorld({ worldId });
  await guest.reducers.joinWorld({ worldId });
  await until(() => !!guest.db.world.id.find(worldId));
  const operation = JSON.stringify(bridgeOperation("verified-bridge"));
  await assert.rejects(() =>
    guest.reducers.applyOperationCommand({
      worldId,
      expectedRevision: 0,
      requestId: "unauthorized",
      operation,
    }),
  );
  await director.reducers.applyOperationCommand({
    worldId,
    expectedRevision: 0,
    requestId: "near-miss",
    operation: JSON.stringify({
      type: "CREATE_ENTITY",
      entity: {
        id: "near-miss-bridge",
        role: "helper",
        description: "",
        properties: ["carries"],
        name: "Near miss bridge",
        bounds: { x: 420, y: 330, width: 119, height: 50 },
      },
    }),
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 1);
  const added = guest.db.worldEvent.id.find(worldId + ":1")!;
  assert.equal(JSON.parse(added.snapshot).pathStatus, "blocked");
  assert.equal(added.summary, "Near miss bridge added");
  const resolve = (
    entityId: string,
    outcome: string,
    obstacleId: string | null = "river",
  ) =>
    JSON.stringify({
      type: "RESOLVE_INTERACTION",
      entityId,
      outcome,
      odds: 0.4,
      confidence: 0.7,
      obstacleId,
    });
  // A funny failure is committed as the outcome and keeps the route blocked.
  await director.reducers.applyOperationCommand({
    worldId,
    expectedRevision: 1,
    requestId: "near-miss-outcome",
    operation: resolve("near-miss-bridge", "almost"),
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 2);
  const nearMiss = guest.db.worldEvent.id.find(worldId + ":2")!;
  assert.equal(JSON.parse(nearMiss.snapshot).pathStatus, "blocked");
  assert.equal(JSON.parse(nearMiss.snapshot).interaction.outcome, "almost");
  assert.equal(nearMiss.summary, "Near miss bridge: almost!");
  // An outcome the drawing cannot present (a bridge does not fly) is refused.
  await assert.rejects(() =>
    director.reducers.applyOperationCommand({
      worldId,
      expectedRevision: 2,
      requestId: "impossible-outcome",
      operation: resolve("near-miss-bridge", "flies_over"),
    }),
  );
  await guest.reducers.submitProposal({
    worldId,
    proposalId: worldId + "-proposal",
    operation,
  });
  await until(() => !!director.db.proposal.id.find(worldId + "-proposal"));
  assert.equal(director.db.world.id.find(worldId)?.revision, 2);
  await director.reducers.resolveProposal({
    worldId,
    proposalId: worldId + "-proposal",
    approve: true,
    expectedRevision: 2,
    requestId: "accept",
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 3);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":3")!.snapshot)
      .pathStatus,
    "blocked",
  );
  // A success outcome for the accepted bridge opens the route.
  await director.reducers.applyOperationCommand({
    worldId,
    expectedRevision: 3,
    requestId: "crossing-outcome",
    operation: resolve("verified-bridge", "crosses"),
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 4);
  const crossed = JSON.parse(
    guest.db.worldEvent.id.find(worldId + ":4")!.snapshot,
  );
  assert.equal(crossed.pathStatus, "available");
  assert.deepEqual(crossed.crossings, [
    { obstacleId: "river", helperId: "verified-bridge" },
  ]);
  // Each drawing is resolved once.
  await assert.rejects(() =>
    director.reducers.applyOperationCommand({
      worldId,
      expectedRevision: 4,
      requestId: "second-outcome",
      operation: resolve("verified-bridge", "crosses"),
    }),
  );
  await guest.reducers.submitProposal({
    worldId,
    proposalId: worldId + "-rejected-cloud",
    operation: JSON.stringify(cloudOperation()),
  });
  await until(
    () => !!director.db.proposal.id.find(worldId + "-rejected-cloud"),
  );
  await director.reducers.resolveProposal({
    worldId,
    proposalId: worldId + "-rejected-cloud",
    approve: false,
    expectedRevision: 4,
    requestId: "reject",
  });
  await until(
    () =>
      guest.db.proposal.id.find(worldId + "-rejected-cloud")?.status ===
      "rejected",
  );
  assert.equal(guest.db.world.id.find(worldId)?.revision, 4);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":4")!.snapshot).weather,
    "clear",
  );
  await assert.rejects(() =>
    director.reducers.applyOperationCommand({
      worldId,
      expectedRevision: 1,
      requestId: "stale",
      operation: JSON.stringify(cloudOperation()),
    }),
  );
  const args = {
    worldId,
    expectedRevision: 4,
    requestId: "cloud-once",
    operation: JSON.stringify(cloudOperation()),
  };
  await director.reducers.applyOperationCommand(args);
  await director.reducers.applyOperationCommand(args);
  await until(() => guest.db.world.id.find(worldId)?.revision === 5);
  const rainy = JSON.parse(
    guest.db.worldEvent.id.find(worldId + ":5")!.snapshot,
  );
  assert.equal(rainy.weather, "rain");
  // The module reloads the committed crossing for the next operation.
  assert.equal(rainy.pathStatus, "available");
  assert.equal(rainy.interaction.entityId, "verified-bridge");
  // A guest can never propose an outcome, even one the director could commit
  // for this unresolved cloud.
  const cloudId = (
    rainy.entities as { id: string; properties: string[] }[]
  ).find((entity) => entity.properties.includes("weather"))!.id;
  const cloudOutcome = resolve(cloudId, "nothing_happens");
  applyOperation(rainy, JSON.parse(cloudOutcome));
  await assert.rejects(
    () =>
      guest.reducers.submitProposal({
        worldId,
        proposalId: worldId + "-guest-outcome",
        operation: cloudOutcome,
      }),
    /director/,
  );
  await director.reducers.rewindWorld({
    worldId,
    revision: 0,
    expectedRevision: 5,
    requestId: "restore",
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 6);
  const restored = JSON.parse(
    guest.db.worldEvent.id.find(worldId + ":6")!.snapshot,
  );
  assert.equal(restored.pathStatus, "blocked");
  assert.equal(restored.weather, "clear");
  assert.equal(restored.interaction, null);
  assert.deepEqual(restored.crossings, []);
  // Neither a guest nor the director can take away what blocks the route.
  const removeRiver = JSON.stringify({
    type: "REMOVE_ENTITY",
    entityId: "river",
  });
  await assert.rejects(
    () =>
      guest.reducers.submitProposal({
        worldId,
        proposalId: worldId + "-remove-river",
        operation: removeRiver,
      }),
    /taken away/,
  );
  await assert.rejects(
    () =>
      director.reducers.applyOperationCommand({
        worldId,
        expectedRevision: 6,
        requestId: "remove-river",
        operation: removeRiver,
      }),
    /taken away/,
  );
  // A drawing that itself blocks the route is never its own obstacle and
  // cannot get anyone past itself; nor can the river cross itself.
  await director.reducers.applyOperationCommand({
    worldId,
    expectedRevision: 6,
    requestId: "fallen-log",
    operation: JSON.stringify({
      type: "CREATE_ENTITY",
      entity: {
        id: "fallen-log",
        role: "obstacle",
        name: "Fallen log",
        description: "",
        properties: ["blocks"],
        bounds: { x: 300, y: 250, width: 60, height: 200 },
      },
    }),
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 7);
  for (const [requestId, operation] of [
    ["log-crosses-log", resolve("fallen-log", "crosses", "fallen-log")],
    ["log-crosses-river", resolve("fallen-log", "crosses", "river")],
    ["river-crosses", resolve("river", "crosses", "fallen-log")],
  ] as const)
    await assert.rejects(
      () =>
        director.reducers.applyOperationCommand({
          worldId,
          expectedRevision: 7,
          requestId,
          operation,
        }),
      /past itself/,
    );
  assert.equal(guest.db.world.id.find(worldId)?.revision, 7);
  console.log(
    "PASS: schema version stamped; free-play scene (no goal, null odds, route outcomes refused); independent clients synchronize; unauthorized/stale edits rejected; interaction outcomes (failure keeps the route blocked, success opens it, impossible, repeated, self-crossing and guest-proposed outcomes refused, blockers cannot be removed, crossing reloaded); proposal approval/rejection, idempotency, and rewind verified.",
  );
} finally {
  director.disconnect();
  guest.disconnect();
}
