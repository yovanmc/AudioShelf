import type { RenameItem, RenameResult } from "../lib/api";

function pluralFiles(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

export function RenameView(props: {
  items: RenameItem[];
  result: RenameResult | null;
  onApply: (chapterIds: number[]) => void;
  onUndo: () => void;
  onBack: () => void;
  onReload: () => void;
}) {
  const okItems = props.items.filter((i) => i.status === "ok");
  const okIds = okItems.map((i) => i.chapterId);

  return (
    <div className="rename">
      <button onClick={props.onBack}>← Library</button>
      <h1>Rename tool</h1>
      <p className="rename-blurb">
        Preview canonical filenames below. Only <strong>{pluralFiles(okItems.length)}</strong> will
        change; conflicts and already-clean files are skipped. Renames are reversible — an Undo
        button appears after you apply.
      </p>

      {props.result ? (
        <div className="rename-result" role="status">
          <p>Renamed {pluralFiles(props.result.renamedCount)}.</p>
          {props.result.failures.length > 0 && (
            <ul className="rename-failures">
              {props.result.failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
          <button onClick={props.onUndo}>Undo this rename</button>
          <button onClick={props.onReload}>Refresh preview</button>
        </div>
      ) : (
        <button disabled={okIds.length === 0} onClick={() => props.onApply(okIds)}>
          Rename {pluralFiles(okItems.length)}
        </button>
      )}

      <table className="rename-table">
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
      </table>
    </div>
  );
}
