import assert from "node:assert/strict";
import { DbConnection } from "../apps/web/src/module_bindings";
import { bridgeOperation, cloudOperation } from "@storyworld/world-fixtures";
import type { ConfirmedScene } from "@storyworld/contracts";
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
        kind: "character",
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
  await assert.rejects(() => guest.reducers.initializeScene(sceneArgs));
  await assert.rejects(() =>
    director.reducers.initializeScene({
      ...sceneArgs,
      scene: JSON.stringify({ ...scene, openingNarration: "Different" }),
    }),
  );
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
        kind: "bridge",
        name: "Near miss bridge",
        bounds: { x: 420, y: 330, width: 119, height: 50 },
      },
    }),
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 1);
  const nearMiss = guest.db.worldEvent.id.find(worldId + ":1")!;
  assert.equal(JSON.parse(nearMiss.snapshot).pathStatus, "blocked");
  assert.match(nearMiss.summary, /river still blocks the route/);
  await guest.reducers.submitProposal({
    worldId,
    proposalId: worldId + "-proposal",
    operation,
  });
  await until(() => !!director.db.proposal.id.find(worldId + "-proposal"));
  assert.equal(director.db.world.id.find(worldId)?.revision, 1);
  await director.reducers.resolveProposal({
    worldId,
    proposalId: worldId + "-proposal",
    approve: true,
    expectedRevision: 1,
    requestId: "accept",
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 2);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":2")!.snapshot)
      .pathStatus,
    "available",
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
    expectedRevision: 2,
    requestId: "reject",
  });
  await until(
    () =>
      guest.db.proposal.id.find(worldId + "-rejected-cloud")?.status ===
      "rejected",
  );
  assert.equal(guest.db.world.id.find(worldId)?.revision, 2);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":2")!.snapshot).weather,
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
    expectedRevision: 2,
    requestId: "cloud-once",
    operation: JSON.stringify(cloudOperation()),
  };
  await director.reducers.applyOperationCommand(args);
  await director.reducers.applyOperationCommand(args);
  await until(() => guest.db.world.id.find(worldId)?.revision === 3);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":3")!.snapshot).weather,
    "rain",
  );
  await director.reducers.rewindWorld({
    worldId,
    revision: 0,
    expectedRevision: 3,
    requestId: "restore",
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 4);
  const restored = JSON.parse(
    guest.db.worldEvent.id.find(worldId + ":4")!.snapshot,
  );
  assert.equal(restored.pathStatus, "blocked");
  assert.equal(restored.weather, "clear");
  console.log(
    "PASS: independent clients synchronize; unauthorized/stale edits rejected; proposal approval/rejection, idempotency, and rewind verified.",
  );
} finally {
  director.disconnect();
  guest.disconnect();
}
