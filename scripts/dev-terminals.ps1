# Open one PowerShell window running the full local stack (site + eval + Hedron consumers).
# Uses a single Wrangler dev session so Queues are shared (separate `wrangler dev` processes do not).
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Start-Process -FilePath "powershell.exe" -WorkingDirectory $repo -ArgumentList @(
  "-NoProfile",
  "-NoExit",
  "-Command",
  "npm run dev:all"
) | Out-Null
