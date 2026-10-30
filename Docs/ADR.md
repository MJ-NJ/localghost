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

## ADR-006 Default Kokoro voice (Superseded 2026-10-30: now `af_heart`, chosen by the user by ear)
> The default is now `af_heart` ("Heart", en-US female, grade A). The original reasoning below is kept for history.

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

## ADR-026 Parallel Kokoro workers, behind a toggle (Provisional, unmeasured, user-requested)
- **What:** Settings has "Voice workers" 1-3 (default **1 = off**, the plan's concurrency). Each worker is a separate copy of the model in its own Web Worker. Segments are started in order and may finish out of order; the timeline builder only advances when the next segment it needs exists, so playback order is unchanged (tested).
- **Loading:** worker 1 loads first and downloads; the others then load in parallel from the browser cache. More workers mean a longer first load.
- **Memory:** after the voice loads, the Debug tab records page memory (`performance.measureUserAgentSpecificMemory`, Chromium only, works because the page is cross-origin isolated). Compare 1, 2 and 3 workers there. Not measured by me yet.
- **Start policy:** the throughput estimate is now wall-clock time per finished segment, so it is correct with several in flight.
- **Risk, thread oversubscription:** each worker lets onnxruntime-web use up to 4 threads (`min(4, cores/2)`). Two workers on 16 logical cores are fine; three can oversubscribe, and the gain may flatten or reverse. I did not set per-worker thread counts because that needs importing `@huggingface/transformers` directly (not a declared dependency). Judge by the speed test number, not by assumption.
- **Aborted clips:** a worker cannot cancel a clip in progress; it finishes it and then frees its slot, so Stop is instant for the UI but the worker is briefly busy.

## ADR-027 Auto story length from a voice speed test (Provisional, user-approved, deviates from the plan's word counts)
- **Why:** measured about 5-11 s of synthesis per sentence against 3-4 s of speech, so the plan's 350-800 words meant waits of many minutes.
- **Speed test:** one warm-up clip, then one fixed sentence per worker at the same time; result = wall-clock synthesis seconds per audio second with all workers busy ("rtf"). Cached in `localStorage.kokoroBench` per worker count; runs automatically the first time Auto is used, or from the Settings button. **One sentence is a small sample**: real stories differ, and CPU load from Ollama at the same time is not part of the test.
- **Formula (`director/length.ts`):** with streaming, the start wait is about `words x 0.43 s x (rtf - 1.5)`. Auto picks the words that keep this near **90 s**, then scales the level's range by that factor, floored at **x0.35**. At rtf <= 1.5 there is no limit (the plan's range). Constants (0.43 s/word, 1.5 playback multiplier, 90 s target, 0.35 floor) are estimates. Short = x0.5, Full = x1.
- **Consequence:** on a slow machine every level gets shorter and the five levels become less distinct in length. The scare differences come from the other profile fields (jumps, effects budget, ending, ceiling).
- Scaling affects only the prompt's "Length:" line; the model may still overshoot. The effects budget is not scaled.

## ADR-028 Story shape, minimum lights and premise seeds (Provisional, user-approved, additions to the plan's prompt)
- **Problem seen:** stories ended oddly and used few or no lights.
- **Added to the director prompt:** a STORY SHAPE block (calm opening, three escalating wrong things, unmistakable climax, an ending that follows the level and must close the story, never stop mid-scene) and a per-level **minimum number of `[light]` cues** (L1:1, L2:2, L3:2, L4:3, L5:4; `minLights` in `profiles.ts`). The minimum is a request; the model can still ignore it, and the parser does not enforce it.
- **Premise seeds:** one of 14 original one-line premises (`director/seeds.ts`) is picked at random per story and shown in the Debug tab. They are written in the spirit of common campfire tropes and are **not** taken from r/nosleep or any specific story. The prompt says the level's ending rule overrides the premise (so level 1 still resolves warmly). Cost: roughly 300 extra prompt tokens.
- **Risk:** a seed that fits a level badly (a threatening seed at level 1) can make the model fight the ending rule; the premise text is deliberately mild.

## ADR-029 The local `gemma-4-E4B` cannot see images (Accepted, 2026-10-30)
- Ollama returned `400: Multimodal data provided, but model does not support multimodal requests` for the vision call. The no-vision fallback behaved as designed. This is a property of this particular Ollama model (a GGUF import without its vision projector, most likely), not necessarily of the Gemma family. Fix by using a build that includes the projector (check `ollama show <tag>` for a vision capability) or a server that loads it explicitly (LM Studio, llama.cpp `-hf`).

## ADR-030 Photos are sent only to models that can read them (Accepted, user-requested; freezes the vision layer)
- **Setting:** "Read my photos with this model": **Auto** (default), **Yes**, **No**. Persisted in `llmSettings.images`.
- **Auto:** before the vision pass the app asks the server. Ollama: `POST /api/show` and look for `vision` in `capabilities`. llama.cpp: `GET /props` and `modalities.vision`. Other servers (LM Studio, custom) cannot be asked, so the result is "unknown".
- **Decision table:** detected *no* -> photos skipped, a notice says so, no request carrying an image is ever sent. Detected *yes* or *unknown* -> the vision pass runs; for *unknown*, the earlier safety net still applies (an HTTP error on an image request means "model can't see", ADR-023). "Yes" skips detection; "No" skips photos.
- **Settings:** a "Check model for image support" button shows the result; it resets when the model or URL changes.
- **Limits:** the server API is only reachable if CORS allows `/api/show` (same `OLLAMA_ORIGINS` as `/v1`); older Ollama versions do not list `capabilities` (result "unknown"). A model that accepts images but ignores them still cannot be detected.
- **Open question (not built):** in the notes-only path the photo reveal is also skipped (ADR-023). The reveal itself needs no vision, so it could still fire at the climax with the listener's own photo even when the model can't read it. Not changed without sign-off.

