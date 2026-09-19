# Storyworld

Storyworld is a shared, causal story world. A drawing can become an object, objects participate in a small rule system, and accepted changes appear as synchronized world events. The current repository is the team foundation: it has a polished fixture scene, a real SpacetimeDB module, typed contracts, and explicit seams for Gemini and ElevenLabs work.

The foundation demo is deterministic:

```text
Nova wants to reach the castle, but the river blocks her.
Add a bridge -> the route opens.
Add a storm cloud -> the world becomes rainy.
Reset or rewind -> the semantic world returns to an earlier revision.
```

Provider output is never silently faked. `POST /api/interpret/edit` calls Gemini when `GEMINI_API_KEY` is set and otherwise returns a deterministic response labelled `"mode": "fixture"`. `POST /api/interpret/scene` does the same for an uploaded picture. ElevenLabs voice is live when `ELEVENLABS_API_KEY` is set; without it the voice routes report `503 PROVIDER_NOT_CONFIGURED` and the UI falls back to text and captions.

## Shared integration contracts

### Drawing experience

Draw directly on the page or upload a PNG, JPEG, or WebP reference (up to 10 MB), then trace the part to bring to life. Uploads are fitted to a 1000 × 600 drawing surface; they do not replace the semantic world. Each edit sends a compressed image, stroke bounds, and the narration text through the existing interpretation endpoint.

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

Optional server settings: `GEMINI_MODEL` (default `gemini-3.6-flash`), `GEMINI_TIMEOUT_MS` (default `8000`, kept below the browser's 10 second abort), and `GEMINI_SCENE_TIMEOUT_MS` (default `20000`; a whole scene takes about 7-9 seconds). For voice: `ELEVENLABS_VOICE_ID` (default `EXAVITQu4vr4xnSDxMaL`), `ELEVENLABS_TTS_MODEL` (default `eleven_flash_v2_5`), `ELEVENLABS_STT_MODEL` (default `scribe_v2_realtime`), and `ELEVENLABS_TIMEOUT_MS` (default `8000`). The key needs the speech-to-text and text-to-speech permissions; it does not need `voices_read`.

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

### Voice: transcription and reactions

Speech in and speech out use ElevenLabs. Reactions come only from a confirmed `WorldEvent`, never from a button press or unconfirmed model output, and the animation never waits for speech. `/api/health` reports `audioMode` as `live` or `unavailable`.

**Speech in.** `GET /api/elevenlabs/scribe-token` mints a single-use token (never cached, valid for 15 minutes) so the browser can transcribe directly without the API key: `{ "token", "model", "websocketUrl", "expiresInSeconds" }`. In the browser, `createTranscriber()` in `apps/web/src/features/intelligence/transcriber.ts` does the rest: `start()` opens the microphone and streams it, `onPartial` reports live text, and `stop()` resolves with the final transcript ("" if nothing was heard). Use `isVoiceInputSupported()` first and keep the text box as the fallback. A transcript can be wrong, so let the child or a grown-up edit it before it is used.

**Speech out.** Both routes take `{ "event": { "id", "revision", "state" }, "previousState" }`, where `state` is the committed world (`pathStatus`, `weather`, `goal`, and `entities` with `id`, `kind`, and `name`) and `previousState` is the world before the event (`null` for the first event). The client sends only those fields.

- `POST /api/reactions/cue` returns `{ "reaction": { "eventId", "text", "emotion" } | null }` instantly, with no provider call. Use it for the caption.
- `POST /api/reactions/speech` returns `{ "reaction", "audio": { "mimeType": "audio/mpeg", "base64" } | null, "audioStatus": "ready" | "unavailable" | "failed" | "none", "error"? }`. A voice failure is not an HTTP error: the caption is still returned with `audio: null`, so the UI can carry on with text. Generated lines are cached in memory.

The reaction is chosen from what the event changed: a bridge that opens the route is `delighted`, a bridge that still does not span the river is `worried`, and a storm cloud that starts rain is `curious`. Resets, most rewinds, and other events return `reaction: null`; a rewind that brings a bridge or cloud back counts as a change and can react. Each emotion uses different wording and voice settings.

**Playing reactions.** `createBrowserReactionPlayer()` in `apps/web/src/features/intelligence/reaction-player.ts` wires the routes to the browser. Call `void player.observe(snapshot.events)` whenever the events change, once the world is connected. The first call only records existing history, so loading or reconnecting never speaks for old events. After that each event is reacted to at most once, remembered across a reload in `sessionStorage`, and only the newest unseen event is spoken. A newer event replaces narration that is still playing. `onCaption` fires as soon as the text is known and `onAudio` reports `playing`, `ended`, `unavailable`, or `failed`.

To try it without the app UI, open [http://localhost:5173/voice-test.html](http://localhost:5173/voice-test.html) (development only).

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
