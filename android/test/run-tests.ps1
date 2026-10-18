<#
.SYNOPSIS
  Runs the desktop tests of the app's updater core (src\...\UpdateCore.java) on the PC's JDK.

.DESCRIPTION
  No TV, no internet, no firewall prompt: every test socket binds to 127.0.0.1 only, and the signing keys are
  throwaway keys made by the test. Java tools cannot open the Arabic project path, so the sources are copied
  to an ASCII work folder (-WorkDir) first. If tools\SignUpdate.java exists, the test also checks that a
  manifest signed by that PC tool verifies in the app code (same protocol on both sides).
  With the Android SDK present it also compiles all app sources against android.jar and runs AndroidGlueTest
  (AssetClient folder guard + "https only" rule, Arabic messages, the window.onNativeUpdate JS in node).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\test\run-tests.ps1
#>
[CmdletBinding()]
param(
  [string]$Jdk     = $(if ($env:DS_JDK) { $env:DS_JDK } else { 'C:\tools\jdk-17' }),
  [string]$WorkDir = 'C:\tools\ota-native-test',
  [string]$AndroidJar = $(if ($env:DS_SDK) { "$env:DS_SDK\platforms\android-34\android.jar" } else { 'C:\tools\android-sdk\platforms\android-34\android.jar' })
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

try {
  $AndroidDir = Split-Path -Parent $PSScriptRoot
  if ($WorkDir -match '[^\x20-\x7E]') { throw "-WorkDir must contain only English letters/numbers: $WorkDir" }
  if (-not [IO.Path]::IsPathRooted($WorkDir) -or $WorkDir.TrimEnd('\').Length -le 3) { throw "-WorkDir must be a full folder path like C:\tools\ota-native-test" }
  $javac = Join-Path $Jdk 'bin\javac.exe'
  $java  = Join-Path $Jdk 'bin\java.exe'
  if (-not (Test-Path -LiteralPath $javac)) { throw "JDK not found: $javac (run tools\setup-toolchain.ps1)" }

  if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
  $src = Join-Path $WorkDir 'src\com\nadir\dronesim'
  $out = Join-Path $WorkDir 'out'
  $tmp = Join-Path $WorkDir 'tmp'
  New-Item -ItemType Directory -Force -Path $src, $out, $tmp | Out-Null
  Copy-Item -LiteralPath (Join-Path $AndroidDir 'src\com\nadir\dronesim\UpdateCore.java') -Destination $src
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'com\nadir\dronesim\UpdateCoreTest.java') -Destination $src

  $props = @("-Djava.io.tmpdir=$tmp")
  $su = Join-Path $AndroidDir 'tools\SignUpdate.java'
  if (Test-Path -LiteralPath $su) {
    Copy-Item -LiteralPath $su -Destination $WorkDir
    $props += "-Dsignupdate=$(Join-Path $WorkDir 'SignUpdate.java')"
  }

  Write-Host '==> javac' -ForegroundColor Cyan
  & $javac -encoding UTF-8 -Xlint:all -d $out (Join-Path $src 'UpdateCore.java') (Join-Path $src 'UpdateCoreTest.java')
  if ($LASTEXITCODE -ne 0) { throw "javac failed (exit code $LASTEXITCODE)" }

  Write-Host '==> UpdateCore tests' -ForegroundColor Cyan
  & $java @props -cp $out com.nadir.dronesim.UpdateCoreTest
  $code = $LASTEXITCODE

  # Android glue (AssetClient guards, onNativeUpdate JS) against the android.jar stubs, if the SDK is there
  if (Test-Path -LiteralPath $AndroidJar) {
    Write-Host '==> Android glue tests' -ForegroundColor Cyan
    $gsrc = Join-Path $WorkDir 'glue\src'
    $gout = Join-Path $WorkDir 'glue\out'
    New-Item -ItemType Directory -Force -Path $gsrc, $gout | Out-Null
    Copy-Item -Path (Join-Path $AndroidDir 'src\*') -Destination $gsrc -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'com\nadir\dronesim\AndroidGlueTest.java') -Destination (Join-Path $gsrc 'com\nadir\dronesim')
    $files = @(Get-ChildItem -LiteralPath $gsrc -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
    & $javac -nowarn -encoding UTF-8 -cp $AndroidJar -d $gout @files
    if ($LASTEXITCODE -ne 0) { throw "javac (glue) failed (exit code $LASTEXITCODE)" }
    & $java "-Djava.io.tmpdir=$tmp" -cp "$gout;$AndroidJar" com.nadir.dronesim.AndroidGlueTest
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  } else {
    Write-Host "SKIP Android glue tests (no $AndroidJar)" -ForegroundColor Yellow
  }

  if ($code -eq 0) { Write-Host 'ALL TESTS PASSED' -ForegroundColor Green } else { Write-Host 'SOME TESTS FAILED' -ForegroundColor Red }
  exit $code
}
catch {
  Write-Host "TEST RUN FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
