import type {
  Bounds,
  WorldClient,
  WorldOperation,
} from "@storyworld/contracts/model";
import { storyCharacter } from "@storyworld/contracts/interaction";
import {
  NEEDS_JEV_NOTE,
  outcomeNote,
  resolveDrawingInteraction,
  sketchFromStrokes,
  strokesBounds,
  waitForEntity,
  withSketch,
} from "./story-drawing";

/** Strokes that land within this long of each other form one drawing. */
export const STROKE_SETTLE_MS = 900;

type Creation = Extract<WorldOperation, { type: "CREATE_ENTITY" }>;

/** A drawing on its way into the world: local and ephemeral, never world state. */
export type PendingCutout = {
  id: string;
  strokes: number[][];
  bounds: Bounds;
  /** The strokes as a transparent PNG, shown as a wobbling paper cutout. */
  image: string;
  state: "drawing" | "reading" | "failed";
  /**
   * The drawing as read, once it has been. A retry reuses it, so the same
   * entity ID is committed (or found already committed) instead of a copy.
   */
  creation?: Creation;
};

export type StoryDrawingState = {
  pending: PendingCutout[];
  note: string;
  /** Bumped when strokes move onto a cutout, so the drawing layer clears. */
  canvasKey: number;
  /**
   * A committed drawing whose moment Jev could not decide (a timeout, a busy
   * provider, a changed world). The child can ask again.
   */
  unresolved: { entityId: string; name: string } | null;
};

export type StoryDrawingDeps = {
  client: () => WorldClient | undefined;
  /** A guest proposes drawings instead of committing them. */
  guest: () => boolean;
  /** Reads a drawing (Gemini or the fixture). Throws when reading fails. */
  read: (cutout: PendingCutout) => Promise<WorldOperation | undefined>;
  /** The strokes as a cutout image. */
  picture: (strokes: number[][], bounds: Bounds) => string;
  resolve?: typeof resolveDrawingInteraction;
  settleMs?: number;
};

/**
 * Drawing mid-story, outside React so its ordering can be tested. Each
 * finished stroke shows at once as a cutout; strokes close together in time
 * form one drawing. A drawing is read, committed as CREATE_ENTITY with the
 * child's strokes as its sketch (a guest proposes instead), and then Jev
 * decides what happens (RESOLVE_INTERACTION). Drawings and accepted
 * proposals go through one queue, one at a time, so each commit and each
 * outcome sees the latest revision.
 */
