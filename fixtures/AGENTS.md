# AGENTS.md — `fixtures/`

Non-production test data and **frozen contracts** for the eval pipeline. Not deployed; consumed by Vitest, golden harness, and documentation.

| Subdirectory | Doc | Purpose |
|--------------|-----|---------|
| `pipeline/` | [pipeline/AGENTS.md](pipeline/AGENTS.md) | JSON Schema + example queue messages |
| `eval-golden/` | [eval-golden/AGENTS.md](eval-golden/AGENTS.md) | Deck photo regression set + scores |

Implementation of contracts: `src/pipeline/contracts/`. Runtime behavior: [../src/pipeline/AGENTS.md](../src/pipeline/AGENTS.md).

## Rules

- **Commit** schema, examples, golden cases, and `eval-golden/scores/baseline.json` (after deliberate baseline promotion).
- **Do not commit** `eval-golden/scores/latest.json`, `runs.json`, or `scores/history/` (gitignored).
- Keep Zod (`src/pipeline/contracts/*.zod.ts`) and `fixtures/pipeline/*.schema.json` in sync when changing queue payloads.
