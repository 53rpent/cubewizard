# AGENTS.md — `docs/` (static dashboard)

Static site served by the site Worker via Wrangler **assets** (`wrangler.jsonc` → `directory: "./docs/"`, binding `ASSETS`). No build step — HTML/CSS/JS committed as-is.

API and auth live in [../src/AGENTS.md](../src/AGENTS.md). Root index: [../AGENTS.md](../AGENTS.md).

## Page map

| File | Purpose |
|------|---------|
| `index.html` | Landing / cube picker |
| `decks.html` + `decks-main.js` | Deck grid, processing poll, Hedron sync UI, deck modal |
| `submit.html` | Upload flow |
| `add_cube.html` | Register cube |
| `analysis-card.html`, `analysis-color.html`, `analysis-synergy.html` | Analytics views |
| `resources.html`, `resources-pilot-search.html` | Resources + pilot search |
| `CubeWizard.png` | Logo asset |

Shared chrome: `site-header.css`, `site-nav.js`, `site-footer.js`, `analysis-shared.css`, `analysis-shared.js`.

## Client-side routing (`cw-paths.js`)

IIFE attached to `global` — **must load before** pages that depend on cube URLs.

- Pretty paths: `/{cubeId}`, `/{cubeId}/decks`, `/cards`, `/colors`, `/synergies`.
- `RESERVED_FIRST` — segments that are **not** cube ids (`submit`, `api`, `decks`, `analysis`, …).
- `normalizeCubeId` — `[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}`; rejects reserved names.
- `safeAppPath` — blocks open redirects (`//`, schemes, control chars).

`worker.js` mirrors pretty URLs server-side via `mapPrettyUrlToAsset` — **keep worker mapping and `cw-paths.js` in sync** when adding routes.

Legacy `/analysis/...` URLs may redirect client-side; check `legacyAnalysisToDataViewRedirect` in worker if changing analysis URLs.

## Shared JS utilities

| File | Role |
|------|------|
| `cw-html.js` | `CWHtml.escapeHtmlAttr` / `escapeHtmlText` — use for any user/API-derived HTML |
| `card-tooltip.js` + `card-tooltip.css` | Card hover tooltips (Scryfall-style data from API) |
| `cw-paths.js` | URL builders and parsers |

`decks-main.js` polls `/api/processing-decks/:cubeId` while uploads run; uses `CWPaths` and `CWHtml`. Hedron sync POSTs `/api/hedron-sync/:cubeId`.

## API usage from the browser

All calls are same-origin relative `/api/...` (Worker). Typical endpoints:

- `GET /api/cubes`, `/api/decks/:cubeId`, `/api/deck/:deckId`
- `GET /api/processing-decks/:cubeId`
- `POST /api/upload` (multipart), `POST /api/hedron-sync/:cubeId`
- Deck images: `/api/deck/:id/photo`, `/thumb`

No API keys in frontend code. Turnstile widget on upload when not `CWW_ENV=local`.

## Conventions

- **Vanilla JS** — IIFEs, `var`/`function` style matches existing pages.
- **Biome** lints `docs/**/*.js` — run `npm run lint` after JS edits.
- **No framework** — do not introduce React/Vue without explicit request.
- **XSS:** always escape dynamic strings via `CWHtml` before `innerHTML` or attribute insertion.
- **CSS:** page-specific files plus `analysis-shared.css`; avoid huge global rewrites.

## Adding a new page

1. Add `something.html` under `docs/`.
2. If it needs a clean URL, extend `cw-paths.js` and `mapPrettyUrlToAsset` in `worker.js`.
3. Include shared header/nav/footer patterns from sibling pages.
4. Load `cw-paths.js` (and `cw-html.js` if rendering API data) in script order.

## Testing

No automated tests for `docs/`. Verify manually with `npm run dev:all` → http://127.0.0.1:8787.

## Assets and caching

Static files served through Worker assets binding. Cache behavior follows Cloudflare defaults; bump cache-busting query params on script/css if needed (follow existing pages).
