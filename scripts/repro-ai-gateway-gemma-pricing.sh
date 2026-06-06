#!/usr/bin/env bash
# Repro: AI Gateway compat/v1/models reports $0.60 in / $3.00 out for
# workers-ai/@cf/google/gemma-4-26b-a4b-it (cost_in=6e-7, cost_out=3e-6).
#
# Workers AI neuron pricing docs say $0.10 / $0.30 for the same model:
# https://developers.cloudflare.com/workers-ai/platform/pricing/
#
# Same catalog costs also appear on kimi-k2.6 (docs: $0.95/$4.00) — likely
# copied from kimi-k2.5 ($0.60/$3.00, which matches docs).
#
# Usage:
#   export CLOUDFLARE_ACCOUNT_ID=your_account_id
#   export CF_AIG_TOKEN=your_cfut_or_api_token
#   export AI_GATEWAY_NAME=cubewizard   # optional
#   bash scripts/repro-ai-gateway-gemma-pricing.sh

set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
GATEWAY="${AI_GATEWAY_NAME:-cubewizard}"
TOKEN="${CF_AIG_TOKEN:?set CF_AIG_TOKEN}"

URL="https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY}/compat/v1/models"

echo "GET ${URL}"
echo

curl -sS "${URL}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "cf-aig-authorization: Bearer ${TOKEN}" \
| jq '
  .data[]
  | select(.id | test("^workers-ai/@cf/(google/gemma-4-26b-a4b-it|moonshotai/kimi-k2\\.(5|6)|meta/llama-3.2-1b-instruct)$"))
  | {
      id,
      cost_in,
      cost_out,
      usd_per_1m_input: (.cost_in * 1000000),
      usd_per_1m_output: (.cost_out * 1000000)
    }
'
