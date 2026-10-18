<#
.SYNOPSIS
  Downloads the smallest toolchain needed to build the Android TV app (no Android Studio, no Gradle).

.DESCRIPTION
  "Route B" from the TV research (about 330 MB of downloads):
    * Eclipse Temurin JDK 17, Windows x64 zip      -> C:\tools\jdk-17
        checked with the SHA-256 published by api.adoptium.net
    * Android SDK Build-Tools 35.0.0 (aapt2, d8, zipalign, apksigner)
                                                    -> C:\tools\android-sdk\build-tools\35.0.0
    * Android SDK Platform 34 (android.jar)         -> C:\tools\android-sdk\platforms\android-34
    * Android SDK Platform-Tools 37.0.1 (adb)       -> C:\tools\android-sdk\platform-tools
        the three Android zips are checked against the SHA-1 values in Google's official index
        https://dl.google.com/android/repository/repository2-3.xml (Google publishes SHA-1 only)
    * three.js r149 (three.min.js, ~0.6 MB)         -> <simulator>\lib\three.min.js  (offline 3D)
        checked with the SHA-256 published by data.jsdelivr.com when reachable

  Prints every file with its size and asks before downloading anything (-Yes skips the question).
  Downloading the Android SDK parts means you accept the Android SDK License Agreement:
  https://developer.android.com/studio/terms

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-toolchain.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-toolchain.ps1 -ToolsDir D:\tools -Yes
#>
[CmdletBinding()]
param(
  [string]$ToolsDir = 'C:\tools',
  [switch]$Yes,          # do not ask for confirmation
  [switch]$Force,        # re-download / re-extract even if already present
  [switch]$SkipJdk,
  [switch]$SkipAndroid,
  [switch]$SkipThree,
  [string]$JdkZip = ''   # use a JDK 17 zip you downloaded yourself (no checksum check)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ---- pinned Android packages (from repository2-3.xml, October 2026)
$RepoBase = 'https://dl.google.com/android/repository/'
$AndroidPkgs = @(
  @{ Name = 'Android Build-Tools 35.0.0'; File = 'build-tools_r35_windows.zip';   Size = 59878107; Sha1 = 'af059bb67cf7786f45ee0db85e2d24985df1b4b6'; Target = 'android-sdk\build-tools\35.0.0' },
  @{ Name = 'Android Platform 34';        File = 'platform-34-ext7_r03.zip';     Size = 63180081; Sha1 = '1f2e9478d6a7601425ceaa553311dc43191f103d'; Target = 'android-sdk\platforms\android-34' },
  @{ Name = 'Android Platform-Tools (adb)'; File = 'platform-tools_r37.0.1-win.zip'; Size = 8044989; Sha1 = 'e03e78b1d80b396f1c3358e31251cb31740e1110'; Target = 'android-sdk\platform-tools' }
)
$AdoptiumApi = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
$ThreeUrl    = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js'
$ThreeMeta   = @('https://data.jsdelivr.com/v1/packages/npm/three@0.149.0?structure=flat',
                 'https://data.jsdelivr.com/v1/package/npm/three@0.149.0/flat')

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note([string]$m) { Write-Host "    $m" }
function Warn([string]$m) { Write-Host "WARNING: $m" -ForegroundColor Yellow }
function Mb([double]$bytes) { return ('{0:N1} MB' -f ($bytes / 1MB)) }

function Get-Download([string]$Url, [string]$Dest) {
  $part = "$Dest.part"
  if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
  $curl = Get-Command 'curl.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($curl) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $curl.Source -L --fail --retry 3 --retry-delay 2 -o $part $Url } finally { $ErrorActionPreference = $old }
    if ($LASTEXITCODE -ne 0) { throw "Download failed (curl exit $LASTEXITCODE): $Url" }
  } else {
    $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'   # PS 5.1 progress bar is very slow
    try { Invoke-WebRequest -Uri $Url -OutFile $part -UseBasicParsing } finally { $ProgressPreference = $old }
  }
  Move-Item -LiteralPath $part -Destination $Dest -Force
}

function Test-FileHash([string]$File, [string]$Algo, [string]$Expected) {
  if (-not $Expected) { return $true }
  $h = (Get-FileHash -LiteralPath $File -Algorithm $Algo).Hash
  return ($h -ieq $Expected)
}

