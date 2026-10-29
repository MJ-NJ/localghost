# Architecture Decision Records

Running log of decisions, especially ones that could produce **wrong output** (bad audio, mis-parsed stories), with the trade-off and how to debug/revert. Newest at the bottom. Status: `Accepted`, `Provisional` (unverified, needs a human check), `Superseded`.

Template:

```
## ADR-NNN Title  (Status, date, milestone)
Context / Decision / Trade-off / Debug & revert
```

---

## ADR-001 Package lives in `web/`, not repo root (Accepted, 2026-10-28, M0)
- **Decision:** `package.json` is in `web/`; run all npm commands from there.
- **Trade-off:** Matches the Render static-site config (root `web`), but `npm run dev` from the repo root does not work.
- **Revert:** add a root `package.json` with scripts that `--prefix web`.

## ADR-002 Own IndexedDB wrapper instead of `idb-keyval` (Accepted, M0)
- **Decision:** `lib/idb.ts` (~40 lines) rather than a dependency. CLAUDE.md allows either.
- **Trade-off:** No dependency; we own edge cases (private-mode failures, upgrades). Callers must handle rejected promises.

## ADR-003 Cue parser leniency rules (Accepted, user-approved, M1)
All of these change what is spoken, so they are listed explicitly (code: `cue/parser.ts`, constants: `cue/spec.ts`).
| Case | Behaviour | Why / risk |
|---|---|---|
| `[pause]` / `[pause abc]` | default **1 s**, warn, counted in `stats.defaulted` | Model that forgets the number still gets a beat. Risk: invents a pause. |
| `[light blackout]` without N | default **2 s** | same |
| `[pause N]` range | clamped **0.2–6 s** (plan) | |
| `[light blackout N]` range | clamped **0.2–6 s** (**our choice**; plan is silent) | Reuses pause clamp. Revisit if long blackouts are wanted. |
| `(pause 2)` where first word is a tag name | stripped, not converted to a pause | Plan says drop. Intent of the model is lost. |
| `*anything up to 40 chars*` | stripped | Also removes legitimate `*emphasis*` words. |
| Ordinary `(parentheses)` | spoken | Only tag-word parentheses are junk. |
| Unterminated `[tag` | rest of line from `[` dropped | Avoids Kokoro reading "bracket pause two". |
| Unknown tag / unknown sfx / light / ambient / `[photo reveal]` with no id | dropped, warned, `stats.unknownTags++` | |
| Two style tags (`[slow] [whisper]`) | **last style wins** from that point to end of line; no stacking | Predictable; stacked effects (slow+whisper) are impossible. |
| Style scope | resets at every newline | per plan |
| Punctuation-only speech (`...`) | dropped | Kokoro can emit noise/garbage for empty phoneme input. |
- **Debug:** each drop logs `cue: dropped ...` to console; counts appear in DebugPanel.

## ADR-004 Naive sentence splitter (Accepted, M1)
- **Decision:** regex split on `. ! ? …`; no abbreviation handling.
- **Trade-off:** "Mr. Hale" becomes two segments with a seam in prosody. Fine for prose written for the ear. Over-long sentences are hard-split at `, ` / `; ` / space to respect `maxChars`.
- **Kokoro:** `targetChars: 0` (one sentence per segment) as per plan; ElevenLabs will use ≤350.

## ADR-005 Kokoro device/dtype: WebGPU→fp32, WASM→q8 (Provisional, M1)
- **Context:** Plan says "q8 weights". kokoro-js README recommends fp32 when using WebGPU.
- **Decision:** try WebGPU+fp32, fall back to WASM+q8 on load failure. User can force a device in Settings (persisted in `localStorage.kokoroDevice`).
- **Known problem (2026-10-29):** on the dev laptop, WebGPU/fp32 playback is only sparking/crackling noise for **every** voice. A Node CPU+q8 run of the same pipeline produced clean speech statistics (no NaN, RMS 0.086, peak 0.47, zero-crossing rate 0.167), so the model, voice files and our `RawAudio → AudioBuffer` handling are fine; the suspect is WebGPU numerical output (driver / onnxruntime-web dev build `1.22.0-dev.20250409`, AMD iGPU).
- **Diagnostics added:** per-segment stats (peak, rms, zcr, NaN count) in DebugPanel. Reading: speech ≈ zcr 0.02–0.2; white-noise/garbage ≈ zcr ~0.5, or NaN > 0, or peak pinned at 1.0.
- **Next:** if WASM is clean, make WASM the default on this class of device (or default to WASM everywhere and make WebGPU opt-in). Not decided until the user confirms.

## ADR-006 Provisional default voice `bm_george` (Provisional, M1)
- **Context:** kokoro-js exposes only name/language/gender/quality grade, no pitch or "calm" metadata.
- **Decision:** chose a male en-GB voice with a mid grade (C) by metadata alone, never by ear. Higher-graded voices exist (e.g. `af_heart`, grade A) but are not "low".
- **Debug/revert:** change `DEFAULT_KOKORO_VOICE` in `adapters/tts/kokoroWeb.ts`. Candidates: `bm_fable`, `am_michael`, `am_fenrir`, `af_heart`.

## ADR-007 `slow` = Kokoro speed 0.8; other styles not emulated yet (Accepted, M1)
- whisper / trembling / shout are emulated in the audio graph in M2/M5. Until then they are spoken as normal.

## ADR-008 M1 playback is prerender-then-play, no pause/resume (Accepted, M1)
- **Decision:** `engine/player.ts` synthesizes everything, then schedules buffers back-to-back; pauses are silence; non-speech events ignored.
- **Consequence:** Stop cancels; pressing Play again **re-synthesizes and restarts from the beginning** (no resume, no cache). Not a bug: Pause/Resume (`ctx.suspend`) and Replay without re-synthesis are M2; the audio cache is M5.
- **Superseded by:** M2 timeline/player.

## ADR-009 Audio created via `new AudioBuffer()` from worker Float32Array (Accepted, M1)
- Worker transfers the `Float32Array` buffer (zero-copy). Adapter builds a mono `AudioBuffer` at the sample rate reported by the library (24000 Hz). Verified field names (`audio`, `sampling_rate`) against `@huggingface/transformers@3.8.1`.
