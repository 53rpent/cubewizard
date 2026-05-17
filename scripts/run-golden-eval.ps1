# Run the live golden-set harness (OpenAI). Requires .dev.vars with OPENAI_API_KEY.
param(
    [string]$Label = ""
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if ($Label) {
    $env:GOLDEN_EVAL_LABEL = $Label
}

npm run golden:eval
