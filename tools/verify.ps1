param(
  [string]$Walkthrough = "browse",
  [int]$TimeoutSec = 240,
  [switch]$SkipBuild,
  [string]$OutputRoot = ".shots"
)
$ErrorActionPreference = "Stop"
$root    = Split-Path -Parent $PSScriptRoot
$devenv  = Join-Path $PSScriptRoot "dev-env.cmd"
$fixture = Join-Path $root ".fixture"
$output  = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot
} else {
  Join-Path $root $OutputRoot
}
$shots   = Join-Path $output $Walkthrough
$done    = Join-Path $output "$Walkthrough.done"

# Run from the repo root so `cargo tauri build` can locate src-tauri/tauri.conf.json
# regardless of the caller's working directory.
Set-Location $root

Remove-Item $shots -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $done -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $shots | Out-Null

cmd /c "`"$devenv`" cargo run --quiet --manifest-path `"$root\tools\gen-fixture\Cargo.toml`" -- `"$fixture`""
if ($LASTEXITCODE -ne 0) { Write-Host "FIXTURE GENERATION FAILED"; exit 1 }

if (-not $SkipBuild) {
  cmd /c "`"$devenv`" cargo tauri build --debug --no-bundle"
  if ($LASTEXITCODE -ne 0) { Write-Host "APP BUILD FAILED"; exit 1 }
}
$exe = Get-ChildItem "$root\src-tauri\target\debug\audioshelf.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Write-Host "APP EXE NOT FOUND"; exit 1 }

$argLine = "--library `"$fixture`" --autostart --walkthrough $Walkthrough " +
           "--shots `"$shots`" --done-signal `"$done`" --exit-when-done"
$proc = Start-Process -FilePath $exe.FullName -ArgumentList $argLine -PassThru

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not (Test-Path $done) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
if (-not $proc.HasExited) { try { $proc.Kill() } catch {} }

if (Test-Path $done) {
  Write-Host "WALKTHROUGH OK. Shots:"
  Get-ChildItem $shots | ForEach-Object { Write-Host "  $($_.FullName)" }

  # Pixel-diff comparison against a stable baseline. Informational only --
  # CHANGED/NEW shots do NOT fail the run; the diff-manifest.txt tells the
  # verifier which images are worth loading into context.
  $baseline = Join-Path $root ".shots-baseline\$Walkthrough"
  . (Join-Path $PSScriptRoot "Compare-Screenshots.ps1")
  Compare-ScreenshotSet -CurrentDir $shots -BaselineDir $baseline | Out-Null

  exit 0
} else {
  Write-Host "WALKTHROUGH TIMED OUT (no done-signal)"; exit 1
}
