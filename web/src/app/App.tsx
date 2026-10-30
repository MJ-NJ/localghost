import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CueParser } from "../cue/parser";
import type { CueEvent, Style } from "../cue/spec";
import { OpenAICompatAdapter, hostOf } from "../adapters/llm/openaiCompat";
import { detectVision, type VisionSupport } from "../adapters/llm/capabilities";
import { direct, countSpeechWords } from "../director/director";
import { lengthFactor, scaledWords, type LengthMode } from "../director/length";
import { profileFor } from "../director/profiles";
import { DEFAULT_KOKORO_VOICE, KokoroWebAdapter, type KokoroProgress } from "../adapters/tts/kokoroWeb";
import type { TTSAdapter, VoiceInfo } from "../adapters/tts/types";
import { ElevenLabsAdapter } from "../adapters/tts/elevenlabs";
import { routeForAdapter } from "../adapters/tts/router";
import { audioCacheSize, clearAudioCache } from "../lib/cache";
import { Effects } from "../engine/effects";
import { PhotoReveal } from "../engine/photoReveal";
import { analysePhotos } from "../memories/vision";
import {
  addPhoto,
  getInventory,
  getNotes,
  listPhotos,
  photoDataUrl,
  removePhoto,
  setInventory,
  setNotes,
  type PhotoId,
  type StoredPhoto,
} from "../memories/store";
import { Player, type PlayerState } from "../engine/player";
import { StorySession, synthesizeInto } from "../engine/session";
import { timing } from "../lib/timing";
import { DebugPanel } from "./DebugPanel";
import { ErrorView } from "./ErrorView";
import { MemoriesPanel } from "./MemoriesPanel";
import { SettingsPanel } from "./SettingsPanel";
import { DataFlowBadge } from "./DataFlowBadge";
import { dataFlow } from "./dataFlow";
import {
  loadElevenSettings,
  loadLLMSettings,
  loadProvider,
  saveElevenSettings,
  saveLLMSettings,
  saveProvider,
  type ElevenSettings,
  type LLMSettings,
  type TtsProvider,
} from "./settings";
import { Stage } from "./Stage";

type DrawerTab = "settings" | "memories" | "debug";
type Phase = "idle" | "loading" | "looking" | "writing" | "summoning";
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

const MAX_WORKERS = 3;

function readNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  } catch {
    return fallback;
  }
}

function readLengthMode(): LengthMode {
  try {
    const v = localStorage.getItem("storyLength");
    return v === "short" || v === "full" ? v : "auto";
  } catch {
    return "auto";
  }
}

const readBench = (workers: number): number | null => {
  try {
    const b = JSON.parse(localStorage.getItem("kokoroBench") ?? "null") as { workers: number; rtf: number } | null;
    return b && b.workers === workers && Number.isFinite(b.rtf) ? b.rtf : null;
  } catch {
    return null;
  }
};

