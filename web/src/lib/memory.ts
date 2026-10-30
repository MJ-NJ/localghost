// Page memory in MB, including workers. Only available in Chromium and only on a cross-origin isolated page
// (which this app is, see vite.config.ts). Returns null when unsupported or when the browser declines.
export async function measureMemoryMB(): Promise<number | null> {
  const perf = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (!perf.measureUserAgentSpecificMemory || !self.crossOriginIsolated) return null;
  try {
    return Math.round((await perf.measureUserAgentSpecificMemory()).bytes / 1048576);
  } catch {
    return null;
  }
}
