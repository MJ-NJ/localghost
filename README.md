# Localghost 👻

**A ghost story, told aloud, set in your own place.** Pick how scared you want to be (1–5), optionally add photos of your room and a few notes, and an open-weight model writes a horror story around your real surroundings. It is performed in your browser with pauses, whispers, a drone, sound effects, flickering lights and, at the climax, your own photo fading back in, distorted.

Everything open runs on your machine: the story model (Gemma through Ollama), the voice (Kokoro, in the browser) and the sound (procedural WebAudio). There is no backend. Nothing is sent to a server of ours, because we do not run one.

> **Live demo: https://localghost.mrituanjay.tech** &nbsp;·&nbsp; Demo video: _TODO: add link_

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 4 ("Ghost in the Machine").

**Contents:** [Try it now](#1-try-it-now-no-setup) · [Full setup](#2-full-setup-run-it-on-your-own-machine) · [ElevenLabs (optional)](#3-optional-elevenlabs-voice) · [Deploy your own](#4-deploy-your-own-copy) · [Using it](#5-using-it) · [Known gotchas](#6-known-gotchas-and-troubleshooting) · [Privacy](#7-privacy) · [How it works](#8-how-it-works) · [Adding a provider](#9-adding-a-provider) · [Photosensitivity](#10-photosensitivity) · [Credits](#11-credits-and-licenses)

---

## 1. Try it now (no setup)

Open **https://localghost.mrituanjay.tech** and press **Try it now — no setup**. It plays a short bundled story through Kokoro, running entirely in your browser: no account, no key, no Ollama. The first run downloads the voice model (about 90 MB) and shows progress; after that it is cached by the browser.

Use headphones and a dark room, and read the [photosensitivity notice](#10-photosensitivity) first. **Space** pauses, **Esc** stops.

---

## 2. Full setup (run it on your own machine)

This gets you the whole thing: stories written by a local model about your own photos and notes, fully offline.

### What you need

| | Minimum | Notes |
|---|---|---|
| Node.js | **22.12 or newer** | `node -v` to check. Vitest needs 22.12+. |
| Ollama | any recent version | [ollama.com/download](https://ollama.com/download). LM Studio or llama.cpp also work (see below). |
| RAM | about 16 GB | The model, the browser and the in-browser voice share it. Close heavy browser tabs. |
| Browser | Chrome, Edge or Firefox | Safari works but the voice stays single-threaded (slower). |
| GPU | not required | Everything was built and tested on a CPU-only laptop (Ryzen 7 7730U). |

### Step 1: get the code

```bash
git clone https://github.com/MJ-NJ/localghost.git
cd localghost/web
npm install
```

All commands below run from `web/` unless stated otherwise.

### Step 2: pick and pull a story model

The story model writes the script. To use your **photos**, it must also be able to read images. These are the Gemma options that fit a 16 GB laptop (sizes from the Ollama library):

| Ollama tag | Download | Reads photos | Thinks before answering | When to choose it |
|---|---|---|---|---|
| `gemma3:4b` | 3.4 GB | ✅ | No | **Lowest memory, fastest first words.** Best for 16 GB laptops and demos. |
| `gemma4:e2b-it-qat` | 4.3 GB | ✅ | Yes (by default) | Smallest Gemma 4. |
| `gemma4:e4b-it-qat` | 6.1 GB | ✅ | Yes (by default) | Better writing; needs free memory. |

```bash
ollama pull gemma3:4b
ollama show gemma3:4b      # under "Capabilities" you should see: vision
```

> If `ollama show` does not list **vision**, the model cannot read photos. This happens with GGUF files imported from Hugging Face without their vision "projector" file. The app detects it and uses your notes instead, but your photos will not shape the story. Use a tag from the Ollama library (above) to get vision.

### Step 3: let the browser talk to Ollama (CORS)

A web page may only call Ollama if Ollama allows the page's origin. Set `OLLAMA_ORIGINS` and then **fully restart Ollama** (it only reads this at startup).

| System | Command | Then |
|---|---|---|
| Windows | `setx OLLAMA_ORIGINS "http://localhost:5173,https://localghost.mrituanjay.tech"` | Quit Ollama from the system tray (right-click → Quit) and start it again. Open a new terminal for `setx` to take effect. |
| macOS | `launchctl setenv OLLAMA_ORIGINS "http://localhost:5173,https://localghost.mrituanjay.tech"` | Quit and reopen the Ollama app. |
| Linux (systemd) | `sudo systemctl edit ollama` and add `Environment="OLLAMA_ORIGINS=http://localhost:5173,https://localghost.mrituanjay.tech"` under `[Service]` | `sudo systemctl daemon-reload && sudo systemctl restart ollama` |

Include every origin you will open the app from: `http://localhost:5173` for `npm run dev`, and the hosted URL if you want the hosted page to use your local Ollama.

### Step 4: run the app

```bash
npm run dev          # opens on http://localhost:5173
```

### Step 5: set it up in the app

1. **Settings → Story model:** Provider **Ollama**, Base URL `http://localhost:11434/v1`. Press **Fetch models** and pick your model (or type the tag).
2. **Settings → "Read my photos with this model":** leave it on **Auto**. Press **Check model for image support** to confirm it says the model reports image support.
3. **Settings → Voice:** Kokoro is the default and needs nothing. Press **Load voice model** once (about 90 MB, cached afterwards). Settings should show `wasm/q8, multi-threaded`.
4. **Settings → Story length:** leave on **Auto**. The first story times the voice once and shortens stories to suit your machine. Use **Full** for the designed lengths if your machine is fast or you use ElevenLabs.
5. **Memories tab:** add up to 4 photos of a real room (drag-drop or "Choose photos") and a few notes: names, small details, what scares you.
6. Pick a **Scare** level (1 = campfire, 5 = nightmare) and press **Tell me a story**.

What happens next: "Studying your place" (one call per photo, cached forever afterwards), "Summoning…" while the model writes (you can watch the text appear, dimmed), then the voice starts while the rest is still being synthesized.

### Alternative servers (instead of Ollama)

Anything with an OpenAI-compatible `/v1/chat/completions` works. Pick the preset in Settings.

- **LM Studio** (`http://localhost:1234/v1`): load a vision-capable model, start the local server, and enable **CORS** in the server settings.
- **llama.cpp server** (`http://localhost:8080/v1`): e.g. `llama-server -hf <repo>:<quant>`. For photos the vision projector must be loaded; recent builds fetch it with `-hf`, otherwise pass `--mmproj <file>`. The app reads `/props` to check whether vision is available.
- **Any hosted endpoint** ("Custom"): paste the base URL and an API key. Note the [privacy badge](#7-privacy) will warn you that your notes (and photos, if any) leave your machine.

---

## 3. Optional: ElevenLabs voice

Kokoro is free and offline. ElevenLabs is more expressive and much faster, and is entirely optional.

1. **Create a restricted API key** in your ElevenLabs account. It only needs two permissions:
   - **Text to Speech**: enabled
   - **Voices**: read

   Everything else (agents, speech-to-text, dubbing, voice cloning, history) can stay off. Setting a **credit quota** on the key is a good idea. Do **not** set an IP allowlist if you will demo from other networks.
2. **Settings → Voice provider → ElevenLabs**, paste the key, choose a model (`eleven_v4` by default), press **Load my voices**, pick one.
3. **Or, for local development, keep the key in a file:** copy `web/.env.local.example` to `web/.env.local` and set `VITE_ELEVENLABS_API_KEY=...`, then **restart `npm run dev`**. That file is git-ignored and read **only** by the dev server: it is never included in a production build, so a deployed site never contains your key.
4. The **Voice** selector next to the Stage buttons switches between Kokoro and ElevenLabs. **Replay** re-renders the same story in the selected voice.

What is sent to ElevenLabs: the text of each spoken line plus style tags such as `[whispers]` or `[sighs]`. Never your photos or notes. Every rendered line is cached on your device, so you never pay twice for a line you have already heard.

---

## 4. Deploy your own copy

It is a static site; any static host works. The repo includes a **Render Blueprint** (`render.yaml`):

1. Push the repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`: builds with `cd web && npm ci && npm run build`, publishes `web/dist`, rewrites unknown paths to `index.html`, pins Node 22, and sets two headers:
   - `Cross-Origin-Opener-Policy: same-origin`
   - `Cross-Origin-Embedder-Policy: credentialless`

   These make the page "cross-origin isolated", which lets the in-browser voice use several CPU threads instead of one. **Keep them**; without them the site works but the voice is much slower.
3. **Custom domain:** add it in Render (Settings → Custom Domains), then at your domain's DNS provider create the **CNAME** record Render shows (e.g. `localghost` → `<your-service>.onrender.com`). Render issues the HTTPS certificate automatically once DNS resolves.
4. Check the deployed site: **Settings** should say `multi-threaded` after loading the voice.

On another host, set the same two headers and an SPA fallback to `index.html`.

---

## 5. Using it

| Control | What it does |
|---|---|
| **Try it now — no setup** | Plays the bundled demo story with the offline voice. |
| **Tell me a story** | Writes a new story with your model, photos and notes. |
| **Replay** | Plays the last story again instantly (or re-renders it if you switched voice). |
| **Voice** selector | Kokoro (offline) or ElevenLabs. |
| **Space** / **Esc** | Pause/resume · stop. While playing, the controls fade; move the mouse to bring them back. |
| **Scare** slider | 1 Campfire · 2 Uneasy · 3 Haunted · 4 Dread · 5 Nightmare. Changes length, number of scares, which lights are allowed, the ending and the content ceiling. |
| **Debug** tab | Timings (time to first word, model speed, per-line voice time), cache hits, dropped tags, the story's premise, whether the model was cut off. |

---

## 6. Known gotchas and troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Could not reach localhost. Is Ollama running? Did you set OLLAMA_ORIGINS…" | CORS: Ollama does not allow the page's origin, or was not restarted after setting it. | Set `OLLAMA_ORIGINS` to include the exact origin (scheme, host and port) and **fully restart Ollama**. On Windows, quit it from the tray. |
| Works on 5173, fails after a restart | Port 5173 was busy, so Vite started on 5174. | Use the port Vite prints, and add it to `OLLAMA_ORIGINS`, or free port 5173. |
| Hosted page cannot reach my local Ollama | Browsers treat an HTTPS page calling `http://localhost` as a local-network request; it may prompt for permission or block it. | Allow the prompt, and add the hosted URL to `OLLAMA_ORIGINS`. The guaranteed offline setup is `npm run dev`. |
| "This model could not read your photos… does not support multimodal requests" | The model has no vision projector (common with GGUFs imported from Hugging Face). | Check `ollama show <tag>` for `vision`. Use a library tag such as `gemma3:4b` or `gemma4:e2b-it-qat`. Or set "Read my photos" to **No**. |
| Long "Summoning…" with no text appearing, then a story that ends abruptly | Gemma 4 **thinks before answering** by default. The thinking is hidden but takes time and counts toward the reply limit. | Expected with Gemma 4. `gemma3:4b` does not think and starts writing at once. If the Debug tab says the story was cut off by the token limit, use a smaller story length or a non-thinking model. |
| Voice is pure crackling noise | WebGPU at fp32 produced garbage on an AMD integrated GPU during development. | The app now always uses WebAssembly with 8-bit weights. If you see noise anyway, the Debug tab flags audio that looks like noise; report your browser and GPU. |
| Voice is very slow; long wait before the first word | In-browser Kokoro on a CPU can be slower than real time (on the dev laptop: about 5–11 s to make a sentence that plays for 3–4 s). | Check Settings says **multi-threaded** (needs the COOP/COEP headers). Leave **Story length: Auto**. Try **Voice workers: 2** and **Run voice speed test**. Or use ElevenLabs. |
| Settings says **single-threaded** | The page is not cross-origin isolated (missing headers), or the browser is Safari. | `npm run dev` and the provided `render.yaml` set the headers. On another host, add them yourself. |
| "the voice is gathering itself…" mid-story | Playback caught up with synthesis; it waits and resumes on its own. | Normal on slow machines. A shorter story length or more voice workers reduces it. |
| More voice workers made it slower, or memory spiked | Each worker is a full copy of the voice model with up to 4 threads; 3 workers can oversubscribe a laptop CPU. | Compare with **Run voice speed test** and the memory line in the Debug tab; use whatever is fastest (often 1 or 2). |
| First load is slow or the voice never loads | The voice model (about 90 MB) downloads from Hugging Face on first use; some networks block it. | Wait for the progress bar; check the network allows `huggingface.co`. It is cached afterwards. |
| ElevenLabs: 401 / 402 / 429 / 422 | Bad key / out of credits / rate limited / unknown voice or model. | The message says which. Check the key permissions (Text to Speech + Voices read), your credits, and that a voice is selected. |
| A tag is read aloud (e.g. "nervous") in ElevenLabs | That audio-tag spelling is not understood by the model. | Edit `web/src/adapters/tts/styleMap.ts`; all tag spellings live there. |
| `.env.local` key not picked up | The dev server reads env files only at startup. | Restart `npm run dev`. (It is never used by production builds, by design.) |
| Story ignores my photos or uses few effects | Small models follow instructions loosely. | Expected sometimes. The parser accepts common slips (`[lights pulse]`, `[sfx scrapes]`); the Debug tab counts what was dropped. Try another scare level or model. |
| The app is using a lot of storage | Kokoro audio is cached as raw PCM (about 176 KB per second of speech). | Settings → **Clear audio cache**. |
| Photos or cache disappear | Private/incognito windows and "clear site data" wipe IndexedDB. | Use a normal window. |

---

## 7. Privacy

The badge in the top bar always says where your data goes. Click it for the full table.

| Badge | Meaning |
|---|---|
| 🟢 **Fully local** | Local story model and the offline voice. Nothing leaves your computer. |
| 🟡 **Story text → ElevenLabs. Photos stay on this device.** | Local model, ElevenLabs voice. |
| 🟡 **Notes and prompts are sent to {host}** | A remote story model, no photos involved. |
| 🔴 **Photos are sent to {host}** | A remote story model and photos present. |

- Photos are downscaled (longest side 768 px) and re-encoded as JPEG in your browser, which strips EXIF data (GPS, camera, time). They are stored in your browser's IndexedDB and sent only to the story model you configured.
- API keys are stored in your browser's `localStorage` and sent only to the service they belong to.
- Nothing is sent to any server run by this project. There is no analytics.

---

## 8. How it works

```
 notes + photos ─► vision pass ─► inventory (JSON, cached by photo hash)
                                       │
 scare level ─► profile ─► director prompt ─► story model (streams a "cue script")
                                                     │
                                     incremental cue parser (lenient)
                                                     │
                                 router ─► segments ─► voice (Kokoro | ElevenLabs)
                                                     │           │
                                          audio cache (IndexedDB) ◄┘
                                                     │
                       timeline ─► WebAudio graph (voice, reverb, drone, SFX, ducking)
                                └► visual effects (lights, photo reveal), same clock
```

**The cue language.** The model writes a *cue script*, one beat per line, with tags. Everything that isn't a tag is speech. Unknown or malformed tags are dropped and counted, never thrown, so imperfect output from a small model still plays.

| Tag | Meaning |
|---|---|
| `[pause N]` | silence (0.2–6 s) |
| `[whisper]` `[slow]` `[trembling]` `[shout]` | style for the rest of that line |
| `[breath]` `[sigh]` `[gasp]` `[laugh]` | non-verbal |
| `[sfx creak\|knock\|footsteps\|door\|heartbeat\|static\|drip\|scrape\|whispers]` | one-shot sound |
| `[light flicker\|blackout N\|red\|pulse\|calm]` | visual effect |
| `[ambient low\|swell\|stop]` | the drone bed |
| `[photo reveal ID]` | fade your photo in at the climax |

The single source of truth for tags is `web/src/cue/spec.ts`; the parser, router, director prompt and effects all import from it.

**Streaming playback.** Speech is synthesized in the background while the story plays. If playback catches up with synthesis it holds and resumes by itself. Audio, lights and the transcript share one clock, so Pause freezes everything together.

**Decisions and trade-offs**, including what could produce wrong output and how to debug it, are logged in [`Docs/ADR.md`](Docs/ADR.md). Deferred work is in [`Docs/IMPROVEMENTS.md`](Docs/IMPROVEMENTS.md).

---

## 9. Adding a provider

Adapters implement small interfaces; the UI never talks to a provider directly.

- **Story model:** implement `LLMAdapter` in `web/src/adapters/llm/types.ts` (`chat()` returns an async iterable of text). The OpenAI-compatible adapter in `openaiCompat.ts` already covers Ollama, LM Studio, llama.cpp and hosted endpoints.
- **Voice:** implement `TTSAdapter` in `web/src/adapters/tts/types.ts`: declare which styles and non-verbals you do natively (the rest are emulated in the audio graph) and return an `AudioBuffer` from `synth()`. Put any cue→tag mapping in `styleMap.ts`.

### Development

```bash
cd web
npm run dev         # dev server
npm test            # unit tests (vitest)
npm run typecheck
npm run build       # production build in web/dist
```

---

## 10. Photosensitivity

The experience uses flickering lights, blackouts and red flashes. A notice is shown before the first play. **Settings → Reduce flashing** replaces flicker and blackout with slow dims and skips the photo glitch. Press **Esc** to stop at any time.

---

## 11. Credits and licenses

- This project: MIT (see `LICENSE`).
- **Story model:** Gemma, run through Ollama. See the license on the model's page for its terms.
- **Voice:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-js](https://www.npmjs.com/package/kokoro-js) (Apache-2.0), running on transformers.js / ONNX Runtime Web.
- **Optional voice:** [ElevenLabs](https://elevenlabs.io) (service terms apply).
- **Sound:** all ambience and effects are generated in code with the WebAudio API; no sound files are bundled.
- **Demo story:** written for this project. **Demo photo:** _TODO: credit the photo's source and license._
- **Font:** Cormorant Garamond (SIL Open Font License) from Google Fonts.
- Built with React, Vite, TypeScript and Vitest.

## Commits after the submission deadline

_None._
