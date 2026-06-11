# AudioShelf — Tools & Harness

This directory contains the self-verification harness and the MSVC environment wrapper used by all Rust/Tauri builds on Windows.

---

## `dev-env.cmd`

**Purpose:** Initialises the Rust + MSVC build environment, then runs whatever command you pass.

Tauri on Windows requires the MSVC C++ toolchain to be active in the shell. `dev-env.cmd` locates the latest Visual Studio installation via `vswhere`, calls `vcvars64.bat` to set the compiler environment, prepends `~\.cargo\bin` to `PATH`, and then executes the remaining arguments as a command.

**Usage:**

```cmd
tools\dev-env.cmd <any cargo / tauri command>
```

**Examples:**

```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
cmd /c "tools\dev-env.cmd cargo tauri dev"
cmd /c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```

If Visual Studio with the VC++ toolset cannot be found, the script exits with code 9009 and prints a diagnostic.

---

## `gen-fixture`

**Purpose:** Generates a small, deterministic synthetic WAV library for use by the self-verification harness.

`gen-fixture` is a standalone Rust binary (`tools/gen-fixture/Cargo.toml`). It writes silent mono 8 kHz 16-bit WAV files into an output directory you specify, mirroring the real collection layout (author subfolders, files named with the base-title + chapter-number convention).

**Generated structure:**

```
<output-dir>/
  Jane Doe/
    Cool Story.wav                (2 s)   — chapter 1 of "Cool Story"
    Cool Story 2 the sequel.wav   (3 s)   — chapter 2 of "Cool Story"
    Cool Story 3 finale.wav       (4 s)   — chapter 3 of "Cool Story"
    Another Standalone Tale.wav   (5 s)   — standalone work
  Sam Smith/
    Night Walk.wav                (6 s)   — chapter 1 of "Night Walk"
    Night Walk 2.wav              (7 s)   — chapter 2 of "Night Walk"
  Trap Author/
    Area 51.wav                   (2 s)   — trap: lone numbered file
```

**The "Area 51" trap:** `Area 51.wav` is the only file in its author folder. Because it has no siblings sharing the base title "Area", the grouping logic must **demote** it to a standalone work ("Area 51", chapter 1) rather than splitting it into work "Area" / chapter 51. The harness walkthrough asserts this demotion is applied correctly.

**Running manually:**

```powershell
cmd /c "tools\dev-env.cmd cargo run --manifest-path tools\gen-fixture\Cargo.toml -- <output-dir>"
```

---

## `verify.ps1`

**Purpose:** End-to-end self-verification script. Builds the app, drives it through a UI walkthrough against the synthetic library, captures screenshots, and reports pass/fail.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Walkthrough` | string | `"browse"` | Name of the walkthrough scenario to execute. Passed to the app as `--walkthrough <name>`. Screenshots go to `.shots\<name>\`. |
| `-TimeoutSec` | int | `240` | Seconds to wait for the app to emit the done-signal before declaring a timeout failure. |
| `-SkipBuild` | switch | off | Skip the `cargo tauri build` step and use whatever binary is already in `src-tauri\target\debug\`. |

### Pipeline

1. **Clean** — removes `.shots\<walkthrough>\` and any stale done-signal file.
2. **Regenerate fixture** — runs `gen-fixture` to write fresh WAV files into `.fixture\`.
3. **Build** (unless `-SkipBuild`) — runs `cargo tauri build --debug --no-bundle` via `dev-env.cmd`. Fails fast if the build exits non-zero.
4. **Launch** — starts `audioshelf.exe` with the harness flags (see below). The process is not waited on synchronously; the script polls for the done-signal file instead.
5. **Poll** — checks for `.shots\<walkthrough>.done` every 300 ms until it appears or `-TimeoutSec` elapses.
6. **Report** — kills the app process if still running, then prints the list of captured screenshots and exits 0 on success or 1 on timeout/build failure.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Walkthrough completed; done-signal received within the timeout. |
| `1` | Fixture generation failed, build failed, or timeout waiting for done-signal. |

### Output

Screenshots are written by the app to `.shots\<walkthrough>\` (filenames determined by the walkthrough steps). The done-signal is a zero-byte file at `.shots\<walkthrough>.done`.

### Example invocations

```powershell
# Standard full run
.\tools\verify.ps1

# Quick re-run after code changes (binary already built)
.\tools\verify.ps1 -SkipBuild

# Longer timeout for slow machines
.\tools\verify.ps1 -TimeoutSec 360
```

---

## App Launch Flags (harness mode)

These flags are consumed by the Tauri app itself (implemented in `src-tauri/src/launch.rs`). They are passed by `verify.ps1` automatically; you can also use them directly for manual testing.

| Flag | Argument | Description |
|------|----------|-------------|
| `--library` | `<path>` | Path to the root library folder to scan on startup. Skips the normal folder-picker dialog. |
| `--autostart` | *(none)* | Begin scanning the library immediately on launch without waiting for user interaction. |
| `--walkthrough` | `<name>` | Name of the UI walkthrough scenario to run (e.g. `browse`). The app executes the named scenario and captures screenshots automatically. |
| `--shots` | `<dir>` | Directory where screenshot files are written during the walkthrough. |
| `--done-signal` | `<file>` | Path to a file the app creates (or touches) when the walkthrough is complete. The harness polls for this file. |
| `--exit-when-done` | *(none)* | Cause the app to exit automatically once the walkthrough finishes and the done-signal has been written. |

### Screenshot method

Screenshots are captured using the **Win32 `PrintWindow` API**, which renders the window contents directly rather than reading the screen pixels. This is reliable even when the window is partially obscured or minimised, and correctly captures the WebView2-hosted front-end without requiring a compositing pass.

---

## Directory layout

```
tools/
  dev-env.cmd          MSVC + cargo environment wrapper
  verify.ps1           End-to-end self-verification script
  gen-fixture/
    Cargo.toml
    src/
      main.rs          CLI entry point
      lib.rs           Fixture generation logic
```
