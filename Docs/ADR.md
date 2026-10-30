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

## ADR-005 Kokoro device/dtype: WebGPU fp32, WASM q8 (Superseded 2026-10-29)
> **Superseded:** WebGPU fp32 confirmed as the cause of the noise (WASM q8 is clean). The app is now WASM q8 only; see `Docs/IMPROVEMENTS.md`.
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

## ADR-010 Voice naturalness: pacing, silence trim, baseline speed (Provisional, M2)
User feedback after M1: voice "robotic", pauses "like a paragraph reading". Probable causes and what was changed (all ear-tuned guesses; not yet verified by listening):

| Change | Value | Where | Rationale / risk |
|---|---|---|---|
| Silence after every speech segment | **0.45 s** (`PACING.speechGap`) | `engine/timeline.ts` | M1 played sentences back-to-back with zero gap. Too long = halting, too short = rushed. |
| Trim Kokoro leading/trailing silence | threshold **0.004**, keep **40 ms** | `adapters/tts/kokoroWeb.ts` `trimSilence` | Kokoro pads clips unpredictably, so gaps varied. Risk: clipping a soft start/end of a whispered word. |
| Baseline speed | **0.92** (was 1.0); `slow` **0.78** (was 0.8) | `kokoroWeb.ts` | Slower narration. Risk: very low speeds can sound drawn-out or artifacty in Kokoro. |
| Room reverb on voice | wet **0.22**, IR 2.5 s decaying noise | `engine/audioGraph.ts` | Dry TTS sounds flat. Risk: muddy at high wet levels. |

- Still not addressed (inherent to Kokoro q8 + one-sentence segments): flat prosody across sentences. Options if still robotic: merge 2-3 sentences per segment (`targetChars`), try other voices, whisper/shout emulation (M5), or a higher-quality engine (ElevenLabs, M5).
- **Debug/tune:** all constants are in `PACING` and `kokoroWeb.ts`.

## ADR-011 Non-verbals occupy fixed timeline time and are procedural noise (Provisional, M2)
- `[breath] [sigh] [gasp] [laugh]` take 0.9 / 1.3 / 0.6 / 1.1 s and play band-passed-noise sounds (`engine/sfx.ts`). They are crude stand-ins (laugh especially); Kokoro has no native non-verbals. ElevenLabs will use native tags in M5.

## ADR-012 Heartbeat is three lub-dub cycles; `[light pulse]` is not yet synced to it (Provisional, M2)
- Plan says "two thumps"; one lub-dub is barely audible so three cycles (about 2.8 s) are played. `pulse` runs a fixed 1.2 s vignette cycle; syncing to heartbeat timing is deferred.

## ADR-013 Reduce-flashing behaviour (Provisional, M2)
- `flicker` -> single 2.5 s slow dim (max 0.45 opacity). `blackout N` -> dim (max 0.85, not black), 1.5 s fade in, N s hold, 1.5 s fade out. `red` is already slow (1.5 s ramps) and unchanged. `pulse` period 1.2 s (< 3 luminance changes/s) in both modes.
- Plan says "blackout -> 1.5 s fade"; I interpreted that as both fades and a dimmed (not fully black) hold. Revisit if too strong or weak.

## ADR-014 Timeline rules (Accepted, M2)
- Speech advances the cursor by buffer duration + gap; pause by N; non-verbal by fixed time; sfx/light/photo/ambient are stamped at the cursor and take **no time**, so `[sfx knock]` directly before a line overlaps that line (intended). Story end = last event + 0.6 s tail, extended to cover an `[ambient stop]` 3 s fade.
- Ducking: ambient bus to 0.5 gain (~-6 dB) during speech, merged across gaps < 1 s so the bed doesn't pump between sentences. Ramps 0.25 s in, 0.6 s out.
- Pause uses `AudioContext.suspend()`; effects and transcript read the same clock, so they freeze with it. Hidden tabs throttle rAF, so visual events can fire late (audio is unaffected).

## ADR-015 Space key handling (Accepted, M2)
- Space toggles pause globally except inside input/select/textarea; `keyup` default is also prevented so a focused button isn't "clicked" as well.

