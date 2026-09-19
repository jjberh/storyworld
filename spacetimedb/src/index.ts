import {
  schema,
  table,
  t,
  type ReducerCtx,
  SenderError,
} from "spacetimedb/server";
import {
  initialWorld,
  applyOperation,
  deriveWorld,
  summarize,
} from "../../packages/contracts/src/simulation";
import { operationSchema } from "../../packages/contracts/src/index";
import { confirmedSceneSchema } from "../../packages/contracts/src/index";
import { worldFromScene } from "../../packages/contracts/src/scene";
import {
  SCHEMA_VERSION,
  type WorldState,
  type Entity,
  type WorldRule,
} from "../../packages/contracts/src/model";
const db = schema({
  storyDocument: table(
    { public: true },
    {
      worldId: t.string().primaryKey(),
      requestId: t.string(),
      scene: t.string(),
    },
  ),
  world: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      owner: t.identity(),
      revision: t.u32(),
      schemaVersion: t.u32(),
    },
  ),
  participant: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      worldId: t.string().index("btree"),
      identity: t.identity(),
    },
  ),
  entity: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      worldId: t.string().index("btree"),
      data: t.string(),
    },
  ),
  worldRule: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      worldId: t.string().index("btree"),
      data: t.string(),
    },
  ),
  goal: table(
    { public: true },
    {
      worldId: t.string().primaryKey(),
      characterId: t.string(),
      targetId: t.string(),
    },
  ),
  proposal: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      worldId: t.string().index("btree"),
      actor: t.identity(),
      operation: t.string(),
      status: t.string(),
    },
  ),
  worldEvent: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      worldId: t.string().index("btree"),
      revision: t.u32(),
      actor: t.identity(),
      summary: t.string(),
      snapshot: t.string(),
      requestId: t.string(),
    },
  ),
  metadata: table(
    { public: true },
    { id: t.string().primaryKey(), schemaVersion: t.u32() },
  ),
});
export default db;
type Context = ReducerCtx<typeof db.schemaType>;
function requireWorld(ctx: Context, id: string) {
  const w = ctx.db.world.id.find(id);
  if (!w) throw new SenderError("World does not exist.");
  if (w.schemaVersion !== SCHEMA_VERSION)
    throw new SenderError("Update your client.");
  return w;
}
function requireOwner(ctx: Context, id: string) {
  const w = requireWorld(ctx, id);
  if (!w.owner.isEqual(ctx.sender))
    throw new SenderError("Only the director can change this world.");
  return w;
}
function load(ctx: Context, id: string): WorldState {
  const w = requireWorld(ctx, id),
    goal = ctx.db.goal.worldId.find(id);
  return deriveWorld({
    id,
    revision: w.revision,
    schemaVersion: w.schemaVersion,
    entities: [...ctx.db.entity.worldId.filter(id)].map(
      (e) => JSON.parse(e.data) as Entity,
    ),
    rules: [...ctx.db.worldRule.worldId.filter(id)].map(
      (e) => JSON.parse(e.data) as WorldRule,
    ),
    goal: goal
      ? { characterId: goal.characterId, targetId: goal.targetId }
      : null,
    pathStatus: "idle",
    weather: "clear",
  });
}
function commit(
  ctx: Context,
  state: WorldState,
  summary: string,
  requestId: string,
) {
  const w = requireWorld(ctx, state.id);
  // Entity/rule rows and the snapshot event commit in the same transaction.
  for (const e of [...ctx.db.entity.worldId.filter(state.id)])
    ctx.db.entity.id.delete(e.id);
  for (const r of [...ctx.db.worldRule.worldId.filter(state.id)])
    ctx.db.worldRule.id.delete(r.id);
  for (const e of state.entities)
    ctx.db.entity.insert({
      id: state.id + ":" + e.id,
      worldId: state.id,
      data: JSON.stringify(e),
    });
  for (const r of state.rules)
    ctx.db.worldRule.insert({
      id: state.id + ":" + r.id,
      worldId: state.id,
      data: JSON.stringify(r),
    });
  ctx.db.goal.worldId.delete(state.id);
  if (state.goal) ctx.db.goal.insert({ worldId: state.id, ...state.goal });
  ctx.db.world.id.update({ ...w, revision: state.revision });
  ctx.db.worldEvent.insert({
    id: state.id + ":" + state.revision,
    worldId: state.id,
    revision: state.revision,
    actor: ctx.sender,
    summary,
    snapshot: JSON.stringify(state),
    requestId,
  });
}
function fresh(
  ctx: Context,
  worldId: string,
  revision: number,
  requestId: string,
) {
  const w = requireOwner(ctx, worldId);
  if (!requestId || requestId.length > 100)
    throw new SenderError("Invalid request ID.");
  if (
    [...ctx.db.worldEvent.worldId.filter(worldId)].some(
      (e) => e.requestId === requestId,
    )
  )
    return false;
  if (w.revision !== revision)
    throw new SenderError("World changed. Please retry your action.");
  return true;
}
function parseOperation(text: string) {
  if (text.length > 10000) throw new SenderError("Operation too large.");
  const result = operationSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new SenderError("Invalid world operation.");
  return result.data;
}
export const init = db.init((ctx) => {
  ctx.db.metadata.insert({ id: "schema", schemaVersion: SCHEMA_VERSION });
});
export const createWorld = db.reducer(
  { worldId: t.string() },
  (ctx, { worldId }) => {
    if (!/^[a-z0-9-]{1,40}$/.test(worldId))
      throw new SenderError("Use 1–40 lowercase letters, digits, or hyphens.");
    if (ctx.db.world.id.find(worldId))
      throw new SenderError("This room already exists. Join it instead.");
    ctx.db.world.insert({
      id: worldId,
      owner: ctx.sender,
      revision: 0,
      schemaVersion: SCHEMA_VERSION,
    });
    ctx.db.participant.insert({
      id: worldId + ":" + ctx.sender.toHexString(),
      worldId,
      identity: ctx.sender,
    });
    commit(ctx, initialWorld(worldId), "The adventure begins", "initial");
  },
);
export const joinWorld = db.reducer(
  { worldId: t.string() },
  (ctx, { worldId }) => {
    requireWorld(ctx, worldId);
    const id = worldId + ":" + ctx.sender.toHexString();
    if (!ctx.db.participant.id.find(id))
      ctx.db.participant.insert({ id, worldId, identity: ctx.sender });
  },
);
export const initializeScene = db.reducer(
  { worldId: t.string(), requestId: t.string(), scene: t.string() },
  (ctx, args) => {
    if (
      !args.requestId ||
      args.requestId.length > 100 ||
      args.scene.length > 10_000_000
    )
      throw new SenderError("Invalid scene request.");
    const parsed = confirmedSceneSchema.safeParse(JSON.parse(args.scene));
    if (!parsed.success) throw new SenderError("Invalid confirmed scene.");
    const state = worldFromScene(args.worldId, parsed.data);
    const canonical = JSON.stringify(parsed.data);
    const existing = ctx.db.world.id.find(args.worldId);
    if (existing) {
      requireOwner(ctx, args.worldId);
      const saved = ctx.db.storyDocument.worldId.find(args.worldId);
      if (saved?.requestId === args.requestId && saved.scene === canonical)
        return;
      throw new SenderError(
        "This world already exists with a different scene.",
      );
    }
    ctx.db.world.insert({
      id: args.worldId,
      owner: ctx.sender,
      revision: 0,
      schemaVersion: SCHEMA_VERSION,
    });
    ctx.db.participant.insert({
      id: args.worldId + ":" + ctx.sender.toHexString(),
      worldId: args.worldId,
      identity: ctx.sender,
    });
    ctx.db.storyDocument.insert({
      worldId: args.worldId,
      requestId: args.requestId,
      scene: canonical,
    });
    commit(ctx, state, "Your confirmed story begins", args.requestId);
  },
);
// A single validated command endpoint keeps AI and manual edits on the same path.
export const applyOperationCommand = db.reducer(
  {
    worldId: t.string(),
    expectedRevision: t.u32(),
    requestId: t.string(),
    operation: t.string(),
  },
  (ctx, args) => {
    if (!fresh(ctx, args.worldId, args.expectedRevision, args.requestId))
      return;
    const op = parseOperation(args.operation);
    const next = applyOperation(load(ctx, args.worldId), op);
    commit(ctx, next, summarize(op, next), args.requestId);
  },
);
export const submitProposal = db.reducer(
  { worldId: t.string(), proposalId: t.string(), operation: t.string() },
  (ctx, args) => {
    const state = load(ctx, args.worldId);
    if (
      !ctx.db.participant.id.find(args.worldId + ":" + ctx.sender.toHexString())
    )
      throw new SenderError("Join this world first.");
    if (!args.proposalId || args.proposalId.length > 100)
      throw new SenderError("Invalid proposal ID.");
    if (ctx.db.proposal.id.find(args.proposalId)) return;
    if (
      [...ctx.db.proposal.worldId.filter(args.worldId)].filter(
        (p) => p.status === "pending",
      ).length >= 20
    )
      throw new SenderError("Too many pending proposals.");
    const op = parseOperation(args.operation);
    applyOperation(state, op);
    ctx.db.proposal.insert({
      id: args.proposalId,
      worldId: args.worldId,
      actor: ctx.sender,
      operation: JSON.stringify(op),
      status: "pending",
    });
  },
);
export const resolveProposal = db.reducer(
  {
    worldId: t.string(),
    proposalId: t.string(),
    approve: t.bool(),
    expectedRevision: t.u32(),
    requestId: t.string(),
  },
  (ctx, args) => {
    if (!fresh(ctx, args.worldId, args.expectedRevision, args.requestId))
      return;
    const p = ctx.db.proposal.id.find(args.proposalId);
    if (!p || p.worldId !== args.worldId || p.status !== "pending")
      throw new SenderError("Proposal no longer pending.");
    if (args.approve) {
      const op = parseOperation(p.operation),
        next = applyOperation(load(ctx, args.worldId), op);
      commit(
        ctx,
        next,
        summarize(op, next) + " · guest contribution",
        args.requestId,
      );
    }
    ctx.db.proposal.id.update({
      ...p,
      status: args.approve ? "approved" : "rejected",
    });
  },
);
export const resetDemoWorld = db.reducer(
  { worldId: t.string(), expectedRevision: t.u32(), requestId: t.string() },
  (ctx, args) => {
    if (!fresh(ctx, args.worldId, args.expectedRevision, args.requestId))
      return;
    for (const p of [...ctx.db.proposal.worldId.filter(args.worldId)])
      ctx.db.proposal.id.delete(p.id);
    commit(
      ctx,
      { ...initialWorld(args.worldId), revision: args.expectedRevision + 1 },
      "World reset",
      args.requestId,
    );
  },
);
export const rewindWorld = db.reducer(
  {
    worldId: t.string(),
    revision: t.u32(),
    expectedRevision: t.u32(),
    requestId: t.string(),
  },
  (ctx, args) => {
    if (!fresh(ctx, args.worldId, args.expectedRevision, args.requestId))
      return;
    const event = ctx.db.worldEvent.id.find(args.worldId + ":" + args.revision);
    if (!event) throw new SenderError("Revision not found.");
    const restored = JSON.parse(event.snapshot) as WorldState;
    commit(
      ctx,
      { ...restored, revision: args.expectedRevision + 1 },
      "Restored revision " + args.revision,
      args.requestId,
    );
  },
);