# Extract a zip and move its single top folder (whatever it is called, e.g. "android-15") to $Target.
function Expand-To([string]$Zip, [string]$Target, [string]$Work) {
  if (Test-Path -LiteralPath $Target) {
    if (-not $Force) { Note "Already there, skipped: $Target"; return }
    Remove-Item -LiteralPath $Target -Recurse -Force
  }
  $tmp = Join-Path $Work ('x_' + [IO.Path]::GetFileNameWithoutExtension($Zip))
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  Note "Extracting $([IO.Path]::GetFileName($Zip)) ..."
  [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $tmp)
  $top = @(Get-ChildItem -LiteralPath $tmp -Force)
  $src = if ($top.Count -eq 1 -and $top[0].PSIsContainer) { $top[0].FullName } else { $tmp }
  $parent = Split-Path -Parent $Target
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Move-Item -LiteralPath $src -Destination $Target
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  Note "-> $Target"
}

try {
  if ($ToolsDir -match '[^\x20-\x7E]') { throw "-ToolsDir must contain only English letters/numbers (Java tools cannot use Arabic paths): $ToolsDir" }
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # android\tools -> simulator folder
  $ThreeDest = Join-Path $ProjectRoot 'lib\three.min.js'
  $Downloads = Join-Path $ToolsDir 'downloads'

  # ---------------------------------------------------------------- plan
  Say 'Checking what is needed'
  $plan = New-Object System.Collections.ArrayList

  if (-not $SkipJdk) {
    $jdkTarget = Join-Path $ToolsDir 'jdk-17'
    if ((Test-Path -LiteralPath (Join-Path $jdkTarget 'bin\javac.exe')) -and -not $Force) {
      Note "JDK 17 already installed: $jdkTarget"
    } elseif ($JdkZip) {
      if (-not (Test-Path -LiteralPath $JdkZip)) { throw "-JdkZip not found: $JdkZip" }
      [void]$plan.Add(@{ Name = 'Temurin JDK 17 (your zip)'; Url = ''; Local = $JdkZip; Size = (Get-Item -LiteralPath $JdkZip).Length; Algo = ''; Hash = ''; Kind = 'zip'; Target = $jdkTarget })
    } else {
      try { $assets = Invoke-RestMethod -Uri $AdoptiumApi -UseBasicParsing }
      catch { throw "Could not ask api.adoptium.net for the JDK ($($_.Exception.Message)). Download the 'JDK 17 - Windows x64 - .zip' from https://adoptium.net/temurin/releases/?version=17 and run again with -JdkZip <file>." }
      $pkg = $null; $rel = ''
      foreach ($a in @($assets)) {
        if ($a.binary -and $a.binary.package -and $a.binary.package.name -like '*.zip') { $pkg = $a.binary.package; $rel = [string]$a.release_name; break }
      }
      if (-not $pkg) { throw 'api.adoptium.net returned no JDK 17 zip for Windows x64.' }
      [void]$plan.Add(@{ Name = "Temurin JDK 17 ($rel)"; Url = [string]$pkg.link; Local = (Join-Path $Downloads ([string]$pkg.name)); Size = [long]$pkg.size; Algo = 'SHA256'; Hash = [string]$pkg.checksum; Kind = 'zip'; Target = $jdkTarget })
    }
  }

  if (-not $SkipAndroid) {
    foreach ($p in $AndroidPkgs) {
      $target = Join-Path $ToolsDir $p.Target
      if ((Test-Path -LiteralPath $target) -and -not $Force) { Note "$($p.Name) already installed: $target"; continue }
      [void]$plan.Add(@{ Name = $p.Name; Url = $RepoBase + $p.File; Local = (Join-Path $Downloads $p.File); Size = [long]$p.Size; Algo = 'SHA1'; Hash = $p.Sha1; Kind = 'zip'; Target = $target })
    }
  }

  if (-not $SkipThree) {
    if ((Test-Path -LiteralPath $ThreeDest) -and -not $Force) {
      Note "three.min.js already there: $ThreeDest"
    } else {
      $tHash = ''; $tSize = [long]620000
      foreach ($u in $ThreeMeta) {
        try {
          $meta = Invoke-RestMethod -Uri $u -UseBasicParsing
          foreach ($f in @($meta.files)) {
            if ($f.name -eq '/build/three.min.js') {
              $tHash = -join ([Convert]::FromBase64String([string]$f.hash) | ForEach-Object { $_.ToString('x2') })
              if ($f.size) { $tSize = [long]$f.size }
            }
          }
          if ($tHash) { break }
        } catch { }
      }
      if (-not $tHash) { Warn 'Could not get the three.js checksum from data.jsdelivr.com; the file will be checked by size/content only.' }
      [void]$plan.Add(@{ Name = 'three.js r149 (three.min.js)'; Url = $ThreeUrl; Local = $ThreeDest; Size = $tSize; Algo = 'SHA256'; Hash = $tHash; Kind = 'file'; Target = $ThreeDest })
    }
  }

  if ($plan.Count -eq 0) { Say 'Everything is already installed. Next: android\build.ps1'; exit 0 }

  # ---------------------------------------------------------------- confirm
  $total = [long]0
  Write-Host ''
  Write-Host 'Will download:' -ForegroundColor White
  foreach ($i in $plan) {
    if ($i.Url) { $total += $i.Size }
    $check = if ($i.Hash) { "$($i.Algo) checked" } else { 'no checksum' }
    Write-Host ('  {0,-34} {1,10}   {2}' -f $i.Name, (Mb $i.Size), $check)
    if ($i.Url) { Write-Host "      from $($i.Url)" -ForegroundColor DarkGray }
    Write-Host "      to   $($i.Target)" -ForegroundColor DarkGray
  }
  Write-Host ('  Total download: about {0}  (about twice that on disk after extracting)' -f (Mb $total))
  Write-Host '  The Android SDK parts are under the Android SDK License: https://developer.android.com/studio/terms'
  $drive = (Split-Path -Qualifier $ToolsDir).TrimEnd(':')
  $free = (Get-PSDrive -Name $drive -ErrorAction SilentlyContinue)
  if ($free -and $free.Free -lt (3 * $total)) { Warn ("Only {0} free on drive {1}, you may run out of space." -f (Mb $free.Free), $drive) }
  if (-not $Yes) {
    $ans = Read-Host 'Download now? (y/n)'
    if ($ans -notmatch '^(y|yes)$') { Say 'Cancelled. Nothing was downloaded.'; exit 1 }
  }

  # ---------------------------------------------------------------- download + verify + extract
  New-Item -ItemType Directory -Force -Path $ToolsDir, $Downloads | Out-Null
  foreach ($i in $plan) {
    Say $i.Name
    if ($i.Url) {
      $have = (Test-Path -LiteralPath $i.Local) -and -not $Force -and $i.Hash -and (Test-FileHash $i.Local $i.Algo $i.Hash)
      if ($have) { Note 'Already downloaded and verified.' }
      else {
        $dir = Split-Path -Parent $i.Local
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Get-Download $i.Url $i.Local
        if (-not (Test-FileHash $i.Local $i.Algo $i.Hash)) {
          Remove-Item -LiteralPath $i.Local -Force
          throw "$($i.Name): checksum mismatch ($($i.Algo)). The file was deleted; run the script again."
        }
        Note $(if ($i.Hash) { "$($i.Algo) OK" } else { 'downloaded (not verified)' })
      }
    }
    if ($i.Kind -eq 'zip') {
      Expand-To $i.Local $i.Target $ToolsDir
    } elseif (-not $i.Hash) {
      $len = (Get-Item -LiteralPath $i.Local).Length
      $head = if ($len -ge 300000) { [IO.File]::ReadAllText($i.Local).Substring(0, 400) } else { '' }
      if ($head -notmatch 'three') { Remove-Item -LiteralPath $i.Local -Force; throw 'three.min.js does not look right; deleted it.' }
    }
  }

  # ---------------------------------------------------------------- report
  Write-Host ''
  Say 'Installed:'
  $checks = [ordered]@{
    'JDK 17 (javac)'      = Join-Path $ToolsDir 'jdk-17\bin\javac.exe'
    'aapt2'               = Join-Path $ToolsDir 'android-sdk\build-tools\35.0.0\aapt2.exe'
    'd8.jar'              = Join-Path $ToolsDir 'android-sdk\build-tools\35.0.0\lib\d8.jar'
    'apksigner.jar'       = Join-Path $ToolsDir 'android-sdk\build-tools\35.0.0\lib\apksigner.jar'
    'zipalign'            = Join-Path $ToolsDir 'android-sdk\build-tools\35.0.0\zipalign.exe'
    'android.jar (34)'    = Join-Path $ToolsDir 'android-sdk\platforms\android-34\android.jar'
    'adb'                 = Join-Path $ToolsDir 'android-sdk\platform-tools\adb.exe'
    'three.min.js'        = $ThreeDest
  }
  foreach ($k in $checks.Keys) {
    $ok = Test-Path -LiteralPath $checks[$k]
    Write-Host ('  {0,-18} {1}  {2}' -f $k, $(if ($ok) { 'OK     ' } else { 'MISSING' }), $checks[$k]) -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' })
  }
  if ($ToolsDir.TrimEnd('\') -ne 'C:\tools') {
    Note "build.ps1 looks in C:\tools by default. Use:  .\build.ps1 -Jdk `"$ToolsDir\jdk-17`" -Sdk `"$ToolsDir\android-sdk`""
  }
  Note ("You can delete the downloads folder to save space: $Downloads")
  Say 'Next: powershell -ExecutionPolicy Bypass -File ..\build.ps1'
  exit 0
}
catch {
  Write-Host ''
  Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
