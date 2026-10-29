# Localghost — context for Claude Code

> Working name. Rename freely (repo, package.json, `<title>`, README).

## What this is

A local-first horror storyteller in the browser. You pick how scared you want to be (1–5), optionally add photos of your own room/house plus a few notes, and an open-weight model (Gemma 4) writes a ghost story **set in your actual space**. The story is performed aloud with pauses, whispers, ambient drone, sound effects, flickering "lights" and, at the climax, your own photo fading back in, distorted.

It is BYO model / BYO key. Clone → `npm i` → point at Ollama → it runs fully offline. ElevenLabs is an optional premium voice adapter, not a requirement.

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 4 ("Ghost in the Machine").
**Deadline: 2026-10-31 23:59 PDT = Sat 2026-11-01 12:29 IST.** Feature freeze: Fri 2026-10-31 20:00 IST.

## Non-negotiable principles

1. **Open at the core.** The LLM is any OpenAI-compatible endpoint (default: Ollama + Gemma 4). Default voice is Kokoro running in the browser. Closed services are optional adapters only.
2. **No backend.** Static site. Everything runs client-side.
3. **Privacy is a feature.** Photos are only ever sent to the configured LLM endpoint. API keys live in `localStorage` and are only sent to the provider they belong to. Nothing goes to any server we run (we run none).
4. **V0 first.** Get the end-to-end path working ugly, then improve. Never polish a stage before the next stage exists.
5. **Small dependency surface.** Ask before adding a dependency not listed below.

## Stack (decided — don't re-litigate)

- Vite + React + TypeScript (`strict: true`)
- Plain CSS with CSS custom properties (no UI kit, no Tailwind)
- `kokoro-js` for in-browser TTS, loaded in a **Web Worker**
- `idb-keyval` (or a ~30-line IndexedDB wrapper) for photos, inventories and the audio cache
- `vitest` for unit tests
- No state library; React state + a couple of context providers is enough
- WebAudio API for all audio; procedural ambient/SFX first, CC0 files only if procedural sounds bad

## Layout

```
web/
  src/
    app/            React UI: SettingsPanel, ScareDial, MemoriesPanel, Stage, DebugPanel, DataFlowBadge
    cue/            spec.ts (single source of truth for tags), parser.ts, segmenter.ts, parser.test.ts
    director/       profiles.ts (scare levels), prompts.ts (vision + director), director.ts
    adapters/
      llm/          types.ts, openaiCompat.ts, presets.ts
      tts/          types.ts, kokoroWeb.ts (+ kokoro.worker.ts), elevenlabs.ts, router.ts, styleMap.ts
    engine/         audioGraph.ts, ambient.ts, sfx.ts, timeline.ts, player.ts, effects.ts, photoReveal.ts
    memories/       store.ts, imagePrep.ts (downscale), vision.ts
    lib/            idb.ts, cache.ts (audio cache), timing.ts, sse.ts
  public/sample/    sample.cue.txt, sample_room.jpg
README.md
PLAN.md             milestones, specs, prompts — follow it
```

## Commands

- `npm run dev` — dev server (http://localhost:5173)
- `npm run build` — production build to `web/dist`
- `npm test` — vitest
- `npm run typecheck`

## Conventions

- `engine/`, `cue/`, `adapters/`, `director/` are **framework-free TypeScript**. React only lives in `app/`.
- Every tag's meaning lives in `cue/spec.ts`. Parser, router, prompts and effects import from there. Never hardcode a tag string elsewhere.
- Adapters implement the interfaces in `adapters/*/types.ts`. UI never talks to a provider directly.
- Unknown/malformed cue tags are dropped and logged, never thrown. A bad model output must still play.
- Record timings (vision ms, time-to-first-token, generation ms, tokens/s, per-segment TTS ms, total prerender) via `lib/timing.ts` and show them in the DebugPanel. These numbers go into the write-up.
- Commit after each completed task with a clear message. Agent sessions are being captured (Entire), so commits are the checkpoints.
- After each milestone: run `npm test` and `npm run typecheck`, summarize what changed and what I should manually test, then **stop and wait**.

## Known gotchas

- Ollama from a browser needs CORS: `OLLAMA_ORIGINS` must include the page origin (e.g. `http://localhost:5173,https://<domain>.tech`). Ollama must be restarted after setting it. Surface a helpful error when a fetch to localhost fails.
- A hosted HTTPS page calling `http://localhost` may trigger the browser's local-network permission prompt or be blocked. The full offline experience is guaranteed via `npm run dev`; the hosted site must still work via Sample mode and remote endpoints.
- Downscale photos client-side (longest side ≤ 768px, JPEG ~0.8) before sending to the model. The dev laptop is CPU/iGPU only (Ryzen 7730U, 16 GB) — vision on full-size photos will be painfully slow.
- `kokoro-js`: try WebGPU, fall back to WASM. Run it in a worker. First load downloads the model; show progress.
- ElevenLabs `eleven_v3` has higher latency and a 5,000-character per-request limit. Always prerender; never stream it live. Cache everything.
- Small models break strict formats. The cue parser must be lenient; the director retries once if the output has no speech or no tags.
- Flashing effects: show a photosensitivity notice before first play and provide a "Reduce flashing" toggle that replaces flicker/blackout with slow dims.