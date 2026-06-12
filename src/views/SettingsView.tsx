import type { ScanResult } from "../lib/api";
import { Button, Card, Notice } from "../components/ui";
import { Icon } from "../components/Icon";

export function SettingsView(props: {
  root: string | null;
  lastScan: ScanResult | null;
  scanError: string | null;
  busy: boolean;
  firstRun: boolean;
  onChooseFolder: () => void;
  onRescan: () => void;
  onBack?: () => void;
}) {
  const { root, lastScan, scanError, busy, firstRun } = props;
  return (
    <main className={firstRun ? "settings" : "view settings"}>
      <header className="view-section"><div className="muted">{firstRun ? "Welcome to AudioShelf" : "Library preferences"}</div><h1>{firstRun ? "Choose your audio library" : "Settings"}</h1></header>

      {firstRun && (
        <p className="muted">
          Welcome to AudioShelf. Choose the folder that holds your audio library
          (one subfolder per author) to get started.
        </p>
      )}

      <Card className="settings-root" style={{ padding: 24 }}>
        <h2>Library folder</h2>
        {root ? <p className="current-root">{root}</p> : <p>No library folder chosen yet.</p>}

        <Button variant="primary" onClick={props.onChooseFolder} disabled={busy}>
          <Icon name="folder" />
          {root ? "Choose a different folder…" : "Choose library folder…"}
        </Button>
        {root && (
          <Button variant="secondary" onClick={props.onRescan} disabled={busy}>
            <Icon name="refresh" />
            Re-scan this folder
          </Button>
        )}
      </Card>

      {busy && <p className="settings-busy">Scanning…</p>}

      {scanError && (
        <Notice tone="error" role="alert">
          Couldn't scan that folder: {scanError}
        </Notice>
      )}

      {lastScan && !busy && !scanError && (
        <Notice tone="success">
          Indexed {lastScan.authors} authors, {lastScan.works} works,{" "}
          {lastScan.chapters} chapters.
        </Notice>
      )}
    </main>
  );
}
