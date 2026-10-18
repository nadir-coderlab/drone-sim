<#
.SYNOPSIS
  Installs DroneSim.apk on the Android TV box over Wi-Fi (adb) and starts it.

.DESCRIPTION
  Before the first run, on the TV: Developer options -> USB debugging ON (see README-ar.md), and find the TV's
  IP address (Settings -> Network & Internet -> your Wi-Fi). The first connection shows "Allow USB debugging?"
  on the TV: tick "Always allow from this computer" and press OK. The last IP is remembered.

  LAN dev mode (change the web files without rebuilding the APK):
    1. Build and install a dev APK once:   .\build.ps1 -Dev   then   .\install-tv.ps1 -Ip <TV-IP>
    2. Serve the simulator folder from the PC on port 8080, e.g. in that folder:  python -m http.server 8080
       (or: npx http-server -p 8080 -c-1)
    3a. Through adb, no firewall change needed:   .\install-tv.ps1 -NoInstall -Reverse
        (adb reverse makes http://localhost:8080 on the TV reach port 8080 on the PC)
    3b. Or over the LAN:   .\install-tv.ps1 -NoInstall -DevUrl http://<PC-IP>:8080/index.html
        (Windows Firewall must allow port 8080 on the private network)
    4. After editing files on the PC, run the same command again: the app reloads the page.
    5. Debug / FPS / console: Chrome on the PC -> chrome://inspect -> the DroneSim WebView.
    Release builds ignore -DevUrl (not debuggable) and always run the files inside the APK.

  "adb install -r" replaces the app IN PLACE: the saved progress stays. Before installing, the APK is checked
  against android\signing-cert.txt (same key as the app on the TV), so a wrongly signed APK is never pushed.
  Normally you do not need this script any more: the app updates itself from the PC (update-tv.ps1).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-tv.ps1 -Ip 192.168.1.50
.EXAMPLE
  .\install-tv.ps1 -Pair 192.168.1.50:37215 -Ip 192.168.1.50:41003
  Android 11+ "Wireless debugging" (when port 5555 is refused): pair with the 6-digit code, then connect.
.EXAMPLE
  .\install-tv.ps1 -Logcat
  Install, start, then show the app's log (Ctrl+C to stop).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Ip = '',   # 192.168.1.50  or  192.168.1.50:41003
  [int]$Port = 5555,
  [string]$Apk = '',                            # default: android\DroneSim.apk
  [string]$Sdk = $(if ($env:DS_SDK) { $env:DS_SDK } else { 'C:\tools\android-sdk' }),
  [string]$Pair = '',                           # ip:port from "Pair device with pairing code"
  [string]$DevUrl = '',
  [switch]$Reverse,
  [int]$DevPort = 8080,
  [switch]$NoInstall,
  [switch]$NoLaunch,
  [switch]$Uninstall,
  [switch]$AnyKey,                              # skip the signing-cert.txt check (not recommended)
  [string]$Jdk = $(if ($env:DS_JDK) { $env:DS_JDK } else { 'C:\tools\jdk-17' }),
  [switch]$Logcat
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Package  = 'com.nadir.dronesim'
$Activity = "$Package/.MainActivity"

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note([string]$m) { Write-Host "    $m" }
function Warn([string]$m) { Write-Host "WARNING: $m" -ForegroundColor Yellow }

# Run adb, return its output lines (stdout+stderr as text); $LASTEXITCODE is kept.
function Invoke-Adb([string[]]$AdbArgs) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $o = & $script:adb @AdbArgs 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
  return @($o)
}

function Get-DeviceState([string]$Serial) {
  foreach ($line in (Invoke-Adb @('devices'))) {
    $parts = $line -split '\s+'
    if ($parts.Count -ge 2 -and $parts[0] -eq $Serial) { return $parts[1] }
  }
  return ''
}

