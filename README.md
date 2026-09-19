# Storyworld

Storyworld begins with a child's own picture. They can start on a blank canvas or upload a drawing, add an optional description, and send the resulting scene draft to the typed scene-interpretation boundary. The draft keeps its normalized source image, strokes, and composite drawing while the picture is read, retried, and extended. The next experience stage will let the child confirm detected objects before creating a shared world.

The foundation demo is deterministic:

```text
Nova wants to reach the castle, but the river blocks her.
Add a bridge -> the route opens.
Add a storm cloud -> the world becomes rainy.
Reset or rewind -> the semantic world returns to an earlier revision.
```

Provider output is never silently faked. `POST /api/interpret/edit` calls Gemini when `GEMINI_API_KEY` is set and otherwise returns a deterministic response labelled `"mode": "fixture"`. `POST /api/interpret/scene` does the same for an uploaded picture. The ElevenLabs routes still return `501` until those integrations are implemented.

## Shared integration contracts

### Initial authoring

The default route begins with exactly two choices: **Start from scratch** and **Upload a drawing**. Both create the same `StoryDocument` shape: a source image, structured drawing data (strokes plus composite image), and an optional description. A scratch document uses a real blank source layer; an upload is resized onto that same 1000 × 600 layer. New strokes always sit above the source layer, so future drawing layers can be added without replacing the child's image.

**Bring my world to life** sends the draft composite image and optional child description to `POST /api/interpret/scene`. The browser preserves that draft during interpretation and recoverable failures, and **Try bringing it to life again** resubmits the same scene.

### Confirming and creating a scene

Review each detected object on the submitted image. Names, supported types, and regions can be corrected; regions can be drawn with a pointer or entered numerically. Remove unwanted detections or mark a region with **Add a missed object**. Check each object explicitly, keep exactly one character, and optionally choose a castle destination and a river the character fears. The opening narration is editable. No fear rule is inferred from the child's free-text prompt. The geometric simulation still treats an unbridged river between the character and destination as an obstacle, independently of fear rules.

Changing the picture or prompt invalidates the interpretation until it is submitted again. **Create confirmed world** freezes the accepted submission for safe retry and advances only when the committed world is observed. The `initializeScene` reducer validates the complete `ConfirmedScene`, builds typed operations against an empty world, and atomically stores the entities, rules, goal, initial event and `storyDocument` row. Identical owner/request/payload retries return the existing result; conflicting payloads or other owners are rejected.

Fixture interpretation is labelled as sample detections and requires consent; it can only create a local test world. With live interpretation, `mode=fixture` still uses the local world client; `mode=live` uses the configured database. The source picture, strokes, composite, prompt, confirmed objects and opening narration are retained together. Database document rows are public like the foundation's other tables; do not upload confidential pictures. Local fixture documents last for this page session. Maincloud must receive the new module before live scene creation is available.

This stage ends at a confirmed world. Animation of the child's image and later story consequences are subsequent work.

The former Nova, river, and castle causal demo is retained only as an explicit fixture fallback at `/?mode=fixture&fixture=nova` for fixture demonstrations and automated coverage.

### Fixture drawing experience

The Nova fixture can still draw directly on the page or upload a PNG, JPEG, or WebP reference (up to 10 MB), then trace the part to bring to life. Each edit sends a compressed image, stroke bounds, and narration text through the edit-interpretation endpoint.

Multiple candidates or confidence below 0.8 prompt a friendly choice before any world change. A failed interpretation preserves the strokes and uploaded reference; **Try my drawing again** reuses the captured image and bounds with your current narration. Drawing references are held in memory for the current page, not saved across reloads. Microphone input and event audio/captions remain pending provider integration. Text narration works now without audio.

Verify the recovery path by returning a 504 from `/api/interpret/edit`, drawing a bridge, editing the narration, and retrying. The route must remain blocked until an interpretation is accepted and its operation commits. Browser coverage in `tests/drawing-flow.spec.ts` exercises timeout recovery, ambiguous results, uploads, and guest proposals.

Dismiss an uncertain preview with **Keep drawing** to revise your words and retry the same image. Reset and rewind discard the draft and its retry image; results from interpretations started before the restore are ignored.

