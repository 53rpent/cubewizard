# Run the live golden-set harness (OpenAI). Requires .dev.vars with OPENAI_API_KEY.
param(
    [switch]$Baseline,
    [string]$Label = ""
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if ($Baseline) {
    $env:GOLDEN_EVAL_WRITE_BASELINE = "1"
}
if ($Label) {
    $env:GOLDEN_EVAL_LABEL = $Label
}

npm run golden:eval
