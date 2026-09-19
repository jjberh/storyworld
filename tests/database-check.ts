import assert from "node:assert/strict";
import { DbConnection } from "../apps/web/src/module_bindings";
import { bridgeOperation, cloudOperation } from "@storyworld/world-fixtures";
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
  await guest.reducers.submitProposal({
    worldId,
    proposalId: worldId + "-proposal",
    operation,
  });
  await until(() => !!director.db.proposal.id.find(worldId + "-proposal"));
  assert.equal(director.db.world.id.find(worldId)?.revision, 0);
  await director.reducers.resolveProposal({
    worldId,
    proposalId: worldId + "-proposal",
    approve: true,
    expectedRevision: 0,
    requestId: "accept",
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 1);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":1")!.snapshot)
      .pathStatus,
    "available",
  );
  await assert.rejects(() =>
    director.reducers.applyOperationCommand({
      worldId,
      expectedRevision: 0,
      requestId: "stale",
      operation: JSON.stringify(cloudOperation()),
    }),
  );
  const args = {
    worldId,
    expectedRevision: 1,
    requestId: "cloud-once",
    operation: JSON.stringify(cloudOperation()),
  };
  await director.reducers.applyOperationCommand(args);
  await director.reducers.applyOperationCommand(args);
  await until(() => guest.db.world.id.find(worldId)?.revision === 2);
  assert.equal(
    JSON.parse(guest.db.worldEvent.id.find(worldId + ":2")!.snapshot).weather,
    "rain",
  );
  await director.reducers.rewindWorld({
    worldId,
    revision: 0,
    expectedRevision: 2,
    requestId: "restore",
  });
  await until(() => guest.db.world.id.find(worldId)?.revision === 3);
  const restored = JSON.parse(
    guest.db.worldEvent.id.find(worldId + ":3")!.snapshot,
  );
  assert.equal(restored.pathStatus, "blocked");
  assert.equal(restored.weather, "clear");
  console.log(
    "PASS: independent clients synchronize; unauthorized/stale edits rejected; proposals, idempotency, and rewind verified.",
  );
} finally {
  director.disconnect();
  guest.disconnect();
}
