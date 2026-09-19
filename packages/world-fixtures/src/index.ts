import type {
  WorldClient,
  ClientSnapshot,
  WorldOperation,
} from "@storyworld/contracts/model";
import {
  initialWorld,
  applyOperation,
  summarize,
} from "@storyworld/contracts/simulation";
export { initialWorld };
import {
  confirmedSceneSchema,
  type ConfirmedScene,
} from "@storyworld/contracts";
import { worldFromScene } from "@storyworld/contracts/scene";
export function bridgeOperation(
  id = "bridge-" + crypto.randomUUID(),
): WorldOperation {
  return {
    type: "CREATE_ENTITY",
    entity: {
      id,
      kind: "bridge",
      name: "Bridge",
      bounds: { x: 385, y: 330, width: 190, height: 55 },
    },
  };
}
export function cloudOperation(): WorldOperation {
  return {
    type: "CREATE_ENTITY",
    entity: {
      id: "cloud-" + crypto.randomUUID(),
      kind: "cloud",
      name: "Storm cloud",
      bounds: { x: 580, y: 80, width: 150, height: 75 },
    },
  };
}
export class FixtureWorldClient implements WorldClient {
  private initialization?: { id: string; requestId: string; payload: string };
  constructor(empty = false) {
    if (empty) this.snapshot = { ...this.snapshot, world: null };
  }
  async initializeScene(id: string, requestId: string, input: ConfirmedScene) {
    const scene = confirmedSceneSchema.parse(input);
    const world = worldFromScene(id, scene);
    const payload = JSON.stringify(scene);
    if (!requestId || requestId.length > 100)
      throw new Error("Invalid request ID.");
    if (this.initialization) {
      if (
        this.initialization.id === id &&
        this.initialization.requestId === requestId &&
        this.initialization.payload === payload
      )
        return;
      throw new Error("This world already exists with a different scene.");
    }
    this.initialization = { id, requestId, payload };
    this.snapshot = {
      ...this.snapshot,
      world,
      scene,
      events: [
        {
          id: id + ":0",
          revision: 0,
          actor: "You",
          summary: "Your confirmed story begins",
          state: world,
        },
      ],
      proposals: [],
    };
    this.emit();
  }
  private listeners = new Set<() => void>();
  private snapshot: ClientSnapshot = {
    status: "ready",
    mode: "fixture",
    world: initialWorld("nova"),
    events: [],
    proposals: [],
    isDirector: true,
  };
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.snapshot = { ...this.snapshot };
    this.listeners.forEach((fn) => fn());
  }
  async connect() {
    this.emit();
  }
  async createWorld(id: string) {
    this.snapshot = {
      ...this.snapshot,
      world: initialWorld(id),
      events: [],
      proposals: [],
      isDirector: true,
    };
    this.emit();
  }
  async joinWorld(id: string) {
    await this.createWorld(id);
  }
  async apply(op: WorldOperation) {
    const current = this.snapshot.world!;
    const world = applyOperation(current, op);
    this.snapshot = {
      ...this.snapshot,
      world,
      events: [
        ...this.snapshot.events,
        {
          id: crypto.randomUUID(),
          revision: world.revision,
          actor: "You",
          summary: summarize(op, world),
          state: world,
        },
      ],
    };
    this.emit();
  }
  async propose(operation: WorldOperation) {
    this.snapshot = {
      ...this.snapshot,
      proposals: [
        ...this.snapshot.proposals,
        {
          id: crypto.randomUUID(),
          actor: "Fixture guest",
          operation,
          status: "pending",
        },
      ],
    };
    this.emit();
  }
  async resolveProposal(id: string, approve: boolean) {
    const p = this.snapshot.proposals.find((p) => p.id === id);
    if (!p || p.status !== "pending")
      throw new Error("Proposal no longer pending.");
    if (approve) await this.apply(p.operation);
    this.snapshot = {
      ...this.snapshot,
      proposals: this.snapshot.proposals.map((p) =>
        p.id === id ? { ...p, status: approve ? "approved" : "rejected" } : p,
      ),
    };
    this.emit();
  }
  async reset() {
    const old = this.snapshot.world!;
    const world = { ...initialWorld(old.id), revision: old.revision + 1 };
    this.snapshot = {
      ...this.snapshot,
      world,
      proposals: [],
      events: [
        ...this.snapshot.events,
        {
          id: crypto.randomUUID(),
          revision: world.revision,
          actor: "You",
          summary: "World reset",
          state: world,
        },
      ],
    };
    this.emit();
  }
  async rewind(revision: number) {
    const old = this.snapshot.world!;
    const target =
      revision === 0
        ? initialWorld(old.id)
        : this.snapshot.events.find((e) => e.revision === revision)?.state;
    if (!target) throw new Error("Revision not found.");
    const world = { ...structuredClone(target), revision: old.revision + 1 };
    this.snapshot = {
      ...this.snapshot,
      world,
      events: [
        ...this.snapshot.events,
        {
          id: crypto.randomUUID(),
          revision: world.revision,
          actor: "You",
          summary: "Restored revision " + revision,
          state: world,
        },
      ],
    };
    this.emit();
  }
  dispose() {
    this.listeners.clear();
  }
}
