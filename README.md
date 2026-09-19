# Storyworld

Storyworld is a shared, causal story world. A drawing can become an object, objects participate in a small rule system, and accepted changes appear as synchronized world events. The current repository is the team foundation: it has a polished fixture scene, a real SpacetimeDB module, typed contracts, and explicit seams for Gemini and ElevenLabs work.

The foundation demo is deterministic:

```text
Nova wants to reach the castle, but the river blocks her.
Add a bridge -> the route opens.
Add a storm cloud -> the world becomes rainy.
Reset or rewind -> the semantic world returns to an earlier revision.
```

Provider output is never silently faked. `POST /api/interpret/edit` calls Gemini when `GEMINI_API_KEY` is set and otherwise returns a deterministic response labelled `"mode": "fixture"`. `POST /api/interpret/scene` and the ElevenLabs routes still return a fixture response or `501` until those integrations are implemented.

## Shared integration contracts

Provider work can propose an `InitialSceneResponse`: ordered typed operations, opening narration, Nova's identity, and mood hints. It does not change the world directly. A confirmed `WorldEvent` is the handoff for visual and audio reactions; it carries a stable event ID, revision, readable summary, and the complete committed world state.

## Fastest start: Docker

Prerequisite: Docker Desktop with its engine running. No API keys or SpacetimeDB installation are needed for fixture mode.

```powershell
git clone https://github.com/jjberh/storyworld.git
cd storyworld
docker compose up --build --wait
```

Open [http://localhost:5173/?mode=fixture](http://localhost:5173/?mode=fixture). The API health endpoint is [http://localhost:3001/api/health](http://localhost:3001/api/health).

Stop the services with:

```powershell
docker compose down
```

The optional smoke check tests Docker itself without application code:

```powershell
docker compose -f compose.smoke.yaml up --build --wait
Invoke-RestMethod http://localhost:8080/health
docker compose -f compose.smoke.yaml down
```

## Native start

Prerequisites: Node 24 and npm.

```powershell
npm ci
npm run dev
```

The web app runs on port 5173 and the Fastify API on port 3001. Native development does not require API keys in fixture mode.

## Environment variables

Copy `.env.example` only when you need custom configuration:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

These are public browser settings:

```dotenv
VITE_WORLD_MODE=fixture
VITE_SPACETIMEDB_URI=https://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=storyworld-zhvbk
```

Only the Fastify process may read these server secrets:

```dotenv
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
```

Optional server settings: `GEMINI_MODEL` (default `gemini-3.6-flash`) and `GEMINI_TIMEOUT_MS` (default `8000`, kept below the browser's 10 second abort).

Never prefix provider secrets with `VITE_`, commit `.env`, or paste keys into an issue, chat, screenshot, or pull request.

### Gemini interpretation behavior

With a key, `/api/interpret/edit` sends the narration and drawing to Gemini with a structured-output schema. Gemini only chooses what the child added (`bridge`, `cloud`, or `shelter`), a friendly name, and a confidence; the server builds the `CREATE_ENTITY` operation with its own ID and the drawn `changedRegion` as bounds, then validates it with the shared contract. Nothing from the model writes to SpacetimeDB. `/api/health` reports `providerMode` as `live` or `fixture`.

If Gemini fails, the route does not fall back to the fixture. It returns a recoverable error and the drawing is untouched:

```json
{ "code": "PROVIDER_TIMEOUT", "message": "…", "retryable": true }
```

Codes: `PROVIDER_TIMEOUT` (504), `PROVIDER_RATE_LIMITED` (503), `PROVIDER_UNAVAILABLE`, `PROVIDER_FAILED`, `PROVIDER_AUTH_FAILED`, `INVALID_MODEL_OUTPUT` (502), and `INVALID_INPUT` (400). Remove the key to run the fixture flow.

## Josh: local and Maincloud database work

Only the world-engine owner needs the SpacetimeDB CLI. To test the module locally:

```powershell
npm run db:start
npm run db:publish:local
npm run db:generate
```

For local live mode, use a separate terminal to start the web app with:

```powershell
$env:VITE_WORLD_MODE="live"
$env:VITE_SPACETIMEDB_URI="http://127.0.0.1:3000"
$env:VITE_SPACETIMEDB_DATABASE="storyworld-local"
npm run dev -w @storyworld/web
```

Use separate browser profiles for the director and guest, and choose a fresh room name for each run (for example, `?mode=live&world=josh-demo-1`). The browser profile that creates the room is its director; reopening that same profile with the same host, port, and database regains director access. A different profile is a contributor, even at the root room URL, and can propose rather than directly change the world. After accepting a change, refresh both profiles and use the timeline to rewind; both clients should converge on the same state. The live client reconnects after a short connection interruption and resends an interrupted reducer call once with its original request ID.

To publish the tested module to the shared Maincloud database, first confirm that the module matches the intended empty database and do not use `--delete-data`:

```powershell
spacetime publish storyworld-zhvbk --server maincloud --module-path spacetimedb --yes=migrate
npm run db:generate
```

Commit the module and generated bindings together. Teammates should pull that commit before using live mode. The shared Maincloud database is for integration and rehearsal; do not publish unfinished schema changes from multiple branches.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The live browser test is skipped unless `TEST_LIVE=1` is set. The local two-client check uses `TEST_DB_URI` and `TEST_DB_NAME` when provided.

Read [docs/FOUNDATION_CHECK.md](docs/FOUNDATION_CHECK.md) for the current feature boundary and onboarding details. Read [AGENTS.md](AGENTS.md) before changing shared contracts or the SpacetimeDB module.
