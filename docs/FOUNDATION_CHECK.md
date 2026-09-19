# Foundation check

This foundation includes initial authoring, object confirmation, and atomic creation of a world from a confirmed scene. Shared team ownership and pull request conventions are documented in `AGENTS.md`.

The default page starts with a blank canvas or upload. Submit the picture and optional prompt, correct detected objects and their regions, accept each object, then create the world. Sample detections require explicit consent and only create a local test world. Changing the picture or prompt requires reinterpretation. The confirmed document is retained with the initial world event; animation of that picture is subsequent work. See README for the complete flow.

## Docker

Run `docker compose up --build --wait`, then open http://localhost:5173. No API keys or local SpacetimeDB are required in default fixture mode. The dependency service refreshes the container-only node_modules volume so old images or Windows dependencies do not break onboarding.

The legacy Nova demo is available at `/?mode=fixture&fixture=nova`. Click Add sample bridge: the route opens. Add storm cloud: rain appears. Reset world restores the river obstacle.

## Native

Install Node 24, run `npm ci`, then `npm run dev`. Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Local live database (Josh)

Run `npm run db:start` in one terminal. In another run `npm run db:publish:local` and `npm run db:generate`. Configure VITE_SPACETIMEDB_URI=http://127.0.0.1:3000 and VITE_SPACETIMEDB_DATABASE=storyworld-local, then restart web. Open /?mode=live&world=your-room and create it. A separate browser profile opens /join?mode=live&world=your-room, joins, and proposes a change. The director approves it.

The cloud database has not been modified. Live Maincloud requires publishing this module first. Only Josh should publish. Browser identities are anonymous and persisted per database in browser storage. Table reads are public in this hackathon foundation; rooms separate edits, not confidential data.

## What is implemented

- Typed world operations, geometric bridge rule, revisions, idempotency, director authorization, guest proposals, event snapshots, reset and restore.
- React shell, Konva stroke input, Pixi procedural scene, same-origin API proxy, mobile route, fixture/live adapters.
- Drawing image capture with narration and stroke bounds, uploaded pictures (PNG/JPEG/WebP), scene confirmation, and retry without losing the drawing. Uploads are the initial-scene source in the default flow. Uncommitted drafts and local fixture worlds last for the current page only; live confirmed scenes are stored in the database.
- Fastify `/api/interpret/edit`: live Gemini interpretation when `GEMINI_API_KEY` is set (schema-validated, recoverable errors), deterministic fixture otherwise. `/api/interpret/scene` turns an uploaded picture into a proposed initial scene; STT/TTS endpoints return explicit 501 until implemented.

Audio, sophisticated animation/pathfinding, QR generation, and finished UX are feature work after this checkpoint. Fixture rooms are local and do not synchronize. Rewind restores semantic state as a new revision; it does not replay historical audio or raw strokes.
