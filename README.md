# Localghost 👻

**A ghost story, told aloud, set in your own place.** Pick how scared you want to be (1–5), optionally add photos of your room and a few notes, and an open-weight model writes a horror story around your real surroundings. It is performed in your browser with pauses, whispers, a drone, sound effects, flickering lights and, at the climax, your own photo fading back in, distorted.

Everything open runs on your machine: the story model (Gemma through Ollama), the voice (Kokoro, in the browser), the sound (procedural WebAudio). There is no backend. Nothing is sent to a server of ours, because we do not run one.

> **Live demo:** _TODO: add the deployed URL_ &nbsp;·&nbsp; **Screenshot / GIF:** _TODO: add after recording_

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 4 ("Ghost in the Machine").

---

## 1. Try it now (no setup)

Open the site and press **Try it now — no setup**. It plays a short bundled story through Kokoro, running entirely in your browser: no account, no key, no Ollama. The first run downloads the voice model (about 90 MB) and shows progress; after that it is cached.

Use headphones, a dark room, and read the [photosensitivity notice](#8-photosensitivity) first.

## 2. Run it fully offline (your own story, your own photos)

Requirements: Node 22.12 or newer, and [Ollama](https://ollama.com) (or any OpenAI-compatible server: LM Studio, llama.cpp). About 16 GB of RAM is comfortable for a small Gemma model plus the browser.

**1. Install a model that can read images** (so it can use your photos). Gemma 4's smaller sizes are listed on the [Ollama library page](https://ollama.com/library/gemma4); copy the exact tag from there and check that `ollama show <tag>` lists `vision` under capabilities:

```bash
ollama pull <the gemma4 tag you chose>
ollama show <the gemma4 tag you chose>
```

A model without `vision` still works: stories use your notes only, and Settings → "Read my photos with this model" will skip photos for it.

**2. Let the page talk to Ollama (CORS).** The browser can only call Ollama if the page's origin is allowed. Set `OLLAMA_ORIGINS` and **restart Ollama**:

| System | How |
|---|---|
| Windows | `setx OLLAMA_ORIGINS "http://localhost:5173"`, then quit Ollama from the tray and start it again |
| macOS | `launchctl setenv OLLAMA_ORIGINS "http://localhost:5173"`, then restart the Ollama app |
| Linux | `sudo systemctl edit ollama`, add `Environment="OLLAMA_ORIGINS=http://localhost:5173"`, then `sudo systemctl restart ollama` |

If you later host the page elsewhere, add that origin too (comma separated).

**3. Run the app:**

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

**4. In the app:** Settings → Story model → type the model tag (or press "Fetch models") → press **Tell me a story**. Add photos and notes in the **Memories** tab first if you want the story set in your place.

> **Hosted page vs. local Ollama.** A page served over HTTPS that calls `http://localhost` may trigger your browser's local-network permission prompt or be blocked. The guaranteed offline experience is `npm run dev`; the hosted site is designed to work through Try it now and through remote endpoints.

### Speed on a laptop without a GPU

In-browser Kokoro on WebAssembly is slower than the speech it makes on a CPU-only laptop. The app handles this three ways: it starts speaking while the rest is still being synthesized (streaming playback), it can run several voice workers in parallel (Settings → Voice workers), and **Story length: Auto** times the voice once and shortens stories to fit. Segments are cached on your device, so replays are instant. Full numbers: _TODO: add your measured speed-test and time-to-first-word results here_.

## 3. Optional: ElevenLabs voice

ElevenLabs is an optional premium voice. Kokoro is the default and needs nothing.

1. Create an API key in ElevenLabs. A **restricted** key is enough: enable **Text to Speech** and read access to **Voices**, and consider a credit quota.
2. Settings → Voice provider → ElevenLabs → paste the key → **Load my voices** → pick one.
3. For local development you can put the key in `web/.env.local` instead (copy `web/.env.local.example`). That file is git-ignored, and it is read **only** by `npm run dev`; it is never included in a production build.

What is sent: only the story text of each spoken line (plus style tags such as `[whispers]`), to `api.elevenlabs.io`. Your photos never go to ElevenLabs. Audio is cached per segment, so you do not pay twice for a line you have already heard.

## 4. Privacy

The badge in the top bar always tells you what is happening. Click it for the full table.

| Badge | Meaning |
|---|---|
| 🟢 **Fully local** | Local story model and the offline voice. Nothing leaves your computer. |
| 🟡 **Story text → ElevenLabs. Photos stay on this device.** | Local model, ElevenLabs voice. |
| 🟡 **Notes and prompts are sent to {host}** | A remote story model, no photos involved. |
| 🔴 **Photos are sent to {host}** | A remote story model and photos present. |

- Photos are downscaled (longest side 768 px) and re-encoded as JPEG in your browser, which strips EXIF data. They are stored in your browser's IndexedDB and sent only to the story model you configured, as base64.
- API keys are stored in your browser's `localStorage` and sent only to the service they belong to.
- Nothing is sent to any server run by this project. There is no analytics.

## 5. How it works

```
 notes + photos ─► vision pass ─► inventory (JSON, cached by photo hash)
                                       │
 scare level ─► profile ─► director prompt ─► story model (streams "cue script")
                                                     │
                                     incremental cue parser (lenient)
                                                     │
                                 router ─► segments ─► TTS adapter (Kokoro | ElevenLabs)
                                                     │           │
                                          audio cache (IndexedDB) ◄┘
                                                     │
                       timeline ─► WebAudio graph (voice, reverb, drone, SFX, ducking)
                                └► visual effects (lights, photo reveal), same clock
```

**The cue language.** The model does not write prose; it writes a *cue script*, one beat per line, with tags. Everything that isn't a tag is speech. Bad or unknown tags are dropped and counted, never thrown, so imperfect output from a small model still plays.

| Tag | Meaning |
|---|---|
| `[pause N]` | silence (0.2–6 s) |
| `[whisper]` `[slow]` `[trembling]` `[shout]` | style for the rest of that line |
| `[breath]` `[sigh]` `[gasp]` `[laugh]` | non-verbal |
| `[sfx creak\|knock\|footsteps\|door\|heartbeat\|static\|drip\|scrape\|whispers]` | one-shot sound |
| `[light flicker\|blackout N\|red\|pulse\|calm]` | visual effect |
| `[ambient low\|swell\|stop]` | the drone bed |
| `[photo reveal ID]` | fade your photo in at the climax |

The single source of truth for tags is `web/src/cue/spec.ts`. The parser, the router, the director prompt and the effects all import from it.

**Streaming playback.** Speech is synthesized in the background while the story plays. If the playhead ever catches up with synthesis, playback holds ("the voice is gathering itself…") and resumes by itself. Audio, lights and the transcript share one clock, so Pause freezes everything together.

**Decisions and trade-offs** are recorded as they were made in [`Docs/ADR.md`](Docs/ADR.md), including what could produce wrong output and how to debug it.

## 6. Adding a provider

Adapters implement small interfaces; the UI never talks to a provider directly.

- **Story model:** implement `LLMAdapter` in `web/src/adapters/llm/types.ts` (`chat()` returns an async iterable of text). The OpenAI-compatible adapter in `openaiCompat.ts` already covers Ollama, LM Studio, llama.cpp and hosted endpoints.
- **Voice:** implement `TTSAdapter` in `web/src/adapters/tts/types.ts`: declare which styles and non-verbals you do natively (the rest are emulated in the audio graph) and return an `AudioBuffer` from `synth()`. Put any cue→tag mapping in `styleMap.ts`.

## 7. Development

```bash
cd web
npm run dev         # dev server
npm test            # unit tests (vitest)
npm run typecheck
npm run build       # production build in web/dist
```

Deploying: the repo includes a Render Blueprint (`render.yaml`) for a static site. It builds `web/`, publishes `web/dist`, rewrites unknown paths to `index.html`, and sets the two cross-origin-isolation headers that make the in-browser voice multi-threaded. To use a custom domain, add it in Render's dashboard and create the `CNAME` record Render shows at your DNS provider (for a `.tech` domain, in the registrar's DNS settings).

## 8. Photosensitivity

The experience uses flickering lights, blackouts and red flashes. A notice is shown before the first play. **Settings → Reduce flashing** replaces flicker and blackout with slow dims and skips the photo glitch. Press **Esc** to stop at any time; **Space** pauses.

## 9. Credits and licenses

- This project: MIT (see `LICENSE`).
- **Story model:** Gemma, run through Ollama. See the license on the model's page for its terms.
- **Voice:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-js](https://www.npmjs.com/package/kokoro-js) (Apache-2.0), running on transformers.js / ONNX Runtime Web.
- **Optional voice:** [ElevenLabs](https://elevenlabs.io) (service terms apply).
- **Sound:** all ambience and effects are generated in code with the WebAudio API; no sound files are bundled.
- **Font:** Cormorant Garamond (SIL Open Font License) from Google Fonts.
- Built with React, Vite, TypeScript and Vitest.

## 10. Commits after the submission deadline

_None._
