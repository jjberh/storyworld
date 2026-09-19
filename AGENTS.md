# Storyworld contributor instructions

## Current scope

This repository is the foundation for the Storyworld hackathon project. The stable foundation must remain runnable in fixture mode without provider keys. Gemini interpretation, ElevenLabs speech, QR generation, and richer animation are implementation work after teammate onboarding.

## Start and verify

Use Node 24. The easiest development path is:

```powershell
docker compose up --build --wait
```

Open `http://localhost:5173/?mode=fixture`. Native development is also supported with `npm ci` followed by `npm run dev`.

Before opening a pull request, run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

## Architecture rules

- React owns ephemeral UI state; SpacetimeDB owns confirmed shared world state.
- Gemini may propose typed operations. It never writes directly to the database.
- SpacetimeDB reducers validate authorization, revisions, IDs, bounds, and operation shape.
- The renderer changes permanent world state only after a committed database event.
- `packages/contracts` is the source of truth for operations and world models.
- Generated files in `apps/web/src/module_bindings` are committed and must be regenerated with `npm run db:generate` whenever the module schema changes.
- Do not add a second global state store unless the team agrees first.

## Ownership and branches

After the foundation checkpoint, use one branch per area:

- `feat/experience`: `apps/web/src/app`, `features/canvas`, `features/world-renderer`, `features/collaboration`, `features/timeline`, and styles.
- `feat/intelligence-audio`: `apps/api/src/routes`, `apps/api/src/services`, narration, reactions, prompts, and provider fallbacks.
- `feat/world-engine`: `spacetimedb`, database client adapter, bindings, and simulation changes.

Do not edit another owner's area casually. Shared changes to `packages/contracts`, root scripts, Docker, or generated bindings require a short team message first. Keep commits small and centered on one behavior.

## SpacetimeDB

Only Josh publishes the shared Maincloud module. Teammates connect to Maincloud for integration and use fixture mode while building independently. Never use `--delete-data` against `storyworld-zhvbk` without explicitly checking the target and agreeing with the team.

Live database changes must follow this order:

1. Test the module locally.
2. Generate bindings.
3. Commit the module and bindings together.
4. Publish that exact commit to Maincloud.
5. Tell teammates to pull the commit before testing live mode.

## Secrets

`.env` is local and ignored. Never commit it. `VITE_` variables are public browser configuration; Gemini and ElevenLabs keys are server-only variables read by Fastify. Use separate development keys where possible and rotate any key that appears in logs or chat.

## Product constraints

Preserve the golden causal loop: Nova is blocked by a river, a bridge opens the route, and a committed world event produces a visible consequence. Keep the UI legible to a judge who has not seen the code. Prefer a reliable bounded rule over a broad but inconsistent general-purpose simulator.
