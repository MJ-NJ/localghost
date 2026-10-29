import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CueParser } from "../cue/parser";
import { segment } from "../cue/segmenter";
import type { Style } from "../cue/spec";
import { OpenAICompatAdapter } from "../adapters/llm/openaiCompat";
import { direct, countSpeechWords } from "../director/director";
import { DEFAULT_KOKORO_VOICE, KokoroWebAdapter, type KokoroProgress } from "../adapters/tts/kokoroWeb";
import type { VoiceInfo } from "../adapters/tts/types";
import { Effects } from "../engine/effects";
import { Player, prepare, type PlayerState, type Prepared } from "../engine/player";
import { timing } from "../lib/timing";
import { DebugPanel } from "./DebugPanel";
import { ErrorView } from "./ErrorView";
import { SettingsPanel } from "./SettingsPanel";
import { loadLLMSettings, saveLLMSettings, type LLMSettings } from "./settings";
import { Stage } from "./Stage";

type DrawerTab = "settings" | "memories" | "debug";
type Phase = "idle" | "loading" | "writing" | "summoning";
type Source = "sample" | "story";

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

const formatEta = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

export function App() {
  const [level, setLevel] = useState(3);
  const [tab, setTab] = useState<DrawerTab>("settings");
  const [phase, setPhase] = useState<Phase>("idle");
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [progress, setProgress] = useState<KokoroProgress | null>(null);
  const [prerender, setPrerender] = useState<[number, number, number] | null>(null); // done, total, elapsed ms
  const [line, setLine] = useState<{ text: string; style: Style; n: number } | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState(DEFAULT_KOKORO_VOICE);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState("");
  const [llm, setLlm] = useState<LLMSettings>(loadLLMSettings);
  const [pendingSource, setPendingSource] = useState<Source | null>(null);
  const [device, setDevice] = useState("");
  const [reduceFlashing, setReduceFlashing] = useState(() => readFlag("reduceFlashing"));
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
  const preparedKey = useRef<string | null>(null);
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
    if (adapter.status) setDevice(`${adapter.status.device}/${adapter.status.dtype}, ${adapter.status.isolated ? "multi-threaded" : "single-threaded (not cross-origin isolated)"}`);
  }

  const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

  async function begin(source: Source) {
    setError(null);
    setLine(null);
    setDraft("");
    const ac = new AbortController();
    abort.current = ac;
    try {
      getPlayer(); // create the AudioContext inside the user gesture
      if (source === "sample" && prepared.current && preparedKey.current === `sample:${voice}`) {
        await run(prepared.current); // same script + voice: reuse the synthesis (M5 adds the real cache)
        return;
      }

      let segments;
      if (source === "sample") {
        setPhase("loading");
        await ensureModel();
        const res = await fetch(`${import.meta.env.BASE_URL}sample/sample.cue.txt`);
        if (!res.ok) throw new Error(`Could not load the sample script (${res.status})`);
        const { events, stats } = CueParser.parse(await res.text());
        if (stats.unknownTags) timing.count("unknown tags dropped", stats.unknownTags);
        segments = segment(events, { maxChars: adapter.caps.maxChars, targetChars: 0 });
      } else {
        setPhase("writing");
        const voiceLoad = ensureModel(); // load the voice while the model writes
        voiceLoad.catch(() => {}); // surfaced below if it is still failing when we need it
        const result = await direct({
          adapter: new OpenAICompatAdapter(llm),
          level,
          signal: ac.signal,
          onText: (d) => setDraft((t) => t + d),
        });
        if (countSpeechWords(result.events) === 0) {
          throw new Error("The model returned no spoken text. Try again, or try a different model.");
        }
        segments = segment(result.events, { maxChars: adapter.caps.maxChars, targetChars: 0 });
        setPhase("loading");
        await voiceLoad;
      }

      setPhase("summoning");
      setDraft("");
      const synthStart = performance.now();
      const p = await prepare(segments, {
        adapter,
        voice,
        signal: ac.signal,
        onProgress: (d, t) => setPrerender([d, t, performance.now() - synthStart]),
      });
      prepared.current = p;
      preparedKey.current = source === "sample" ? `sample:${voice}` : "story";
      setHasStory(true);
      setPhase("idle");
      setPrerender(null);
      setDraft("");
      await run(p);
    } catch (e) {
      if (!isAbort(e)) setError(e);
      setPhase("idle");
      setPrerender(null);
      setDraft("");
    }
  }

  async function loadModel() {
    setError(null);
    setPhase("loading");
    try {
      await ensureModel();
    } catch (e) {
      setError(e);
    }
    setPhase("idle");
  }

  const request = (source: Source) => {
    if (readFlag("photosensitivityAck")) void begin(source);
    else setPendingSource(source);
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
    phase === "writing" ? (
      "Summoning…"
    ) : phase === "loading" ? (
      <>
        Loading voice model{pct !== null ? ` — ${pct}%` : "…"}
        {progress ? <div>{progress.file}</div> : null}
      </>
    ) : phase === "summoning" && prerender ? (
      <>
        Summoning… {prerender[0]}/{prerender[1]}
        {prerender[0] > 0 && (
          <div>about {formatEta((prerender[2] / prerender[0]) * (prerender[1] - prerender[0]))} left</div>
        )}
      </>
    ) : !line && !active ? (
      "The Stage. Nothing is summoned yet."
    ) : null;

  const controls = pendingSource ? (
    <div className="notice">
      <p>
        <strong>Photosensitivity notice.</strong> This experience uses flickering lights, blackouts and red flashes. Turn on
        "Reduce flashing" to replace them with slow dims.
      </p>
      <button
        className="primary"
        onClick={() => {
          writeFlag("photosensitivityAck", true);
          const src = pendingSource;
          setPendingSource(null);
          void begin(src);
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
      <button className="primary" onClick={() => request("story")}>
        Tell me a story
      </button>{" "}
      <button onClick={() => request("sample")}>Play sample</button>{" "}
      {hasStory && <button onClick={replay}>Replay</button>}
    </>
  );

  return (
    <div className={`shell ${active ? "immersive" : ""}`}>
      <header className="topbar">
        <h1>Localghost</h1>
        <div className="dial">
          <span>Scare</span>
          <input type="range" min={1} max={5} value={level} disabled={busy} onChange={(e) => setLevel(Number(e.target.value))} />
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
          draft={draft}
          error={error != null ? <ErrorView error={error} /> : null}
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
              <SettingsPanel
                llm={llm}
                onLlm={(v) => {
                  setLlm(v);
                  saveLLMSettings(v);
                }}
                voices={voices}
                voice={voice}
                onVoice={setVoice}
                device={device}
                locked={busy || active}
                onLoadVoiceModel={loadModel}
                reduceFlashing={reduceFlashing}
                onReduceFlashing={(on) => {
                  setReduceFlashing(on);
                  writeFlag("reduceFlashing", on);
                }}
              />
            )}
            {tab === "memories" && <div className="hint">Coming in M4.</div>}
            {tab === "debug" && <DebugPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
