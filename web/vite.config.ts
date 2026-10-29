import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [react()],
  // Cross-origin isolation lets onnxruntime-web use several WASM threads (otherwise it runs on 1).
  // "credentialless" keeps third-party fonts and model downloads working without CORP headers.
  server: { port: 5173, headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: "es" },
  test: { environment: "node" },
});
