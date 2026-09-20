# Foundation check

This foundation includes child-led initial authoring, in-place object
confirmation, and atomic creation of a world from a confirmed scene. Shared
team ownership and pull request conventions are documented in `AGENTS.md`.
The confirmed picture now plays as a deterministic living paper theater in
Story Room.

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
authoring flow can create a confirmed world after the updated module is
published locally. After **Start my story** the URL becomes
`/?mode=live&world=story-…`; a second profile joins at
`/join?mode=live&world=story-…`. For the retained Nova collaboration test, open
`/?mode=live&world=your-room&fixture=nova`; a second browser profile uses
`/join?mode=live&world=your-room&fixture=nova`.

To see creation-failure recovery, run the web app in live mode with
`VITE_SPACETIMEDB_URI` pointing at a port nothing listens on, check every object,
and press **Start my story**. After about ten seconds **Try starting my story
again** and **Review my picture again** appear; correct the URI and restart web
to create the world.

Maincloud `storyworld-zhvbk` now has this foundation module, including
`story_document` and `initializeScene`. Its first migration did not run `init`,
so the metadata row (`id='schema'`, `schema_version=1`) was inserted manually.
Only Josh should publish further changes. Browser identities are anonymous and
persisted per database in browser storage. Table reads are public in this
hackathon foundation; rooms separate edits, not confidential data.

## What is implemented

- Typed world operations, geometric bridge rule, revisions, idempotency, director authorization, guest proposals, event snapshots, reset and restore.
- React shell, Konva stroke input, Pixi procedural scene, same-origin API proxy, mobile route, fixture/live adapters.
- The default route starts from a blank canvas or uploaded PNG/JPEG/WebP,
  preserves the source artwork beneath later strokes, and submits the composite
  image and optional description to `/api/interpret/scene`. Drafts survive
  interpretation failures and retry, but remain in memory for the page session.
- The child checks one proposed object at a time on the submitted picture and
  answers **Yes, that's right!**, **Change it** (rename, retype, or redraw its
  region), or **That is not in my picture**; **I missed something** adds an
  object. Exactly one character is required. Changing the picture or prompt
  requires reinterpretation. No fear rule is inferred from a detected river.
  **Start my story** freezes one world ID and request ID and calls
  `initializeScene`, which atomically creates the confirmed world and retains its
  `StoryDocument`; local fixture worlds last for the page session, while live
  confirmed scenes are stored in the database. If creation fails, **Try starting
  my story again** resends the same request and **Review my picture again**
  abandons it and unlocks editing. After a successful commit the URL becomes a
  room (`/?mode=…&world=<id>`). That room lists the people currently in it.
  Guests join a live room at `/join?mode=live&world=<id>` and see the same
  picture, events, and people in the room. Fixture join cannot reopen another
  tab's in-memory world. Confirmed image regions become light-edged paper
  cutouts over a subdued backdrop. The renderer sequences one to three beats
  from committed event snapshots only: the opening approaches and stops at a
  blocking river, while a committed spanning bridge reveals before the
  character crosses and celebrates. Pending proposals do not animate.
- The explicit Nova fixture retains drawing capture, uploaded references,
  ambiguous-interpretation choices, and retry without losing the drawing.
- Fastify `/api/interpret/edit`: live Gemini interpretation when `GEMINI_API_KEY` is set (schema-validated, recoverable errors), deterministic fixture otherwise. `/api/interpret/scene` turns an uploaded picture into a proposed initial scene; STT/TTS endpoints return explicit 501 until implemented.

Audio, provider-generated story sequences, segmentation, arbitrary pathfinding,
QR generation, and finished UX are feature work after this checkpoint. Fixture
rooms are local and do not synchronize. Rewind restores semantic state as a new
revision and plays one safe bounded paper-stage beat; it does not replay the
whole visual history, historical audio, or raw strokes.
