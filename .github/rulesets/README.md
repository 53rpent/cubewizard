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

### Verify after apply

Use the **rulesets** API (not `rules/branches`, which is a separate rules surface):

```bash
gh api repos/OWNER/REPO/rulesets
gh api repos/OWNER/REPO/rulesets/16801448   # Protect staging
gh api repos/OWNER/REPO/rulesets/16801449   # Protect main
```

Compare `rules` (especially `required_status_checks`) to the JSON in this directory.
