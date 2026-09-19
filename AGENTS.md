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

## Model selection

- Use GPT-5.6 Luna with medium reasoning for repository inspection, straightforward documentation, small fixes, and routine test updates.
- Use GPT-5.6 Terra with medium reasoning as the default for normal implementation, feature work, integration, and debugging.
- Use GPT-6 Astra with medium reasoning only for genuinely ambiguous architecture, cross-team contract decisions, difficult multi-system debugging, or a final high-risk review.
- Keep reasoning set to medium for all models in this project. Do not use low, high, xhigh, max, or ultra reasoning by default.
- Prefer the least capable model that can safely handle the task, and escalate models only when the task's complexity or risk justifies it.

## Architecture rules

- React owns ephemeral UI state; SpacetimeDB owns confirmed shared world state.
- Gemini may propose typed operations. It never writes directly to the database.
- SpacetimeDB reducers validate authorization, revisions, IDs, bounds, and operation shape.
- The renderer changes permanent world state only after a committed database event.
- `packages/contracts` is the source of truth for operations and world models.
- Generated files in `apps/web/src/module_bindings` are committed and must be regenerated with `npm run db:generate` whenever the module schema changes.
- Do not add a second global state store unless the team agrees first.

## Documentation and code conventions

- Keep documentation current as part of the implementation. When behavior, setup, environment variables, architecture, routes, contracts, demo steps, or ownership changes, update the relevant public documentation in the same PR. Do not leave README instructions, `FOUNDATION_CHECK.md`, or examples describing removed behavior.
- Keep comments focused on intent, constraints, invariants, and non-obvious tradeoffs. Update or remove comments when the code changes; never preserve a stale comment just because it was already there. Do not add comments that merely restate the next line of code.
- Follow the existing TypeScript, React, Fastify, SpacetimeDB, naming, formatting, and error-handling patterns before introducing a new convention. Run Prettier and ESLint rather than hand-formatting around them.
- Keep `.env.example`, package scripts, Docker instructions, generated bindings, tests, and docs consistent with one another. If a change affects one of these surfaces, check the related surfaces before opening the PR.
- Treat the public README and root `AGENTS.md` as committed project documentation. The private `docs/plans/` handoff notes remain ignored and must not be linked from public docs.

## Ownership and branches

After the foundation checkpoint, use one branch per area:

- `feat/experience`: `apps/web/src/app`, `features/canvas`, `features/world-renderer`, `features/collaboration`, `features/timeline`, and styles.
- `feat/intelligence-audio`: `apps/api/src/routes`, `apps/api/src/services`, narration, reactions, prompts, and provider fallbacks.
- `feat/world-engine`: `spacetimedb`, database client adapter, bindings, and simulation changes.

Do not edit another owner's area casually. Shared changes to `packages/contracts`, root scripts, Docker, or generated bindings require a short team message first. Keep commits small and centered on one behavior.

Josh is also the flex and integration engineer after the first world-engine milestones land. When helping another area, the area owner still decides the interface and reviews the work. Josh should branch from the owner's latest remote branch, claim a bounded slice and its files in team chat, and open the pull request back into that owner's branch. Do not have two people edit the same file at the same time.

## Pull request convention

The individual implementation plans in `docs/plans/` are local handoff notes. That directory is ignored by Git and must never be staged, committed, linked from public project documentation, or included in a pull request. Teammates may keep a privately shared copy in that location for their AI agents. Open a pull request when the current plan milestone is demonstrably complete; do not wait for the entire area to be finished. If a local plan is unavailable, agree on the observable PR goal in team chat before starting.

- Primary branches are `feat/experience`, `feat/intelligence-audio`, and `feat/world-engine`.
- A helper branch is named `<area-branch>-<person>-<slice>`, for example `feat/experience-josh-guest-flow`, and targets the area branch rather than `main`.
- Title PRs as `<area>: <result>`, such as `audio: react to committed world events`.
- Keep one observable outcome per PR. Include a short before/after description, changed contracts, validation run, manual demo steps, and known limitations.
- Draft PRs are encouraged for early integration feedback. Remove draft status only when the PR milestone and its required checks pass.
- The area owner reviews helper PRs. Josh reviews shared contracts, SpacetimeDB changes, generated bindings, root configuration, and final integration PRs.
- Merge shared contract changes first. The author must announce the change, regenerate bindings when required, and tell teammates when to update their branches.
- Prefer normal merges from `main` into active shared branches. Do not force-push or rewrite a branch another teammate is using.
- Before merging to `main`, run `npm run typecheck`, `npm run lint`, `npm test`, and any area-specific checks from the privately shared plan or team handoff. Record any skipped check in the PR.
- Never merge a broken intermediate state into `main`. During the final feature freeze, fixes require a reproducible failure or a direct improvement to the rehearsed demo.

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
