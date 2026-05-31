# AGENTS.md — `src/pipeline/` (eval consumer)

TypeScript eval pipeline: **orient** then **extract**, invoked from Cloudflare Queues. Entry: `entry/evalQueueEntry.ts` → `wrangler-eval-consumer.jsonc` (`nodejs_compat`, `enable_nodejs_process_v2`).

Workers overview: [../AGENTS.md](../AGENTS.md). Queue JSON contracts: [../../fixtures/pipeline/AGENTS.md](../../fixtures/pipeline/AGENTS.md). Golden regression: [../../fixtures/eval-golden/AGENTS.md](../../fixtures/eval-golden/AGENTS.md).

## Phase flow

```
EVAL_QUEUE message (schema v1 TaskRequest)
  → runOrientTask
      load staging (R2 metadata+image or image_url)
      orientDeckImageRgba + OpenAI confirm
      upload oriented JPEG → cubewizard-deck-images
      EVAL_EXTRACT_QUEUE.send (schema v2 ExtractTaskRequest)

EVAL_EXTRACT_QUEUE message
  → runExtractTask
      decode oriented JPEG → RGBA
      extractCardNamesFromRgba (OpenAI, optional CubeCobra list)
      upload WebP thumb, release RGBA
      Scryfall enrich → executeDeckWritePlan → markJobDone
```

Routing: `orchestrator/evalQueueRouting.ts` (`shouldRunExtractPhase`). Queue handler: `entry/evalQueueEntry.ts` (retry, DLQ, `PermanentEvalError`, `ModelOutputInvalidError`).

## Tooling

| Command | Scope |
|---------|--------|
| `npm run typecheck` | `tsconfig.pipeline.json` — this tree only |
| `npm run test:pipeline` | `**/*.test.ts` except `goldenEval.harness.test.ts` |
| `npm run test:pipeline:watch` | Watch mode |
| `npm run golden:eval` | `golden/goldenEval.harness.test.ts` (live OpenAI) |

Vitest WASM: `vitest.config.ts` plugin precompiles `vendor/jsquash-webp/*.wasm` for Node.

## Cross-cutting rules

- **Strict TS**, Zod at queue boundaries, colocated `*.test.ts`.
- **Errors:** `PermanentEvalError` → ack + `processing_jobs.failed`. Transient → `message.retry()` with backoff in `evalQueueEntry.ts`.
- **Logging:** `util/evalConsumerLog.ts` — JSON lines with `"log":"eval_consumer"`. No secrets or raw image bytes.
- **Memory:** 128 MiB isolate limit. `images/decodeLimits.ts` guards RGBA budget; staging downscale happens in site/Hedron (`normalizeStagingImage`). Probe: `util/evalMemoryProbe.ts` + `CW_EVAL_MEMORY_LOG`.
- **Scryfall:** `scryfall/globalThrottle.ts` — `CW_EVAL_MAX_CONSUMERS` must match wrangler `max_concurrency`.
- **Vision input:** `evalEnv/isLocalEvalEnv.ts` — local uses inline JPEG base64; hosted uses presigned R2 GET (`r2/presignedGetUrl.ts`, needs R2 API token secrets).

---

## `entry/`

`evalQueueEntry.ts` — default export `{ queue(batch, env) }`.

- Resets module globals per message (`evalUsage`, memory probes, log context).
- Configures Scryfall throttle from `CW_EVAL_MAX_CONSUMERS` (not on DLQ handler).
- DLQ queues: `failEvalJobFromQueue` + ack.
- Warns if `batch.messages.length > 1` (expect `max_batch_size: 1`).

---

## `orchestrator/`

