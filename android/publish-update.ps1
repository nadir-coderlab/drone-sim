<#
.SYNOPSIS
  Publishes a signed update of the drone simulator for the TV app: web content (hot update, no reinstall)
  and, only when the Android (native) part changed, a new APK that installs over the old one (progress kept).

.DESCRIPTION
  Writes into -OutDir (default C:\tools\dronesim-updates):
    update.properties       manifest (protocol P1; java.util.Properties, UTF-8, non-ASCII written as \uXXXX)
    update.properties.sig   lowercase hex SHA256withRSA of the exact manifest bytes, made with the APK release key (P2)
    content-<ver>.zip       the web root exactly as staged for the APK + content-version.txt (P3)
    DroneSim-<code>.apk     the release APK (kept from the previous publish when the native part did not change)
  and keeps only the newest -Keep (3) content zips and APKs. serve-updates.ps1 serves this folder to the TV on the
  same Wi-Fi; the same files can be uploaded as they are to a static web host (GitHub Pages etc.).

  Versions (P4): content.version = versionCode = minutes since 2025-01-01 UTC, and always higher than anything
  published before (no downgrade / replay). content.minNative = UpdateCore.NATIVE_API read from the Java source.

  A new APK is built (build.ps1, release) when there is no published APK yet, when android\src, android\res,
  AndroidManifest.xml, build.ps1 or -UpdateSources changed since the last published APK, or with -ForceApk.
  Otherwise only the web content is staged (build.ps1 -StageOnly) and published: the app updates itself without
  any install prompt.

  Safety: the release key must match android\signing-cert.txt (checked before and after building; exit code 3
  otherwise), every APK is checked for package com.nadir.dronesim, a versionCode higher than the last published
  one and the pinned certificate, and the fresh signature is verified before the manifest is replaced.

  Keystore password: $env:DS_KS_PASS, else keystore-password.txt next to the keystore. It is never printed.
  Exit codes: 0 ok, 1 failed, 3 signing key differs from signing-cert.txt, 5 keystore or its password missing /
  unreadable (restore %USERPROFILE%\.dronesim\ from the backup; never make a new key).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\publish-update.ps1
.EXAMPLE
  .\publish-update.ps1 -NotesFile C:\tools\notes.txt -ForceApk
.EXAMPLE
  .\publish-update.ps1 -ApkPath C:\tools\DroneSim.apk
  Publish an APK that was built before (its own assets become the content zip).
.EXAMPLE
  .\publish-update.ps1 -Sources 'https://example.github.io/dronesim/'
  Apps that read this manifest remember that web address as an extra update source.
