<#
.SYNOPSIS
  Pixel-diff screenshot comparison for verify harnesses. Zero external deps
  (System.Drawing only, Windows). Emits a per-shot similarity manifest so an
  automated verifier can SKIP loading images whose UI state is unchanged --
  the token-saving complement to viewing screenshots inside a subagent.

  CANONICAL MASTER: C:\Agent Zone\tools\Compare-Screenshots.ps1
  Vendored verbatim into each repo's harness folder (tools\ or build\).
  Keep the copies in sync with this master.

.NOTES
  Metric is TILE-MAX mean-absolute pixel difference on a downscaled 32bpp
  surface: the frame is partitioned into a grid and we return the single
  most-changed tile's normalized diff in [0,1] (0 = identical, 1 = max diff /
  dimension mismatch). Tile-max -- not a whole-frame average -- so a small
  LOCALIZED change (a pill color, a number, an icon) still spikes its tile and
  is reported CHANGED, while global render jitter stays low. It answers "did
  any region of this UI state visibly change", not "are these pixel-perfect".
  Biased to be conservative: a false CHANGED just costs an image load; a false
  UNCHANGED would hide a regression, so we err toward CHANGED.
#>

Add-Type -AssemblyName System.Drawing

function Get-NormalizedImageDiff {
  # Returns a [double] in [0,1] = the most-changed tile's mean abs diff.
  # 0 = identical. Dimension mismatch => 1.0.
  param(
    [Parameter(Mandatory)][string]$PathA,
    [Parameter(Mandatory)][string]$PathB,
    [int]$SampleEdge = 256,
    [int]$TileEdge   = 16
  )
  $imgA = [System.Drawing.Image]::FromFile($PathA)
  try {
    $imgB = [System.Drawing.Image]::FromFile($PathB)
    try {
      if ($imgA.Width -ne $imgB.Width -or $imgA.Height -ne $imgB.Height) { return 1.0 }

      # Downscale both into a fixed, small 32bpp surface for a bounded compare.
      $scale = [Math]::Min(1.0, $SampleEdge / [Math]::Max($imgA.Width, $imgA.Height))
      $w = [Math]::Max(1, [int]($imgA.Width  * $scale))
      $h = [Math]::Max(1, [int]($imgA.Height * $scale))
      $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
      $bmpA = New-Object System.Drawing.Bitmap $w, $h, $fmt
      $bmpB = New-Object System.Drawing.Bitmap $w, $h, $fmt
      try {
        $gA = [System.Drawing.Graphics]::FromImage($bmpA); $gA.DrawImage($imgA, 0, 0, $w, $h); $gA.Dispose()
        $gB = [System.Drawing.Graphics]::FromImage($bmpB); $gB.DrawImage($imgB, 0, 0, $w, $h); $gB.Dispose()

        $rect  = New-Object System.Drawing.Rectangle 0, 0, $w, $h
        $dataA = $bmpA.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $fmt)
        $dataB = $bmpB.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $fmt)
        try {
          $stride = $dataA.Stride
          $bytes  = $stride * $h
          $bufA   = New-Object byte[] $bytes
          $bufB   = New-Object byte[] $bytes
          [System.Runtime.InteropServices.Marshal]::Copy($dataA.Scan0, $bufA, 0, $bytes)
          [System.Runtime.InteropServices.Marshal]::Copy($dataB.Scan0, $bufB, 0, $bytes)

          # NB: PowerShell [int] ROUNDS (banker's); tile indices must FLOOR.
          $tilesX = [int][Math]::Ceiling($w / [double]$TileEdge)
          $tilesY = [int][Math]::Ceiling($h / [double]$TileEdge)
          $tileSum   = New-Object 'double[]' ($tilesX * $tilesY)
          $tileCount = New-Object 'double[]' ($tilesX * $tilesY)
          for ($y = 0; $y -lt $h; $y++) {
            $row = $y * $stride
            $ty  = [int][Math]::Floor($y / $TileEdge)
            for ($x = 0; $x -lt $w; $x++) {
              $i = $row + $x * 4
              $d = [Math]::Abs([int]$bufA[$i]   - [int]$bufB[$i]) +
                   [Math]::Abs([int]$bufA[$i+1] - [int]$bufB[$i+1]) +
                   [Math]::Abs([int]$bufA[$i+2] - [int]$bufB[$i+2])
              $t = $ty * $tilesX + [int][Math]::Floor($x / $TileEdge)
              $tileSum[$t]   += $d
              $tileCount[$t] += 1
            }
          }
          $max = 0.0
          for ($t = 0; $t -lt $tileSum.Length; $t++) {
            if ($tileCount[$t] -gt 0) {
              # 3 channels (RGB), each 0..255.
              $m = $tileSum[$t] / ($tileCount[$t] * 3 * 255.0)
              if ($m -gt $max) { $max = $m }
            }
          }
          return $max
        } finally {
          $bmpA.UnlockBits($dataA); $bmpB.UnlockBits($dataB)
        }
      } finally { $bmpA.Dispose(); $bmpB.Dispose() }
    } finally { $imgB.Dispose() }
  } finally { $imgA.Dispose() }
}

