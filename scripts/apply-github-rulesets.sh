#!/usr/bin/env bash
# Sync .github/rulesets/*.json to GitHub repository rulesets.
# Requires: gh CLI, jq, authenticated with repo admin access.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULESETS_DIR="$ROOT/.github/rulesets"
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

apply_one() {
  local file="$1"
  local fallback_id="$2"
  local path="$RULESETS_DIR/$file"
  local name
  name="$(jq -r .name "$path")"
  local id
  id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" | head -n1)"
  if [[ -z "$id" ]]; then
    id="$fallback_id"
  fi
  echo "Updating ruleset '$name' (id $id) on $REPO ..."
  jq '{
    name,
    target,
    enforcement,
    conditions,
    bypass_actors,
    rules
  }' "$path" | gh api --method PUT "repos/$REPO/rulesets/$id" --input -
  echo "  OK"
}

apply_one protect-staging.json 16801448
apply_one protect-main.json 16801449

echo ""
echo "Done. Verify via the rulesets API (same as apply), not rules/branches:"
echo "  gh api repos/$REPO/rulesets"
for file in protect-staging.json protect-main.json; do
  path="$RULESETS_DIR/$file"
  name="$(jq -r .name "$path")"
  id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" | head -n1)"
  if [[ -z "$id" ]]; then
    case "$file" in
      protect-staging.json) id=16801448 ;;
      protect-main.json) id=16801449 ;;
    esac
  fi
  echo "  gh api repos/$REPO/rulesets/$id   # $name"
done
