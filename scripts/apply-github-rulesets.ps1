# Sync .github/rulesets/*.json to GitHub repository rulesets.
# Requires: gh CLI, authenticated with repo admin access.
# Usage: .\scripts\apply-github-rulesets.ps1 [-Repo owner/name]

param(
    [string]$Repo = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RulesetsDir = Join-Path $Root ".github\rulesets"

if (-not $Repo) {
    $Repo = (gh repo view --json nameWithOwner -q .nameWithOwner)
}

$files = @(
    @{ File = "protect-staging.json"; FallbackId = 16801448 },
    @{ File = "protect-main.json"; FallbackId = 16801449 }
)

$existing = gh api "repos/$Repo/rulesets" | ConvertFrom-Json
$idByName = @{}
foreach ($r in $existing) { $idByName[$r.name] = $r.id }

foreach ($entry in $files) {
    $path = Join-Path $RulesetsDir $entry.File
    if (-not (Test-Path $path)) {
        throw "Missing ruleset file: $path"
    }
    $name = (Get-Content $path -Raw | ConvertFrom-Json).name
    $id = $idByName[$name]
    if (-not $id) { $id = $entry.FallbackId }

    Write-Host "Updating ruleset '$name' (id $id) on $Repo ..."
    gh api --method PUT "repos/$Repo/rulesets/$id" --input $path
    Write-Host "  OK"
}

Write-Host "Done. Verify: gh api repos/$Repo/rules/branches/staging"
