# AGENTS.md — CubeWizard (root)

Magic: The Gathering cube analytics on **Cloudflare Workers**: deck photos → OpenAI Vision → Scryfall → D1 → static dashboard. License: **GPL-3.0-or-later**.

Human setup and operations: [README.md](README.md).

## Nested agent docs

Cursor merges `AGENTS.md` from the repo root and from directories that contain files you are editing (more specific paths take precedence). Use the doc for the area you are changing:

| Directory | File | Scope |
|-----------|------|--------|
| `src/` | [src/AGENTS.md](src/AGENTS.md) | Site Worker, Hedron consumer, redirect, shared JS |
| `src/pipeline/` | [src/pipeline/AGENTS.md](src/pipeline/AGENTS.md) | Eval consumer pipeline (TypeScript) |
| `docs/` | [docs/AGENTS.md](docs/AGENTS.md) | Static dashboard HTML/CSS/JS |
| `fixtures/` | [fixtures/AGENTS.md](fixtures/AGENTS.md) | Queue contracts and golden regression |
| `migrations/` | [migrations/AGENTS.md](migrations/AGENTS.md) | Hosted D1 schema changes |

## Architecture (one screen)

| Component | Entry | Wrangler |
|-----------|--------|----------|
| Site | `src/worker.js` | `wrangler.jsonc` |
| Eval consumer | `src/pipeline/entry/evalQueueEntry.ts` | `wrangler-eval-consumer.jsonc` |
| Hedron consumer | `src/hedron-consumer.js` | `wrangler-hedron-consumer.jsonc` |
| Redirect (prod) | `src/redirect-worker.js` | `wrangler-redirect.jsonc` |

**Eval:** `EVAL_QUEUE` (orient) → `EVAL_EXTRACT_QUEUE` (extract). Details: [src/pipeline/AGENTS.md](src/pipeline/AGENTS.md).

**Data:** D1 (`schema.sql`, `migrations/`), R2 `decklist-uploads` + `cubewizard-deck-images`.

## Commands (repo-wide)

Node **22**, npm. Before a PR:

```bash
npm ci
npm run test:pipeline
npm run typecheck
npm run lint
npm run wrangler:check
```

| Script | Purpose |
|--------|---------|
| `npm run dev:all` | Local E2E: site + eval + hedron, shared `.wrangler/local-shared` |
| `npm run d1:bootstrap:local` | Apply `schema.sql` to local D1 |
| `npm run golden:eval` | Live OpenAI golden regression |
| `npm run wrangler:check` | Dry-run all Worker bundles |

## Local dev (critical)

1. Copy [`.dev.vars.example`](.dev.vars.example) → `.dev.vars`; set `OPENAI_API_KEY` for eval/golden.
2. `npm run d1:bootstrap:local` once per fresh `.wrangler/local-shared`.
3. **`npm run dev:all` only** — separate `dev` / `dev:eval-consumer` / `dev:hedron-consumer` terminals do **not** share queues locally.
4. Dashboard: http://127.0.0.1:8787

**Never commit** `.dev.vars` or API keys. Hosted eval secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` via `wrangler secret put` (not in repo).

## Git and CI

- PRs target **`staging`**, not `main` (prod promotion is maintainer-driven).
- Do **not** commit or push unless the user asks.
- CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — test, typecheck, lint, wrangler-check.

## Global conventions

- **Biome:** 2 spaces, line width 120, double quotes, semicolons, trailing commas. `npm run lint` on `src/**` and `docs/**/*.js`.
- **New deck-processing logic:** TypeScript under `src/pipeline/`. Site/Hedron stay JS unless asked to migrate.
- **Wrangler dev:** one queue consumer at a time locally (no parallel eval isolates).
- **Dependencies:** justify additions (Worker bundle size / `nodejs_compat` on eval consumer only).

## What to avoid

- Secrets in logs, issues, or committed files.
- Editing `fixtures/eval-golden/scores/baseline.json` without `npm run golden:baseline` and user confirmation.
- Large cross-layer refactors (JS workers + pipeline) in one change without explicit scope.
