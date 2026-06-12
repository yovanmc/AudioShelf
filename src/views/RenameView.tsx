import type { RenameItem, RenameResult } from "../lib/api";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";

function pluralFiles(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

export function RenameView(props: {
  items: RenameItem[];
  result: RenameResult | null;
  onApply: (chapterIds: number[]) => void;
  onUndo: () => void;
  onBack?: () => void;
  onReload: () => void;
}) {
  const okItems = props.items.filter((i) => i.status === "ok");
  const okIds = okItems.map((i) => i.chapterId);

  return (
    <main className="view rename">
      <PageHeader eyebrow="Tidy up your file names — changes are reversible" title="Rename tool" />
      <Card className="view-section" style={{ padding: 20 }}>
      <p className="rename-blurb">
        Preview canonical filenames below. Only <strong>{pluralFiles(okItems.length)}</strong> will
        change; conflicts and already-clean files are skipped. Renames are reversible — an Undo
        button appears after you apply.
      </p>

      {props.result ? (
        <Notice tone={props.result.failures.length ? "error" : "success"} role="status">
          <p>Renamed {pluralFiles(props.result.renamedCount)}.</p>
          {props.result.failures.length > 0 && (
            <ul className="rename-failures">
              {props.result.failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
          <Button variant="secondary" onClick={props.onUndo}>Undo this rename</Button>
          <Button variant="ghost" onClick={props.onReload}><Icon name="refresh" /> Refresh preview</Button>
        </Notice>
      ) : (
        <Button variant="primary" disabled={okIds.length === 0} onClick={() => props.onApply(okIds)}>
          Rename {pluralFiles(okItems.length)}
        </Button>
      )}
      </Card>

      <Card style={{ overflow: "hidden" }}><table className="rename-table data-table">
        <thead>
          <tr><th>Author</th><th>Current</th><th>Proposed</th><th>Status</th></tr>
        </thead>
        <tbody>
          {props.items.map((i) => (
            <tr key={i.chapterId} className={`rename-row rename-${i.status}`}>
              <td>{i.authorName}</td>
              <td>{i.fromName}</td>
              <td>{i.status === "noop" ? "—" : i.toName}</td>
              <td>
                {i.status === "ok" && <span className="badge badge-ok">rename</span>}
                {i.status === "noop" && <span className="badge badge-noop">already clean</span>}
                {i.status === "conflict" && (
                  <span className="badge badge-conflict" title={i.conflictReason ?? ""}>conflict</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></Card>
    </main>
  );
}
