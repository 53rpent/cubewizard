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
    $body = Get-Content $path -Raw | ConvertFrom-Json
    $payload = [ordered]@{
        name          = $body.name
        target        = $body.target
        enforcement   = $body.enforcement
        conditions    = $body.conditions
        bypass_actors = @($body.bypass_actors)
        rules         = @($body.rules)
    }
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $payload | ConvertTo-Json -Depth 20 | Set-Content -Path $tmp -Encoding utf8NoBOM

        $id = $idByName[$body.name]
        if (-not $id) { $id = $entry.FallbackId }

        Write-Host "Updating ruleset '$($body.name)' (id $id) on $Repo ..."
        gh api --method PUT "repos/$Repo/rulesets/$id" --input $tmp | Out-Null
        Write-Host "  OK"
    }
    finally {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    }
}

Write-Host "Done. Verify: gh api repos/$Repo/rules/branches/staging"