| Module | Responsibility |
|--------|----------------|
| `runOrientTask.ts` | Phase 1: validate TaskRequest, read staging, orient, upload JPEG, enqueue extract |
| `runExtractTask.ts` | Phase 2: decode, extract, thumb, Scryfall, D1 write, `markJobDone` |
| `evalTaskShared.ts` | Staging read (`readStagingPackage`), config (`resolveEvalPipelineConfig`), metadata |
| `processingJobRepo.ts` | D1 `processing_jobs` — **keep SQL aligned with `processingJobsD1.js`** |
| `jobId.ts` | `processingJobDocIdFromUploadId` |
| `uploadOriented.ts` | R2 keys for oriented JPEG + thumb |
| `evalQueueRouting.ts` | Orient vs extract queue detection |
| `evalQueueRetries.ts` | Max retries, DLQ queue name helpers |
| `failEvalJobFromQueue.ts` | Mark failed from queue/DLQ |
| `safeMarkJobFailed.ts` | Best-effort failure write |
| `evalConsumerScale.ts` | Parse `CW_EVAL_MAX_CONSUMERS` |
| `evalImageLimits.ts` | Max image side parsing (`CW_EVAL_MAX_IMAGE_SIDE`) |
| `evalErrors.ts` | `PermanentEvalError` |
| `hedronSyncedDeckRepo.ts` | Hedron dedup table updates after successful extract |
| `runEvalTask.ts` | `RunEvalTaskEnv` type + re-exports |

`RunEvalTaskEnv` includes: `cubewizard_db`, `BUCKET`, `DECK_IMAGES_BLOB`, `EVAL_EXTRACT_QUEUE`, OpenAI/R2 env vars.

---

## `contracts/`

- `taskRequest.zod.ts` — phase-1 queue body; XOR `(r2_bucket + r2_prefix)` vs `image_url`.
- `extractTaskRequest.zod.ts` — phase-2; `schema_version: 2`, requires `oriented_image_r2_key`, `image_id`, etc.

**Any contract change:** update matching file under `fixtures/pipeline/` and examples.

---

## `openai/`

| Module | Role |
|--------|------|
| `responsesApi.ts` | OpenAI Responses API, structured JSON output, `ModelOutputInvalidError`, log levels |
| `extractCardNames.ts` | Multi-pass extraction, cube list suffix, JPEG resize for vision |
| `prompts.ts` | Developer/user prompt strings |
| `jsonSchemas.ts` | API JSON schema payloads |
| `schemas.ts` | Zod result types (`CardExtractionResult`, orientation types) |

Config: `OPENAI_VISION_MODEL`, `OPENAI_MAX_OUTPUT_TOKENS`, `OPENAI_REASONING_EFFORT`, `CW_EVAL_USE_MULTI_PASS`, `CW_EVAL_LOG_LEVEL` (`off|low|medium|high`).

**AI Gateway (default):** `OPENAI_BASE_URL` in `wrangler-eval-consumer.jsonc` points at Cloudflare AI Gateway (`cubewizard`). Local, staging, and production share the same URL for parity. `config/resolveOpenAiBaseUrl.ts` builds `/responses` and adds `cf-aig-*` retry/timeout headers when the base host is `gateway.ai.cloudflare.com`. Opt out locally: `OPENAI_BASE_URL=https://api.openai.com/v1` in `.dev.vars`. Optional `OPENAI_GATEWAY_TOKEN` when Authenticated Gateway is enabled.

API key: `config/resolveOpenAiApiKey.ts` — `env.OPENAI_API_KEY` secret (Bearer forwarded by the gateway).

Token accounting: `evalUsage/evalUsageReport.ts` — reporter attached during extract; logged as `eval_usage_report`.

---

## `images/`

Decode/encode pipeline for eval (not staging — staging is `normalizeStagingImage.ts` used by site/Hedron).

| Module | Role |
|--------|------|
| `decode.ts` | JPEG/PNG/WebP/HEIC → RGBA; uses `decodeLimits` |
| `decodeLimits.ts` | `MAX_RGBA_BYTES`, `assertDecodeBudget` |
| `encode.ts` | JPEG encode for vision/orient |
| `transform.ts` | Resize, rotate helpers |
| `jsquashWebpInit.ts` | WASM init for WebP |
| `visionPublish.ts` | Hosted: upload temp vision asset, presigned URL |
| `visionImageInput.ts` | Build vision payload (local vs URL) |
| `normalizeStagingImage.ts` | **Cloudflare Images** resize before R2 (site/Hedron) |
| `readImageDimensions.ts` | Sniff dimensions without full decode when possible |
| `heic.ts` | HEIC via libheif-js |
| `base64.ts`, `sniff.ts`, `compatible.ts` | Utilities |

