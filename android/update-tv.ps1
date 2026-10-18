<#
.SYNOPSIS
  One click: publish the latest simulator as a signed update, then serve it to the TV on the same Wi-Fi.
  The app on the TV updates ITSELF (no deleting, saved progress kept). Started by the desktop shortcut.

.DESCRIPTION
  1. publish-update.ps1: web content (hot update) and, only if the Android part changed, a new APK.
  2. serve-updates.ps1 for -Minutes (20): the TV finds the PC by itself (UDP 47800) and downloads over HTTP 47801.
  A window shows simple Arabic instructions and what the TV is doing; this black console shows the details.

  -Adb: instead of waiting for the TV, install the published APK with adb (install-tv.ps1 = "adb install -r",
  data kept). Needs USB/Wi-Fi debugging on the TV (README-ar.md). -Adb always publishes a NEW APK (-ForceApk), so
  the APK that is installed carries the newest web content too (a content-only publish would keep the old APK).

  -MakeShortcut: (re)creates the desktop shortcut that runs this script.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\update-tv.ps1
.EXAMPLE
  .\update-tv.ps1 -Adb -Ip 192.168.1.50
.EXAMPLE
  .\update-tv.ps1 -MakeShortcut
#>
[CmdletBinding()]
param(
  [double]$Minutes = 20,
  [switch]$Adb,
  [string]$Ip = '',
  [switch]$NoWindow,
  [switch]$SkipPublish,
  [switch]$ForceApk,
  [string]$Notes = '',
  [string]$Bind = '0.0.0.0',
  [int]$Port = 47801,
  [string]$OutDir   = $(if ($env:DS_UPDATES) { $env:DS_UPDATES } else { 'C:\tools\dronesim-updates' }),
  [string]$BuildDir = $(if ($env:DS_BUILD)   { $env:DS_BUILD }   else { 'C:\tools\dronesim-build' }),
  [switch]$MakeShortcut,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# Arabic UI text, built from code points (this file stays pure ASCII for Windows PowerShell 5.1).
$utArRaw = [ordered]@{
  Title = '\u062A\u062D\u062F\u064A\u062B \u0645\u062D\u0627\u0643\u064A \u0627\u0644\u062F\u0631\u0648\u0646'
  Head = '\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646'
  Preparing = '\u0642\u0627\u0639\u062F \u0623\u062C\u0647\u0651\u0632 \u0627\u0644\u062A\u062D\u062F\u064A\u062B... \u0627\u0646\u062A\u0638\u0631 \u0634\u0648\u064A (\u062A\u0642\u0631\u064A\u0628\u064B\u0627 \u062F\u0642\u064A\u0642\u0629).'
  PrepFail = '\u0635\u0627\u0631 \u062E\u0637\u0623 \u0648\u0623\u0646\u0627 \u0623\u062C\u0647\u0651\u0632 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u0634\u0648\u0641 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u0648\u062F\u0627 \u0627\u0644\u0644\u064A \u0648\u0631\u0627 \u0647\u0627\u0644\u0646\u0627\u0641\u0630\u0629\u060C \u0648\u0635\u0648\u0651\u0631\u0647\u0627 \u0644\u0648 \u062A\u0628\u064A \u0645\u0633\u0627\u0639\u062F\u0629.'
  KeyFail = '\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u063A\u0644\u0637\u060C \u0641\u0648\u0642\u0651\u0641\u0646\u0627! \u0647\u0630\u0627 \u0645\u0648 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0648\u0642\u064A\u0639 \u062D\u0642 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0644\u064A \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646\u060C \u0648\u0644\u0648 \u0643\u0645\u0651\u0644\u0646\u0627 \u0644\u0627\u0632\u0645 \u062A\u062D\u0630\u0641 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0636\u064A\u0639 \u062A\u0642\u062F\u0651\u0645\u0643. \u0631\u062C\u0651\u0639 \u0645\u0644\u0641 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0623\u0635\u0644\u064A \u0645\u0646 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 \u0644\u0645\u062C\u0644\u062F \u200E.dronesim\u200E \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629.'
  KeyMissing = '\u0645\u0644\u0641 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0648\u0642\u064A\u0639 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631 \u062D\u0642\u062A\u0647 \u0645\u0648 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631\u060C \u0641\u0648\u0642\u0651\u0641\u0646\u0627. \u0631\u062C\u0651\u0639 \u0627\u0644\u0645\u062C\u0644\u062F \u200E.dronesim\u200E \u0643\u0627\u0645\u0644 \u0645\u0646 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629 (\u0641\u0644\u0627\u0634 \u0623\u0648 Google Drive) \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629. \u0644\u0627 \u062A\u0633\u0648\u064A \u0645\u0641\u062A\u0627\u062D \u062C\u062F\u064A\u062F: \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062C\u062F\u064A\u062F \u064A\u062C\u0628\u0631\u0643 \u062A\u062D\u0630\u0641 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0636\u064A\u0639 \u062A\u0642\u062F\u0651\u0645\u0643.'
  Ready = '\u0627\u0644\u062A\u062D\u062F\u064A\u062B \u062C\u0627\u0647\u0632 (\u0646\u0633\u062E\u0629 {0})'
  Step1 = '\u2022 \u062E\u0644\u0651 \u0647\u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u0645\u0641\u062A\u0648\u062D\u0629\u060C \u0648\u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631 \u0648\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u0648\u0627\u064A \u0641\u0627\u064A.'
  Step2 = '\u2022 \u0627\u0641\u062A\u062D \u00AB\u0645\u062D\u0627\u0643\u064A \u0627\u0644\u062F\u0631\u0648\u0646\u00BB \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 (\u0644\u0648 \u0643\u0627\u0646 \u0645\u0641\u062A\u0648\u062D: \u0627\u0637\u0644\u0639 \u0645\u0646\u0647 \u0628\u0632\u0631 \u0627\u0644\u0631\u062C\u0648\u0639 \u0645\u0631\u062A\u064A\u0646 \u0648\u0627\u0641\u062A\u062D\u0647 \u0645\u0646 \u062C\u062F\u064A\u062F).'
  Step3 = '\u2022 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u064A\u0644\u0642\u0649 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0648\u064A\u0646\u0632\u0651\u0644\u0647 \u0644\u062D\u0627\u0644\u0647.'
  Step4 = '\u2022 \u0625\u0630\u0627 \u0637\u0644\u0639 \u0644\u0643 \u00AB\u0641\u064A\u0647 \u0646\u0633\u062E\u0629 \u062C\u062F\u064A\u062F\u0629\u00BB \u0627\u0636\u063A\u0637 \u00AB\u062D\u062F\u0651\u062B \u0627\u0644\u062D\u064A\u0646\u00BB\u060C \u0648\u0625\u0630\u0627 \u0633\u0623\u0644\u0643 \u0623\u0646\u062F\u0631\u0648\u064A\u062F \u0627\u0636\u063A\u0637 \u00AB\u062A\u062D\u062F\u064A\u062B\u00BB\u060C \u0648\u0628\u0639\u062F\u0647\u0627 \u0627\u0641\u062A\u062D \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0645\u0646 \u062C\u062F\u064A\u062F.'
  Keep = '\u062A\u0642\u062F\u0651\u0645\u0643 \u0645\u0627 \u064A\u0636\u064A\u0639. \u0644\u0627 \u062A\u062D\u0630\u0641 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0623\u0628\u062F.'
  Firewall = '\u0623\u0648\u0644 \u0645\u0631\u0629 \u0628\u0633: \u0625\u0630\u0627 \u0637\u0644\u0639\u062A \u0631\u0633\u0627\u0644\u0629 \u00AB\u062C\u062F\u0627\u0631 \u0627\u0644\u062D\u0645\u0627\u064A\u0629\u00BB (Windows Firewall)\u060C \u062D\u0637 \u0635\u062D \u0639\u0644\u0649 \u00AB\u0627\u0644\u0634\u0628\u0643\u0627\u062A \u0627\u0644\u062E\u0627\u0635\u0629\u00BB \u0648\u0627\u0636\u063A\u0637 \u00AB\u0627\u0644\u0633\u0645\u0627\u062D \u0628\u0627\u0644\u0648\u0635\u0648\u0644\u00BB (Allow access).'
  Public = '\u062A\u0646\u0628\u064A\u0647: \u0627\u0644\u0634\u0628\u0643\u0629 \u0641\u064A \u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631 \u0645\u0636\u0628\u0648\u0637\u0629 \u00AB\u0639\u0627\u0645\u0629\u00BB (Public)\u060C \u0648\u0645\u0645\u0643\u0646 \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0645\u0627 \u064A\u0648\u0635\u0644 \u0644\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631. \u0627\u0644\u062D\u0644: \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0627\u0644\u0634\u0628\u0643\u0629 \u0648\u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A \u2190 \u0627\u0644\u0648\u0627\u064A \u0641\u0627\u064A \u2190 \u0627\u0633\u0645 \u0627\u0644\u0634\u0628\u0643\u0629 \u2190 \u062E\u0644\u0651\u0647\u0627 \u00AB\u062E\u0627\u0635\u0629\u00BB (Private).'
  Blocked = '\u062A\u0646\u0628\u064A\u0647: \u062C\u062F\u0627\u0631 \u0627\u0644\u062D\u0645\u0627\u064A\u0629 \u0645\u0627\u0646\u0639 PowerShell (\u064A\u0645\u0643\u0646 \u0636\u063A\u0637\u062A \u00AB\u0625\u0644\u063A\u0627\u0621\u00BB \u0642\u0628\u0644). \u0627\u0641\u062A\u062D \u00AB\u062C\u062F\u0627\u0631 \u062D\u0645\u0627\u064A\u0629 Windows\u00BB \u2190 \u00AB\u0627\u0644\u0633\u0645\u0627\u062D \u0644\u062A\u0637\u0628\u064A\u0642\u00BB \u0648\u062E\u0644\u0651 Windows PowerShell \u0645\u0633\u0645\u0648\u062D \u0639\u0644\u0649 \u00AB\u062E\u0627\u0635\u0629\u00BB.'
  NoLan = '\u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631 \u0645\u0648 \u0645\u062A\u0635\u0644 \u0628\u0623\u064A \u0634\u0628\u0643\u0629. \u0648\u0635\u0651\u0644\u0647 \u0628\u0646\u0641\u0633 \u0627\u0644\u0648\u0627\u064A \u0641\u0627\u064A \u062D\u0642 \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629.'
  PortBusy = '\u0641\u064A\u0647 \u0646\u0627\u0641\u0630\u0629 \u062A\u062D\u062F\u064A\u062B \u062B\u0627\u0646\u064A\u0629 \u0645\u0641\u062A\u0648\u062D\u0629. \u0633\u0643\u0651\u0631\u0647\u0627 \u0648\u062C\u0631\u0651\u0628 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629.'
  ServeFail = '\u0635\u0627\u0631 \u062E\u0637\u0623 \u0641\u064A \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u0634\u0648\u0641 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u0648\u062F\u0627 \u0627\u0644\u0644\u064A \u0648\u0631\u0627 \u0647\u0627\u0644\u0646\u0627\u0641\u0630\u0629.'
  Waiting = '\u0623\u0646\u062A\u0638\u0631 \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646...'
  Found = '\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0644\u0642\u0649 \u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631'
  Checking = '\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u064A\u0634\u064A\u0651\u0643 \u0639\u0644\u0649 \u0627\u0644\u062A\u062D\u062F\u064A\u062B...'
  Checked = '\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0634\u064A\u0651\u0643 \u0639\u0644\u0649 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u0625\u0630\u0627 \u0637\u0644\u0639 \u0644\u0643 \u0633\u0624\u0627\u0644 \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u062C\u0627\u0648\u0628\u0647\u060C \u0648\u0625\u0630\u0627 \u0645\u0627 \u0637\u0644\u0639 \u0634\u064A \u0641\u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0645\u062D\u062F\u0651\u062B. (\u0644\u0648 \u0636\u063A\u0637\u062A \u00AB\u0628\u0639\u062F\u064A\u0646\u00BB \u0628\u0627\u0644\u063A\u0644\u0637: \u062F\u0628\u0644 \u0643\u0644\u0643 \u0639\u0644\u0649 \u0627\u0644\u0627\u062E\u062A\u0635\u0627\u0631 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629\u060C \u0648\u0627\u0637\u0644\u0639 \u0645\u0646 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0628\u0632\u0631 \u0627\u0644\u0631\u062C\u0648\u0639 \u0645\u0631\u062A\u064A\u0646 \u0648\u0627\u0641\u062A\u062D\u0647.)'
  DlContent = '\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u064A\u0646\u0632\u0651\u0644 \u0627\u0644\u062A\u062D\u062F\u064A\u062B... {0}%'
  DlApk = '\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u064A\u0646\u0632\u0651\u0644 \u0646\u0633\u062E\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u062C\u062F\u064A\u062F\u0629... {0}%'
  DoneContent = '\u062A\u0645! \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0646\u0632\u0651\u0644 \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u060C \u0648\u064A\u0634\u062A\u063A\u0644 \u0644\u062D\u0627\u0644\u0647 \u0623\u0648\u0644 \u0645\u0627 \u062A\u0631\u062C\u0639 \u0644\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0643\u064A.'
  DoneApk = '\u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0646\u0632\u0651\u0644 \u0646\u0633\u062E\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u062C\u062F\u064A\u062F\u0629. \u0641\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 (\u0628\u0639\u062F \u0645\u0627 \u062A\u0648\u0642\u0641 \u0627\u0644\u0637\u064A\u0631\u0627\u0646) \u0627\u0636\u063A\u0637 \u00AB\u062D\u062F\u0651\u062B \u0627\u0644\u062D\u064A\u0646\u00BB \u0648\u0628\u0639\u062F\u064A\u0646 \u00AB\u062A\u062D\u062F\u064A\u062B\u00BB. \u0628\u0639\u062F\u0647\u0627 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u064A\u062A\u0633\u0643\u0651\u0631 \u0644\u062D\u0627\u0644\u0647\u060C \u0627\u0641\u062A\u062D\u0647 \u0645\u0646 \u062C\u062F\u064A\u062F.'
  Aborted = '\u0627\u0646\u0642\u0637\u0639 \u0627\u0644\u062A\u0646\u0632\u064A\u0644. \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0628\u064A\u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629 \u0644\u062D\u0627\u0644\u0647.'
  Left = '\u0628\u0627\u0642\u064A {0} \u062F\u0642\u064A\u0642\u0629\u060C \u0648\u0628\u0639\u062F\u0647\u0627 \u064A\u0648\u0642\u0641 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0644\u062D\u0627\u0644\u0647.'
  Over = '\u062E\u0644\u0635 \u0627\u0644\u0648\u0642\u062A \u0648\u0648\u0642\u0651\u0641\u0646\u0627 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u062A\u0642\u062F\u0631 \u062A\u0633\u0643\u0651\u0631 \u0647\u0627\u0644\u0646\u0627\u0641\u0630\u0629.'
  Stopped = '\u0648\u0642\u0651\u0641\u0646\u0627 \u0627\u0644\u062A\u062D\u062F\u064A\u062B.'
  Close = '\u0633\u0643\u0651\u0631'
  AdbRun = '\u0642\u0627\u0639\u062F \u0623\u062B\u0628\u0651\u062A \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0639\u0644\u0649 \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646 \u0639\u0646 \u0637\u0631\u064A\u0642 adb...'
  AdbOk = '\u062A\u0645 \u062A\u062B\u0628\u064A\u062A \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0639\u0644\u0649 \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646\u060C \u0648\u062A\u0642\u062F\u0651\u0645\u0643 \u0645\u062D\u0641\u0648\u0638.'
  AdbFail = '\u0645\u0627 \u0642\u062F\u0631\u0646\u0627 \u0646\u062B\u0628\u0651\u062A \u0639\u0646 \u0637\u0631\u064A\u0642 adb. \u0634\u0648\u0641 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u0648\u062F\u0627 \u0627\u0644\u0644\u064A \u0648\u0631\u0627 \u0647\u0627\u0644\u0646\u0627\u0641\u0630\u0629.'
  Shortcut = '\u062A\u062D\u062F\u064A\u062B \u0645\u062D\u0627\u0643\u064A \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646'
  Address = '\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631: {0}'
}
$AR = @{}
foreach ($k in @($utArRaw.Keys)) { $AR[$k] = [regex]::Unescape($utArRaw[$k]) }

# Shared state for the window callbacks. serve-updates.ps1 calls them from its own scope, so they only use
# $UT / $AR and UT-* functions (names serve-updates.ps1 never defines).
$UT = @{
  Form = $null; Status = $null; Steps = $null; Warn = $null; List = $null; Left = $null; Addr = $null
  Stop = $false; Deadline = [DateTime]::MaxValue; LastLeft = -1; CheckAt = $null; Downloading = $false
  CheckedShown = $false; Phase = 'prepare'
}
Add-Type -AssemblyName System.Drawing
$OkColor   = [System.Drawing.Color]::FromArgb(255, 134, 239, 172)
$InfoColor = [System.Drawing.Color]::FromArgb(255, 125, 211, 252)
$BadColor  = [System.Drawing.Color]::FromArgb(255, 252, 165, 165)
$WarnColor = [System.Drawing.Color]::FromArgb(255, 253, 224, 71)

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note([string]$m) { Write-Host "    $m" }

# ------------------------------------------------------------------------------------------------ window
function UT-Alive { return ($null -ne $UT.Form) -and -not $UT.Form.IsDisposed }
function UT-Pump { if (UT-Alive) { [System.Windows.Forms.Application]::DoEvents() } }

function UT-SetStatus([string]$Text, $Color) {
  if (-not (UT-Alive)) { return }
  try { $UT.Status.Text = $Text; if ($Color) { $UT.Status.ForeColor = $Color }; UT-Pump } catch { }
}
function UT-SetWarn([string]$Text) {
  if (-not (UT-Alive)) { return }
  try { $UT.Warn.Text = $Text; $UT.Warn.Visible = [bool]$Text } catch { }
}
function UT-Log([string]$Text) {
  if (-not (UT-Alive) -or -not $Text) { return }
  try {
    $UT.List.Items.Insert(0, ((Get-Date -Format 'HH:mm') + '   ' + $Text))
    while ($UT.List.Items.Count -gt 200) { $UT.List.Items.RemoveAt($UT.List.Items.Count - 1) }
  } catch { }
}

function UT-NewLabel([float]$Size, [System.Drawing.FontStyle]$Style, $Color) {
  $l = New-Object System.Windows.Forms.Label
  $l.AutoSize = $true
  $l.MaximumSize = New-Object System.Drawing.Size(730, 0)   # widened to the real window by UT-FitLabels
  $l.Font = New-Object System.Drawing.Font('Segoe UI', $Size, $Style)
  $l.ForeColor = $Color
  $l.Margin = New-Object System.Windows.Forms.Padding(12, 6, 12, 6)
  $l.Anchor = [System.Windows.Forms.AnchorStyles]::Left   # mirrored by RightToLeft = Yes: hugs the right edge
  return $l
}

function UT-NewWindow {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  try {
    Add-Type -Namespace DroneSimUt -Name Dpi -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
    [void][DroneSimUt.Dpi]::SetProcessDPIAware()
  } catch { }
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $bg = [System.Drawing.Color]::FromArgb(255, 11, 17, 24)
  $fg = [System.Drawing.Color]::FromArgb(255, 238, 243, 248)

  $f = New-Object System.Windows.Forms.Form
  $f.Text = $AR.Title
  $f.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
  $f.RightToLeftLayout = $false
  $f.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
  $f.MaximizeBox = $false
  # DPI-aware process: fonts (points) grow with the screen scale by themselves; the window size is scaled here
  $scale = 1.0
  try { $gr = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $scale = [Math]::Max(1.0, $gr.DpiX / 96.0); $gr.Dispose() } catch { }
  $f.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
  $f.ClientSize = New-Object System.Drawing.Size([int](760 * $scale), [int](620 * $scale))
  $f.BackColor = $bg
  $f.ForeColor = $fg
  $f.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $ico = Join-Path $env:LOCALAPPDATA 'DroneSim\update-tv.ico'
  if (Test-Path -LiteralPath $ico) { try { $f.Icon = New-Object System.Drawing.Icon($ico) } catch { } }

  $t = New-Object System.Windows.Forms.TableLayoutPanel
  $t.Dock = [System.Windows.Forms.DockStyle]::Fill
  $t.ColumnCount = 1
  $t.RowCount = 7
  $t.Padding = New-Object System.Windows.Forms.Padding(6, 10, 6, 6)
  [void]$t.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
  for ($i = 0; $i -lt 7; $i++) {
    $st = if ($i -eq 5) { New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100) } else { New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize) }
    [void]$t.RowStyles.Add($st)
  }

  $head = UT-NewLabel 18 ([System.Drawing.FontStyle]::Bold) $fg
  $head.Text = $AR.Head
  $status = UT-NewLabel 15 ([System.Drawing.FontStyle]::Bold) $InfoColor
  $status.Text = $AR.Preparing
  $steps = UT-NewLabel 12.5 ([System.Drawing.FontStyle]::Regular) $fg
  $steps.Text = ''
  $warn = UT-NewLabel 11 ([System.Drawing.FontStyle]::Regular) $WarnColor
  $warn.Visible = $false
  $addr = UT-NewLabel 9.5 ([System.Drawing.FontStyle]::Regular) ([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
  $addr.Text = ''

  $list = New-Object System.Windows.Forms.ListBox
  $list.Dock = [System.Windows.Forms.DockStyle]::Fill
  $list.BackColor = [System.Drawing.Color]::FromArgb(255, 17, 26, 36)
  $list.ForeColor = $fg
  $list.BorderStyle = [System.Windows.Forms.BorderStyle]::None
  $list.Font = New-Object System.Drawing.Font('Segoe UI', 10.5)
  $list.IntegralHeight = $false
  $list.Margin = New-Object System.Windows.Forms.Padding(12, 6, 12, 6)

  $bottom = New-Object System.Windows.Forms.FlowLayoutPanel
  $bottom.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight   # mirrored by RightToLeft = Yes
  $bottom.AutoSize = $true
  $bottom.Dock = [System.Windows.Forms.DockStyle]::Fill
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $AR.Close
  $btn.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $btn.AutoSize = $true
  $btn.Padding = New-Object System.Windows.Forms.Padding(18, 4, 18, 4)
  $btn.BackColor = [System.Drawing.Color]::FromArgb(255, 30, 41, 59)
  $btn.ForeColor = $fg
  $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $btn.Add_Click({ $UT.Stop = $true; try { $UT.Form.Close() } catch { } })
  $left = UT-NewLabel 11 ([System.Drawing.FontStyle]::Regular) ([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
  $left.Anchor = [System.Windows.Forms.AnchorStyles]::None
  $left.Text = ''
  $bottom.Controls.Add($left)
  $bottom.Controls.Add($btn)

  $t.Controls.Add($head, 0, 0)
  $t.Controls.Add($status, 0, 1)
  $t.Controls.Add($steps, 0, 2)
  $t.Controls.Add($warn, 0, 3)
  $t.Controls.Add($addr, 0, 4)
  $t.Controls.Add($list, 0, 5)
  $t.Controls.Add($bottom, 0, 6)
  $f.Controls.Add($t)
  $f.CancelButton = $btn
  $f.Add_FormClosing({ $UT.Stop = $true })

  $UT.Form = $f; $UT.Status = $status; $UT.Steps = $steps; $UT.Warn = $warn; $UT.List = $list; $UT.Left = $left; $UT.Addr = $addr
  return $f
}

function UT-FitLabels {
  if (-not (UT-Alive)) { return }
  $w = [Math]::Max(200, $UT.Form.ClientSize.Width - 40)
  foreach ($c in @($UT.Status, $UT.Steps, $UT.Warn, $UT.Addr)) { $c.MaximumSize = New-Object System.Drawing.Size($w, 0) }
}

function UT-ShowSteps([string]$Version) {
  if (-not (UT-Alive)) { return }
  $UT.Steps.Text = (@($AR.Step1, $AR.Step2, $AR.Step3, $AR.Step4, '', $AR.Keep) -join "`n")
  UT-SetStatus ($AR.Ready -f $Version) $OkColor
}

# Wait until the user closes the window (end states), pumping events.
function UT-WaitClose {
  while ((UT-Alive) -and $UT.Form.Visible) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
}

# Called by serve-updates.ps1 for every event.
function UT-OnEvent($ev) {
  $k = [string]$ev.Kind
  $file = if ($ev.ContainsKey('File')) { [string]$ev.File } else { '' }
  $isApk = $file.EndsWith('.apk')
  $isZip = $file.EndsWith('.zip')
  switch ($k) {
    'start' {
      $UT.Phase = 'serve'
      if ($ev.Minutes -gt 0) { $UT.Deadline = (Get-Date).AddMinutes([double]$ev.Minutes) }
      $w = @()
      if ($ev.NoLan) { $w += $AR.NoLan }
      if (-not $ev.Loopback) {
        if ($ev.Blocked) { $w += $AR.Blocked } elseif (-not $ev.Allowed) { $w += $AR.Firewall }
        if ($ev.Public) { $w += $AR.Public }
      }
      UT-SetWarn ($w -join "`n`n")
      # LRM after each URL keeps its trailing '/' on the right side inside the right-to-left label
      $lrm = [string][char]0x200E
      if (@($ev.Urls).Count -gt 0 -and (UT-Alive)) { $UT.Addr.Text = ($AR.Address -f ((@($ev.Urls) | ForEach-Object { $_ + $lrm }) -join '   ')) }
      UT-Log $AR.Waiting
    }
    'discover' { UT-SetStatus $AR.Found $InfoColor; UT-Log $AR.Found }   # IP stays in the console (digits shaping)
    'get' {
      if ($file -eq 'update.properties') { UT-SetStatus $AR.Checking $InfoColor; UT-Log $AR.Checking; $UT.CheckAt = Get-Date; $UT.Downloading = $false; $UT.CheckedShown = $false }
      elseif ($isZip -or $isApk) { $UT.Downloading = $true; UT-SetStatus ($(if ($isApk) { $AR.DlApk } else { $AR.DlContent }) -f 0) $InfoColor }
    }
    'progress' {
      $UT.Downloading = $true
      if ($isZip) { UT-SetStatus ($AR.DlContent -f $ev.Percent) $InfoColor }
      elseif ($isApk) { UT-SetStatus ($AR.DlApk -f $ev.Percent) $InfoColor }
    }
    'done' {
      if ($isZip) { UT-SetStatus $AR.DoneContent $OkColor; UT-Log $AR.DoneContent }
      elseif ($isApk) { UT-SetStatus $AR.DoneApk $OkColor; UT-Log $AR.DoneApk }
    }
    'abort' { if ($isZip -or $isApk) { UT-SetStatus $AR.Aborted $WarnColor; UT-Log $AR.Aborted } }
    'busy'  { UT-SetStatus $AR.PortBusy $BadColor }
    'error' { UT-SetStatus $AR.ServeFail $BadColor }
    'stop'  { if ($ev.Reason -eq 'time') { UT-SetStatus $AR.Over $InfoColor } else { UT-SetStatus $AR.Stopped $InfoColor } }
  }
}

# Called by serve-updates.ps1 many times a second; outputs $false to stop the server.
function UT-Tick {
  UT-Pump
  if (UT-Alive) {
    $now = Get-Date
    if ($UT.Deadline -ne [DateTime]::MaxValue) {
      $m = [int][Math]::Ceiling(($UT.Deadline - $now).TotalMinutes)
      if ($m -ne $UT.LastLeft -and $m -ge 0) { $UT.LastLeft = $m; try { $UT.Left.Text = ($AR.Left -f $m) } catch { } }
    }
    if ($null -ne $UT.CheckAt -and -not $UT.Downloading -and -not $UT.CheckedShown -and ($now - $UT.CheckAt).TotalSeconds -gt 15) {
      $UT.CheckedShown = $true
      UT-SetStatus $AR.Checked $OkColor
      UT-Log $AR.Checked
    }
  }
  return (-not $UT.Stop)
}

# Runs a script in a child powershell.exe that shares this console; keeps the window responsive meanwhile.
function UT-RunChild([string]$Script, [string[]]$ArgList) {
  $q = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script) + $ArgList
  $line = ($q | ForEach-Object { if ($_ -match '[\s"]' -or $_ -eq '') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $PSHOME 'powershell.exe'
  $psi.Arguments = $line
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  while (-not $p.HasExited) {
    UT-Pump
    if ($UT.Stop) {
      Write-Host 'Window closed: stopping...' -ForegroundColor Yellow
      & taskkill.exe /T /F /PID $p.Id | Out-Null
      break
    }
    Start-Sleep -Milliseconds 60
  }
  $p.WaitForExit()
  return $p.ExitCode
}

function UT-ReadManifest([string]$Path) {
  $h = @{}
  if (Test-Path -LiteralPath $Path) {
    foreach ($l in [IO.File]::ReadAllLines($Path)) { $i = $l.IndexOf('='); if ($i -gt 0 -and -not $l.StartsWith('#')) { $h[$l.Substring(0, $i)] = $l.Substring($i + 1) } }
  }
  return $h
}

# ------------------------------------------------------------------------------------------------ shortcut
# .ico (PNG-compressed entries, Windows Vista+) made from the app's launcher icons, for the desktop shortcut.
function UT-MakeIcon([string]$Dest) {
  $pngs = @()
  foreach ($d in @('mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi')) {
    $p = Join-Path $PSScriptRoot "res\$d\ic_launcher.png"
    if (Test-Path -LiteralPath $p) { $pngs += $p }
  }
  if ($pngs.Count -eq 0) { return $null }
  Add-Type -AssemblyName System.Drawing
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$pngs.Count)
  $offset = 6 + 16 * $pngs.Count
  $datas = @()
  foreach ($p in $pngs) {
    $bytes = [IO.File]::ReadAllBytes($p)
    $img = [System.Drawing.Image]::FromFile($p)
    try { $w = $img.Width; $h = $img.Height } finally { $img.Dispose() }
    $bw.Write([byte]($(if ($w -ge 256) { 0 } else { $w }))); $bw.Write([byte]($(if ($h -ge 256) { 0 } else { $h })))
    $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$bytes.Length); $bw.Write([uint32]$offset)
    $offset += $bytes.Length
    $datas += , $bytes
  }
  foreach ($b in $datas) { $bw.Write([byte[]]$b) }
  $bw.Flush()
  $dir = Split-Path -Parent $Dest
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllBytes($Dest, $ms.ToArray())
  $bw.Dispose()
  return $Dest
}

function UT-MakeShortcut {
  $desk = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desk ($AR.Shortcut + '.lnk')
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $ico = $null
  try { $ico = UT-MakeIcon (Join-Path $env:LOCALAPPDATA 'DroneSim\update-tv.ico') } catch { $ico = $null }
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($lnk)
  $sc.TargetPath = $ps
  $sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $sc.WorkingDirectory = $PSScriptRoot
  $sc.WindowStyle = 1
  $sc.Description = 'Drone simulator: update the app on the TV (saved progress is kept)'
  if ($ico) { $sc.IconLocation = "$ico,0" } else { $sc.IconLocation = "$ps,0" }
  $sc.Save()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wsh)
  # read it back: the Arabic folder names must have survived
  $chk = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  if (-not $chk.Arguments.Contains($PSCommandPath)) { throw "Shortcut check failed: $($chk.Arguments)" }
  return $lnk
}

# ------------------------------------------------------------------------------------------------ main
$code = 0
try {
  if ($MakeShortcut) {
    $l = UT-MakeShortcut
    Say "Desktop shortcut created: $l"
    exit 0
  }
  try { $Host.UI.RawUI.WindowTitle = 'DroneSim - TV update (details)' } catch { }
  Say 'DroneSim TV update'
  Note 'This black window shows the details. The instructions (Arabic) are in the other window.'
  if (-not $NoWindow) {
    try {
      $form = UT-NewWindow
      $form.Show()
      UT-FitLabels
      $form.Activate()
      UT-Pump
    } catch {
      Write-Host "No window ($($_.Exception.Message)); continuing in this console." -ForegroundColor Yellow
      $UT.Form = $null
    }
  }

  # ---- 1. publish
  if (-not $SkipPublish) {
    $pargs = @('-OutDir', $OutDir.TrimEnd('\'), '-BuildDir', $BuildDir.TrimEnd('\'))
    # -Adb installs the APK itself: it must be built now, or it would still carry the previous web content
    if ($ForceApk -or $Adb) { $pargs += '-ForceApk' }
    if ($Notes) {
      $nf = Join-Path $env:TEMP 'dronesim-update-notes.txt'
      [IO.File]::WriteAllText($nf, $Notes, (New-Object System.Text.UTF8Encoding($false)))
      $pargs += @('-NotesFile', $nf)
    }
    $rc = UT-RunChild (Join-Path $PSScriptRoot 'publish-update.ps1') $pargs
    if ($UT.Stop) { exit 0 }
    if ($rc -ne 0) {
      $code = $rc
      Write-Host "Publishing failed (exit code $rc). See the messages above." -ForegroundColor Red
      UT-SetStatus ($(if ($rc -eq 3) { $AR.KeyFail } elseif ($rc -eq 5) { $AR.KeyMissing } else { $AR.PrepFail })) $BadColor
      if (UT-Alive) { UT-WaitClose } elseif (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
      exit $code
    }
  }
  $man = UT-ReadManifest (Join-Path $OutDir 'update.properties')
  $ver = if ($man.ContainsKey('content.version')) { $man['content.version'] } else { '?' }
  UT-ShowSteps $ver

  # ---- 2a. adb install (optional) instead of waiting for the TV
  if ($Adb) {
    $apk = if ($man.ContainsKey('apk.file')) { Join-Path $OutDir $man['apk.file'] } else { '' }
    if (-not $apk -or -not (Test-Path -LiteralPath $apk)) { throw 'No published APK to install.' }
    # the APK's own web content is its versionCode: an older APK would not bring the published content
    $apkCode = 0L; $cv = 0L
    [void][long]::TryParse([string]$man['apk.versionCode'], [ref]$apkCode)
    if ($man.ContainsKey('content.version')) { [void][long]::TryParse([string]$man['content.version'], [ref]$cv) }
    if ($apkCode -lt $cv) { throw "The published APK ($apkCode) is older than the published web content ($cv). Run update-tv.ps1 -Adb without -SkipPublish." }
    UT-SetStatus $AR.AdbRun $InfoColor
    $iargs = @('-Apk', $apk)
    if ($Ip) { $iargs += @('-Ip', $Ip) }
    $rc = UT-RunChild (Join-Path $PSScriptRoot 'install-tv.ps1') $iargs
    if ($rc -eq 0) { UT-SetStatus $AR.AdbOk $OkColor } else { $code = $rc; UT-SetStatus $AR.AdbFail $BadColor }
    if (UT-Alive) { UT-WaitClose } elseif (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
    exit $code
  }

  # ---- 2b. serve to the TV
  $serve = Join-Path $PSScriptRoot 'serve-updates.ps1'
  if (UT-Alive) {
    & $serve -Dir $OutDir -Bind $Bind -Port $Port -Minutes $Minutes -OnEvent { param($e) UT-OnEvent $e } -Tick { UT-Tick }
  } else {
    & $serve -Dir $OutDir -Bind $Bind -Port $Port -Minutes $Minutes
  }
  $code = $LASTEXITCODE
  if ($UT.Stop) { exit 0 }
  if (UT-Alive) { UT-WaitClose } elseif (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
  exit $code
}
catch {
  Write-Host "UPDATE FAILED: $($_.Exception.Message)" -ForegroundColor Red
  UT-SetStatus $AR.PrepFail $BadColor
  if (UT-Alive) { UT-WaitClose } elseif (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
  exit 1
}