const saveBench = (workers: number, rtf: number) => {
  try {
    localStorage.setItem("kokoroBench", JSON.stringify({ workers, rtf }));
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
  const [workers, setWorkers] = useState(() => readNumber("kokoroWorkers", 1, 1, MAX_WORKERS));
  const [lengthMode, setLengthMode] = useState<LengthMode>(() => readLengthMode());
  const [bench, setBench] = useState<number | null>(null); // measured synthesis seconds per audio second
  const [benching, setBenching] = useState(false);
  const [visionSupport, setVisionSupport] = useState<VisionSupport | undefined>(undefined);
  const [checkingVision, setCheckingVision] = useState(false);
  const [reduceFlashing, setReduceFlashing] = useState(() => readFlag("reduceFlashing"));
  const [hasStory, setHasStory] = useState(false);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [notes, setNotesState] = useState("");
  const [memError, setMemError] = useState("");
  const [vision, setVision] = useState<[number, number] | null>(null);
  const [notice, setNotice] = useState("");
  const [provider, setProvider] = useState<TtsProvider>(loadProvider);
  const [eleven, setEleven] = useState<ElevenSettings>(loadElevenSettings);
  const [elevenVoices, setElevenVoices] = useState<VoiceInfo[]>([]);
  const [loadingElevenVoices, setLoadingElevenVoices] = useState(false);
  const [cacheSize, setCacheSize] = useState(0);

  const fxBlack = useRef<HTMLDivElement>(null);
  const fxRed = useRef<HTMLDivElement>(null);
  const fxVignette = useRef<HTMLDivElement>(null);
  const revealCanvas = useRef<HTMLCanvasElement>(null);
  const reveal = useRef<PhotoReveal | null>(null);
  const revealImages = useRef(new Map<string, ImageBitmap>());
  const notesTimer = useRef<number | undefined>(undefined);
  const effects = useRef<Effects | null>(null);
  const reduceRef = useRef(reduceFlashing);
  reduceRef.current = reduceFlashing;

  const abort = useRef<AbortController | null>(null);
  const player = useRef<Player | null>(null);
  const prepared = useRef<StorySession | null>(null);
  const [waitingVoice, setWaitingVoice] = useState(false);
  const preparedKey = useRef<string | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const lineN = useRef(0);
  const lastEvents = useRef<CueEvent[] | null>(null); // the last story as parsed, so another voice can re-render it
  const lastSource = useRef<Source>("story");
  const adapter = useMemo(() => new KokoroWebAdapter(setProgress, workers), [workers]);
  useEffect(() => {
    setBench(readBench(workers));
    return () => adapter.dispose();
  }, [adapter, workers]);

  const elevenAdapter = useMemo(
    () => new ElevenLabsAdapter({ apiKey: eleven.apiKey, modelId: eleven.modelId }),
    [eleven.apiKey, eleven.modelId],
  );
  /** Adapter, voice and concurrency for a provider. */
  const voiceSetup = (p: TtsProvider) =>
    p === "elevenlabs"
      ? { tts: elevenAdapter as TTSAdapter, voice: eleven.voiceId, concurrency: elevenAdapter.caps.concurrency, tag: eleven.modelId }
      : { tts: adapter as TTSAdapter, voice, concurrency: adapter.workerCount, tag: "" };
  /** Try it now always uses the offline voice, so it works with no key and no setup. */
  const providerFor = (source: Source): TtsProvider => (source === "sample" ? "kokoro-web" : provider);
  /** Identifies what a rendered session sounds like: same key means it can be replayed as is. */
  const renderKey = (source: Source, p: TtsProvider) => `${source}|${p}|${voiceSetup(p).voice}|${voiceSetup(p).tag}`;

  const refreshCacheSize = useCallback(() => void audioCacheSize().then(setCacheSize).catch(() => {}), []);
  useEffect(refreshCacheSize, [refreshCacheSize]);

  async function loadElevenVoices() {
    setError(null);
    setLoadingElevenVoices(true);
    try {
      const list = await elevenAdapter.listVoices();
      setElevenVoices(list);
      if (list.length && !list.some((v) => v.id === eleven.voiceId)) updateEleven({ ...eleven, voiceId: list[0].id });
    } catch (e) {
      setError(e);
    }
    setLoadingElevenVoices(false);
  }

  function updateEleven(v: ElevenSettings) {
    setEleven(v);
    saveElevenSettings(v);
  }

  function changeProvider(p: TtsProvider) {
    setProvider(p);
    saveProvider(p);
  }

  function assertVoiceReady(p: TtsProvider) {
    if (p === "elevenlabs" && (!eleven.apiKey || !eleven.voiceId)) {
      throw new Error("Enter your ElevenLabs API key and choose a voice in Settings first, or switch the voice back to Kokoro.");
    }
  }

  useEffect(() => {
    if (fxBlack.current && fxRed.current && fxVignette.current) {
      effects.current = new Effects(
        { black: fxBlack.current, red: fxRed.current, vignette: fxVignette.current },
        () => reduceRef.current,
      );
    }
    if (revealCanvas.current) reveal.current = new PhotoReveal(revealCanvas.current, () => reduceRef.current);
  }, []);

  useEffect(() => {
    void listPhotos().then(setPhotos).catch(() => {});
    void getNotes().then(setNotesState).catch(() => {});
  }, []);

  async function addFiles(files: File[]) {
    setMemError("");
    for (const f of files) {
      try {
        await addPhoto(f);
      } catch (e) {
        setMemError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setPhotos(await listPhotos());
  }

  async function dropPhoto(id: PhotoId) {
    await removePhoto(id);
    setPhotos(await listPhotos());
  }

  function changeNotes(v: string) {
    setNotesState(v);
    window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => void setNotes(v).catch(() => {}), 400);
  }

  useEffect(() => setVisionSupport(undefined), [llm.baseUrl, llm.model]);

  async function checkVision(): Promise<VisionSupport> {
    setCheckingVision(true);
    const r = await detectVision(llm);
    setVisionSupport(r);
    setCheckingVision(false);
    return r;
  }

  const getPlayer = () => (player.current ??= new Player(new AudioContext()));

  const run = useCallback(async (p: StorySession) => {
    effects.current?.clear();
    await getPlayer().start(p, {
      onLine: (text, style) => setLine({ text, style, n: ++lineN.current }),
      onVisual: (ev, at) => {
        if (ev.kind === "light") effects.current?.trigger(ev.mode, ev.seconds, at);
        else {
          const img = revealImages.current.get(ev.id);
          if (img) reveal.current?.show(img, at); // an unknown id (no such photo) is ignored
        }
      },
      onFrame: (t) => {
        effects.current?.update(t);
        reveal.current?.update(t);
      },
      onWaiting: setWaitingVoice,
      onEnd: () => {
        effects.current?.clear();
        reveal.current?.clear();
        setWaitingVoice(false);
        setPlayerState("idle");
      },
    });
    setPlayerState("playing");
  }, []);

  async function ensureModel() {
    await adapter.load();
    setVoices(adapter.voices);
    if (adapter.status) setDevice(`${adapter.status.device}/${adapter.status.dtype}, ${adapter.status.isolated ? "multi-threaded" : "single-threaded (not cross-origin isolated)"}, ${adapter.status.workers} worker${adapter.status.workers > 1 ? "s" : ""}`);
  }

  async function runBenchmark(): Promise<number> {
    await ensureModel();
    const r = await adapter.benchmark(voice);
    saveBench(workers, r.rtf);
    setBench(r.rtf);
    return r.rtf;
  }

  async function speedTest() {
    setError(null);
    setBenching(true);
    try {
      await runBenchmark();
    } catch (e) {
      setError(e);
    }
    setBenching(false);
  }

  const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

  const fail = (e: unknown) => {
    if (!isAbort(e)) setError(e);
    setPhase("idle");
    setPrerender(null);
    setDraft("");
  };

  /** Try it now: the demo photo for `[photo reveal sample]`. Missing file = no reveal (the story still plays). */
  async function loadSampleReveal() {
    revealImages.current.forEach((b) => b.close());
    revealImages.current.clear();
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/sample_room.jpg`);
      // a dev server answers a missing file with index.html, so check that it really is an image
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) {
        revealImages.current.set("sample", await createImageBitmap(await res.blob()));
      }
    } catch {
      /* no sample photo: skip the reveal */
    }
  }

  /** Route a parsed story to the voice for `p`, synthesize in the background, and start playing as soon as it is safe. */
  async function render(events: CueEvent[], source: Source, ac: AbortController, p: TtsProvider) {
    lastEvents.current = events;
    lastSource.current = source;
    const v = voiceSetup(p);
    const key = renderKey(source, p);
    const segments = routeForAdapter(events, v.tts);

    setPhase("summoning");
    setDraft("");
    const synthStart = performance.now();
    const session = new StorySession(segments, v.tts.caps.styles);
    // Synthesis continues in the background while the story plays (streaming playback).
    const synth = synthesizeInto(session, {
      adapter: v.tts,
      voice: v.voice,
      signal: ac.signal,
      concurrency: v.concurrency,
      onProgress: (d, t) => setPrerender([d, t, performance.now() - synthStart]),
    });
    synth.then(
      () => {
        prepared.current = session; // complete: Replay / Try it now can reuse it
        preparedKey.current = key;
        setHasStory(true);
        refreshCacheSize();
      },
      (e) => {
        if (isAbort(e)) return;
        setError(e);
        player.current?.stop(); // synthesis died mid-story
      },
    );
    await session.ready();
    timing.record("time to start speaking", performance.now() - synthStart);
    setPhase("idle");
    setPrerender(null);
    await run(session);
  }

  /** Render the last story again, for example after switching voice. */
  async function rerender(events: CueEvent[]) {
    setError(null);
    setLine(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      getPlayer();
      assertVoiceReady(provider);
      if (lastSource.current === "sample") await loadSampleReveal();
      if (provider === "kokoro-web") {
        setPhase("loading");
        await ensureModel();
      }
      await render(events, lastSource.current, ac, provider);
    } catch (e) {
      fail(e);
    }
  }

  async function begin(source: Source) {
    setError(null);
    setLine(null);
    setDraft("");
    const ac = new AbortController();
    abort.current = ac;
    // Try it now always uses the offline voice, so it works with no key and no setup.
    const p = providerFor(source);
    const cloud = p === "elevenlabs";
    try {
      getPlayer(); // create the AudioContext inside the user gesture
      assertVoiceReady(p); // fail before spending minutes on the story model
      if (source === "sample") {
        if (provider !== p) changeProvider(p); // keep the Voice selector honest
        await loadSampleReveal();
        if (prepared.current && preparedKey.current === renderKey("sample", p)) {
          await run(prepared.current); // same script + voice: reuse the synthesis
          return;
        }
      }

      let events: CueEvent[];
      if (source === "sample") {
        setPhase("loading");
        await ensureModel();
        const res = await fetch(`${import.meta.env.BASE_URL}sample/sample.cue.txt`);
        if (!res.ok) throw new Error(`Could not load the demo story (${res.status})`);
        const parsed = CueParser.parse(await res.text());
        if (parsed.stats.unknownTags) timing.count("unknown tags dropped", parsed.stats.unknownTags);
        events = parsed.events;
      } else {
        setNotice("");
        const llmAdapter = new OpenAICompatAdapter(llm);
        const voiceLoad = cloud ? Promise.resolve() : ensureModel(); // load Kokoro while the model works
        voiceLoad.catch(() => {}); // surfaced below if it is still failing when we need it

        // Auto length needs Kokoro's speed on this machine; time it once (then it is remembered).
        // A cloud voice is fast, so it gets the full length.
        let rtf = cloud ? undefined : (bench ?? undefined);
        if (!cloud && lengthMode === "auto" && rtf === undefined) {
          setPhase("loading");
          rtf = await runBenchmark();
        }
        const factor = lengthFactor(lengthMode, profileFor(level), rtf);
        const [minW, maxW] = scaledWords(profileFor(level), factor);
        timing.note(`story length: ${lengthMode}, x${factor.toFixed(2)} of the plan's range = ${minW}-${maxW} words`);

        // Vision pass: one call per photo, cached by photo hash, so unchanged photos cost nothing.
        let inventory: string | undefined;
        let bestPhotoId: PhotoId | undefined;
        revealImages.current.forEach((b) => b.close());
        revealImages.current.clear();
        let useVision = photos.length > 0;
        if (useVision && llm.images === "off") {
          useVision = false;
          setNotice("Photos are turned off in Settings, so the story uses your notes only.");
        } else if (useVision && llm.images === "auto") {
          // unknown (null) still tries: the server's own refusal is caught below
          if ((await checkVision()) === false) {
            useVision = false;
            const msg = "The selected model reports no image support, so the story uses your notes only.";
            setNotice(msg);
            timing.note(msg);
          }
        }
        if (useVision) {
          setPhase("looking");
          const v = await analysePhotos(
            llmAdapter,
            await Promise.all(photos.map(async (ph) => ({ id: ph.id, hash: ph.hash, dataUrl: await photoDataUrl(ph) }))),
            {
              cache: { get: getInventory, set: setInventory },
              signal: ac.signal,
              onProgress: (d, t) => setVision([d, t]),
            },
          );
          setVision(null);
          if (v.unsupported) {
            const msg = `This model could not read your photos, so the story uses your notes only. Server said: ${(v.detail ?? "").slice(0, 200)}`;
            setNotice(msg);
            timing.note(msg);
          } else if (Object.keys(v.inventories).length) {
            inventory = JSON.stringify(v.inventories);
            bestPhotoId = v.bestId;
            const best = photos.find((ph) => ph.id === bestPhotoId);
            if (best) revealImages.current.set(best.id, await createImageBitmap(best.blob));
          }
        }

        setPhase("writing");
        const result = await direct({
          adapter: llmAdapter,
          level,
          inventory,
          notes,
          bestPhotoId,
          lengthFactor: factor,
          signal: ac.signal,
          onText: (d) => setDraft((t) => t + d),
        });
        if (countSpeechWords(result.events) === 0) {
          throw new Error("The model returned no spoken text. Try again, or try a different model.");
        }
        events = result.events;
        if (!cloud) {
          setPhase("loading");
          await voiceLoad;
        }
      }

      await render(events, source, ac, p);
    } catch (e) {
      fail(e);
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
    const events = lastEvents.current;
    if (!events) return;
    if (prepared.current && preparedKey.current === renderKey(lastSource.current, provider)) {
      setLine(null);
      void run(prepared.current);
    } else {
      void rerender(events); // the voice changed since this story was rendered
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
  const flow = dataFlow({
    llmBaseUrl: llm.baseUrl,
    tts: provider,
    photosMaySend: llm.images !== "off",
    photoCount: photos.length,
    hasNotes: notes.trim().length > 0,
  });

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
    phase === "looking" ? (
      <>Studying your place{vision ? ` — photo ${Math.min(vision[0] + 1, vision[1])} of ${vision[1]}` : "…"}</>
    ) : phase === "writing" ? (
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
      "A ghost story, told aloud, in your own place. Try the demo, or connect a local model to write one of your own."
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
      <button className="primary" onClick={() => request("sample")}>
        Try it now — no setup
      </button>{" "}
      <button onClick={() => request("story")}>Tell me a story</button>{" "}
      {hasStory && <button onClick={replay}>Replay</button>}
      <div className="voice-toggle">
        <label>
          Voice{" "}
          <select value={provider} onChange={(e) => changeProvider(e.target.value as TtsProvider)}>
            <option value="kokoro-web">Kokoro (offline)</option>
            <option value="elevenlabs">ElevenLabs</option>
          </select>
        </label>
      </div>
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
        <DataFlowBadge flow={flow} />
      </header>
      <div className="body">
        <Stage
          fxBlack={fxBlack}
          fxRed={fxRed}
          fxVignette={fxVignette}
          line={line}
          hint={hint}
          draft={draft}
          notice={notice}
          revealCanvas={revealCanvas}
          error={error != null ? <ErrorView error={error} /> : null}
          controls={controls}
          playerState={playerState}
        />
        {active && waitingVoice && <div className="waiting">the voice is gathering itself…</div>}
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
                provider={provider}
                onProvider={changeProvider}
                eleven={eleven}
                onEleven={updateEleven}
                elevenVoices={elevenVoices}
                loadingElevenVoices={loadingElevenVoices}
                onLoadElevenVoices={() => void loadElevenVoices()}
                cacheSize={cacheSize}
                onClearCache={() => void clearAudioCache().then(refreshCacheSize)}
                visionSupport={visionSupport}
                checkingVision={checkingVision}
                onCheckVision={() => void checkVision()}
                workers={workers}
                maxWorkers={MAX_WORKERS}
                onWorkers={(n) => {
                  try {
                    localStorage.setItem("kokoroWorkers", String(n));
                  } catch {
                    /* storage unavailable */
                  }
                  setVoices([]);
                  setDevice("");
                  setWorkers(n);
                }}
                lengthMode={lengthMode}
                onLengthMode={(m) => {
                  try {
                    localStorage.setItem("storyLength", m);
                  } catch {
                    /* storage unavailable */
                  }
                  setLengthMode(m);
                }}
                bench={bench}
                benching={benching}
                onSpeedTest={() => void speedTest()}
                reduceFlashing={reduceFlashing}
                onReduceFlashing={(on) => {
                  setReduceFlashing(on);
                  writeFlag("reduceFlashing", on);
                }}
              />
            )}
            {tab === "memories" && (
              <MemoriesPanel
                photos={photos}
                notes={notes}
                host={hostOf(llm.baseUrl)}
                locked={busy || active}
                error={memError}
                onAdd={(f) => void addFiles(f)}
                onRemove={(id) => void dropPhoto(id)}
                onNotes={changeNotes}
              />
            )}
            {tab === "debug" && <DebugPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
