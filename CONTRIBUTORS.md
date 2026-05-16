# Contributors

CubeWizard is free software under the [GNU General Public License v3.0 or later](LICENSE).

## Copyright

Copyright © 2026 CubeWizard contributors.

## Branches and releases

| Branch | Role |
|--------|------|
| **`staging`** | Integration branch. All contributor PRs merge here. Pushes deploy the **staging** Cloudflare stack via GitHub Actions (`deploy-cloudflare-stg.yml`). |
| **`main`** | Production branch. Updated when maintainers **promote** `staging` to production (merge or PR from `staging` → `main`). Pushes deploy **production** (`--env prod`). |

Contributors do not open PRs directly against `main` unless a maintainer asks for a hotfix exception.

## Contributing

1. Branch from **`staging`**: `git fetch origin`, `git checkout staging`, `git pull`.
2. Open a pull request **into `staging`** (not `main`).
3. Keep changes focused; match existing style in `src/worker.js` and `src/pipeline/`.
4. Run `npm run test:pipeline` and `npm run wrangler:check` before requesting review.
5. Do not commit secrets (`.dev.vars`, `.env`, API keys). Use `.dev.vars.example` as a template.

After your PR merges to `staging`, it will ship to the staging environment on the next deploy. Production is updated separately when maintainers promote `staging` to `main`.

## Maintainer notes

- **Promote to production:** merge `staging` into `main` (via PR or direct merge) when staging is validated; CI on `main` deploys prod Workers and related services.
- **Production path:** Cloudflare Workers, D1, R2, and Queues (`EVAL_QUEUE`, `HEDRON_QUEUE`). See [README.md](README.md).
- **CI/CD:** `.github/workflows/ci.yml` on PRs; Cloudflare deploy workflows on `staging` / `main` (see [README.md](README.md#github-actions)).

## Third-party assets

- WebP WASM binaries under `vendor/jsquash-webp/` come from [@jsquash/webp](https://www.npmjs.com/package/@jsquash/webp) (Apache-2.0). Refresh steps are in [README.md](README.md#webp-wasm-vendor).