try {
  # ---- adb
  $script:adb = Join-Path $Sdk 'platform-tools\adb.exe'
  if (-not (Test-Path -LiteralPath $script:adb)) {
    $cmd = Get-Command 'adb.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $script:adb = $cmd.Source }
    else { throw "adb.exe not found (looked in $Sdk\platform-tools and PATH). Run tools\setup-toolchain.ps1 first." }
  }

  # ---- the APK and its signing key, checked BEFORE talking to the TV
  $src = $null
  if (-not $NoInstall) {
    if (-not $Apk) { $Apk = Join-Path $PSScriptRoot 'DroneSim.apk' }
    if (-not (Test-Path -LiteralPath $Apk)) { throw "APK not found: $Apk  (build it first: .\build.ps1)" }
    $src = $Apk
    if ($Apk -match '[^\x20-\x7E]') {   # adb + non-ASCII paths: copy to a plain temp path first
      $src = Join-Path $env:TEMP 'DroneSim-install.apk'
      Copy-Item -LiteralPath $Apk -Destination $src -Force
    }
    # same key as the app on the TV? (an APK with another key cannot update it; installing it would need an uninstall)
    $pin = ''
    $pinFile = Join-Path $PSScriptRoot 'signing-cert.txt'
    if (Test-Path -LiteralPath $pinFile) {
      foreach ($l in [IO.File]::ReadAllLines($pinFile)) { $tl = $l.Trim().ToLowerInvariant(); if ($tl -match '^[0-9a-f]{64}$') { $pin = $tl; break } }
    }
    $javaExe = Join-Path $Jdk 'bin\java.exe'
    $signJar = Join-Path $Sdk 'build-tools\35.0.0\lib\apksigner.jar'
    if (-not (Test-Path -LiteralPath $signJar)) {
      $cand = @(Get-ChildItem -LiteralPath (Join-Path $Sdk 'build-tools') -Recurse -Filter 'apksigner.jar' -ErrorAction SilentlyContinue | Select-Object -Last 1)
      if ($cand.Count -gt 0) { $signJar = $cand[0].FullName }
    }
    if ($AnyKey) {
      Warn '-AnyKey: signing key not checked.'
    } elseif (-not $pin) {
      Warn 'signing-cert.txt not found: signing key not checked.'
    } elseif (-not (Test-Path -LiteralPath $javaExe) -or -not (Test-Path -LiteralPath $signJar)) {
      Warn "java / apksigner not found ($javaExe, $signJar): signing key not checked."
    } else {
      $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { $vo = & $javaExe -jar $signJar verify --print-certs $src 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
      $certs = @($vo | ForEach-Object { if ($_ -match 'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})') { $Matches[1].ToLowerInvariant() } })
      if ($certs.Count -ne 1 -or $certs[0] -ne $pin) {
        throw ("This APK is not signed with the key of the app on the TV (signing-cert.txt).`n" +
               "  APK: $(if ($certs.Count -gt 0) { $certs -join ', ' } else { 'not signed / unreadable' })`n  pin: $pin`n" +
               "  Installing it would need an uninstall = the saved progress would be lost. Build it again with the original keystore.")
      }
      Note 'Signing key: same as signing-cert.txt (update keeps the saved progress)'
    }
  }

  # ---- TV address (remembered)
  $memDir = Join-Path $env:LOCALAPPDATA 'DroneSim'
  $memFile = Join-Path $memDir 'tv-address.txt'
  if (-not $Ip -and (Test-Path -LiteralPath $memFile)) { $Ip = (Get-Content -LiteralPath $memFile -TotalCount 1).Trim() }
  if (-not $Ip) {
    throw "Give the TV's IP address, e.g.  .\install-tv.ps1 -Ip 192.168.1.50`n  (on the TV: Settings -> Network & Internet -> your Wi-Fi -> IP address)"
  }
  $target = if ($Ip.Contains(':')) { $Ip } else { "${Ip}:$Port" }

  # ---- optional pairing (Android 11+ wireless debugging)
  if ($Pair) {
    Say "Pairing with $Pair (type the 6-digit code shown on the TV)"
    & $script:adb pair $Pair
    if ($LASTEXITCODE -ne 0) { throw 'Pairing failed. Open "Pair device with pairing code" on the TV again and use the new code.' }
  }

  # ---- connect
  Say "Connecting to $target"
  $out = (Invoke-Adb @('connect', $target)) -join ' '
  Note $out
  # "failed to authenticate" is fine: it means the TV is now showing the "Allow USB debugging?" prompt
  if ($out -match 'cannot|refused|unable|No route|failed to connect|timed out') {
    throw ("Could not connect to $target.`n" +
      "  * TV and PC must be on the same Wi-Fi/network, and the IP must be right.`n" +
      "  * On the TV: Developer options -> USB debugging ON (Network debugging ON on some boxes).`n" +
      "  * Android 11+ / Google TV: Developer options -> Wireless debugging -> 'Pair device with pairing code', then`n" +
      "    .\install-tv.ps1 -Pair <ip:pair-port> -Ip <ip:port shown under 'IP address & Port'>")
  }
  $state = ''
  for ($t = 0; $t -lt 40; $t++) {
    $state = Get-DeviceState $target
    if ($state -eq 'device') { break }
    if ($t -eq 0 -or $t % 5 -eq 0) { Note "Waiting for the TV ($state). Look at the TV: press OK on 'Allow USB debugging?' (tick 'Always allow')." }
    Start-Sleep -Seconds 1
  }
  if ($state -ne 'device') { throw "The TV did not allow the connection (state: '$state'). Accept the prompt on the TV and run again." }
  New-Item -ItemType Directory -Force -Path $memDir | Out-Null
  Set-Content -LiteralPath $memFile -Value $Ip -Encoding ASCII
  $model = ((Invoke-Adb @('-s', $target, 'shell', 'getprop', 'ro.product.model')) -join ' ').Trim()
  $sdkInt = ((Invoke-Adb @('-s', $target, 'shell', 'getprop', 'ro.build.version.sdk')) -join ' ').Trim()
  Note "Connected: $model (Android API $sdkInt)"
  if ($sdkInt -match '^\d+$' -and [int]$sdkInt -lt 24) { throw 'This box runs Android older than 7.0 (API 24); the app needs Android 7 or newer.' }

  # ---- uninstall (only when asked: it deletes the saved progress on the TV)
  if ($Uninstall) {
    Warn 'Uninstalling removes the saved progress and settings on the TV.'
    $ans = Read-Host 'Uninstall the old app? (y/n)'
    if ($ans -match '^(y|yes)$') { Note ((Invoke-Adb @('-s', $target, 'uninstall', $Package)) -join ' ') }
  }

  # ---- install
  if (-not $NoInstall) {
    Say ("Installing {0} ({1:N1} MB)" -f (Split-Path -Leaf $Apk), ((Get-Item -LiteralPath $Apk).Length / 1MB))
    $res = (Invoke-Adb @('-s', $target, 'install', '-r', $src)) -join "`n"
    Note $res
    if ($res -notmatch 'Success') {
      if ($res -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
        throw "The app on the TV was signed with a different key. Use the original keystore (backup of %USERPROFILE%\.dronesim\). Only as a last resort: -Uninstall (deletes the saved progress on the TV)."
      }
      if ($res -match 'INSTALL_FAILED_VERSION_DOWNGRADE') { throw 'The TV has a newer build. Build again (version codes increase every minute).' }
      if ($res -match 'INSUFFICIENT_STORAGE') { throw 'Not enough free space on the TV box.' }
      throw 'Install failed (see the message above).'
    }
  }

  # ---- dev server routing
  if ($Reverse) {
    Note ((Invoke-Adb @('-s', $target, 'reverse', "tcp:$DevPort", "tcp:$DevPort")) -join ' ')
    if (-not $DevUrl) { $DevUrl = "http://localhost:$DevPort/index.html" }
  }

  # ---- launch
  if (-not $NoLaunch) {
    $am = @('-s', $target, 'shell', 'am', 'start', '-n', $Activity)
    if ($DevUrl) {
      if ($DevUrl -notmatch '^https?://[^\s''"]+$') { throw "Bad -DevUrl: $DevUrl" }
      $am += @('--es', 'url', "'$DevUrl'")   # quoted for the TV's shell (& or ? in the URL)
      Note "Dev URL: $DevUrl  (works only with a  build.ps1 -Dev  APK; release builds ignore it)"
    }
    Say 'Starting the app on the TV'
    Note ((Invoke-Adb $am) -join ' ')
  }

  if ($Logcat) {
    Say 'App log (Ctrl+C to stop)'
    [void](Invoke-Adb @('-s', $target, 'logcat', '-c'))
    & $script:adb -s $target logcat -v time 'DroneSim:V' 'chromium:W' 'AndroidRuntime:E' '*:S'
  }
  Say 'Done. Pick up the controller and press A.'
  exit 0
}
catch {
  Write-Host ''
  Write-Host "INSTALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