Provider work proposes a `SceneInterpretationResponse`: image-space object candidates, confidence scores, opening narration, character and goal references, and mood hints. The child confirms or corrects those candidates before the application creates world operations. A confirmed `WorldEvent` is the handoff for visual and audio reactions; it carries a stable event ID, revision, readable summary, and the complete committed world state.

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

Optional server settings: `GEMINI_MODEL` (default `gemini-3.6-flash`), `GEMINI_TIMEOUT_MS` (default `8000`, kept below the browser's 10 second abort), and `GEMINI_SCENE_TIMEOUT_MS` (default `20000`; a whole scene takes about 7-9 seconds).

Never prefix provider secrets with `VITE_`, commit `.env`, or paste keys into an issue, chat, screenshot, or pull request.

### Gemini interpretation behavior

With a key, `/api/interpret/edit` sends the narration and drawing to Gemini with a structured-output schema. Gemini only chooses what the child added (`bridge`, `cloud`, or `shelter`), a friendly name, and a confidence; the server builds the `CREATE_ENTITY` operation with its own ID and the drawn `changedRegion` as bounds, then validates it with the shared contract. Nothing from the model writes to SpacetimeDB. `/api/health` reports `providerMode` as `live` or `fixture`.

If Gemini fails, the route does not fall back to the fixture. It returns a recoverable error and the drawing is untouched:

```json
{ "code": "PROVIDER_TIMEOUT", "message": "…", "retryable": true }
```

Codes: `PROVIDER_TIMEOUT` (504), `PROVIDER_RATE_LIMITED` (503), `PROVIDER_UNAVAILABLE`, `PROVIDER_FAILED`, `PROVIDER_AUTH_FAILED`, `INVALID_MODEL_OUTPUT` (502), and `INVALID_INPUT` (400). Remove the key to run the fixture flow.

### Scene interpretation

`POST /api/interpret/scene` turns an uploaded picture plus optional narration into proposed objects for confirmation. Send `{ "image": "data:image/png;base64,…", "transcript": "optional narration" }`; PNG, JPEG, and WebP data URLs are accepted. Image data URLs are limited to 4,000,000 characters, so browser clients should resize or compress large phone photos before sending them. It returns candidates only and never creates world operations or writes to SpacetimeDB:

```json
{
  "mode": "live",
  "message": "A friendly sentence for the child.",
  "candidates": [
    {
      "id": "character-…",
      "kind": "character",
      "name": "Sunny",
      "confidence": 0.95,
      "imageBounds": { "x": 0.105, "y": 0.458, "width": 0.17, "height": 0.258 }
    },
    {
      "id": "castle-…",
      "kind": "castle",
      "name": "Tall Castle",
      "confidence": 0.92,
      "imageBounds": { "x": 0.71, "y": 0.2, "width": 0.2, "height": 0.35 }
    }
  ],
  "openingNarration": "One warm sentence about the hero.",
  "characterCandidateId": "character-…",
  "goalCandidateId": "castle-…",
  "moodHints": ["curious", "worried"]
}
```

The response uses the shared `SceneInterpretationResponse` contract. `imageBounds` are normalized from 0 to 1 against the original picture, so the UI can place confirmation overlays without assuming an aspect ratio. Gemini identifies only `character`, `castle`, `river`, `bridge`, `cloud`, and `shelter`; the server mints candidate IDs, keeps at most one character, castle, and river, and requires a character. The application must wait for the child to confirm or correct candidates before converting them into world operations. Without a key the route returns fixed Nova, river, and castle candidates with `"mode": "fixture"` and ignores the image.

Whole-scene requests may take 5-10 seconds. The browser client uses a 25-second abort for this endpoint and callers should show a non-blocking “reading your picture” state.

In addition to the codes above, scene requests can return `IMAGE_REQUIRED` and `UNSUPPORTED_IMAGE` (400, not retryable: pick another picture) and `SCENE_NOT_RECOGNIZED` (422, retryable: no hero was found). The picture's bytes must match its declared type, so a mislabelled file is rejected before any model call.

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