WebP thumbs: `r2/thumbWebp.ts`. Vendor WASM: `vendor/jsquash-webp/` (see root README).

---

## `orientation/`

- `orientDeckImage.ts` — pick best rotation from RGBA (OpenAI scoring).
- `orientExtractVerify.ts` — post-orient sanity checks.

Orient uses OpenAI; extract runs on oriented JPEG loaded from R2.

---

## `scryfall/`

- `client.ts` — collection POST (batches ≤75), fuzzy fallback, 429 retry; used by eval and mirrored conceptually in `worker.js` for PUT deck cards.
- `globalThrottle.ts` — isolate-wide spacing ~10 req/s account budget across concurrent consumers.
- `types.ts` — `EnrichedDeckCardRow`, map Scryfall JSON → D1 row shape.

Always call through `createEvalScryfallClient()` so throttle applies.

---

## `d1/`

- `types.ts` — `DeckPayload`, `DeckCardRow`, write plan types.
- `deckWriteBatches.ts` — SQL statements for insert deck / cards / stats.
- `executeDeckWritePlan.ts` — `db.batch` orchestration, duplicate detection by `image_id`.
- `imageId.ts` — stable id from upload/orient metadata.
- `storedPath.ts` — legacy stored path helpers.

Schema source of truth: `schema.sql` + `migrations/`. See [../../migrations/AGENTS.md](../../migrations/AGENTS.md).

---

## `r2/`

- `orientedKeys.ts` — key layout under `cubewizard-deck-images`.
- `presignedGetUrl.ts` — S3-compatible presigned GET for OpenAI (hosted).
- `thumbWebp.ts` — thumbnail upload after extract.

Staging bucket keys: producer writes under `decklist-uploads` prefix from `upload_id`.

---

## `cards/` + `cubecobra/`

- `cubecobra/fetchCubeList.ts` — mainboard names for cube-constrained extraction.
- `normalizeToCubeList.ts` — align extracted names to cube list.
- `augmentCubeList.ts` — list augmentation for prompts.

Controlled by `CW_EVAL_MAX_CUBECOBRA_CARDS`, `CW_EVAL_USE_MULTI_PASS`.

---

## `golden/`

Regression harness (live OpenAI):

- `runViaEvalConsumer.ts` — stage case on mock R2, invoke `evalQueueEntry` inline for orient+extract queues.
- `runGoldenEvalCli.ts` / `runGoldenBaselineCli.ts` — npm script entrypoints.
- `loadEvalConsumerEnv.ts`, `sqliteD1.ts`, `mockR2.ts` — in-memory test env.
- `compareToBaseline.ts`, `metrics.ts`, `scoresStore.ts` — F1/cost comparison.

Do not run `golden:eval` or commit `scores/baseline.json` unless the task requires it.

---

## `util/`

- `evalConsumerLog.ts` — structured logging + optional memory fields.
- `evalMemoryProbe.ts` — `est_rgba_mb`, heap when Node available.
- `formatEvalError.ts`, `queueMessageBody.ts` — parse queue JSON.
- `runPool.ts` — bounded concurrency helper.

---

## `config/`

`resolveOpenAiApiKey.ts` — fail fast if secret missing in eval.

---

## Debugging failed jobs

1. D1: `processing_jobs` (`status`, `error`, `result_json` with `eval_report` when done).
2. Logs: `wrangler tail` on eval worker, filter `eval_consumer`.
3. OOM: `likely_memory_limit`, Error 1102 — lower `CW_EVAL_MAX_IMAGE_SIDE`, verify staging normalize ran.

---

## Checklist for pipeline changes

1. Orient vs extract vs shared module.
2. Zod + `fixtures/pipeline` if message shape changes.
3. `*.test.ts` + `npm run test:pipeline` + `npm run typecheck`.
4. If `processing_jobs` SQL changes → `processingJobsD1.js` + migration.
5. Vision behavior change → tell user about `npm run golden:eval`.
