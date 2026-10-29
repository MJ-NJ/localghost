import { useSyncExternalStore } from "react";
import { timing } from "../lib/timing";

export function DebugPanel() {
  useSyncExternalStore(timing.subscribe, timing.version);
  const entries = timing.entries();
  const counters = [...timing.counters()];
  const notes = timing.notes();

  return (
    <dl className="debug">
      {counters.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      {entries.map((e, i) => (
        <div key={i}>
          <dt>{e.label}</dt>
          <dd>{Math.round(e.ms)} ms</dd>
        </div>
      ))}
      {notes.map((n, i) => (
        <div key={`n${i}`}>
          <dd>{n}</dd>
        </div>
      ))}
      {!entries.length && !counters.length && <dd>No timings yet.</dd>}
    </dl>
  );
}