#>
[CmdletBinding()]
param(
  [string]$OutDir     = $(if ($env:DS_UPDATES)  { $env:DS_UPDATES }  else { 'C:\tools\dronesim-updates' }),
  [string]$BuildDir   = $(if ($env:DS_BUILD)    { $env:DS_BUILD }    else { 'C:\tools\dronesim-build' }),
  [string]$ApkPath    = '',
  [string]$Jdk        = $(if ($env:DS_JDK)      { $env:DS_JDK }      else { 'C:\tools\jdk-17' }),
  [string]$Sdk        = $(if ($env:DS_SDK)      { $env:DS_SDK }      else { 'C:\tools\android-sdk' }),
  [string]$KeyStore   = $(if ($env:DS_KEYSTORE) { $env:DS_KEYSTORE } else { "$env:USERPROFILE\.dronesim\dronesim-release.keystore" }),
  [string]$KeyAlias   = 'dronesim',
  [string]$PasswordFile = '',
  [string]$BuildTools = '35.0.0',
  [string]$UpdateSources = 'lan',   # baked into a NEW APK (assets/update-config.properties); see build.ps1
  [string]$Sources    = '',         # manifest "sources=": extra base URLs the apps should remember
  [string]$Notes      = '',         # Arabic text shown in the app's update dialog
  [string]$NotesFile  = '',         # same, from a UTF-8 text file
  [string]$VersionName = '',
  [int]$Keep          = 3,
  [switch]$ForceApk
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note([string]$m) { Write-Host "    $m" }
function Warn([string]$m) { Write-Host "WARNING: $m" -ForegroundColor Yellow }
function Test-Ascii([string]$s) { return -not ($s -match '[^\x20-\x7E]') }

$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Package = 'com.nadir.dronesim'
$NameRx = '^[A-Za-z0-9._-]+$'
$MaxEntries = 4000
$MaxBytes = 64MB
$script:ExitCode = 1

# Arabic text built from code points (this file stays pure ASCII for Windows PowerShell 5.1).
$AR_DefaultNotes = [regex]::Unescape('\u0646\u0633\u062E\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0643\u064A \u0641\u064A\u0647\u0627 \u062A\u062D\u0633\u064A\u0646\u0627\u062A.')
$AR_KeyMissing = [regex]::Unescape('\u0645\u0644\u0641 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0648\u0642\u064A\u0639 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631 \u062D\u0642\u062A\u0647 \u0645\u0648 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631\u060C \u0641\u0648\u0642\u0651\u0641\u0646\u0627. \u0631\u062C\u0651\u0639 \u0627\u0644\u0645\u062C\u0644\u062F \u200E.dronesim\u200E \u0643\u0627\u0645\u0644 \u0645\u0646 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 (\u0641\u0644\u0627\u0634 \u0623\u0648 Google Drive) \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629. \u0644\u0627 \u062A\u0633\u0648\u064A \u0645\u0641\u062A\u0627\u062D \u062C\u062F\u064A\u062F: \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062C\u062F\u064A\u062F \u064A\u062C\u0628\u0631\u0643 \u062A\u062D\u0630\u0641 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0636\u064A\u0639 \u062A\u0642\u062F\u0651\u0645\u0643.')
$AR_KeyMismatch = [regex]::Unescape('\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u063A\u0644\u0637\u060C \u0641\u0648\u0642\u0651\u0641\u0646\u0627! \u0647\u0630\u0627 \u0645\u0648 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0648\u0642\u064A\u0639 \u062D\u0642 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0644\u064A \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646. \u0631\u062C\u0651\u0639 \u0645\u0644\u0641 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0623\u0635\u0644\u064A \u0645\u0646 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u0644\u0645\u062C\u0644\u062F \u200E.dronesim\u200E \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629.')

# ------------------------------------------------------------------------------------------------ helpers
function Get-ToolOutput([string]$Exe, [string[]]$ToolArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $o = & $Exe @ToolArgs 2>&1 | ForEach-Object { "$_" } } catch { $o = @("$_") } finally { $ErrorActionPreference = $old }
  return @($o)
}

function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Get-MinutesNow {
  return [long][Math]::Floor(([DateTime]::UtcNow - (New-Object DateTime(2025, 1, 1, 0, 0, 0, [DateTimeKind]::Utc))).TotalMinutes)
}

