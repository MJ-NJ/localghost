# Improvements backlog

Things deliberately deferred. Each entry: what, why deferred, how to resume.

## Kokoro on WebGPU (fp32)
- **Status:** removed from the app (2026-10-29). The voice engine is WASM + q8 only.
- **Why:** on the dev laptop (Ryzen 7730U, AMD iGPU) WebGPU/fp32 output was only sparking/crackling noise for every voice, while WASM/q8 and Node CPU/q8 were clean. Suspects: GPU driver or the onnxruntime-web dev build (`1.22.0-dev.20250409`) that `kokoro-js@1.2.1` / `@huggingface/transformers@3.8.1` pull in.
- **To resume:** the WebGPU load path, the device selector and per-segment audio stats are in commit `46c380d`. Retry after upgrading `kokoro-js` / `@huggingface/transformers`, try `dtype: "fp16"` or `q4f16` on WebGPU, or test on other hardware. The audio stats (zero-crossing rate near 0.5, NaN > 0, peak pinned at 1.0 = garbage) are a quick check.
- **Cost of not having it:** slower prerender on CPU/WASM. Mitigations: audio cache (M5), streaming playback mode ([SHOULD] in PLAN.md).
