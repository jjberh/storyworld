# Foundation check

This foundation now includes the child-led initial-authoring handoff. Shared
team ownership and pull request conventions are documented in `AGENTS.md`.

## Docker

Run `docker compose up --build --wait`, then open http://localhost:5173. The
default page offers **Start from scratch** and **Upload a drawing**. Both paths
produce the same scene draft and work without provider keys. The dependency
service refreshes the container-only node_modules volume so old images or
Windows dependencies do not break onboarding.

The deterministic causal demo is retained at
http://localhost:5173/?mode=fixture&fixture=nova. Click **Add sample bridge**:
the route opens. Add a storm cloud: rain appears. Reset restores the river
obstacle.

## Native

Install Node 24, run `npm ci`, then `npm run dev`. Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Local live database (Josh)

Run `npm run db:start` in one terminal. In another run
`npm run db:publish:local` and `npm run db:generate`. Configure
VITE_SPACETIMEDB_URI=http://127.0.0.1:3000 and
VITE_SPACETIMEDB_DATABASE=storyworld-local, then restart web. The normal live
route remains on initial authoring. For the retained collaboration test, open
`/?mode=live&world=your-room&fixture=nova`; a second browser profile uses
`/join?mode=live&world=your-room&fixture=nova`.

The cloud database has not been modified. Live Maincloud requires publishing this module first. Only Josh should publish. Browser identities are anonymous and persisted per database in browser storage. Table reads are public in this hackathon foundation; rooms separate edits, not confidential data.

## What is implemented

- Typed world operations, geometric bridge rule, revisions, idempotency, director authorization, guest proposals, event snapshots, reset and restore.
- React shell, Konva stroke input, Pixi procedural scene, same-origin API proxy, mobile route, fixture/live adapters.
- The default route starts from a blank canvas or uploaded PNG/JPEG/WebP,
  preserves the source artwork beneath later strokes, and submits the composite
  image and optional description to `/api/interpret/scene`. Drafts survive
  interpretation failures and retry, but remain in memory for the page session.
- The explicit Nova fixture retains drawing capture, uploaded references,
  ambiguous-interpretation choices, and retry without losing the drawing.
- Fastify `/api/interpret/edit`: live Gemini interpretation when `GEMINI_API_KEY` is set (schema-validated, recoverable errors), deterministic fixture otherwise. `/api/interpret/scene` turns an uploaded picture into a proposed initial scene; STT/TTS endpoints return explicit 501 until implemented.

Audio, sophisticated animation/pathfinding, QR generation, and finished UX are feature work after this checkpoint. Fixture rooms are local and do not synchronize. Rewind restores semantic state as a new revision; it does not replay historical audio or raw strokes.
