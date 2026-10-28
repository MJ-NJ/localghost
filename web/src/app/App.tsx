import { useState } from "react";

type DrawerTab = "settings" | "memories" | "debug";

export function App() {
  const [level, setLevel] = useState(3);
  const [tab, setTab] = useState<DrawerTab>("settings");

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Localghost</h1>
        <div className="dial">
          <span>Scare</span>
          <input type="range" min={1} max={5} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <span>{level}</span>
        </div>
        <span className="spacer" />
        <span className="badge">Data flow: —</span>
      </header>
      <div className="body">
        <main className="stage">
          <div className="hint">The Stage. Nothing is summoned yet.</div>
        </main>
        <aside className="drawer">
          <div className="tabs">
            {(["settings", "memories", "debug"] as const).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="panel">{tab}</div>
        </aside>
      </div>
    </div>
  );
}
