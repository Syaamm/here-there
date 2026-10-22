<#
  Builds an Android APK of HERE & THERE that talks to the API on THIS computer through a temporary tunnel, so it can be
  sent to a friend's Android phone. Demo use only.

  Before the first run (once):
    1. npx eas-cli login          (a free Expo account)
    2. cd apps/mobile; npx eas-cli init     (creates the Expo project; its id goes in apps/mobile/eas.json, see "EAS_PROJECT_ID")
  Then, with the API running on port 3000 (npm run api):
    powershell -File scripts/build-apk.ps1

  What it does: opens a Cloudflare quick tunnel to http://localhost:3000, checks it works, writes the tunnel address into
  the "preview" build settings (EXPO_PUBLIC_API_URL), starts the cloud build, and puts eas.json back as it was.
  Keep this computer on and the API running for as long as the friends use the app: the address is baked into the APK.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $root 'apps\mobile'
$easJson = Join-Path $mobile 'eas.json'

# 1. the API must be running
if (-not (Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
  throw 'The API is not running on port 3000. Start it first (npm run api), then run this again.'
}

# 2. the tunnel program (downloaded once from Cloudflare's official releases)
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  $dir = Join-Path $env:TEMP 'here-there-cloudflared'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $cf = Join-Path $dir 'cloudflared.exe'
  if (-not (Test-Path $cf)) {
    Write-Host 'Downloading the Cloudflare tunnel program...'
    Invoke-WebRequest -UseBasicParsing -OutFile $cf -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  }
}

# 3. open the tunnel and read its address
$log = Join-Path $env:TEMP 'here-there-tunnel.log'
Remove-Item $log -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:3000' -RedirectStandardError $log -PassThru -WindowStyle Hidden
$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep 1
  if (Test-Path $log) { $m = [regex]::Match((Get-Content $log -Raw -ErrorAction SilentlyContinue), 'https://[a-z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $url = $m.Value } }
}
if (-not $url) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue; throw 'The tunnel did not start. Check your internet connection and try again.' }
Write-Host "Tunnel: $url"

# 4. wait until the tunnel has connected to Cloudflare (its own log says so). Checking the address from this computer is not
#    reliable for a brand-new address: Windows caches a failed lookup for a while, so that check is only a courtesy below.
$connected = $false
for ($i = 0; $i -lt 60 -and -not $connected; $i++) {
  if ((Test-Path $log) -and ((Get-Content $log -Raw -ErrorAction SilentlyContinue) -match 'Registered tunnel connection')) { $connected = $true } else { Start-Sleep 1 }
}
if (-not $connected) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue; throw 'The tunnel did not connect to Cloudflare within a minute. Check your internet connection and try again.' }
Start-Sleep 5 # let the new address spread
try {
  Invoke-WebRequest -UseBasicParsing "$url/v1/push/config" -TimeoutSec 15 -ErrorAction Stop | Out-Null
  Write-Host 'The tunnel reaches the API.'
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  if ($code -eq 401) { Write-Host 'The tunnel reaches the API.' }
  else { Write-Host 'The tunnel is connected, but this computer cannot look the new address up yet. That is normal for a new address; your friends phone looks it up fresh. Continuing.' }
}

# 5. write the address into the build settings for this build only, then build
$original = Get-Content $easJson -Raw
try {
  $cfg = $original | ConvertFrom-Json
  $cfg.build.preview.env | Add-Member -NotePropertyName 'EXPO_PUBLIC_API_URL' -NotePropertyValue $url -Force
  $cfg | ConvertTo-Json -Depth 10 | Set-Content $easJson -Encoding utf8
  Push-Location $mobile
  npx --yes eas-cli@latest build --platform android --profile preview
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  Set-Content $easJson $original -Encoding utf8
}

Write-Host ''
Write-Host "Done. Keep this computer on, the API running, and the tunnel open (it is running as process $($tunnel.Id))."
Write-Host "To close the tunnel later:  Stop-Process -Id $($tunnel.Id)"
