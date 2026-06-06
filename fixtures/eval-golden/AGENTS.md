# AGENTS.md — `fixtures/eval-golden/`

Vision pipeline **regression suite**: real deck photos + expected card name lists. Runs the full eval consumer (orient + extract) with **live OpenAI** — not part of default CI unit tests.

Full human guide: [README.md](README.md). Harness code: `src/pipeline/golden/`. Parent: [../AGENTS.md](../AGENTS.md).

## Layout

```
eval-golden/
├── cases/
│   └── {CaseName}/
│       ├── image.jpg|png|webp|heic   # required
│       └── expected.json             # required
├── cases/_template/                  # copy for new cases (ignored: names starting with _)
├── data/model-pricing.csv  # AI Gateway model token costs (regenerate: node scripts/sync-ai-gateway-pricing-csv.mjs)
└── scores/
    ├── baseline.json                 # committed reference (promote via golden:baseline)
    ├── baseline.explanation.json     # glossary only
    ├── latest.json                   # gitignored — last run
    └── history/                      # gitignored
```

## `expected.json`

| Field | Required | Notes |
|-------|----------|--------|
| `expected_card_names` | yes | Scryfall-style names after extraction |
| `expected_count` | no | Defaults to name list length |
| `cube_id` | no | Enables CubeCobra list + multi-pass (production parity) |
| `description`, `tags` | no | Reporting only |

## Commands

```bash
# Requires OPENAI_API_KEY in .dev.vars or env
npm run golden:eval

# Promote latest → baseline (interactive; --yes for CI)
npm run golden:baseline
```

Harness flow (`runViaEvalConsumer.ts`):

1. Stage case on in-memory R2 (production-shaped keys).
2. Call `evalQueueEntry.queue` for orient queue, then inline extract queue (mirrors production handoff).
3. Read `processing_jobs.result_json` / `eval_report` for metrics.

Vitest config: `vitest.golden.config.ts` (no timeout — slow).

## Scores and tolerances

After `golden:eval`, CLI compares `scores/latest.json` to `scores/baseline.json` (micro-F1, cost, tokens).

Optional env:

| Variable | Default | Effect |
|----------|---------|--------|
| `GOLDEN_MAX_REGRESSION` | `0.02` | Warn if F1 drops more than this vs baseline |
| `GOLDEN_MAX_COST_RATIO` | `1.25` | Warn on cost regression |
| `GOLDEN_MAX_TOKEN_RATIO` | `1.25` | Warn on token regression |
| `GOLDEN_FAIL_ON_REGRESSION` | off | Exit non-zero on warnings |
| `GOLDEN_EVAL_USD_PER_1M_INPUT/OUTPUT` | — | Override pricing CSV in `.dev.vars` |

## Agent rules

- **Do not** add cases or run `golden:eval` unless the user asks or the task is vision regression.
- **Do not** edit `scores/baseline.json` manually — use `npm run golden:baseline` after user confirms metrics.
- New case: copy `_template`, add image + `expected.json`, run eval, then baseline promotion when approved.
- `scripts/rotate-golden-case-images.ts` — utility to rotate case photos (`npm run golden:rotate-cases`).

## When to update baseline

Vision prompt changes, model id changes in wrangler, or intentional accuracy/cost tradeoffs that maintainers accept. Always review per-case F1 deltas in CLI output before `--yes` baseline.
