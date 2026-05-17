# Eval golden set

Deck photos with known-correct card name lists for regression-testing the vision pipeline (orientation + extraction).

## Layout

Each case is a folder under `cases/`:

```
cases/
  my-deck-photo-01/
    image.jpg          # required — .jpg, .jpeg, .png, .webp, or .heic
    expected.json      # required — ground truth (see below)
  another-case/
    image.png
    expected.json
```

Copy `cases/_template/` when adding a new case. Folders whose names start with `_` are ignored.

## `expected.json`

| Field | Required | Description |
|-------|----------|-------------|
| `expected_card_names` | yes | Exact card names as they should appear after extraction (Scryfall-style spelling). |
| `expected_count` | no | Physical card count; defaults to `expected_card_names.length`. Used for count-error metrics. |
| `cube_id` | no | CubeCobra id — when set, the runner fetches the cube list and enables multi-pass extraction (same as production). |
| `description` | no | Human note for score reports. |
| `tags` | no | Labels for filtering (e.g. `glare`, `dense`, `rotated`). |

## Running

Requires `OPENAI_API_KEY` (from `.dev.vars` or the environment).

The harness does **not** call OpenAI directly. For each case it:

1. Stages the photo + `metadata.json` on an in-memory R2 bucket (same shape as a real upload).
2. Invokes the **eval queue consumer** ([`evalQueueEntry.ts`](../../src/pipeline/entry/evalQueueEntry.ts) → [`runEvalTask`](../../src/pipeline/orchestrator/runEvalTask.ts)).
3. Reads `eval_report` from `processing_jobs.result_json` (token usage, extracted card names).

Token usage is recorded inside the consumer ([`evalUsageReport.ts`](../../src/pipeline/evalUsage/evalUsageReport.ts)) and logged as `eval_usage_report` JSON.

```bash
# Run all cases (eval consumer → scores/). Requires OPENAI_API_KEY in .dev.vars
npm run golden:eval

# Save aggregate metrics as the committed baseline (after you trust a run)
npm run golden:baseline

# Compare live run to baseline (Vitest; set GOLDEN_EVAL_RUN=1)
$env:GOLDEN_EVAL_RUN="1"
npm run golden:regression
```

PowerShell baseline:

```powershell
$env:GOLDEN_EVAL_WRITE_BASELINE = "1"
npm run golden:eval
```

If `golden:eval` exits immediately with no scores, check the error message: missing `OPENAI_API_KEY` or no valid case folders under `cases/`.

## Scores

| File | Tracked in git | Purpose |
|------|----------------|---------|
| `scores/baseline.json` | yes (you create via `golden:baseline`) | Reference metrics for regression tests |
| `scores/baseline.explanation.json` | yes | Documented template + metric glossary (`_commentary`); not loaded by the harness |
| `scores/latest.json` | no | Most recent `golden:eval` run |
| `scores/runs.json` | no | History of all recorded runs |
| `scores/history/*.json` | no | Per-run snapshots |

Metrics per case and in aggregate include precision, recall, F1, count error, false positives/negatives, OpenAI call count, token usage, **estimated USD cost**, and wall-clock duration.

**Cost:** Before cases run, the harness loads Standard-tier rates from `data/openai-standard-pricing.csv` (no live fetch). Costs are estimated as `(input_tokens × input_rate + output_tokens × output_rate) / 1e6`. Update the CSV when OpenAI changes list prices, or override with `GOLDEN_EVAL_USD_PER_1M_INPUT` and `GOLDEN_EVAL_USD_PER_1M_OUTPUT` in `.dev.vars`.
