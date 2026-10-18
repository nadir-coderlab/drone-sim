<#
.SYNOPSIS
  Builds the Android TV app (DroneSim.apk) of the drone simulator. No Gradle, no Android Studio.

.DESCRIPTION
  1. Copies the simulator (index.html, js\, lib\ and any other asset folders; never android\ or .git) into a
     staging folder and injects web\native-shim.js as the first script of the staged index.html.
     Also writes assets\content-version.txt (= versionCode: the version of the web content inside this APK)
     and assets\update-config.properties (sources=<-UpdateSources>, where the app looks for updates).
  2. Creates the TV banner (320x180) and launcher icons in res\ if they are missing (System.Drawing).
  3. aapt2 compile + link, javac, d8, aapt add, zipalign, apksigner sign + verify.
  4. Checks the signing certificate against android\signing-cert.txt (the key of the app on the TV) and stops
     if it differs (exit code 3), so an APK that could not update the installed app is never produced by accident.
  5. Copies the signed APK next to this script: android\DroneSim.apk

  Updates keep the saved progress only if the package name stays com.nadir.dronesim, the versionCode grows
  (automatic: minutes since 2025-01-01 UTC) and the APK is signed with the SAME key. Back up %USERPROFILE%\.dronesim\.

  The work folder (-BuildDir) must be an ASCII-only path: Java tools (javac, d8, apksigner) cannot open paths
  with Arabic letters on most Windows setups, and this project lives in an Arabic-named folder.

  Install the tools first with:  tools\setup-toolchain.ps1   (JDK 17 + Android build-tools 35 + platform 34)

  Keystore password: $env:DS_KS_PASS, else the file keystore-password.txt next to the keystore
  (%USERPROFILE%\.dronesim\keystore-password.txt), else a prompt (and the typed password is then saved there).

  Exit codes: 0 ok, 1 failed, 3 signing key differs from signing-cert.txt.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build.ps1
  Normal (release) build.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build.ps1 -Dev
  Dev build: debuggable (chrome://inspect from the PC) and "--es url" launch extra honoured (LAN dev server).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build.ps1 -UpdateSources 'lan;https://example.github.io/dronesim/'
  The app looks for updates on the PC on the same Wi-Fi first, then on that web site (see publish-update.ps1).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build.ps1 -StageOnly
  Only stage the web files and make the icons (no JDK / SDK needed). Good for checking what goes in the APK.
#>
[CmdletBinding()]
param(
  # ---------------- configurable paths (env vars DS_JDK / DS_SDK / DS_BUILD / DS_KEYSTORE override) -------
  [string]$Jdk         = $(if ($env:DS_JDK)      { $env:DS_JDK }      else { 'C:\tools\jdk-17' }),
  [string]$Sdk         = $(if ($env:DS_SDK)      { $env:DS_SDK }      else { 'C:\tools\android-sdk' }),
  [string]$BuildDir    = $(if ($env:DS_BUILD)    { $env:DS_BUILD }    else { 'C:\tools\dronesim-build' }),
  [string]$KeyStore    = $(if ($env:DS_KEYSTORE) { $env:DS_KEYSTORE } else { "$env:USERPROFILE\.dronesim\dronesim-release.keystore" }),
  [string]$BuildTools  = '35.0.0',
  [int]$Platform       = 34,
  [int]$MinSdk         = 24,
  [int]$TargetSdk      = 34,
  [string]$KeyAlias    = 'dronesim',
  [string]$PasswordFile = '',      # default: keystore-password.txt next to the keystore
  [string]$VersionName = '',       # default: 2.0.<versionCode>
  [int]$VersionCode    = 0,        # 0 = automatic (minutes since 2025-01-01 UTC, always increasing)
  [string]$UpdateSources = 'lan',  # ';'-separated: 'lan' and/or base URLs (https://host/path/) of published updates
  [string]$Out         = '',       # default: android\DroneSim.apk
  [switch]$Dev,
  [switch]$StageOnly,
  [switch]$AllowNewKey             # accept a signing key that differs from signing-cert.txt (and pin the new one)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ------------------------------------------------------------------------------------------------ helpers
function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note([string]$m) { Write-Host "    $m" }
function Warn([string]$m) { Write-Host "WARNING: $m" -ForegroundColor Yellow }

function Test-Ascii([string]$s) { return -not ($s -match '[^\x20-\x7E]') }

# Run a native tool; arguments are passed one by one (no string joining), stops on a non-zero exit code.
function Invoke-Tool([string]$Exe, [string[]]$ToolArgs, [string]$What) {
  Write-Verbose ("$Exe " + ($ToolArgs -join ' '))
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'   # tools print warnings on stderr; only the exit code matters
  try { & $Exe @ToolArgs | Out-Host } finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

# Same, but returns stdout+stderr as strings and never throws.
function Get-ToolOutput([string]$Exe, [string[]]$ToolArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $o = & $Exe @ToolArgs 2>&1 | ForEach-Object { "$_" } } catch { $o = @("$_") } finally { $ErrorActionPreference = $old }
  return @($o)
}

function First-Existing([string[]]$Paths) {
  foreach ($p in $Paths) { if (Test-Path -LiteralPath $p) { return $p } }
  return $null
}

function Reset-Dir([string]$Path) {
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

# Recursive copy with exclusions. $SkipTopDirs only applies to the first level; dot-folders are always skipped.
function Copy-Tree([string]$From, [string]$To, [string[]]$SkipTopDirs, [string[]]$SkipFiles) {
  $root = (Resolve-Path -LiteralPath $From).ProviderPath.TrimEnd('\')
  $files = 0; $bytes = [long]0
  $stack = New-Object System.Collections.Stack
  $stack.Push($root)
  while ($stack.Count -gt 0) {
    $dir = [string]$stack.Pop()
    foreach ($item in @(Get-ChildItem -LiteralPath $dir -Force)) {
      $rel = $item.FullName.Substring($root.Length + 1)
      if ($item.PSIsContainer) {
        if ($item.Name.StartsWith('.')) { continue }
        if (($dir -eq $root) -and ($SkipTopDirs -contains $item.Name)) { continue }
        $stack.Push($item.FullName)
        continue
      }
      $skip = $item.Name.StartsWith('.')
      foreach ($pat in $SkipFiles) { if ($item.Name -like $pat) { $skip = $true } }
      if ($skip) { continue }
      $dest = Join-Path $To $rel
      $destDir = Split-Path -Parent $dest
      if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
      Copy-Item -LiteralPath $item.FullName -Destination $dest -Force
      $files++; $bytes += $item.Length
    }
  }
  return @{ Files = $files; Bytes = $bytes }
}

function Read-Password([string]$Prompt) {
  $ss = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Keystore password file: UTF-8, the password alone (a trailing newline / BOM is ignored). Never printed.
function Read-PasswordFile([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
  $t = [IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))
  return $t.TrimStart([char]0xFEFF).TrimEnd("`r", "`n")
}
function Save-PasswordFile([string]$Path, [string]$Pass) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($Path, $Pass, (New-Object System.Text.UTF8Encoding($false)))
}

# signing-cert.txt: '#' comment lines + one line with the 64-hex SHA-256 of the release certificate.
function Read-PinnedCert([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  foreach ($l in [IO.File]::ReadAllLines($Path)) {
    $t = $l.Trim().ToLowerInvariant()
    if ($t -match '^[0-9a-f]{64}$') { return $t }
  }
  return ''
}
function Write-PinnedCert([string]$Path, [string]$Sha, [string]$Previous) {
  $lines = @(
    '# SHA-256 of the release signing certificate (apksigner verify --print-certs).',
    '# This is the key of the app already installed on the TV. build.ps1, publish-update.ps1 and install-tv.ps1',
    '# refuse any APK / update signed with another key (Android would refuse it as an update: the app would have to be',
    '# deleted and the saved progress would be lost). Only build.ps1 -AllowNewKey may replace this line.')
  if ($Previous) { $lines += ('# previous key (replaced with -AllowNewKey on ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '): ' + $Previous) }
  $lines += $Sha
  [IO.File]::WriteAllText($Path, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
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

# 'lan;https://host/path' -> 'lan;https://host/path/'. Validated with the app's own rules (UpdateCore.normalizeBase),
# so a source the app would silently ignore is refused here instead.
function Normalize-Sources([string]$s) {
  $out = @()
  foreach ($p in ($s -split ';')) {
    $p = $p.Trim()
    if (-not $p) { continue }
    if ($p -ieq 'lan') { $out += 'lan'; continue }
    $m = [regex]::Match($p, '^(https?)://([A-Za-z0-9.\-]+)(:(\d{1,5}))?(/[A-Za-z0-9._~%+/\-]*)?$', 'IgnoreCase')
    if (-not $m.Success -or $p.Contains('..') -or $p.Substring($m.Groups[1].Length + 3).Contains('//') -or
        ($m.Groups[4].Success -and ([int]$m.Groups[4].Value -lt 1 -or [int]$m.Groups[4].Value -gt 65535))) {
      throw "-UpdateSources: '$p' is not 'lan' or a web address like https://example.github.io/dronesim/"
    }
    if ($m.Groups[1].Value -ieq 'http' -and -not (Test-LanIpv4 $m.Groups[2].Value)) {
      throw "-UpdateSources: '$p' uses plain http. The app accepts http only for a PC on the same Wi-Fi (an address like http://192.168.1.5:47801/); use https:// for web sites."
    }
    if (-not $p.EndsWith('/')) { $p += '/' }
    $out += $p
  }
  if ($out.Count -eq 0) { $out = @('lan') }
  return ($out -join ';')
}

# Arabic messages, built from code points so this file stays pure ASCII.
$AR_KeyMismatch = [regex]::Unescape('\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u063A\u0644\u0637\u060C \u0641\u0648\u0642\u0651\u0641\u0646\u0627 \u0627\u0644\u0628\u0646\u0627\u0621! \u0647\u0630\u0627 \u0645\u0648 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0648\u0642\u064A\u0639 \u062D\u0642 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0644\u064A \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646. \u0644\u0648 \u0643\u0645\u0651\u0644\u0646\u0627\u060C \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0628\u064A\u0631\u0641\u0636 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0648\u0644\u0627\u0632\u0645 \u062A\u062D\u0630\u0641 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0636\u064A\u0639 \u062A\u0642\u062F\u0651\u0645\u0643. \u0631\u062C\u0651\u0639 \u0645\u0644\u0641 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0623\u0635\u0644\u064A \u0645\u0646 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u0644\u0645\u062C\u0644\u062F \u200E.dronesim\u200E \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629.')
$AR_NewKeyAllowed = [regex]::Unescape('\u0627\u0646\u062A\u0628\u0647: \u063A\u064A\u0651\u0631\u062A \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0648\u0642\u064A\u0639. \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0644\u064A \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0645\u0627 \u0628\u064A\u0642\u0628\u0644 \u0647\u0627\u0644\u0646\u0633\u062E\u0629 \u0643\u062A\u062D\u062F\u064A\u062B\u060C \u0648\u0644\u0627\u0632\u0645 \u062A\u062D\u0630\u0641\u0647 \u0623\u0648\u0644 \u0648\u064A\u0636\u064A\u0639 \u062A\u0642\u062F\u0651\u0645\u0643.')
$script:ExitCode = 1

# ------------------------------------------------------------------------------------------------ icons
# Arabic app name ("Drone Simulator") built from code points, so this file stays pure ASCII
# (Windows PowerShell 5.1 reads BOM-less files as ANSI).
$ArabicTitle = -join ([char[]](0x0645, 0x062D, 0x0627, 0x0643, 0x064A, 0x0020, 0x0627, 0x0644, 0x062F, 0x0631, 0x0648, 0x0646))

function New-RoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [float](2 * $r)
  $p.AddArc([float]$x, [float]$y, $d, $d, [float]180, [float]90)
  $p.AddArc([float]($x + $w - $d), [float]$y, $d, $d, [float]270, [float]90)
  $p.AddArc([float]($x + $w - $d), [float]($y + $h - $d), $d, $d, [float]0, [float]90)
  $p.AddArc([float]$x, [float]($y + $h - $d), $d, $d, [float]90, [float]90)
  $p.CloseFigure()
  return $p
}

# Top view of a quadcopter: X arms, 4 rotor discs, body, front camera dot. Front = up.
function Draw-Drone($g, [float]$cx, [float]$cy, [float]$size) {
  $white = [System.Drawing.Color]::FromArgb(255, 238, 243, 248)
  $acc   = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)
  $disc  = [System.Drawing.Color]::FromArgb(70, 56, 189, 248)
  $d  = [float]($size * 0.34 * 0.7071)
  $rr = [float]($size * 0.165)
  $armPen = New-Object System.Drawing.Pen($white, [float]($size * 0.075))
  $armPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $armPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $rotorPen = New-Object System.Drawing.Pen($acc, [float]([Math]::Max(1.0, $size * 0.035)))
  $discBrush = New-Object System.Drawing.SolidBrush($disc)
  $hubBrush = New-Object System.Drawing.SolidBrush($white)
  foreach ($s in @(@(-1, -1), @(1, -1), @(1, 1), @(-1, 1))) {
    $x = [float]($cx + $s[0] * $d); $y = [float]($cy + $s[1] * $d)
    $g.DrawLine($armPen, [float]$cx, [float]$cy, $x, $y)
  }
  foreach ($s in @(@(-1, -1), @(1, -1), @(1, 1), @(-1, 1))) {
    $x = [float]($cx + $s[0] * $d); $y = [float]($cy + $s[1] * $d)
    $g.FillEllipse($discBrush, [float]($x - $rr), [float]($y - $rr), [float](2 * $rr), [float](2 * $rr))
    $g.DrawEllipse($rotorPen, [float]($x - $rr), [float]($y - $rr), [float](2 * $rr), [float](2 * $rr))
    $hub = [float]($size * 0.035)
    $g.FillEllipse($hubBrush, [float]($x - $hub), [float]($y - $hub), [float](2 * $hub), [float](2 * $hub))
  }
  $bw = [float]($size * 0.22); $bh = [float]($size * 0.30)
  $body = New-RoundRectPath ([float]($cx - $bw / 2)) ([float]($cy - $bh / 2)) $bw $bh ([float]($size * 0.07))
  $g.FillPath($hubBrush, $body)
  $camBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 14, 79, 114))
  $cam = [float]($size * 0.045)
  $g.FillEllipse($camBrush, [float]($cx - $cam), [float]($cy - $bh / 2 + $size * 0.03), [float](2 * $cam), [float](2 * $cam))
  foreach ($o in @($armPen, $rotorPen, $discBrush, $hubBrush, $camBrush, $body)) { $o.Dispose() }
}

function Pick-Font([string[]]$Names) {
  $have = @([System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name })
  foreach ($n in $Names) { if ($have -contains $n) { return $n } }
  return 'Arial'
}

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

function Save-Png($bmp, [string]$Path) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-Banner([string]$Path) {
  $c = New-Canvas 320 180; $bmp = $c[0]; $g = $c[1]
  $rect = New-Object System.Drawing.Rectangle(0, 0, 320, 180)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 14, 58, 86), [System.Drawing.Color]::FromArgb(255, 11, 17, 24), [float]90)
  $g.FillRectangle($bg, $rect)
  $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 56, 189, 248))
  $g.FillEllipse($glow, [float]8, [float]32, [float]116, [float]116)
  Draw-Drone $g 66 90 104
  $font = Pick-Font @('Segoe UI', 'Tahoma', 'Arial')
  $fAr = New-Object System.Drawing.Font($font, [float]30, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fEn = New-Object System.Drawing.Font($font, [float]15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 238, 243, 248))
  $blue  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 125, 211, 252))
  $fmt = New-Object System.Drawing.StringFormat([System.Drawing.StringFormatFlags]::DirectionRightToLeft)
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $fmtEn = New-Object System.Drawing.StringFormat
  $fmtEn.Alignment = [System.Drawing.StringAlignment]::Center
  $fmtEn.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($ArabicTitle, $fAr, $white, (New-Object System.Drawing.RectangleF([float]126, [float]42, [float]190, [float]56)), $fmt)
  $line = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 56, 189, 248), [float]2)
  $g.DrawLine($line, [float]160, [float]104, [float]282, [float]104)
  $g.DrawString('DRONE SIM', $fEn, $blue, (New-Object System.Drawing.RectangleF([float]126, [float]108, [float]190, [float]30)), $fmtEn)
  Save-Png $bmp $Path
  foreach ($o in @($bg, $glow, $fAr, $fEn, $white, $blue, $fmt, $fmtEn, $line, $g, $bmp)) { $o.Dispose() }
}

