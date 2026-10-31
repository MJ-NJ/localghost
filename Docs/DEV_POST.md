<!--
DEV post draft for the Hacktoberfest Open-Source AI Challenge, Week 4.

TITLE: Localghost: a ghost story that knows where you live (and runs on your laptop)
COVER IMAGE: a 1000x420 still of the photo reveal (the dining room, red-tinted and grainy) with the title in a serif font.
TAGS: hf26challenge (required), plus e.g. ai, opensource, webdev

Before publishing: fill or delete the two TODO comments below (agent session, The Spirit of It).
Everything below this comment block is the post body.
-->

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 4: Ghost in the Machine](https://dev.to/challenges/hacktoberfest-week4-2026-10-26)*

## What I Built

**Localghost** is a horror storyteller that lives in your browser. You choose how scared you want to be, from 1 (campfire) to 5 (nightmare). If you like, you add a few photos of your own room and some notes ("the hallway light flickers", "my cat is called Moss"). An open-weight model then writes a ghost story **set in your actual space**, and it's performed aloud: pauses, whispers, a low drone, creaks and knocks, flickering "lights", a blackout. At the climax, *your own photo* fades back in, desaturated and glitching.

I read "Ghost in the Machine" literally. The ghost is a story that knows where you live, and the machine is yours: the model, the voice and the sound all run on your computer. With Ollama running, it works with the internet unplugged.

Ghost stories work best when they're specific. "A house" isn't scary. *Your* hallway at 1 a.m. is. But personal horror only works if you're willing to hand over photos of your home, so that had to happen on your own device.

## Demo

🔗 **Live:** https://localghost.mrituanjay.tech. Press **Try it now — no setup**. No account, no key, no install. The voice model downloads once (about 90 MB) and then runs in your browser.

{% embed https://youtu.be/I9caqypA-1k %}

*Headphones recommended. To fit the video length, the story is played at **1.5× speed** in the recording; in the app it runs at its natural pace, with its silences intact. There's a photosensitivity notice and a "Reduce flashing" option.*

## Code

{% github MJ-NJ/localghost %}

MIT licensed. The README covers a full offline setup on Windows, macOS and Linux, choosing a model for your RAM, and a table of known gotchas. Every design decision, including the ones that could make it produce wrong output, is logged in [`Docs/ADR.md`](https://github.com/MJ-NJ/localghost/blob/master/Docs/ADR.md).

## How I Built It

**The open stack**
- **Story model: Gemma, running locally through Ollama.** In the demo, **Gemma 3 4B** (3.4 GB, vision-capable) reads my photo and writes the story on a 16 GB laptop. The app also runs **Gemma 4 E4B** for text-only stories. It talks to any OpenAI-compatible endpoint, so LM Studio and llama.cpp work too.
- **Voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)** through `kokoro-js`, running *in the browser* in Web Workers (ONNX Runtime Web / WebAssembly).
- **Sound and effects:** everything is generated with the WebAudio API. The drone is filtered noise plus detuned low oscillators, and the creaks, knocks, heartbeat, drips and whispers are all synthesized. No sound files.
- Vite, React and TypeScript, a static site with **no backend**, deployed on Render.

**A tiny language for horror.** The model doesn't write prose. It writes a *cue script*, one beat per line:

```text
[ambient low]
Two tall mirrors face each other across the room.
[pause 1.5]
[slow] The room in the glass is not empty.
[sfx heartbeat] [light pulse]
```

A small incremental parser turns that into events while the model is still streaming. Small models break formats, so the parser is lenient on purpose. It accepts `[lights pulse]`, fixes `[sfx scrapes]` to `scrape`, and drops what it can't understand instead of crashing. If the output has no tags at all, the director retries once with a correction.

**Scare levels are more than adjectives.** Each level sets the length, the number of jump scares, an effects budget, which lights are allowed (level 1 gets only a gentle pulse), the kind of ending, and a content ceiling. Each story also gets a random original premise and a required story shape, so it ends properly instead of trailing off.

**Your photos.** Each photo is downscaled and stripped of EXIF in the browser, then goes through a "set designer" pass that lists what's physically there: the mirrors, the drapes, the cobwebbed table. On my CPU that takes about a minute and a half per photo the first time, and then it's cached forever. Those objects are written into the story, and the most unsettling photo is chosen for the climax reveal. The app first asks Ollama whether the model can actually see images. The first Gemma build I pulled couldn't, and instead of sending photos to a model that can't use them, it falls back to your notes.

**Making a free voice fast enough (the hard part).** On my CPU-only laptop (Ryzen 7 7730U, 16 GB), Kokoro took around 5–11 seconds to synthesize a sentence that plays for 3–4 seconds. A few things got it usable:
- **WebGPU produced pure crackle** on my AMD iGPU. The fp32 WebGPU path was the culprit, so I fell back to WebAssembly with 8-bit weights.
- ONNX Runtime Web was quietly running on **a single thread**, because the page wasn't *cross-origin isolated*. Two response headers (`COOP` + `COEP: credentialless`), set in both Vite and the Render Blueprint, unlocked 4 threads.
- **Streaming playback:** the story starts speaking while the rest is still being synthesized. It estimates how much buffer is needed, and if the playhead catches up it holds ("the voice is gathering itself…") and resumes on its own. Audio, lights and captions share one clock, so they stay in sync.
- An optional **pool of voice workers**, a one-time **speed test** that scales story length to your machine, and an **audio cache**, so replays are instant.

**Optional premium voice.** ElevenLabs (`eleven_v4`) is a plug-in adapter, not a requirement. The same story can be re-rendered with it from a toggle, and whispers and sighs map to its audio tags. Kokoro emulates those styles itself with filters, pitch wobble and soft clipping. Honestly, ElevenLabs sounds better. Kokoro does remarkably well for something free that runs entirely in a browser tab.

## Why Does Open Innovation Matter?

Because the scariest input is your home.

A closed API would mean uploading photos of your bedroom to someone's server so it can make you feel unsafe in that bedroom. That's backwards. With open weights:
- **Your photos never leave your machine** in the default setup. A badge in the top bar always says where your data is going: 🟢 fully local, 🟡 story text sent to ElevenLabs, 🔴 photos sent to a remote model, with a click-through table of exactly what goes where.
- **It works with the lights, and the internet, off.** That's exactly when you want a ghost story.
- **It can't disappear.** No subscription, no API being retired, no keys. Clone it, run `npm i`, point it at Ollama.
- **I could see inside it when it broke.** Open models and open runtimes let me find that WebGPU was producing noise, that WebAssembly was stuck on one thread, and that my first Gemma build had no vision, and fix all three. With a closed TTS API, "it's slow" is just the price.

Where closed did win: ElevenLabs is more expressive and much faster. So it's an **optional** adapter, with your own restricted key, kept in your browser.

## My Agent Session

I built this with **Claude Code** as a pair programmer, working milestone by milestone from a written plan, testing every stage by hand, and logging each decision in an ADR file. Entire captured the sessions as checkpoints alongside the commits.

<!-- TODO: replace this comment with the session embed once it is saved on DEV, e.g. {% agent_session <id-or-slug> %} -->

## The Spirit of It

<!-- TODO: one short, honest paragraph: the first time your own room faded in on screen, or someone you played it for and what they said. If you'd rather not, delete this section. -->

## Prize Categories

- **Best Use of Gemma**: Gemma writes every story locally through Ollama, and Gemma 3 4B reads your photos to set the story in your real room.
- **Best Use of ElevenLabs**: an optional `eleven_v4` voice with audio-tag direction, a restricted key and per-line caching.
- **Best Use of Render**: a static site deployed from a Render Blueprint, with the cross-origin isolation headers that make the in-browser voice multi-threaded.
- **Best Use of Entire**: agent sessions captured as checkpoints alongside the commits.
- **Best Use of a .tech Domain**: https://localghost.mrituanjay.tech

---

*Built with help from an AI coding agent (Claude Code). The design decisions, testing and judgement calls are recorded in the repo.*
