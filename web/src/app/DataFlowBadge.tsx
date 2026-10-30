import { useState } from "react";
import type { Flow } from "./dataFlow";

/** Top-bar privacy badge. Click for a table of what goes where. */
export function DataFlowBadge({ flow }: { flow: Flow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flow">
      <button className="badge-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>{flow.emoji}</span> {flow.headline}
      </button>
      {open && (
        <div className="flow-panel" role="dialog" aria-label="Where your data goes">
          <table>
            <thead>
              <tr>
                <th>What</th>
                <th>Goes to</th>
              </tr>
            </thead>
            <tbody>
              {flow.rows.map((r) => (
                <tr key={r.what} className={r.leaves ? "leaves" : ""}>
                  <td>{r.what}</td>
                  <td>
                    {r.leaves ? "⚠ " : ""}
                    {r.where}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