function New-LauncherIcon([int]$Size, [string]$Path) {
  $c = New-Canvas $Size $Size; $bmp = $c[0]; $g = $c[1]
  $m = [float]($Size * 0.04)
  $shape = New-RoundRectPath $m $m ([float]($Size - 2 * $m)) ([float]($Size - 2 * $m)) ([float]($Size * 0.22))
  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 14, 79, 114), [System.Drawing.Color]::FromArgb(255, 11, 17, 24), [float]90)
  $g.FillPath($bg, $shape)
  Draw-Drone $g ([float]($Size / 2)) ([float]($Size / 2)) ([float]($Size * 0.86))
  Save-Png $bmp $Path
  foreach ($o in @($shape, $bg, $g, $bmp)) { $o.Dispose() }
}

function Ensure-Icons([string]$ResDir) {
  $banner = Join-Path $ResDir 'drawable-xhdpi\banner.png'
  $icons = @(
    @{ Dir = 'mipmap-mdpi'; Size = 48 }, @{ Dir = 'mipmap-hdpi'; Size = 72 }, @{ Dir = 'mipmap-xhdpi'; Size = 96 },
    @{ Dir = 'mipmap-xxhdpi'; Size = 144 }, @{ Dir = 'mipmap-xxxhdpi'; Size = 192 })
  $made = @()
  $needDrawing = -not (Test-Path -LiteralPath $banner)
  foreach ($i in $icons) { if (-not (Test-Path -LiteralPath (Join-Path $ResDir "$($i.Dir)\ic_launcher.png"))) { $needDrawing = $true } }
  if (-not $needDrawing) { Note 'Icons: using the existing res\ banner and launcher icons.'; return }
  Add-Type -AssemblyName System.Drawing
  if (-not (Test-Path -LiteralPath $banner)) { New-Banner $banner; $made += 'drawable-xhdpi\banner.png (320x180)' }
  foreach ($i in $icons) {
    $p = Join-Path $ResDir "$($i.Dir)\ic_launcher.png"
    if (-not (Test-Path -LiteralPath $p)) { New-LauncherIcon $i.Size $p; $made += "$($i.Dir)\ic_launcher.png ($($i.Size)px)" }
  }
  foreach ($x in $made) { Note "Icon created: res\$x" }
}

