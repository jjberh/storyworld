import { DbConnection, tables } from "../module_bindings";
import {
  SCHEMA_VERSION,
  type WorldClient,
  type ClientSnapshot,
  type WorldOperation,
  type WorldState,
  type Proposal,
} from "@storyworld/contracts/model";
import { operationSchema } from "@storyworld/contracts";
export class LiveWorldClient implements WorldClient {
  private connection: DbConnection | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  private snapshot: ClientSnapshot = {
    status: "connecting",
    mode: "live",
    world: null,
    events: [],
    proposals: [],
    isDirector: false,
  };
  constructor(private room: string) {}
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private notify() {
    if (!this.disposed) this.listeners.forEach((fn) => fn());
  }
  private fail(message: string) {
    this.snapshot = { ...this.snapshot, status: "error", error: message };
    this.notify();
  }
  async connect() {
    const uri = import.meta.env.VITE_SPACETIMEDB_URI ?? "http://127.0.0.1:3000";
    const database =
      import.meta.env.VITE_SPACETIMEDB_DATABASE ?? "storyworld-local";
    const key = "storyworld.identity:" + uri + ":" + database;
    this.connection = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withToken(localStorage.getItem(key) ?? undefined)
      .onConnect((conn, _identity, token) => {
        if (this.disposed) {
          conn.disconnect();
          return;
        }
        localStorage.setItem(key, token);
        const refresh = () => queueMicrotask(() => this.refresh());
        conn.db.world.onInsert(refresh);
        conn.db.world.onUpdate(refresh);
        conn.db.worldEvent.onInsert(refresh);
        conn.db.proposal.onInsert(refresh);
        conn.db.proposal.onUpdate(refresh);
        conn.db.proposal.onDelete(refresh);
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            this.refresh();
          })
          .onError(() =>
            this.fail(
              "Cannot subscribe. Check the deployed schema and database name.",
            ),
          )
          .subscribe([
            tables.world.where((w) => w.id.eq(this.room)),
            tables.worldEvent.where((e) => e.worldId.eq(this.room)),
            tables.proposal.where((p) => p.worldId.eq(this.room)),
            tables.metadata,
          ]);
      })
      .onConnectError((_ctx, error) =>
        this.fail("Database connection failed: " + error.message),
      )
      .onDisconnect(() => {
        if (!this.disposed) this.fail("Disconnected. Reload to reconnect.");
      })
      .build();
  }
  private refresh() {
    if (this.disposed || !this.connection) return;
    const conn = this.connection;
    const meta = conn.db.metadata.id.find("schema");
    if (!meta || meta.schemaVersion !== SCHEMA_VERSION) {
      this.fail("Database schema does not match foundation v1.");
      return;
    }
    const row = conn.db.world.id.find(this.room);
    const events = [...conn.db.worldEvent.iter()]
      .filter((e) => e.worldId === this.room)
      .sort((a, b) => a.revision - b.revision)
      .map((e) => ({
        id: e.id,
        revision: e.revision,
        actor: e.actor.toHexString(),
        summary: e.summary,
        state: JSON.parse(e.snapshot) as WorldState,
      }));
    const world = events.at(-1)?.state ?? null;
    const proposals: Proposal[] = [...conn.db.proposal.iter()]
      .filter((p) => p.worldId === this.room)
      .map((p) => ({
        id: p.id,
        actor: p.actor.toHexString(),
        operation: operationSchema.parse(JSON.parse(p.operation)),
        status:
          p.status === "approved"
            ? "approved"
            : p.status === "rejected"
              ? "rejected"
              : "pending",
      }));
    this.snapshot = {
      status: "ready",
      mode: "live",
      world,
      events,
      proposals,
      isDirector: !!row && !!conn.identity && row.owner.isEqual(conn.identity),
    };
    this.notify();
  }
  private conn() {
    if (!this.connection || this.snapshot.status !== "ready")
      throw new Error("Database is not ready.");
    return this.connection;
  }
  private args() {
    const w = this.snapshot.world;
    if (!w) throw new Error("Open a world first.");
    return {
      worldId: w.id,
      expectedRevision: w.revision,
      requestId: crypto.randomUUID(),
    };
  }
  async createWorld(id: string) {
    if (id !== this.room) throw new Error("Open the desired room URL first.");
    await this.conn().reducers.createWorld({ worldId: id });
  }
  async joinWorld(id: string) {
    await this.conn().reducers.joinWorld({ worldId: id });
  }
  async apply(operation: WorldOperation) {
    await this.conn().reducers.applyOperationCommand({
      ...this.args(),
      operation: JSON.stringify(operationSchema.parse(operation)),
    });
  }
  async propose(operation: WorldOperation) {
    const conn = this.conn();
    await conn.reducers.joinWorld({ worldId: this.room });
    await conn.reducers.submitProposal({
      worldId: this.room,
      proposalId: crypto.randomUUID(),
      operation: JSON.stringify(operation),
    });
  }
  async resolveProposal(proposalId: string, approve: boolean) {
    await this.conn().reducers.resolveProposal({
      ...this.args(),
      proposalId,
      approve,
    });
  }
  async reset() {
    await this.conn().reducers.resetDemoWorld(this.args());
  }
  async rewind(revision: number) {
    await this.conn().reducers.rewindWorld({ ...this.args(), revision });
  }
  dispose() {
    this.disposed = true;
    this.connection?.disconnect();
    this.listeners.clear();
  }
}