# Minimal reader for our own manifests/state files (plain ASCII key=value lines; values we read back are ASCII).
function Read-Props([string]$Path) {
  $h = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $h }
  foreach ($l in [IO.File]::ReadAllLines($Path, $Utf8)) {
    $t = $l.Trim()
    if (-not $t -or $t.StartsWith('#') -or $t.StartsWith('!')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $h[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
  return $h
}
function Get-Long($h, [string]$k) {
  $v = 0L
  if ($h.ContainsKey($k) -and [long]::TryParse([string]$h[$k], [ref]$v)) { return $v }
  return 0L
}

# java.util.Properties value escaping; everything outside printable ASCII becomes \uXXXX (valid for both
# Properties.load(Reader UTF-8) and load(InputStream)), so the manifest file is pure ASCII.
function ConvertTo-PropValue([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $s.Length; $i++) {
    $c = $s[$i]; $n = [int]$c
    if ($c -eq '\') { [void]$sb.Append('\\') }
    elseif ($n -eq 10) { [void]$sb.Append('\n') }
    elseif ($n -eq 13) { continue }
    elseif ($n -eq 9) { [void]$sb.Append('\t') }
    elseif ($i -eq 0 -and $c -eq ' ') { [void]$sb.Append('\ ') }
    elseif ($n -lt 32) { continue }
    elseif ($n -gt 126) { [void]$sb.Append(('\u{0:x4}' -f $n)) }
    else { [void]$sb.Append($c) }
  }
  return $sb.ToString()
}

function Read-PinnedCert([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  foreach ($l in [IO.File]::ReadAllLines($Path)) {
    $t = $l.Trim().ToLowerInvariant()
    if ($t -match '^[0-9a-f]{64}$') { return $t }
  }
  return ''
}

function Show-KeyMismatch([string]$Found, [string]$Pinned) {
  Write-Host ''
  Write-Host '================================================================================' -ForegroundColor Red
  Write-Host 'WRONG SIGNING KEY - NOTHING WAS PUBLISHED' -ForegroundColor Red
  Write-Host "  key used now      : $Found" -ForegroundColor Red
  Write-Host "  signing-cert.txt  : $Pinned  (the key of the app on the TV)" -ForegroundColor Red
  Write-Host '  The TV app trusts only its own key: an update signed with another key is ignored, and an APK' -ForegroundColor Red
  Write-Host '  signed with another key cannot be installed over it. Restore the original keystore and' -ForegroundColor Red
  Write-Host '  keystore-password.txt from your backup of %USERPROFILE%\.dronesim\ and run this again.' -ForegroundColor Red
  Write-Host ''
  Write-Host $AR_KeyMismatch -ForegroundColor Red
  Write-Host '================================================================================' -ForegroundColor Red
}

# Keystore / password file missing or unreadable: exit code 5, with the restore hint (English + Arabic).
function Stop-KeyMissing([string]$What) {
  $script:ExitCode = 5
  Write-Host ''
  Write-Host '================================================================================' -ForegroundColor Red
  Write-Host 'SIGNING KEY NOT AVAILABLE - NOTHING WAS PUBLISHED' -ForegroundColor Red
  Write-Host "  $What" -ForegroundColor Red
  Write-Host '  Restore the whole folder %USERPROFILE%\.dronesim\ (keystore + keystore-password.txt) from your' -ForegroundColor Red
  Write-Host '  backup and run this again. Do NOT make a new key: the TV app would have to be deleted (progress lost).' -ForegroundColor Red
  Write-Host ''
  Write-Host $AR_KeyMissing -ForegroundColor Red
  Write-Host '================================================================================' -ForegroundColor Red
  throw $What
}

# Fingerprint of everything that ends up in the APK outside assets/ (decides whether a new APK is needed).
function Get-NativeHash([string]$AndroidDir, [string]$Sources) {
  $items = New-Object System.Collections.Generic.List[string]
  $root = (Resolve-Path -LiteralPath $AndroidDir).ProviderPath.TrimEnd('\')
  $files = @()
  foreach ($f in @('AndroidManifest.xml', 'build.ps1')) {
    $p = Join-Path $root $f
    if (Test-Path -LiteralPath $p) { $files += (Get-Item -LiteralPath $p) }
  }
  foreach ($d in @('src', 'res')) {
    $p = Join-Path $root $d
    if (Test-Path -LiteralPath $p) { $files += @(Get-ChildItem -LiteralPath $p -Recurse -File) }
  }
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/').ToLowerInvariant()
    $items.Add($rel + '=' + (Get-Sha256 $f.FullName))
  }
  $arr = $items.ToArray()
  [Array]::Sort($arr, [StringComparer]::Ordinal)
  $text = ($arr -join "`n") + "`nupdateSources=" + $Sources
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $b = $sha.ComputeHash($Utf8.GetBytes($text)) } finally { $sha.Dispose() }
  return (-join ($b | ForEach-Object { $_.ToString('x2') }))
}

# Same rule as the app (UpdateCore.isLanIpv4): plain http is accepted only for a private / loopback IPv4 address.
function Test-LanIpv4([string]$h) {
  $m = [regex]::Match($h, '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')
  if (-not $m.Success) { return $false }
  $o = @(1..4 | ForEach-Object { [int]$m.Groups[$_].Value })
  if (@($o | Where-Object { $_ -gt 255 }).Count -gt 0) { return $false }
  return ($o[0] -eq 10 -or $o[0] -eq 127 -or ($o[0] -eq 192 -and $o[1] -eq 168) -or
          ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) -or ($o[0] -eq 169 -and $o[1] -eq 254))
}

# Validated with the app's own rules (UpdateCore.normalizeBase): a URL the app would ignore is refused here.
function Normalize-Urls([string]$s) {
  $out = @()
  foreach ($p in ($s -split ';')) {
    $p = $p.Trim()
    if (-not $p) { continue }
    $m = [regex]::Match($p, '^(https?)://([A-Za-z0-9.\-]+)(:(\d{1,5}))?(/[A-Za-z0-9._~%+/\-]*)?$', 'IgnoreCase')
    if (-not $m.Success -or $p.Contains('..') -or $p.Substring($m.Groups[1].Length + 3).Contains('//') -or
        ($m.Groups[4].Success -and ([int]$m.Groups[4].Value -lt 1 -or [int]$m.Groups[4].Value -gt 65535))) {
      throw "-Sources: '$p' is not a web address like https://example.github.io/dronesim/"
    }
    if ($m.Groups[1].Value -ieq 'http' -and -not (Test-LanIpv4 $m.Groups[2].Value)) {
      throw "-Sources: '$p' uses plain http. The app accepts http only for a PC on the same Wi-Fi (like http://192.168.1.5:47801/); use https:// for web sites."
    }
    if (-not $p.EndsWith('/')) { $p += '/' }
    $out += $p
  }
  return ($out -join ';')
}

# Checks P3 on a staged web root; returns @{ Files; Bytes; List } (relative '/' names, sorted).
function Test-ContentDir([string]$Dir, [long]$Version) {
  $root = (Resolve-Path -LiteralPath $Dir).ProviderPath.TrimEnd('\')
  $all = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)
  if ($all.Count -eq 0) { throw "No files in $root" }
  if ($all.Count -gt $MaxEntries) { throw "Too many files for an update ($($all.Count) > $MaxEntries)." }
  $bytes = [long]0
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($f in $all) {
    $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
    foreach ($seg in $rel.Split('/')) {
      if ($seg -eq '' -or $seg -eq '.' -or $seg -eq '..' -or $seg.Contains(':')) { throw "Bad file name for the update zip: $rel" }
    }
    $bytes += $f.Length
    $list.Add($rel)
  }
  if ($bytes -gt $MaxBytes) { throw ("Web content too big for an update ({0:N1} MB > 64 MB)." -f ($bytes / 1MB)) }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) { throw "index.html missing in $root" }
  $cv = Join-Path $root 'content-version.txt'
  if (-not (Test-Path -LiteralPath $cv)) { throw "content-version.txt missing in $root" }
  $cvText = [IO.File]::ReadAllText($cv, $Utf8).Trim()
  if ($cvText -ne "$Version") { throw "content-version.txt says '$cvText', expected $Version" }
  $html = [IO.File]::ReadAllText((Join-Path $root 'index.html'), $Utf8)
  if (-not $html.Contains('native-shim.js')) { throw 'index.html does not load native-shim.js (not staged by build.ps1?)' }
  $arr = $list.ToArray()
  [Array]::Sort($arr, [StringComparer]::Ordinal)
  return @{ Files = $all.Count; Bytes = $bytes; List = $arr; Root = $root }
}

function New-ContentZip($Info, [string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $tmp = $ZipPath + '.tmp'
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  $zip = [IO.Compression.ZipFile]::Open($tmp, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($rel in $Info.List) {
      $full = Join-Path $Info.Root ($rel.Replace('/', '\'))
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $rel, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $zip.Dispose() }
  # read it back: same names, '/' only, nothing outside the root
  $zr = [IO.Compression.ZipFile]::OpenRead($tmp)
  try {
    $names = @($zr.Entries | ForEach-Object { $_.FullName })
    if ($names.Count -ne $Info.List.Count) { throw "zip check: $($names.Count) entries, expected $($Info.List.Count)" }
    foreach ($n in $names) {
      if ($n.Contains('\') -or $n.StartsWith('/') -or $n.Contains('..') -or $n.Contains(':')) { throw "zip check: bad entry name $n" }
    }
  } finally { $zr.Dispose() }
  Move-Item -LiteralPath $tmp -Destination $ZipPath -Force
}

# Package / version / certificate of an APK. Returns @{ Package; Code; Name; Cert }.
function Get-ApkFacts([string]$Apk) {
  $bad = (Get-ToolOutput $script:aapt2 @('dump', 'badging', $Apk)) -join "`n"
  $m = [regex]::Match($bad, "package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'")
  if (-not $m.Success) { throw "aapt2 dump badging could not read $Apk" }
  $ver = Get-ToolOutput $script:java @('-jar', $script:signJar, 'verify', '--print-certs', $Apk)
  if ($LASTEXITCODE -ne 0) { $ver | Out-Host; throw "apksigner verify failed for $Apk" }
  $certs = @($ver | ForEach-Object { if ($_ -match 'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})') { $Matches[1].ToLowerInvariant() } })
  if ($certs.Count -ne 1) { throw "Expected one signer certificate in $Apk, found $($certs.Count)" }
  return @{ Package = $m.Groups[1].Value; Code = [long]$m.Groups[2].Value; Name = $m.Groups[3].Value; Cert = $certs[0] }
}

function Invoke-Build([string[]]$BuildArgs) {
  $ps = Join-Path $PSHOME 'powershell.exe'
  $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $script:AndroidDir 'build.ps1')) + $BuildArgs
  & $ps @all | Out-Host
  return $LASTEXITCODE
}

function Remove-Old([string]$Dir, [string]$Prefix, [string]$Ext, [int]$KeepN, [string]$Protect) {
  $rx = '^' + [regex]::Escape($Prefix) + '(\d+)' + [regex]::Escape($Ext) + '$'
  $found = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Name -match $rx } |
             Sort-Object -Property @{ Expression = { [long]([regex]::Match($_.Name, $rx).Groups[1].Value) } } -Descending)
  for ($i = $KeepN; $i -lt $found.Count; $i++) {
    if ($found[$i].Name -eq $Protect) { continue }
    Remove-Item -LiteralPath $found[$i].FullName -Force
    Note "Removed old $($found[$i].Name)"
  }
}

# ------------------------------------------------------------------------------------------------ main
$setEnv = $false
try {
  $script:AndroidDir = $PSScriptRoot
  $AndroidDir = $script:AndroidDir
  Say 'Publishing a DroneSim update'
  foreach ($p in @($OutDir, $BuildDir, $Jdk, $Sdk, $KeyStore)) {
    if (-not (Test-Ascii $p)) { throw "This path must contain only English letters/numbers (Java tools cannot open Arabic paths): $p" }
  }
  if (-not [IO.Path]::IsPathRooted($OutDir) -or $OutDir.TrimEnd('\').Length -le 3) { throw "-OutDir must be a full folder path like C:\tools\dronesim-updates" }
  if ($Keep -lt 2) { $Keep = 2 }
  $OutDir = $OutDir.TrimEnd('\')
  $StateDir = Join-Path $OutDir 'state'
  New-Item -ItemType Directory -Force -Path $OutDir, $StateDir | Out-Null
  Note "Output  : $OutDir"

  # ---- tools
  $script:java = Join-Path $Jdk 'bin\java.exe'
  $BT = Join-Path $Sdk "build-tools\$BuildTools"
  $script:aapt2 = Join-Path $BT 'aapt2.exe'
  $script:signJar = $null
  foreach ($c in @((Join-Path $BT 'lib\apksigner.jar'), (Join-Path $BT 'apksigner.jar'))) { if (Test-Path -LiteralPath $c) { $script:signJar = $c; break } }
  foreach ($t in @($script:java, $script:aapt2)) { if (-not (Test-Path -LiteralPath $t)) { throw "Missing tool: $t (run tools\setup-toolchain.ps1)" } }
  if (-not $script:signJar) { throw "Missing apksigner.jar in $BT\lib" }
  if (-not (Test-Path -LiteralPath $KeyStore)) { Stop-KeyMissing "Keystore not found: $KeyStore" }

  # SignUpdate.java runs from an ASCII folder (Java cannot open the Arabic project path)
  $toolDir = Join-Path $BuildDir 'signtool'
  New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
  $signSrc = Join-Path $toolDir 'SignUpdate.java'
  Copy-Item -LiteralPath (Join-Path $AndroidDir 'tools\SignUpdate.java') -Destination $signSrc -Force

  # ---- keystore password (for build.ps1 and SignUpdate); never printed
  if (-not $PasswordFile) { $PasswordFile = Join-Path (Split-Path -Parent $KeyStore) 'keystore-password.txt' }
  if (-not $env:DS_KS_PASS) {
    if (-not (Test-Path -LiteralPath $PasswordFile)) { Stop-KeyMissing "No keystore password: $PasswordFile is missing (and `$env:DS_KS_PASS is not set)." }
    $pw = [IO.File]::ReadAllText($PasswordFile, $Utf8).TrimStart([char]0xFEFF).TrimEnd("`r", "`n")
    if (-not $pw) { Stop-KeyMissing "$PasswordFile is empty." }
    $env:DS_KS_PASS = $pw
    $pw = $null
    $setEnv = $true
  }

  # ---- the key must be the one of the app on the TV
  $pinFile = Join-Path $AndroidDir 'signing-cert.txt'
  $pinned = Read-PinnedCert $pinFile
  $ksCert = ((Get-ToolOutput $script:java @($signSrc, 'cert', $KeyStore, $KeyAlias)) | Where-Object { $_ -match '^[0-9a-f]{64}$' } | Select-Object -First 1)
  if (-not $ksCert) { Stop-KeyMissing "Could not open '$KeyAlias' in $KeyStore (wrong password in keystore-password.txt, or a damaged keystore)." }
  if ($pinned -and $ksCert -ne $pinned) { $script:ExitCode = 3; Show-KeyMismatch $ksCert $pinned; throw 'Signing key differs from signing-cert.txt.' }
  Note "Key     : $ksCert$(if ($pinned) { ' (= signing-cert.txt)' } else { ' (signing-cert.txt missing: build.ps1 will pin it)' })"

  # ---- native API level required by this content
  $uc = @(Get-ChildItem -LiteralPath (Join-Path $AndroidDir 'src') -Recurse -File -Filter 'UpdateCore.java')
  if ($uc.Count -eq 0) { throw 'UpdateCore.java not found under android\src (the app has no updater: nothing to publish to).' }
  $mApi = [regex]::Match([IO.File]::ReadAllText($uc[0].FullName, $Utf8), 'NATIVE_API\s*=\s*(\d+)')
  if (-not $mApi.Success) { throw "NATIVE_API constant not found in $($uc[0].FullName)" }
  $nativeApi = [int]$mApi.Groups[1].Value
  Note "Native  : NATIVE_API = $nativeApi"

  # ---- what is published now
  $manPath = Join-Path $OutDir 'update.properties'
  $sigPath = Join-Path $OutDir 'update.properties.sig'
  $prev = Read-Props $manPath
  $state = Read-Props (Join-Path $StateDir 'publish-state.properties')
  $prevContent = Get-Long $prev 'content.version'
  $prevApk = Get-Long $prev 'apk.versionCode'
  if ($prevContent -gt 0) { Note "Before  : content $prevContent, APK $prevApk" } else { Note 'Before  : nothing published yet' }

  $UpdateSourcesN = $UpdateSources.Trim()
  if (-not $UpdateSourcesN) { $UpdateSourcesN = 'lan' }
  $nativeHash = Get-NativeHash $AndroidDir $UpdateSourcesN
  $prevApkFile = if ($prev.ContainsKey('apk.file')) { [string]$prev['apk.file'] } else { '' }
  $prevApkOk = $prevApk -gt 0 -and $prevApkFile -match $NameRx -and (Test-Path -LiteralPath (Join-Path $OutDir $prevApkFile)) -and
               $prev.ContainsKey('apk.sha256') -and ((Get-Sha256 (Join-Path $OutDir $prevApkFile)) -eq [string]$prev['apk.sha256'])
  $stateMatches = $state.ContainsKey('nativeHash') -and ([string]$state['nativeHash'] -eq $nativeHash) -and ((Get-Long $state 'apkVersionCode') -eq $prevApk)

  $version = [Math]::Max((Get-MinutesNow), [Math]::Max($prevContent, $prevApk) + 1)
  $newApk = $null      # path of an APK to publish now, or $null = keep the published one
  $assets = $null

  if ($ApkPath) {
    # ---- publish a given APK: its own assets/ are the content
    if (-not (Test-Path -LiteralPath $ApkPath)) { throw "APK not found: $ApkPath" }
    $work = Join-Path $BuildDir 'publish-apk'
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $apkCopy = Join-Path $work 'given.apk'
    Copy-Item -LiteralPath $ApkPath -Destination $apkCopy -Force
    $assets = Join-Path $work 'assets'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zr = [IO.Compression.ZipFile]::OpenRead($apkCopy)
    try {
      $assetRoot = [IO.Path]::GetFullPath($assets) + '\'
      foreach ($e in $zr.Entries) {
        if (-not $e.FullName.StartsWith('assets/') -or $e.FullName.EndsWith('/')) { continue }
        $rel = $e.FullName.Substring(7)
        if ($rel.Contains('\') -or $rel.Contains('..') -or $rel.Contains(':')) { throw "Bad asset name in the APK: $($e.FullName)" }
        $dest = [IO.Path]::GetFullPath((Join-Path $assets ($rel.Replace('/', '\'))))
        if (-not $dest.StartsWith($assetRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Bad asset name in the APK: $($e.FullName)" }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
      }
    } finally { $zr.Dispose() }
    $cvf = Join-Path $assets 'content-version.txt'
    if (-not (Test-Path -LiteralPath $cvf)) { throw 'This APK has no assets/content-version.txt (built with an old build.ps1?).' }
    $version = [long]([IO.File]::ReadAllText($cvf, $Utf8).Trim())
    if ($version -le [Math]::Max($prevContent, $prevApk)) { throw "This APK (content version $version) is not newer than what is published (content $prevContent, APK $prevApk)." }
    $newApk = $apkCopy
    $nativeHash = 'apk:' + (Get-Sha256 $apkCopy)
  } else {
    $needApk = $ForceApk -or -not $prevApkOk -or -not $stateMatches
    $why = if ($ForceApk) { '-ForceApk' } elseif (-not $prevApkOk) { 'no published APK yet' } elseif (-not $stateMatches) { 'the Android part changed' } else { '' }
    $bargs = @('-BuildDir', $BuildDir, '-VersionCode', "$version", '-UpdateSources', $UpdateSourcesN,
               '-KeyStore', $KeyStore, '-KeyAlias', $KeyAlias, '-PasswordFile', $PasswordFile, '-Jdk', $Jdk, '-Sdk', $Sdk)
    if ($VersionName) { $bargs += @('-VersionName', $VersionName) }
    if ($needApk) {
      Say "Building a new APK, version $version ($why)"
      $rc = Invoke-Build $bargs
      if ($rc -eq 3) { $script:ExitCode = 3; throw 'build.ps1 stopped: the signing key differs from signing-cert.txt.' }
      if ($rc -ne 0) { throw "build.ps1 failed (exit code $rc)." }
      $newApk = Join-Path $BuildDir 'bin\DroneSim.apk'
    } else {
      Say "Web content only, version $version (the Android part did not change: no reinstall on the TV)"
      $rc = Invoke-Build ($bargs + @('-StageOnly'))
      if ($rc -ne 0) { throw "build.ps1 -StageOnly failed (exit code $rc)." }
    }
    $assets = Join-Path $BuildDir 'proj\assets'
  }

  # ---- check the APK that will be offered
  $pinned = Read-PinnedCert $pinFile
  if (-not $pinned) { throw 'signing-cert.txt is missing (build.ps1 creates it).' }
  if ($newApk) {
    $f = Get-ApkFacts $newApk
    if ($f.Package -ne $Package) { throw "APK package is $($f.Package), expected $Package." }
    if ($f.Cert -ne $pinned) { $script:ExitCode = 3; Show-KeyMismatch $f.Cert $pinned; throw 'APK signing key differs from signing-cert.txt.' }
    if ($f.Code -le $prevApk) { throw "APK versionCode $($f.Code) is not higher than the published $prevApk." }
    if ($f.Code -ne $version) { Warn "APK versionCode $($f.Code) differs from content version $version." }
    $apkName = "DroneSim-$($f.Code).apk"
    $apkDest = Join-Path $OutDir $apkName
    Copy-Item -LiteralPath $newApk -Destination ($apkDest + '.tmp') -Force
    Move-Item -LiteralPath ($apkDest + '.tmp') -Destination $apkDest -Force
    $apk = @{ Code = $f.Code; Name = $f.Name; File = $apkName; Size = (Get-Item -LiteralPath $apkDest).Length; Sha = (Get-Sha256 $apkDest) }
    Note ("APK     : {0} ({1:N1} MB, versionCode {2}, {3})" -f $apkName, ($apk.Size / 1MB), $apk.Code, $apk.Name)
  } else {
    $apk = @{ Code = $prevApk; Name = [string]$prev['apk.versionName']; File = $prevApkFile
              Size = (Get-Item -LiteralPath (Join-Path $OutDir $prevApkFile)).Length; Sha = [string]$prev['apk.sha256'] }
    Note "APK     : unchanged ($prevApkFile)"
  }

  # ---- content zip
  $info = Test-ContentDir $assets $version
  $zipName = "content-$version.zip"
  $zipPath = Join-Path $OutDir $zipName
  New-ContentZip $info $zipPath
  $zipSize = (Get-Item -LiteralPath $zipPath).Length
  $zipSha = Get-Sha256 $zipPath
  Note ("Content : {0} ({1} files, {2:N1} MB unpacked, {3:N1} MB zip)" -f $zipName, $info.Files, ($info.Bytes / 1MB), ($zipSize / 1MB))

  # ---- manifest
  $noteText = $Notes
  if ($NotesFile) { $noteText = [IO.File]::ReadAllText($NotesFile, $Utf8).TrimStart([char]0xFEFF).Trim() }
  if (-not $noteText) { $noteText = $AR_DefaultNotes }
  $published = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $lines = @(
    '# DroneSim update manifest - signed by update.properties.sig (do not edit by hand: the TV would ignore it)',
    'format=1',
    "published=$published",
    "content.version=$version",
    "content.file=$zipName",
    "content.size=$zipSize",
    "content.sha256=$zipSha",
    "content.minNative=$nativeApi",
    "apk.versionCode=$($apk.Code)",
    ('apk.versionName=' + (ConvertTo-PropValue $apk.Name)),
    "apk.file=$($apk.File)",
    "apk.size=$($apk.Size)",
    "apk.sha256=$($apk.Sha)",
    ('notes=' + (ConvertTo-PropValue $noteText)))
  if ($Sources) { $lines += ('sources=' + (Normalize-Urls $Sources)) }
  foreach ($n in @($zipName, $apk.File)) { if ($n -notmatch $NameRx) { throw "Bad file name in manifest: $n" } }
  $manTmp = $manPath + '.tmp'
  $sigTmp = $sigPath + '.tmp'
  [IO.File]::WriteAllText($manTmp, (($lines -join "`n") + "`n"), $Utf8)

  Say 'Signing the manifest'
  $o = Get-ToolOutput $script:java @($signSrc, 'sign', $KeyStore, $KeyAlias, $manTmp, $sigTmp)
  if ($LASTEXITCODE -ne 0) { $o | Out-Host; throw 'SignUpdate sign failed.' }
  $o = Get-ToolOutput $script:java @($signSrc, 'verify', $KeyStore, $KeyAlias, $manTmp, $sigTmp)
  if ($LASTEXITCODE -ne 0) { $o | Out-Host; throw 'The new signature does not verify.' }
  Move-Item -LiteralPath $manTmp -Destination $manPath -Force
  Move-Item -LiteralPath $sigTmp -Destination $sigPath -Force
  Note 'update.properties + update.properties.sig written (signature verified)'

  # ---- remember what was published; keep the newest versions only
  $st = @('# publish-update.ps1 state (PC only, not served)', "nativeHash=$nativeHash", "apkVersionCode=$($apk.Code)",
          "contentVersion=$version", ("publishedAt=" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')))
  [IO.File]::WriteAllText((Join-Path $StateDir 'publish-state.properties'), (($st -join "`n") + "`n"), $Utf8)
  Remove-Old $OutDir 'content-' '.zip' $Keep $zipName
  Remove-Old $OutDir 'DroneSim-' '.apk' $Keep $apk.File
  Get-ChildItem -LiteralPath $OutDir -File -Filter '*.tmp' | Remove-Item -Force

  Write-Host ''
  Say ("Published: content {0}{1}" -f $version, $(if ($newApk) { ", NEW APK $($apk.Code) (the TV will ask to install it; progress is kept)" } else { ", APK $($apk.Code) unchanged (the TV updates without asking)" }))
  Note 'Serve it to the TV on this Wi-Fi:  .\serve-updates.ps1   (or double-click the desktop shortcut: publish + serve)'
  exit 0
}
catch {
  Write-Host ''
  Write-Host "PUBLISH FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit $script:ExitCode
}
finally {
  if ($setEnv) { Remove-Item Env:\DS_KS_PASS -ErrorAction SilentlyContinue }
}