function Compare-ScreenshotSet {
  <#
    Compares every *.png in -CurrentDir against a same-named baseline in
    -BaselineDir. Writes a manifest and returns $true iff ALL shots are
    UNCHANGED (so the caller / verify-subagent can PASS without loading any
    image). Defensive by design:
      * First run (no baseline file) PROMOTES current -> baseline, reports NEW,
        and never silently passes -- the first human/subagent look is required.
      * A CHANGED shot NEVER overwrites its baseline (golden stays put until you
        intentionally refresh it with -UpdateBaseline or by deleting it).
  #>
  param(
    [Parameter(Mandatory)][string]$CurrentDir,
    [Parameter(Mandatory)][string]$BaselineDir,
    [double]$Threshold = 0.02,   # tile-max: most-changed 16px tile must differ >2% to count as CHANGED
    [string]$ManifestPath,
    [switch]$UpdateBaseline
  )
  if (-not $ManifestPath) { $ManifestPath = Join-Path $CurrentDir "diff-manifest.txt" }
  New-Item -ItemType Directory -Force -Path $BaselineDir | Out-Null

  $lines = @(); $allUnchanged = $true; $changed = @()
  $shots = Get-ChildItem -Path $CurrentDir -Filter *.png -File | Sort-Object Name
  foreach ($shot in $shots) {
    $base = Join-Path $BaselineDir $shot.Name
    if ($UpdateBaseline -or -not (Test-Path $base)) {
      $isNew = -not (Test-Path $base)
      Copy-Item $shot.FullName $base -Force
      if ($isNew) {
        $lines += ("{0}  diff=------  NEW (baseline promoted)" -f $shot.Name)
        $allUnchanged = $false; $changed += $shot.Name
      } else {
        $lines += ("{0}  diff=0.0000  BASELINE-UPDATED" -f $shot.Name)
      }
      continue
    }
    $diff = $null
    try { $diff = Get-NormalizedImageDiff -PathA $shot.FullName -PathB $base } catch { $diff = $null }
    # Fail-safe: a null/failed diff is treated as CHANGED so a compare error can
    # never silently pass a shot without a look.
    if ($null -ne $diff -and $diff -le $Threshold) {
      $verdict = "UNCHANGED"
    } else {
      $verdict = "CHANGED"; $allUnchanged = $false; $changed += $shot.Name
      if ($null -eq $diff) { $diff = 1.0 }
    }
    $lines += ("{0}  diff={1:F4}  {2}" -f $shot.Name, $diff, $verdict)
  }

  Set-Content -Path $ManifestPath -Value $lines -Encoding UTF8
  Write-Host "PIXEL-DIFF MANIFEST ($ManifestPath):"
  $lines | ForEach-Object { Write-Host "  $_" }
  if ($shots.Count -eq 0) {
    Write-Host "NO SHOTS FOUND in $CurrentDir"
    return $false
  }
  if ($allUnchanged) {
    Write-Host "ALL SHOTS UNCHANGED -> verifier may PASS without loading images."
  } else {
    Write-Host ("CHANGED/NEW SHOTS ({0}) -> load only these: {1}" -f $changed.Count, ($changed -join ', '))
  }
  return $allUnchanged
}