export class StoryDrawingSession {
  private state: StoryDrawingState = {
    pending: [],
    note: "",
    canvasKey: 0,
    unresolved: null,
  };
  private listeners = new Set<() => void>();
  private batch: PendingCutout | null = null;
  private settle: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly deps: StoryDrawingDeps) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called on mount; undoes an earlier dispose (React may remount). */
  activate() {
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.settle);
  }

  private set(change: Partial<StoryDrawingState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private say(note: string) {
    this.set({ note });
  }

  private find(id: string) {
    return this.state.pending.find((item) => item.id === id);
  }

  private update(id: string, change: Partial<PendingCutout> | null) {
    this.set({
      pending:
        change === null
          ? this.state.pending.filter((item) => item.id !== id)
          : this.state.pending.map((item) =>
              item.id === id ? { ...item, ...change } : item,
            ),
    });
  }

  /**
   * Runs `task` after everything queued before it. A failed task never
   * stalls the queue; its error still reaches the caller.
   */
  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(() => (this.disposed ? undefined : task()));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private armSettle() {
    clearTimeout(this.settle);
    this.settle = setTimeout(
      () => this.finish(),
      this.deps.settleMs ?? STROKE_SETTLE_MS,
    );
  }

  /**
   * A stroke began: the drawing is still growing, so it is not read until
   * this stroke ends and the settle time passes (slow strokes stay together).
   */
  startStroke() {
    clearTimeout(this.settle);
  }

  /** A stroke ended without lines (a tap): keep waiting for the pause. */
  cancelStroke() {
    if (this.batch) this.armSettle();
  }

  /** A stroke finished on the drawing layer. */
  addStrokes(strokes: number[][]) {
    const usable = strokes.filter((stroke) => stroke.length >= 4);
    if (usable.length === 0) {
      this.cancelStroke();
      return;
    }
    const current = this.batch;
    const all = [...(current?.strokes ?? []), ...usable];
    const bounds = strokesBounds(all);
    const cutout: PendingCutout = {
      id: current?.id ?? crypto.randomUUID(),
      strokes: all,
      bounds,
      image: this.deps.picture(all, bounds),
      state: "drawing",
    };
    this.batch = cutout;
    this.set({
      pending: current
        ? this.state.pending.map((item) =>
            item.id === cutout.id ? cutout : item,
          )
        : [...this.state.pending, cutout],
      // The lines move onto the cutout; the drawing layer starts clean.
      canvasKey: this.state.canvasKey + 1,
    });
    this.armSettle();
  }

  /** The child is done (or paused long enough): read the drawing. */
  finish() {
    clearTimeout(this.settle);
    const cutout = this.batch;
    this.batch = null;
    if (!cutout) return;
    this.update(cutout.id, { state: "reading" });
    void this.run(() => this.process(cutout.id));
  }

  /** Tries a failed drawing again. Repeated taps queue it only once. */
  retry(id: string) {
    if (this.find(id)?.state !== "failed") return;
    this.update(id, { state: "reading" });
    void this.run(() => this.process(id));
  }

  /**
   * The director accepts a guest's proposal, then Jev decides what the new
   * drawing does. Queued with the director's own drawings. Rejects when the
   * proposal could not be accepted.
   */
  acceptProposal(proposalId: string, operation: WorldOperation) {
    return this.run(async () => {
      const client = this.deps.client();
      if (!client) return;
      await client.resolveProposal(proposalId, true);
      if (operation.type === "CREATE_ENTITY")
        await this.resolveInteraction(
          client,
          operation.entity.id,
          operation.entity.name,
        );
    });
  }

  /** Asks Jev again for the drawing whose moment could not be decided. */
  retryInteraction() {
    const unresolved = this.state.unresolved;
    if (!unresolved) return Promise.resolve();
    this.set({ unresolved: null });
    return this.run(async () => {
      const client = this.deps.client();
      const entity = client
        ?.getSnapshot()
        .world?.entities.find((item) => item.id === unresolved.entityId);
      // Gone (rewound or removed) or already decided: nothing to ask.
      if (!client || !entity || entity.outcome) return;
      await this.resolveInteraction(client, entity.id, unresolved.name);
    });
  }

  private async resolveInteraction(
    client: WorldClient,
    entityId: string,
    name: string,
  ) {
    this.set({
      note: `${name} joined the story! Seeing what happens…`,
      unresolved: null,
    });
    const resolve = this.deps.resolve ?? resolveDrawingInteraction;
    const result = await resolve(client, entityId);
    if (result.kind === "failed") this.set({ unresolved: { entityId, name } });
    const world = client.getSnapshot().world;
    const character = world ? storyCharacter(world)?.name : undefined;
    this.say(
      result.kind === "resolved"
        ? outcomeNote(result.outcome, {
            drawing: name,
            character: character ?? "Everyone",
          })
        : result.kind === "needs-jev"
          ? NEEDS_JEV_NOTE
          : result.message,
    );
  }

  private async process(id: string) {
    const client = this.deps.client();
    const cutout = this.find(id);
    if (!client || !cutout) return;
    let creation = cutout.creation;
    if (!creation) {
      this.say("Looking at your new drawing…");
      let operation: WorldOperation | undefined;
      try {
        operation = await this.deps.read(cutout);
      } catch {
        this.update(id, { state: "failed" });
        this.say(
          "We couldn't read your drawing this time. It's safe here; try again when you're ready.",
        );
        return;
      }
      if (operation?.type !== "CREATE_ENTITY") {
        this.update(id, { state: "failed" });
        this.say("We couldn't tell what that is yet. Try drawing it again!");
        return;
      }
      const sketched = withSketch(operation, sketchFromStrokes(cutout.strokes));
      if (sketched.type !== "CREATE_ENTITY") return;
      creation = sketched;
      this.update(id, { creation });
    }
    const { id: entityId, name } = creation.entity;
    try {
      const snapshot = client.getSnapshot();
      if (this.deps.guest()) {
        // A retry after the director already accepted it is done.
        if (snapshot.world?.entities.some((entity) => entity.id === entityId)) {
          this.update(id, null);
          this.say(`Your ${name.toLowerCase()} is in the story!`);
          return;
        }
        // A retry after a proposal that did land must not propose twice.
        const proposed = snapshot.proposals.some(
          (proposal) =>
            proposal.status === "pending" &&
            proposal.operation.type === "CREATE_ENTITY" &&
            proposal.operation.entity.id === entityId,
        );
        if (!proposed) await client.propose(creation);
        this.update(id, null);
        this.say(`Your ${name.toLowerCase()} is waiting for the director.`);
        return;
      }
      // A retry after a commit that did land goes straight to Jev.
      const committed = snapshot.world?.entities.some(
        (entity) => entity.id === entityId,
      );
      if (!committed) await client.apply(creation);
      await waitForEntity(client, entityId);
    } catch {
      this.update(id, { state: "failed" });
      this.say(
        "Your drawing is still here. Check your connection, then try again.",
      );
      return;
    }
    // The committed piece now stands where the cutout was.
    this.update(id, null);
    await this.resolveInteraction(client, entityId, name);
  }
}
