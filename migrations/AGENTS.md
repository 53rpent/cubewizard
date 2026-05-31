# AGENTS.md — `migrations/`

Incremental **hosted D1** SQL. Local dev typically bootstraps from full [`schema.sql`](../schema.sql) via `npm run d1:bootstrap:local` — migrations are still required for staging/production parity.

Types and writers: `src/pipeline/d1/`, `src/worker.js`, `src/processingJobsD1.js`. Parent: [../AGENTS.md](../AGENTS.md).

## Existing migrations (apply in order)

| File | Purpose |
|------|---------|
| `001_add_auto_sync_hedron_network.sql` | `cubes.auto_sync_hedron_network` |
| `002_add_hedron_synced_decks.sql` | Hedron dedup staging table |
| `003_add_hedron_sync_state.sql` | Hedron sync cursor state |
| `004_processing_jobs.sql` | `processing_jobs` + indexes for upload/eval status |

## Adding a migration

1. **Next number** — `00N_descriptive_name.sql` (never renumber applied migrations).
2. **Idempotent where practical** — `CREATE TABLE IF NOT EXISTS`, careful `ALTER` (SQLite/D1 limits).
3. **Update `schema.sql`** — local bootstrap must match hosted end state.
4. **Update code** — TypeScript `d1/types.ts`, pipeline repos, `worker.js` SQL, `processingJobsD1.js` as needed.
5. **Apply on hosted** — maintainer runs `wrangler d1 execute` against `cubewizard-db-stg` / prod (not automated in CI for agents).

## D1 / SQLite constraints

- Prefer additive changes (new columns with defaults) over destructive alters.
- Avoid in-place type changes; pattern: add column → backfill → drop old in later migration.
- Index names: follow `idx_{table}_{columns}` style in existing files.

## `processing_jobs` id convention

Documented in `004_processing_jobs.sql`: `id` = `u_` + url-safe base64(`upload_id`). Logic duplicated in:

- `src/pipeline/orchestrator/jobId.ts`
- `src/processingJobsD1.js`

Keep all three aligned if the formula changes.

## Agent checklist

- [ ] Migration file + `schema.sql`
- [ ] Pipeline/worker SQL updated
- [ ] Tests if write/read paths change
- [ ] Do **not** run production D1 execute unless user explicitly requests and provides environment