## ADR-031 ElevenLabs: browser calls, model and tags (Provisional, unverified with a real key, M5)
- **CORS (verified 2026-10-30):** a preflight to `api.elevenlabs.io` returns `access-control-allow-origin: *`, `allow-headers: *`, methods POST/GET/OPTIONS. Browser calls from localhost and from a hosted origin are allowed, so there is no proxy. A real request with a key has not been made yet.
- **Model:** default `eleven_v4` (newer than the plan's `eleven_v3`; documented as following audio tags more reliably, 10,000-character limit). `eleven_v3` (5,000) and `eleven_v4_turbo` are selectable. The segment target stays 350 characters and `maxChars` 5000 so either model works. The ElevenLabs models table gave conflicting hints about which models take audio tags, so **whether tags actually change the delivery must be checked by ear**.
- **Tag spellings (`adapters/tts/styleMap.ts`, one file to edit):** whisper `[whispers]`, slow `[slowly]`, trembling `[nervous]`, shout `[shouting]` (the plan said `[shouts]`), sigh `[sighs]`, gasp `[gasps]`, laugh `[laughs]`. `breath` has no tag and stays a procedural sound effect. Tags are free-form directions in ElevenLabs' docs, so a wrong spelling should degrade, not fail. `[nervous]` is the least certain.
- **Non-verbals:** for ElevenLabs a `[sigh]`, `[gasp]` or `[laugh]` directly before speech (across instant events like sfx/lights, but not across a pause) is folded into that segment as a leading tag instead of playing a noise sound. Otherwise it stays a procedural sound.
- **Concurrency 2, no streaming, always prerendered** (plan). Errors (401 key, 402/quota, 429, 404/422 voice or model) are translated into plain messages.
- **Credits:** each new segment costs characters. Identical segments (same model, voice, style, text) are served from the cache.

## ADR-032 Audio cache (Accepted, M5)
- Key: `sha256(provider | version-or-model | voice | style | nonverbal | [speed] | text)`. Kokoro stores trimmed PCM (Float32) and the key includes a `KOKORO_CACHE_VERSION` and the speed, so changing trim or pacing constants invalidates old audio instead of replaying stale clips. ElevenLabs stores the mp3 bytes it received and decodes on each use.
- A cached Kokoro segment is served **without loading the voice model**.
- The speed test deliberately bypasses the cache (it would otherwise time a database read).
- Storage failures (quota, private mode) just mean a miss. Hits and misses are counted in the Debug tab; Settings has "Clear audio cache".
- Size: PCM is about 176 KB per second of Kokoro speech, so a long story is tens of MB in IndexedDB. Not capped yet.

## ADR-033 Kokoro style emulation (Provisional, untuned, M5)
- Applied in the audio graph only to styles the adapter does not do natively (so a style is never applied twice): whisper = gain 0.6, high-pass 300 Hz, extra reverb send 0.5 and Kokoro speed x0.95; trembling = pitch wobble of 15 cents at 6 Hz; shout = gain 1.2 into a soft clipper. Values are the plan's, plus the reverb send and clipper curve (my choices). `slow` is Kokoro's own speed option (0.78).
- This is meant to help the "robotic" feel, but it adds expression only on lines the story tags; plain narration is unchanged.

## ADR-034 DataFlowBadge states (Accepted, M5; two cases added beyond the plan)
- Plan: green (local model + offline voice), yellow (local model + ElevenLabs), red (remote model + photos). Added: remote model **without** photos (or photos set to "No") is yellow ("Notes and prompts are sent to {host}"), and remote model + ElevenLabs without photos is yellow naming both.
- The red case triggers when photos exist and the image setting is not "No", even if Auto would end up skipping them (the conservative reading). The badge opens a table of what goes where, with items that leave the computer highlighted.

## ADR-035 Provider toggle and replay (Accepted, M5)
- A Voice selector sits next to the Stage controls and in Settings. Replay re-renders the same parsed story with the chosen voice when it differs from the one last rendered (shows "Summoning" again, but cached segments are free), and replays instantly otherwise.
- ElevenLabs needs a key and a voice before anything starts; this is checked before the story model is called so minutes are not wasted. With ElevenLabs, Auto story length uses the full length (no speed test).

## ADR-036 Draft default demo story (Draft, needs approval)
- `public/sample/sample.cue.txt` is a new hand-written draft (about 250 spoken words) that uses all four voice styles, several effects, and ends on `[photo reveal sample]`. It uses generic objects (kettle, grey coat, hallway light) because the real room photo is not known yet. The reveal does nothing until Sample mode wires `sample_room.jpg` (M6). PLAN.md says the user approves the final script.