## ADR-016 Immersive playback UI and sample reuse (Accepted, user-approved, M2)
- While a story plays or is paused the top bar and drawer are hidden. Pause/Stop become small corner icons that fade after 3 s of inactivity and return on mouse move or key press (also on hover/focus, so they stay keyboard-reachable). Space pauses, Esc stops. Rationale: centred bordered buttons broke the mood; Stop must still be reachable for accessibility/photosensitivity.
- **Play sample** reuses the existing synthesis when the voice is unchanged (in-memory, per page load); changing the voice re-synthesizes. This is a stopgap: the persistent audio cache is M5. Risk: if the sample script ever changes without a reload (it can't today), stale audio would play.

## ADR-017 Allowed [light] modes per scare level: cumulative ladder (Accepted, user-approved, M3)
- PLAN.md only names some modes per level. Mapping used (`director/profiles.ts`): L1 pulse, calm. L2 + flicker. L3 + blackout. L4 and L5 + red. L1's "only pulse/calm" restricts **lights only**; `[sfx]` is allowed within the budget.
- **Enforcement is by prompt only**: the tag list and the style example given to the model contain only the allowed light modes. The parser does not reject a disallowed mode if the model emits it anyway, so a small model can still play e.g. a flicker at L1. If that shows up in testing, add a post-parse filter in the director.
- **Deviation from the plan template:** the plan's prompt lists all light modes and its example uses `[light flicker]` and `[light blackout 3]`. At low levels that example would contradict the restriction (and small models copy examples), so the example swaps in `pulse`/`calm` where the level disallows them.

## ADR-018 Format-repair retry (Accepted, user-approved, M3)
- Trigger (from plan): fewer than 10 spoken words or zero non-speech tags. One retry only.
- The correction line is appended to the **user** message ("Begin.\n\nYour previous output broke the format. Output only the cue script."); the bad output is not echoed back.
- If the retry is also broken, we keep whichever attempt has more spoken words and play it (`degraded: true`). If there is no speech at all, the UI shows an error instead of playing.

## ADR-019 Generation parameters and metrics (Provisional, M3)
- Temperature 0.9 (plan). `max_tokens` 2048 (**our choice**, plan is silent): above the longest target (about 800 words, roughly 1,100 tokens, plus tags) but stops a runaway. If a long level-5 story gets cut mid-sentence, raise `MAX_TOKENS` in `director/director.ts`.
- **Tokens/s is approximate**: it counts SSE stream chunks, which is usually one token per chunk on Ollama but not guaranteed. Good enough for the write-up; don't quote it as exact.
- Time-to-first-token and generation time are recorded in the DebugPanel.

## ADR-020 LLM adapter assumptions (Accepted, M3)
- `caps.vision` is assumed `true`: it cannot be known without calling the model. The M4 vision pass must handle a model that rejects images.
- **Default model is empty on purpose** (plan: do not guess the Gemma 4 tag). The Story model field must be filled from `ollama list`; an empty value gives a clear error. `DEFAULT_MODEL` in `adapters/llm/presets.ts` should be set once the tag is confirmed.
- API key and LLM settings are stored in `localStorage` (plain text, as the plan says) and sent only to the configured base URL.
- Connection failure to a local host shows the `OLLAMA_ORIGINS` explanation with copyable commands. For a non-local host it shows a generic network/CORS message.
- The voice model loads **in parallel** with story generation to hide its load time.

## ADR-021 Cross-origin isolation for multi-threaded Kokoro (Provisional, M3 follow-up)
- **Finding (2026-10-30):** a level-1 story (~75 sentences) sat at 24/75 while "Summoning". The LLM had already finished (its text was on screen); the bottleneck is Kokoro synthesis. onnxruntime-web uses **1 WASM thread** unless the page is cross-origin isolated; isolated, it uses `min(4, ceil(cores/2))` (4 on the dev laptop). We were not sending the headers.
- **Decision:** Vite dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (`vite.config.ts`). `credentialless` rather than `require-corp` so Google Fonts and Hugging Face model downloads keep working without CORP headers.
- **Risks:** (1) unverified that the model download and Ollama calls still work under isolation (CORS requests should, but test); (2) `credentialless` is not supported in Safari, where it silently stays single-threaded; (3) **the hosted site needs the same two headers** (Render static site: add them under Headers in the dashboard or `render.yaml`) or the deployed version stays slow. Add to the M6 checklist.
- **Diagnostic:** Settings shows "multi-threaded" or "single-threaded (not cross-origin isolated)" next to the device. The prerender screen now shows an estimated time left.
- **Not yet done:** streaming playback (speak while still synthesizing, a [SHOULD] item) and merging sentences into larger segments. Both are options if this is still too slow.

## ADR-022 Streaming playback (Provisional, unverified by ear, [SHOULD] item pulled forward)
- **Why:** prerendering every sentence before the first word made a level-1 story (~75 segments) a multi-minute wait on WASM.
- **How:** `StorySession` (`engine/session.ts`) synthesizes segments one at a time in the background. `TimelineBuilder` places events on the timeline only as far as buffers exist. `Player` schedules audio incrementally as each segment arrives, and ducking is scheduled incrementally (`AudioGraph.duckForSpeech`).
- **Start policy (`shouldStart`):** begin when all segments are ready, or when at least 2 segments and 3 s of audio are buffered AND the buffer covers the expected shortfall `(avgSynthSec - playSecPerSegment) * remainingSegments * 1.15`. If synthesis is faster than playback (counting gaps and pauses) this is a short wait; if slower, it waits for the estimated shortfall up front. It is an **estimate from the segments done so far**, so a story whose later sentences are slower than earlier ones can still underrun.
- **Underrun:** if the playhead reaches a segment that is not ready, the AudioContext is suspended and the Stage shows "the voice is gathering itself…". It resumes automatically when 0.25 s of audio is available again. Audio, lights and transcript all freeze together because they share the clock. The cost is an audible hold; it should be rare when the start policy is right.
- **Pause during a wait** keeps the clock stopped on Resume until the voice has arrived (`Player.resume`).
- **Replay / Play sample reuse** apply only once synthesis has completed; stopping mid-synthesis aborts it and nothing is cached.
- **Ducking when merged:** when a new segment arrives after the release ramp has started, the planned release is cancelled and re-planned, which can nudge ambient gain by a small step (ambient is quiet, so likely inaudible).
- **Metrics:** `time to start speaking` and `prerender total` are in the Debug tab.

## ADR-023 Vision pass behaviour (Provisional, M4)
- **When:** at "Tell me a story" time, not on upload, so adding photos is instant. Photos are analysed one at a time (CPU-bound), before the story is written. The voice model loads in parallel, so the two compete for CPU while it does.
- **Cache:** inventories are keyed by the sha-256 of the downscaled JPEG, so the same pixels in a different slot are not re-analysed. **Only valid structured inventories are cached.** A free-form fallback is not, so a failed analysis is retried next time instead of being pinned.
- **Validation (`validateInventory`):** strict on the essentials (a `place` and at least one named object), lenient on the rest (missing arrays become empty, more than 12 objects are truncated). JSON is pulled from the first balanced `{...}` in the reply, so code fences and chatter are tolerated. Invalid output is retried once, then the raw text is kept as `{ "description": ... }` for that story only.
- **What the story model receives:** `{"room_1": <inventory>, "room_2": <inventory>}` as one JSON string in the LISTENER'S PLACE section. Photos with a free-form description appear as `{"description": "..."}`. Notes are sent whether or not there are photos.
- **Best photo for the reveal:** the photo with the most `unsettling_potential` items (free-form counts as 0); ties go to the lowest id. If photos exist but no inventory could be made, the reveal is **not** used, which follows the plan's "use notes only".
- **"Model can't see" detection (`unsupported`):** any HTTP error status from the model server on an image request is treated as "no vision". Risk: a transient 500 (for example out of memory on a large model) is reported as "could not read your photos". Connection failures are not treated this way. A model that accepts images but silently ignores them cannot be detected and will produce an invented inventory.
- **Privacy:** photos are downscaled (longest side 768 px) and re-encoded as JPEG 0.8 through a canvas, which drops EXIF. They are stored in IndexedDB only and sent only to the configured LLM endpoint as base64 data URLs.

## ADR-024 Photo reveal look (Provisional, not seen by eye, M4)
- Canvas layer over the Stage: cover-fit, scale drift 1.0 to 1.04, full desaturation (`saturation` blend), red tint at 0.28 alpha, per-frame grain at 0.22 alpha (96 px noise tile scaled up), darkened edges. Fade in 1.5 s, hold 4 s, fade out 2 s (7.5 s total, the plan's timings).
- Glitch: two 150 ms windows at 2.0 s and 4.6 s, each shifting 3 random horizontal strips vertically by 4-12 px. **Reduce flashing skips the glitch** only; the fades are already slow. The grain still changes each frame in both modes (it is low contrast, but it is per-frame noise, so revisit if it counts as flashing for you).
- Only the best photo is loaded for the reveal. A `[photo reveal ID]` for a photo that was not loaded is ignored.

## ADR-025 Parser leniency for model slips, guaranteed ending, new diagnostics (Accepted, after M4 testing)
- **Observed (2026-10-30, Gemma E4B):** the model wrote `[lights pulse]`, `[sfx scrapes]`, `[sfx cold breath]`, `[sfx stop]`, bare `[whispers]`. Dropped tags meant fewer lights and no drone fade-out.
- **Now accepted:** `lights` as `light`; plural/singular of a real sfx name (`scrapes`→`scrape`, `footstep`→`footsteps`, `knocks`→`knock`, `whisper`→`whispers`). Only these near-misses; `[sfx cold breath]`, `[sfx stop]` and a bare `[whispers]` are still dropped because their intent is ambiguous. Risk: a plural slip maps to a sound the model didn't mean; judged very low.
- **Guaranteed ending:** if a story starts an ambient bed but never stops it, the director appends a 2 s pause and `[ambient stop]` so the drone fades out instead of cutting off.
- **Diagnostics:** the adapter records `finish_reason`; if it is `length` the Debug tab says the story was cut off by the token limit (`max_tokens` 2048 or the server's context size, which Ollama defaults low). The Debug tab also lists per-story counts of words and tags. The no-vision notice now includes the server's own error text.
- **Known and not fixed:** story length vs. synthesis speed. Kokoro WASM measured about 5-11 s per sentence against about 3-4 s of speech, so streaming has to buffer most of a long story before starting. See the open decisions about length and parallel synthesis.
