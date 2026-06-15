# Generates tiny (~2s) REAL encoded audio samples for M35 real-media tests.
# Requires ffmpeg on PATH. Run once; the produced files are committed to git.
# Output: src-tauri/tests/media/Real Formats/
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dir  = Join-Path $root "src-tauri\tests\media\Real Formats"
New-Item -ItemType Directory -Force $dir | Out-Null

function S($name, [string[]]$enc) {
  $out = Join-Path $dir $name
  & ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" @enc $out 2>$null
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $name" }
}
S "Mp3 Sample - 01.mp3"  @("-c:a","libmp3lame","-b:a","64k")
S "M4a Sample - 01.m4a"  @("-c:a","aac","-b:a","64k")
S "Mp4 Sample - 01.mp4"  @("-c:a","aac","-b:a","64k")
S "Flac Sample - 01.flac" @("-c:a","flac")
S "Ogg Sample - 01.ogg"  @("-c:a","libvorbis","-q:a","2")
S "Wav Sample - 01.wav"  @("-c:a","pcm_s16le")

# Art-bearing MP3: embed a tiny cover (APIC)
$cover = Join-Path $env:TEMP "m35cover.png"
& ffmpeg -y -f lavfi -i "color=c=blue:s=80x80:d=0.1" -frames:v 1 $cover 2>$null
$artOut = Join-Path $dir "With Art - 01.mp3"
& ffmpeg -y -f lavfi -i "sine=frequency=330:duration=2" -i $cover `
  -map 0:a -map 1:v -c:a libmp3lame -b:a 64k -c:v mjpeg -id3v2_version 3 `
  -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" `
  -disposition:v attached_pic $artOut 2>$null
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for art mp3" }

# Corrupt file: valid extension, invalid payload
[System.IO.File]::WriteAllBytes((Join-Path $dir "Corrupt File - 01.mp3"),
  [byte[]](0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09))

Write-Host "Generated samples in $dir"
Get-ChildItem $dir | Select-Object Name, Length
