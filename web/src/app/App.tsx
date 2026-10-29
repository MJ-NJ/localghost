import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CueParser } from "../cue/parser";
import { segment } from "../cue/segmenter";
import type { Style } from "../cue/spec";
import { DEFAULT_KOKORO_VOICE, KokoroWebAdapter, type KokoroProgress } from "../adapters/tts/kokoroWeb";
import type { VoiceInfo } from "../adapters/tts/types";
import { Effects } from "../engine/effects";
import { Player, prepare, type PlayerState, type Prepared } from "../engine/player";
import { timing } from "../lib/timing";
import { DebugPanel } from "./DebugPanel";
import { Stage } from "./Stage";

type DrawerTab = "settings" | "memories" | "debug";
type Phase = "idle" | "loading" | "summoning";

const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
};

export function App() {
  const [level, setLevel] = useState(3);
  const [tab, setTab] = useState<DrawerTab>("settings");
  const [phase, setPhase] = useState<Phase>("idle");
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [progress, setProgress] = useState<KokoroProgress | null>(null);
  const [prerender, setPrerender] = useState<[number, number] | null>(null);
  const [line, setLine] = useState<{ text: string; style: Style; n: number } | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState(DEFAULT_KOKORO_VOICE);
  const [error, setError] = useState("");
  const [device, setDevice] = useState("");
  const [reduceFlashing, setReduceFlashing] = useState(() => readFlag("reduceFlashing"));
  const [showNotice, setShowNotice] = useState(false);
  const [hasStory, setHasStory] = useState(false);

  const fxBlack = useRef<HTMLDivElement>(null);
  const fxRed = useRef<HTMLDivElement>(null);
  const fxVignette = useRef<HTMLDivElement>(null);
  const effects = useRef<Effects | null>(null);
  const reduceRef = useRef(reduceFlashing);
  reduceRef.current = reduceFlashing;

  const abort = useRef<AbortController | null>(null);
  const player = useRef<Player | null>(null);
  const prepared = useRef<Prepared | null>(null);
  const preparedVoice = useRef<string | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const lineN = useRef(0);
  const adapter = useMemo(() => new KokoroWebAdapter(setProgress), []);
  useEffect(() => () => adapter.dispose(), [adapter]);

  useEffect(() => {
    if (fxBlack.current && fxRed.current && fxVignette.current) {
      effects.current = new Effects(
        { black: fxBlack.current, red: fxRed.current, vignette: fxVignette.current },
        () => reduceRef.current,
      );
    }
  }, []);

  const getPlayer = () => (player.current ??= new Player(new AudioContext()));

  const run = useCallback(async (p: Prepared) => {
    effects.current?.clear();
    await getPlayer().start(p, {
      onLine: (text, style) => setLine({ text, style, n: ++lineN.current }),
      onVisual: (ev, at) => {
        if (ev.kind === "light") effects.current?.trigger(ev.mode, ev.seconds, at);
      },
      onFrame: (t) => effects.current?.update(t),
      onEnd: () => {
        effects.current?.clear();
        setPlayerState("idle");
      },
    });
    setPlayerState("playing");
  }, []);

  async function ensureModel() {
    await adapter.load();
    setVoices(adapter.voices);
    if (adapter.status) setDevice(`${adapter.status.device}/${adapter.status.dtype}`);
  }

  async function playSample() {
    setError("");
    setLine(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      getPlayer(); // create the AudioContext inside the user gesture
      if (prepared.current && preparedVoice.current === voice) {
        await run(prepared.current); // same script + voice: reuse the synthesis (M5 adds the real cache)
        return;
      }
      setPhase("loading");
      await ensureModel();

      const res = await fetch(`${import.meta.env.BASE_URL}sample/sample.cue.txt`);
      if (!res.ok) throw new Error(`Could not load the sample script (${res.status})`);
      const { events, stats } = CueParser.parse(await res.text());
      if (stats.unknownTags) timing.count("unknown tags dropped", stats.unknownTags);
      const segments = segment(events, { maxChars: adapter.caps.maxChars, targetChars: 0 });

      setPhase("summoning");
      const p = await prepare(segments, {
        adapter,
        voice,
        signal: ac.signal,
        onProgress: (d, t) => setPrerender([d, t]),
      });
      prepared.current = p;
      preparedVoice.current = voice;
      setHasStory(true);
      setPhase("idle");
      setPrerender(null);
      await run(p);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(String(e instanceof Error ? e.message : e));
      setPhase("idle");
      setPrerender(null);
    }
  }

  async function loadModel() {
    setError("");
    setPhase("loading");
    try {
      await ensureModel();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
    setPhase("idle");
  }

  const requestPlay = () => {
    if (readFlag("photosensitivityAck")) void playSample();
    else setShowNotice(true);
  };

  const replay = () => {
    if (prepared.current) {
      setLine(null);
      void run(prepared.current);
    }
  };

  const stop = () => {
    abort.current?.abort();
    player.current?.stop();
    setPlayerState("idle");
  };

  const playerRef = player;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const toggle = useCallback(async () => {
    const p = player.current;
    if (!p) return;
    await p.toggle();
    setPlayerState(p.state);
  }, []);

  // Space toggles pause (unless typing in a field)
  useEffect(() => {
    const ignore = (e: KeyboardEvent) =>
      e.code !== "Space" || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? "");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" && playerRef.current && playerRef.current.state !== "idle") {
        stopRef.current();
        return;
      }
      if (ignore(e)) return;
      e.preventDefault();
      if (!e.repeat) void toggle();
    };
    const up = (e: KeyboardEvent) => {
      if (!ignore(e)) e.preventDefault(); // stop a focused button from also "clicking"
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [toggle]);

  const busy = phase !== "idle";
  const active = playerState !== "idle";

  // While a story plays, the HUD fades after 3 s of inactivity and returns on mouse move / key press.
  useEffect(() => {
    if (!active) {
      setHudVisible(true);
      return;
    }
    let t = window.setTimeout(() => setHudVisible(false), 3000);
    const wake = () => {
      setHudVisible(true);
      clearTimeout(t);
      t = window.setTimeout(() => setHudVisible(false), 3000);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [active]);
  const pct = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : null;

  const hint =
    phase === "loading" ? (
      <>
        Loading voice model{pct !== null ? ` — ${pct}%` : "…"}
        {progress ? <div>{progress.file}</div> : null}
      </>
    ) : phase === "summoning" && prerender ? (
      <>
        Summoning… {prerender[0]}/{prerender[1]}
      </>
    ) : !line && !active ? (
      "The Stage. Nothing is summoned yet."
    ) : null;

  const controls = showNotice ? (
    <div className="notice">
      <p>
        <strong>Photosensitivity notice.</strong> This experience uses flickering lights, blackouts and red flashes. Turn on
        "Reduce flashing" to replace them with slow dims.
      </p>
      <button
        className="primary"
        onClick={() => {
          writeFlag("photosensitivityAck", true);
          setShowNotice(false);
          void playSample();
        }}
      >
        I understand, begin
      </button>{" "}
      <button
        onClick={() => {
          setReduceFlashing(true);
          writeFlag("reduceFlashing", true);
        }}
      >
        Reduce flashing{reduceFlashing ? " ✓" : ""}
      </button>
    </div>
  ) : busy ? (
    <button onClick={stop}>Stop</button>
  ) : active ? null : (
    <>
      <button className="primary" onClick={requestPlay}>
        Play sample
      </button>{" "}
      {hasStory && <button onClick={replay}>Replay</button>}
    </>
  );

  return (
    <div className={`shell ${active ? "immersive" : ""}`}>
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
        <Stage
          fxBlack={fxBlack}
          fxRed={fxRed}
          fxVignette={fxVignette}
          line={line}
          hint={hint}
          error={error}
          controls={controls}
          playerState={playerState}
        />
        {active && (
          <div className={`hud ${hudVisible ? "" : "faded"}`}>
            <button aria-label={playerState === "paused" ? "Resume" : "Pause"} onClick={() => void toggle()}>
              {playerState === "paused" ? "▶" : "❚❚"}
            </button>
            <button aria-label="Stop" onClick={stop}>
              ■
            </button>
          </div>
        )}
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
                  <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={busy || active}>
                    {!voices.length && <option value={voice}>{voice} (load model to list voices)</option>}
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={loadModel} disabled={busy || active}>
                  Load voice model
                </button>
                {device && <div className="badge">Running on {device}</div>}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={reduceFlashing}
                    onChange={(e) => {
                      setReduceFlashing(e.target.checked);
                      writeFlag("reduceFlashing", e.target.checked);
                    }}
                  />
                  Reduce flashing
                </label>
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
