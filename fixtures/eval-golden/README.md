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

# Run all cases, write scores/latest.json, print comparison vs baseline

npm run golden:eval



# Promote latest.json → baseline.json (interactive confirmation)

npm run golden:baseline



# Non-interactive promote (CI / scripting)

npm run golden:baseline -- --yes

```



After `golden:eval`, the CLI prints aggregate metrics and a **comparison vs `scores/baseline.json`** (deltas for F1, cost, tokens, per-case F1). Optional env:



| Variable | Default | Effect |

|----------|---------|--------|

| `GOLDEN_MAX_REGRESSION` | `0.02` | Max allowed micro-F1 drop vs baseline (warnings) |

| `GOLDEN_MAX_COST_RATIO` | `1.25` | Max cost ratio vs baseline (warnings) |

| `GOLDEN_MAX_TOKEN_RATIO` | `1.25` | Max token ratio vs baseline (warnings) |

| `GOLDEN_FAIL_ON_REGRESSION` | off | Exit non-zero when tolerance warnings fire |



If `golden:eval` exits immediately with no scores, check the error message: missing `OPENAI_API_KEY` or no valid case folders under `cases/`.



## Scores



| File | Tracked in git | Purpose |

|------|----------------|---------|

| `scores/baseline.json` | yes (via `golden:baseline`) | Reference metrics committed for comparison |

| `scores/baseline.explanation.json` | yes | Documented template + metric glossary (`_commentary`); not loaded by the harness |

| `scores/latest.json` | no | Most recent `golden:eval` run |

| `scores/runs.json` | no | History of all recorded runs |

| `scores/history/*.json` | no | Per-run snapshots |



Metrics per case and in aggregate include precision, recall, F1, count error, false positives/negatives, OpenAI call count, token usage, **estimated USD cost**, and wall-clock duration.



**Cost:** Before cases run, the harness loads rates from `data/model-pricing.csv` (no live fetch). Costs are estimated as `(input_tokens × input_rate + output_tokens × output_rate) / 1e6`. Regenerate the CSV with `node scripts/sync-ai-gateway-pricing-csv.mjs`, or override with `GOLDEN_EVAL_USD_PER_1M_INPUT` and `GOLDEN_EVAL_USD_PER_1M_OUTPUT` in `.dev.vars`.

