# AGENTS.md

## Cursor Cloud specific instructions

### Architecture Overview

CubeWizard is a Magic: The Gathering Cube Analytics Platform with three main components:

1. **Cloudflare Worker** (`src/worker.js`) — serves the static SPA frontend (`docs/`) and analytics API endpoints backed by D1 (SQLite)
2. **GCP Cloud Run — enqueue** (`services/enqueue/app.py`) — FastAPI service receiving upload notifications
3. **GCP Cloud Run — worker** (`services/worker/app.py`) — FastAPI service processing deck images via OpenAI Vision

### Running the Cloudflare Worker Locally

```bash
npx wrangler dev --local --port 8787
```

- The `--local` flag is **required** in Cloud Agent VMs (no Cloudflare OAuth available). It emulates D1, R2, and Assets locally.
- Seed the local D1 database before testing: `npx wrangler d1 execute cubewizard-db --local --file=./schema.sql`
- Local D1 state persists in `.wrangler/state/v3/d1/`.
- The `add-cube` and `upload` endpoints require Turnstile verification; to add test data locally, insert directly via `npx wrangler d1 execute cubewizard-db --local --command "..."`.

### Running GCP FastAPI Services Locally

```bash
source .venv/bin/activate
uvicorn services.enqueue.app:app --host 127.0.0.1 --port 8090
uvicorn services.worker.app:app --host 127.0.0.1 --port 8091
```

The worker service imports from repo-root Python modules (`main.py`, `image_processor.py`, etc.), so run from the workspace root.

### Lint / Syntax Checking

No formal linting framework is configured. Use:
- `python3 -m py_compile <file.py>` for Python syntax checks
- `node --check <file.js>` for JavaScript syntax checks

### Key Gotchas

- The `wrangler.jsonc` D1 binding has `"remote": true` — this is for production/staging deploys only. Always pass `--local` for local dev.
- `package.json` has a minimal footprint (only `openssl` as dependency, `wrangler` as devDependency). No build step or bundler is needed.
- The frontend in `docs/` is plain HTML/CSS/JS with no build process; changes are served directly by wrangler dev.
- Python venv is at `.venv/` — activate with `source .venv/bin/activate`.
