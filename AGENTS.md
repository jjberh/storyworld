# Storyworld contributor instructions

A child draws a scene, Gemini proposes what it contains, the child confirms it, and the confirmed world lives in SpacetimeDB where others can join and watch it play out. The app must stay fully runnable in fixture mode with no API keys.

## Repo map

- `apps/web`: React + Vite on port 5173. `src/app` is the flow (authoring, scene confirmation, story room), `src/features` holds the canvas and world renderer, `src/services` holds the API and world clients.
- `apps/api`: Fastify on port 3001. `src/routes` are thin; provider logic lives in `src/services` (`gemini.ts`, `scene.ts`, `story-director.ts`, `interaction.ts`).
- `packages/contracts`: Zod schemas for operations, world models, scenes, and story beats. Source of truth for every cross-package shape.
- `packages/world-fixtures`: deterministic fixture data used when no provider key is set.
- `spacetimedb/src/index.ts`: the module (tables and reducers). Has its own `tsconfig.json`.
- `apps/web/src/module_bindings`: generated from the module. Never hand-edit; run `npm run db:generate`.
- `tests/`: Playwright specs and `database-check.ts`. Unit tests sit next to the code as `*.test.ts` (Vitest).

## How a change flows

Drawing → `POST /api/interpret/scene` or `/edit` (Gemini, or fixture without a key) → candidates the child confirms → operations validated by `packages/contracts` → SpacetimeDB reducer (`initializeScene`, `applyOperationCommand`, …) → subscription → renderer. A drawing added mid-story then goes to `POST /api/interactions` (Jev), and its outcome commits as `RESOLVE_INTERACTION`. After a commit, `POST /api/story/sequence` turns the event into one to three presentation beats.

## Architecture rules

- React owns ephemeral UI state; SpacetimeDB owns confirmed shared world state. Do not add a second global store.
- Models only propose typed operations. Nothing from a model writes to the database.
- Reducers validate authorization, revisions, IDs, bounds, and operation shape.
- The renderer changes permanent world state only after a committed database event.
- Without a key, provider routes return deterministic responses labelled `"mode": "fixture"`. With a key, provider failures return a typed error (`PROVIDER_TIMEOUT`, `INVALID_MODEL_OUTPUT`, …) and never fall back to fixture.
- The interaction resolver uses Jev only (`JEV_STORYWORLD_KEY`, server-only). There is no rule table or fixture fallback: without a key the route returns `PROVIDER_NOT_CONFIGURED` and drawings are still added without an outcome. An obstacle across the route is passed only through a committed `RESOLVE_INTERACTION` success: never from a drawing's geometry, and it cannot be removed (rewind and reset still restore earlier states). Guests and models can never propose an outcome.
- A goal is optional. With a character and no goal the world is in free play (`pathStatus: "free_play"`): Jev is asked only what happens (no odds, `odds: null`), and route outcomes never apply.

## Modes

- World mode comes from `?mode=fixture|live`, falling back to `VITE_WORLD_MODE`. Fixture uses an in-memory world client, so `/join` only works across tabs in live mode.
- A room is `/?mode=<mode>&world=<id>`; guests open `/join?mode=live&world=<id>`.
- `/?mode=fixture&fixture=nova` is the retained Nova river-and-bridge fixture used by e2e tests.

## Verify

```bash
npm run typecheck   # also checks spacetimedb/tsconfig.json
npm run lint
npm test
npm run build
npm run test:e2e    # needs the app already running on :5173 (or TEST_BASE_URL)
```

- CI runs typecheck, lint, test, and build only. Run e2e yourself when UI flow changes.
- The live Playwright spec is skipped unless `TEST_LIVE=1`. `npm run test:db` needs a local `spacetime start`.
- Start the app with `npm run dev` or `docker compose up --build --wait`, then check the change at `http://localhost:5173/?mode=fixture`.
- Format with `npm run format`; do not hand-format around Prettier or ESLint.

## Changes that ripple

- A contract change touches the API, the web app, and usually the module. Update all three in the same PR.
- A module schema change requires `npm run db:generate`, and the module and bindings are committed together.
- Keep `.env.example`, package scripts, Docker setup, README, and `docs/FOUNDATION_CHECK.md` consistent with behavior changed in the same PR.

## Git and PRs

- Branch from `main` and open PRs back into `main`.
- Commit and PR titles use an area prefix: `experience:`, `intelligence:`, `world-engine:`, `contracts:`, `scene:`, `docs:`. For example, `experience: play directed story sequences`.
- Contract, module, and binding changes affect teammates. Call them out in the PR description so they can be announced.
- `docs/plans/` holds private notes. It is gitignored; never stage it or link it from public docs.

## SpacetimeDB

Only Josh publishes to the shared Maincloud database `storyworld-zhvbk`. Never publish or run `--delete-data` against it. Live schema changes go: test the module locally, generate bindings, commit module and bindings together, publish that exact commit, then tell teammates to pull.

## Secrets

`VITE_` variables are public browser configuration. Provider keys (`GEMINI_API_KEY`, `JEV_STORYWORLD_KEY`, and `ELEVENLABS_API_KEY` once speech lands) are server-only; never expose them to the web app.
