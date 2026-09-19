import { DbConnection, tables } from "../module_bindings";
import { SenderError } from "spacetimedb";
import {
  SCHEMA_VERSION,
  type WorldClient,
  type ClientSnapshot,
  type WorldOperation,
  type WorldState,
  type Proposal,
} from "@storyworld/contracts/model";
import {
  operationSchema,
  confirmedSceneSchema,
  type ConfirmedScene,
} from "@storyworld/contracts";
export class LiveWorldClient implements WorldClient {
  private connection: DbConnection | null = null;
  private uri: string | null = null;
  private database: string | null = null;
  private identityKey: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
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
  private reconnecting(message: string) {
    this.snapshot = { ...this.snapshot, status: "connecting", error: message };
    this.notify();
  }
  async connect() {
    if (this.uri) return;
    this.uri = import.meta.env.VITE_SPACETIMEDB_URI ?? "http://127.0.0.1:3000";
    this.database =
      import.meta.env.VITE_SPACETIMEDB_DATABASE ?? "storyworld-local";
    this.identityKey = "storyworld.identity:" + this.uri + ":" + this.database;
    this.openConnection();
  }
  private openConnection() {
    if (
      this.disposed ||
      this.connection ||
      !this.uri ||
      !this.database ||
      !this.identityKey
    )
      return;
    this.connection = DbConnection.builder()
      .withUri(this.uri)
      .withDatabaseName(this.database)
      .withToken(localStorage.getItem(this.identityKey) ?? undefined)
      .onConnect((conn, _identity, token) => {
        if (this.disposed) {
          conn.disconnect();
          return;
        }
        this.connection = conn;
        this.reconnectAttempt = 0;
        localStorage.setItem(this.identityKey!, token);
        const refresh = () => queueMicrotask(() => this.refresh());
        conn.db.world.onInsert(refresh);
        conn.db.world.onUpdate(refresh);
        conn.db.storyDocument.onInsert(refresh);
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
            tables.world.where((world) => world.id.eq(this.room)),
            tables.worldEvent.where((event) => event.worldId.eq(this.room)),
            tables.proposal.where((proposal) => proposal.worldId.eq(this.room)),
            tables.metadata,
            tables.storyDocument.where((document) =>
              document.worldId.eq(this.room),
            ),
          ]);
      })
      .onConnectError((conn) => {
        if (!this.disposed && conn === this.connection) {
          this.connection = null;
          this.reconnecting("Database connection failed. Retrying…");
          this.scheduleReconnect();
        }
      })
      .onDisconnect((conn) => {
        if (!this.disposed && conn === this.connection) {
          this.connection = null;
          this.reconnecting("Connection interrupted. Reconnecting…");
          this.scheduleReconnect();
        }
      })
      .build();
  }
  private scheduleReconnect() {
    if (this.reconnectTimer || this.disposed) return;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openConnection();
    }, delay);
  }
  private refresh() {
    if (this.disposed) return;
    if (!this.connection) return;
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
      scene: conn.db.storyDocument.worldId.find(this.room)
        ? confirmedSceneSchema.parse(
            JSON.parse(conn.db.storyDocument.worldId.find(this.room)!.scene),
          )
        : undefined,
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
  private waitForReady() {
    if (this.snapshot.status === "ready") return Promise.resolve();
    if (this.snapshot.status === "error")
      return Promise.reject(
        new Error(this.snapshot.error ?? "Database connection failed."),
      );
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Database did not reconnect in time."));
      }, 10_000);
      const unsubscribe = this.subscribe(() => {
        if (this.snapshot.status === "ready") {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
        if (this.snapshot.status === "error") {
          clearTimeout(timeout);
          unsubscribe();
          reject(
            new Error(this.snapshot.error ?? "Database connection failed."),
          );
        }
      });
    });
  }
  private awaitReducerWhileConnected(reducer: Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe(() => {
        if (this.snapshot.status !== "ready") {
          unsubscribe();
          reject(new Error("Database connection interrupted."));
        }
      });
      reducer.then(
        () => {
          unsubscribe();
          resolve();
        },
        (error) => {
          unsubscribe();
          reject(error);
        },
      );
    });
  }
  private async retryReducer(call: (conn: DbConnection) => Promise<void>) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.awaitReducerWhileConnected(call(this.conn()));
        return;
      } catch (error) {
        if (error instanceof SenderError || attempt === 1) throw error;
        await this.waitForReady();
      }
    }
  }
  async createWorld(id: string) {
    if (id !== this.room) throw new Error("Open the desired room URL first.");
    await this.conn().reducers.createWorld({ worldId: id });
  }
  async initializeScene(id: string, requestId: string, scene: ConfirmedScene) {
    if (id !== this.room) throw new Error("Open the desired room first.");
    await this.waitForReady();
    const args = {
      worldId: id,
      requestId,
      scene: JSON.stringify(confirmedSceneSchema.parse(scene)),
    };
    await this.retryReducer((conn) => conn.reducers.initializeScene(args));
    // Completion means the committed event and document have reached this client.
    if (this.snapshot.world?.id === id && this.snapshot.scene) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(
          new Error("Waiting for the committed world timed out. Retry safely."),
        );
      }, 10000);
      const unsubscribe = this.subscribe(() => {
        if (this.snapshot.world?.id === id && this.snapshot.scene) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });
  }
  async joinWorld(id: string) {
    await this.retryReducer((conn) => conn.reducers.joinWorld({ worldId: id }));
  }
  async apply(operation: WorldOperation) {
    const args = {
      ...this.args(),
      operation: JSON.stringify(operationSchema.parse(operation)),
    };
    await this.retryReducer((conn) =>
      conn.reducers.applyOperationCommand(args),
    );
  }
  async propose(operation: WorldOperation) {
    await this.retryReducer((conn) =>
      conn.reducers.joinWorld({ worldId: this.room }),
    );
    const args = {
      worldId: this.room,
      proposalId: crypto.randomUUID(),
      operation: JSON.stringify(operationSchema.parse(operation)),
    };
    await this.retryReducer((conn) => conn.reducers.submitProposal(args));
  }
  async resolveProposal(proposalId: string, approve: boolean) {
    const args = {
      ...this.args(),
      proposalId,
      approve,
    };
    await this.retryReducer((conn) => conn.reducers.resolveProposal(args));
  }
  async reset() {
    const args = this.args();
    await this.retryReducer((conn) => conn.reducers.resetDemoWorld(args));
  }
  async rewind(revision: number) {
    const args = { ...this.args(), revision };
    await this.retryReducer((conn) => conn.reducers.rewindWorld(args));
  }
  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.connection?.disconnect();
    this.connection = null;
    this.uri = null;
    this.database = null;
    this.identityKey = null;
    this.listeners.clear();
  }
}
