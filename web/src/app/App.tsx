import { useEffect, useMemo, useRef, useState } from "react";
import { CueParser } from "../cue/parser";
import { segment } from "../cue/segmenter";
import { DEFAULT_KOKORO_VOICE, KokoroWebAdapter, type KokoroProgress } from "../adapters/tts/kokoroWeb";
import type { VoiceInfo } from "../adapters/tts/types";
import { playSimple } from "../engine/player";
import { timing } from "../lib/timing";
import { DebugPanel } from "./DebugPanel";

type DrawerTab = "settings" | "memories" | "debug";
type Phase = "idle" | "loading" | "summoning" | "playing";

export function App() {
  const [level, setLevel] = useState(3);
  const [tab, setTab] = useState<DrawerTab>("settings");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<KokoroProgress | null>(null);
  const [prerender, setPrerender] = useState<[number, number] | null>(null);
  const [line, setLine] = useState("");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState(DEFAULT_KOKORO_VOICE);
  const [error, setError] = useState("");
  const [device, setDevice] = useState("");
  const abort = useRef<AbortController | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const adapter = useMemo(() => new KokoroWebAdapter(setProgress), []);
  useEffect(() => () => adapter.dispose(), [adapter]);

  async function loadModel() {
    setError("");
    setPhase("loading");
    try {
      await adapter.load();
      setVoices(adapter.voices);
      if (adapter.status) setDevice(`${adapter.status.device}/${adapter.status.dtype}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
    setPhase("idle");
  }

  async function playSample() {
    setError("");
    setLine("");
    ctx.current ??= new AudioContext();
    const ac = new AbortController();
    abort.current = ac;
    try {
      setPhase("loading");
      await adapter.load();
      setVoices(adapter.voices);
      if (adapter.status) setDevice(`${adapter.status.device}/${adapter.status.dtype}`);

      const res = await fetch(`${import.meta.env.BASE_URL}sample/sample.cue.txt`);
      if (!res.ok) throw new Error(`Could not load the sample script (${res.status})`);
      const { events, stats } = CueParser.parse(await res.text());
      if (stats.unknownTags) timing.count("unknown tags dropped", stats.unknownTags);
      const segments = segment(events, { maxChars: adapter.caps.maxChars, targetChars: 0 });

      setPhase("summoning");
      await playSimple(segments, {
        adapter,
        voice,
        ctx: ctx.current,
        signal: ac.signal,
        onPrerender: (d, t) => setPrerender([d, t]),
        onLine: setLine,
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(String(e instanceof Error ? e.message : e));
    }
    setPrerender(null);
    setPhase("idle");
  }

  const busy = phase !== "idle";
  const pct = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : null;

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
          {phase === "idle" && !line && <div className="hint">The Stage. Nothing is summoned yet.</div>}
          {phase === "loading" && (
            <div className="hint">
              Loading voice model{pct !== null ? ` — ${pct}%` : "…"}
              {progress ? <div>{progress.file}</div> : null}
            </div>
          )}
          {phase === "summoning" && prerender && (
            <div className="hint">
              Summoning… {prerender[0]}/{prerender[1]}
            </div>
          )}
          {line && <div className="line">{line}</div>}
          {error && <div className="hint" style={{ color: "var(--alarm)" }}>{error}</div>}
          <div>
            {phase === "idle" ? (
              <button className="primary" onClick={playSample}>
                Play sample
              </button>
            ) : (
              <button onClick={() => abort.current?.abort()}>Stop</button>
            )}
          </div>
        </main>
        <aside className="drawer">
          <div className="tabs">
            {(["settings", "memories", "debug"] as const).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="panel">
            {tab === "settings" && (
              <>
                <label>
                  Voice (Kokoro)
                  <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={busy}>
                    {!voices.length && <option value={voice}>{voice} (load model to list voices)</option>}
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={loadModel} disabled={busy}>
                  Load voice model
                </button>
                {device && <div className="badge">Running on {device}</div>}
              </>
            )}
            {tab === "memories" && <div className="hint">Coming in M4.</div>}
            {tab === "debug" && <DebugPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
