import type { ScanResult } from "../lib/api";

export function SettingsView(props: {
  root: string | null;
  lastScan: ScanResult | null;
  scanError: string | null;
  busy: boolean;
  firstRun: boolean;
  onChooseFolder: () => void;
  onRescan: () => void;
  onBack: () => void;
}) {
  const { root, lastScan, scanError, busy, firstRun } = props;
  return (
    <div className="settings">
      {!firstRun && (
        <button onClick={props.onBack} disabled={busy}>
          Back to library
        </button>
      )}
      <h1>Settings</h1>

      {firstRun && (
        <p>
          Welcome to AudioShelf. Choose the folder that holds your audio library
          (one subfolder per author) to get started.
        </p>
      )}

      <section className="settings-root">
        <h2>Library folder</h2>
        {root ? <p className="current-root">{root}</p> : <p>No library folder chosen yet.</p>}

        <button onClick={props.onChooseFolder} disabled={busy}>
          {root ? "Choose a different folder…" : "Choose library folder…"}
        </button>
        {root && (
          <button onClick={props.onRescan} disabled={busy}>
            Re-scan this folder
          </button>
        )}
      </section>

      {busy && <p className="settings-busy">Scanning…</p>}

      {scanError && (
        <p className="settings-error" role="alert">
          Couldn't scan that folder: {scanError}
        </p>
      )}

      {lastScan && !busy && !scanError && (
        <p className="settings-scan-summary">
          Indexed {lastScan.authors} authors, {lastScan.works} works,{" "}
          {lastScan.chapters} chapters.
        </p>
      )}
    </div>
  );
}