# ------------------------------------------------------------------------------------------------ main
try {
  $AndroidDir  = $PSScriptRoot
  $ProjectRoot = Split-Path -Parent $AndroidDir
  if (-not $Out) { $Out = Join-Path $AndroidDir 'DroneSim.apk' }
  $utf8 = New-Object System.Text.UTF8Encoding($false)

  Say "Drone Simulator APK build ($(if ($Dev) { 'DEV' } else { 'release' }))"
  Note "Project : $ProjectRoot"
  Note "Work dir: $BuildDir"

  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'index.html'))) { throw "index.html not found in $ProjectRoot (build.ps1 must stay in the android\ folder of the simulator)." }
  if (-not [IO.Path]::IsPathRooted($BuildDir) -or $BuildDir.TrimEnd('\').Length -le 3) { throw "-BuildDir must be a full folder path like C:\tools\dronesim-build (got '$BuildDir')." }
  if (-not (Test-Ascii $BuildDir)) { throw "-BuildDir must contain only English letters/numbers (Java tools cannot read Arabic paths): $BuildDir" }

  # One number for both the APK versionCode and the version of the web content inside it (protocol P4).
  if ($VersionCode -le 0) {
    $VersionCode = [int][Math]::Floor(([DateTime]::UtcNow - (New-Object DateTime(2025, 1, 1, 0, 0, 0, [DateTimeKind]::Utc))).TotalMinutes)
  }
  if (-not $VersionName) { $VersionName = "2.0.$VersionCode" }
  $UpdateSources = Normalize-Sources $UpdateSources
  Note "Version : $VersionName (versionCode $VersionCode = content version)"
  Note "Updates : sources=$UpdateSources"

  # ---- 1. icons (kept in android\res so you can replace them with your own PNGs)
  Say 'Icons'
  Ensure-Icons (Join-Path $AndroidDir 'res')

  # ---- 2. stage project files into the ASCII work folder
  Say 'Staging files'
  $Proj   = Join-Path $BuildDir 'proj'
  $Assets = Join-Path $Proj 'assets'
  Reset-Dir $Proj
  New-Item -ItemType Directory -Force -Path $Assets | Out-Null

  $skipDirs  = @('android', 'node_modules', 'test', 'tests', 'tools', 'docs', 'build', 'dist')
  $skipFiles = @('*.md', '*.ps1', '*.bat', '*.cmd', '*.sh', '*.py', '*.apk', '*.aab', '*.keystore', '*.jks', '*.zip',
                 '*.log', '*.bak', '*.tmp', 'README*', 'LICENSE*', 'package.json', 'package-lock.json', 'Thumbs.db', 'desktop.ini')
  $st = Copy-Tree $ProjectRoot $Assets $skipDirs $skipFiles
  Note ("Web files: {0} files, {1:N1} MB" -f $st.Files, ($st.Bytes / 1MB))

  # native shim, injected as the first script (right after <head>, else before the first <script>)
  Copy-Item -LiteralPath (Join-Path $AndroidDir 'web\native-shim.js') -Destination (Join-Path $Assets 'native-shim.js') -Force
  $idx = Join-Path $Assets 'index.html'
  $html = [IO.File]::ReadAllText($idx, $utf8)
  $tag = '<script src="native-shim.js"></script>'
  if ($html.Contains('native-shim.js')) {
    Note 'index.html already loads native-shim.js'
  } else {
    $m = [regex]::Match($html, '<head(\s[^>]*)?>', 'IgnoreCase')
    if (-not $m.Success) { $m = [regex]::Match($html, '<script\b', 'IgnoreCase') }
    if ($m.Success) {
      $at = if ($m.Value -like '<head*') { $m.Index + $m.Length } else { $m.Index }
      $html = $html.Insert($at, "`n" + $tag + "`n")
    } else {
      Warn 'index.html has no <head> or <script>; native-shim.js appended at the end (voice/rumble bridge may load late).'
      $html = $html + "`n" + $tag + "`n"
    }
    [IO.File]::WriteAllText($idx, $html, $utf8)
    Note 'Injected native-shim.js into index.html (voice + rumble bridge)'
  }

  # update metadata read by the app (UpdateCore): bundled content version + where to look for updates
  [IO.File]::WriteAllText((Join-Path $Assets 'content-version.txt'), "$VersionCode", $utf8)
  $cfg = "# DroneSim updater settings (written by build.ps1; change with build.ps1 -UpdateSources)`n" +
         "# lan = ask the PC on the same Wi-Fi (UDP 47800, serve-updates.ps1); URLs = static hosts with update.properties`n" +
         "format=1`nsources=$UpdateSources`n"
  [IO.File]::WriteAllText((Join-Path $Assets 'update-config.properties'), $cfg, $utf8)
  Note "Wrote content-version.txt ($VersionCode) and update-config.properties"

  if (-not (Test-Path -LiteralPath (Join-Path $Assets 'lib\three.min.js'))) {
    Warn 'lib\three.min.js is missing: the app will download three.js from the internet at every start (and show nothing offline). Run tools\setup-toolchain.ps1 (it fetches three.js r149 into lib\) and build again.'
  }
  $odd = @(Get-ChildItem -LiteralPath $Assets -Recurse | Where-Object { (-not (Test-Ascii $_.Name)) -or ($_.PSIsContainer -and $_.Name.StartsWith('_')) })
  foreach ($o in $odd) { Warn "Asset name may be skipped or break URLs inside the APK: $($o.FullName.Substring($Assets.Length + 1))" }

  # manifest, sources, resources. The manifest is used as it is: dev vs release is only "aapt2 link --debug-mode"
  # (ApplicationInfo.FLAG_DEBUGGABLE). Plain HTTP for the LAN updater comes from res/xml/network_security_config.xml.
  $man = [IO.File]::ReadAllText((Join-Path $AndroidDir 'AndroidManifest.xml'), $utf8)
  $ProjManifest = Join-Path $Proj 'AndroidManifest.xml'
  [IO.File]::WriteAllText($ProjManifest, $man, $utf8)
  $ProjSrc = Join-Path $Proj 'src'
  $ProjRes = Join-Path $Proj 'res'
  [void](Copy-Tree (Join-Path $AndroidDir 'src') $ProjSrc @() @())
  [void](Copy-Tree (Join-Path $AndroidDir 'res') $ProjRes @() @())

  if ($StageOnly) {
    Say "Staged only (no APK). Look at: $Proj"
    exit 0
  }

  # ---- 3. toolchain
  Say 'Checking tools'
  $BT = Join-Path $Sdk "build-tools\$BuildTools"
  $tools = [ordered]@{
    'java.exe (JDK 17)'      = Join-Path $Jdk 'bin\java.exe'
    'javac.exe (JDK 17)'     = Join-Path $Jdk 'bin\javac.exe'
    'jar.exe (JDK 17)'       = Join-Path $Jdk 'bin\jar.exe'
    'keytool.exe (JDK 17)'   = Join-Path $Jdk 'bin\keytool.exe'
    "aapt2.exe (build-tools $BuildTools)"    = Join-Path $BT 'aapt2.exe'
    "zipalign.exe (build-tools $BuildTools)" = Join-Path $BT 'zipalign.exe'
    "android.jar (platform $Platform)"       = Join-Path $Sdk "platforms\android-$Platform\android.jar"
  }
  $missing = @()
  foreach ($k in $tools.Keys) { if (-not (Test-Path -LiteralPath $tools[$k])) { $missing += "  $k  ->  $($tools[$k])" } }
  $d8Jar   = First-Existing @((Join-Path $BT 'lib\d8.jar'), (Join-Path $BT 'd8.jar'))
  $signJar = First-Existing @((Join-Path $BT 'lib\apksigner.jar'), (Join-Path $BT 'apksigner.jar'))
  if (-not $d8Jar)   { $missing += "  d8.jar (build-tools $BuildTools)  ->  $BT\lib\d8.jar" }
  if (-not $signJar) { $missing += "  apksigner.jar (build-tools $BuildTools)  ->  $BT\lib\apksigner.jar" }
  if ($missing.Count -gt 0) {
    throw ("Missing build tools:`n" + ($missing -join "`n") + "`nInstall them with:  powershell -ExecutionPolicy Bypass -File `"$AndroidDir\tools\setup-toolchain.ps1`"`nor point -Jdk / -Sdk (or `$env:DS_JDK / `$env:DS_SDK) at your own JDK 17 and Android SDK.")
  }
  foreach ($p in @($Jdk, $Sdk, $KeyStore)) { if (-not (Test-Ascii $p)) { throw "This path must contain only English letters/numbers: $p" } }
  $java = $tools['java.exe (JDK 17)']; $javac = $tools['javac.exe (JDK 17)']; $jarExe = $tools['jar.exe (JDK 17)']
  $keytool = $tools['keytool.exe (JDK 17)']; $aapt2 = $tools["aapt2.exe (build-tools $BuildTools)"]
  $zipalign = $tools["zipalign.exe (build-tools $BuildTools)"]; $androidJar = $tools["android.jar (platform $Platform)"]
  $aapt = Join-Path $BT 'aapt.exe'

  $ver = (Get-ToolOutput $java @('-version')) -join ' '
  $vm = [regex]::Match($ver, 'version "(\d+)')
  if ($vm.Success -and [int]$vm.Groups[1].Value -lt 11) { throw "JDK 11 or newer is needed (found: $ver). Use JDK 17." }
  Note ("Java: " + ($(if ($vm.Success) { $vm.Groups[1].Value } else { '?' })) + "  build-tools: $BuildTools  platform: android-$Platform")

  $Obj = Join-Path $BuildDir 'obj'
  $Bin = Join-Path $BuildDir 'bin'
  Reset-Dir $Obj
  Reset-Dir $Bin
  $resZip    = Join-Path $Bin 'res.zip'
  $unsigned  = Join-Path $Bin 'app.unaligned.apk'
  $aligned   = Join-Path $Bin 'app.aligned.apk'
  $signed    = Join-Path $Bin 'DroneSim.apk'
  $classesJar = Join-Path $Bin 'classes.jar'
  $dexDir    = Join-Path $Bin 'dex'
  New-Item -ItemType Directory -Force -Path $dexDir | Out-Null

  # ---- 4. resources + manifest + assets
  Say 'aapt2 compile'
  Invoke-Tool $aapt2 @('compile', '--dir', $ProjRes, '-o', $resZip) 'aapt2 compile'
  Say "aapt2 link (versionCode $VersionCode, versionName $VersionName)"
  $linkArgs = @('link', '-o', $unsigned, '-I', $androidJar, '--manifest', $ProjManifest,
                '--min-sdk-version', "$MinSdk", '--target-sdk-version', "$TargetSdk",
                '--version-code', "$VersionCode", '--version-name', $VersionName)
  if ($Dev) { $linkArgs += '--debug-mode' }
  $linkArgs += $resZip
  Invoke-Tool $aapt2 $linkArgs 'aapt2 link'

  # ---- 5. Java -> dex
  Say 'javac'
  $javaFiles = @(Get-ChildItem -LiteralPath $ProjSrc -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
  if ($javaFiles.Count -eq 0) { throw "No .java files in $ProjSrc" }
  Invoke-Tool $javac (@('-source', '8', '-target', '8', '-bootclasspath', $androidJar, '-encoding', 'UTF-8',
                        '-Xlint:-options', '-g:source,lines', '-d', $Obj) + $javaFiles) 'javac'
  Invoke-Tool $jarExe @('cf', $classesJar, '-C', $Obj, '.') 'jar'
  Say 'd8'
  Invoke-Tool $java @('-Xmx1g', '-cp', $d8Jar, 'com.android.tools.r8.D8', '--release', '--min-api', "$MinSdk",
                      '--lib', $androidJar, '--output', $dexDir, $classesJar) 'd8'
  $dex = Join-Path $dexDir 'classes.dex'
  if (-not (Test-Path -LiteralPath $dex)) { throw "d8 did not produce $dex" }

  # ---- 6. add classes.dex, align
  Say 'Packaging'
  if (Test-Path -LiteralPath $aapt) {
    Push-Location $dexDir
    try { Invoke-Tool $aapt @('add', $unsigned, 'classes.dex') 'aapt add' } finally { Pop-Location }
  } else {
    Warn 'aapt.exe not found; adding classes.dex with .NET instead.'
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
    try { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dex, 'classes.dex', [IO.Compression.CompressionLevel]::Optimal) }
    finally { $zip.Dispose() }
  }
  # Assets are added here, not with "aapt2 link -A": on Windows aapt2 stores nested asset paths with a
  # backslash (assets/js\util.js), which Android's AssetManager cannot open. Entry names must use "/".
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
  $nAssets = 0
  try {
    $aRoot = (Resolve-Path -LiteralPath $Assets).ProviderPath.TrimEnd('\')
    foreach ($fi in @(Get-ChildItem -LiteralPath $aRoot -Recurse -File)) {
      $entry = 'assets/' + $fi.FullName.Substring($aRoot.Length + 1).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fi.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal)
      $nAssets++
    }
    $bad = @($zip.Entries | Where-Object { $_.FullName.Contains('\') } | ForEach-Object { $_.FullName })
    if ($bad.Count -gt 0) { throw ("APK entries with a backslash: " + ($bad -join ', ')) }
  } finally { $zip.Dispose() }
  Note "Assets added: $nAssets files"
  Invoke-Tool $zipalign @('-p', '-f', '4', $unsigned, $aligned) 'zipalign'   # align BEFORE signing (v2/v3)

  # ---- 7. sign (one key forever: updates must be signed with the same key)
  Say 'Signing'
  if (-not $PasswordFile) { $PasswordFile = Join-Path (Split-Path -Parent $KeyStore) 'keystore-password.txt' }
  $setEnv = $false
  $typed = $false
  if (-not $env:DS_KS_PASS) {
    $fromFile = Read-PasswordFile $PasswordFile
    if ($fromFile) {
      $env:DS_KS_PASS = $fromFile
      $setEnv = $true
      Note "Keystore password: from $PasswordFile"
    }
  }
  if (-not $env:DS_KS_PASS) {
    $typed = $true
    if (-not (Test-Path -LiteralPath $KeyStore)) {
      Write-Host ''
      Write-Host 'First build: creating your signing key. Choose a password and WRITE IT DOWN.' -ForegroundColor Yellow
      Write-Host "The key file will be: $KeyStore  (back it up; without it you cannot update the app on the TV)" -ForegroundColor Yellow
      while ($true) {
        $p1 = Read-Password 'New keystore password (at least 6 characters)'
        if ($p1.Length -lt 6) { Warn 'Too short.'; continue }
        $p2 = Read-Password 'Type it again'
        if ($p1 -ceq $p2) { break }
        Warn 'The two passwords are different. Try again.'
      }
      $env:DS_KS_PASS = $p1
    } else {
      $env:DS_KS_PASS = Read-Password "Keystore password ($KeyStore)"
    }
    $setEnv = $true
  }
  try {
    if (-not (Test-Path -LiteralPath $KeyStore)) {
      $ksDir = Split-Path -Parent $KeyStore
      if (-not (Test-Path -LiteralPath $ksDir)) { New-Item -ItemType Directory -Force -Path $ksDir | Out-Null }
      Invoke-Tool $keytool @('-genkeypair', '-keystore', $KeyStore, '-storetype', 'PKCS12', '-alias', $KeyAlias,
                             '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
                             '-dname', 'CN=Drone Simulator, O=Nadir, C=SA',
                             '-storepass:env', 'DS_KS_PASS', '-keypass:env', 'DS_KS_PASS') 'keytool (create keystore)'
      Note "Keystore created: $KeyStore  <-- back this file up together with its password"
    }
    Invoke-Tool $java @('-jar', $signJar, 'sign', '--ks', $KeyStore, '--ks-key-alias', $KeyAlias,
                        '--ks-pass', 'env:DS_KS_PASS', '--key-pass', 'env:DS_KS_PASS', '--out', $signed, $aligned) 'apksigner sign (wrong password?)'
    # a password typed at the prompt is kept for the next builds (one-click updates need no prompt)
    if ($typed -and -not (Test-Path -LiteralPath $PasswordFile)) {
      Save-PasswordFile $PasswordFile $env:DS_KS_PASS
      Note "Keystore password saved in $PasswordFile  <-- back up this whole folder"
    }
  } finally {
    if ($setEnv) { Remove-Item Env:\DS_KS_PASS -ErrorAction SilentlyContinue }
  }
  $verifyOut = Get-ToolOutput $java @('-jar', $signJar, 'verify', '-v', '--print-certs', $signed)
  if ($LASTEXITCODE -ne 0) { $verifyOut | Out-Host; throw "apksigner verify failed (exit code $LASTEXITCODE)." }
  $verifyOut | Where-Object { $_ -match 'Verified using|Number of signers|Signer #1 certificate (DN|SHA-256)' } | ForEach-Object { Note $_ }

  # ---- 8. same key as the app on the TV? (android\signing-cert.txt)
  $certs = @($verifyOut | ForEach-Object { if ($_ -match 'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})') { $Matches[1].ToLowerInvariant() } })
  if ($certs.Count -ne 1) { throw "Expected exactly one signer certificate, apksigner reported $($certs.Count)." }
  $certSha = $certs[0]
  $pinFile = Join-Path $AndroidDir 'signing-cert.txt'
  $pinned = Read-PinnedCert $pinFile
  if (-not $pinned) {
    Write-PinnedCert $pinFile $certSha ''
    Note "Signing certificate pinned in signing-cert.txt: $certSha"
  } elseif ($pinned -ne $certSha) {
    if (-not $AllowNewKey) {
      $script:ExitCode = 3
      Write-Host ''
      Write-Host '================================================================================' -ForegroundColor Red
      Write-Host 'WRONG SIGNING KEY - BUILD STOPPED' -ForegroundColor Red
      Write-Host "  This APK is signed with certificate $certSha" -ForegroundColor Red
      Write-Host "  but signing-cert.txt pins           $pinned" -ForegroundColor Red
      Write-Host '  (the key of the app already on the TV). Android refuses an update signed with another key:' -ForegroundColor Red
      Write-Host '  the app would have to be deleted and the saved progress would be lost.' -ForegroundColor Red
      Write-Host "  Fix: restore the original keystore + keystore-password.txt from your backup of %USERPROFILE%\.dronesim\" -ForegroundColor Red
      Write-Host "       (keystore used now: $KeyStore)." -ForegroundColor Red
      Write-Host '  Only if you REALLY want a new key (the TV app must then be deleted): build.ps1 -AllowNewKey' -ForegroundColor Red
      Write-Host ''
      Write-Host $AR_KeyMismatch -ForegroundColor Red
      Write-Host '================================================================================' -ForegroundColor Red
      throw 'Signing key differs from signing-cert.txt (see above). DroneSim.apk was NOT updated.'
    }
    Warn "-AllowNewKey: the signing key changed ($pinned -> $certSha). signing-cert.txt now pins the new key."
    Warn 'The app on the TV will NOT accept this APK as an update: it must be uninstalled first (saved progress is lost).'
    Write-Host $AR_NewKeyAllowed -ForegroundColor Yellow
    Write-PinnedCert $pinFile $certSha $pinned
  } else {
    Note 'Signing key: same as signing-cert.txt (updates keep the saved progress)'
  }

  $badging = (Get-ToolOutput $aapt2 @('dump', 'badging', $signed)) -join "`n"
  if ($badging -match 'leanback-launchable-activity') { Note 'TV launcher entry: OK' } else { Warn 'aapt2 dump badging shows no leanback launcher entry.' }
  $pm = [regex]::Match($badging, "package: name='([^']+)' versionCode='(\d+)'")
  if (-not $pm.Success -or $pm.Groups[1].Value -ne 'com.nadir.dronesim' -or [int64]$pm.Groups[2].Value -ne $VersionCode) {
    throw "Unexpected package/version in the APK (expected com.nadir.dronesim / $VersionCode): $($pm.Value)"
  }

  Copy-Item -LiteralPath $signed -Destination $Out -Force
  $size = (Get-Item -LiteralPath $Out).Length / 1MB
  Write-Host ''
  Say ("Done: {0}  ({1:N1} MB, version {2} / {3}{4})" -f $Out, $size, $VersionName, $VersionCode, $(if ($Dev) { ', DEV' } else { '' }))
  Note 'Update the TV without deleting the app:  double-click the desktop shortcut, or  .\update-tv.ps1'
  Note 'Install with adb (keeps the progress):   powershell -ExecutionPolicy Bypass -File .\install-tv.ps1 -Ip <TV-IP>'
  exit 0
}
catch {
  Write-Host ''
  Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit $script:ExitCode
}
