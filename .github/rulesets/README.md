# Branch rulesets (infrastructure as code)

JSON definitions for GitHub repository rulesets on `staging` and `main`.

After editing `protect-staging.json` or `protect-main.json`, apply to GitHub:

```powershell
.\scripts\apply-github-rulesets.ps1
```

```bash
./scripts/apply-github-rulesets.sh
```

Do not change rules only in the GitHub UI — update these files and run the script.

**Bypass actor IDs** (`RepositoryRole`): maintain = `2`, admin = `5`.

**Live ruleset IDs** (as of initial setup): Protect staging `16801448`, Protect main `16801449`. The apply script resolves by name if IDs change.
