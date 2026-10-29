// Records named timings and counters for the DebugPanel and the write-up.

export interface TimingEntry {
  label: string;
  ms: number;
}

type Listener = () => void;

const entries: TimingEntry[] = [];
const counters = new Map<string, number>();
const notes: string[] = [];
const listeners = new Set<Listener>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export const timing = {
  record(label: string, ms: number) {
    entries.push({ label, ms });
    emit();
  },
  /** Start a timer; call the returned function to record and get elapsed ms. */
  start(label: string): () => number {
    const t0 = performance.now();
    return () => {
      const ms = performance.now() - t0;
      timing.record(label, ms);
      return ms;
    };
  },
  /** Free-text diagnostic line shown in the DebugPanel. */
  note(text: string) {
    notes.push(text);
    emit();
  },
  notes: (): readonly string[] => notes,
  count(name: string, by = 1) {
    counters.set(name, (counters.get(name) ?? 0) + by);
    emit();
  },
  entries: (): readonly TimingEntry[] => entries,
  counters: (): ReadonlyMap<string, number> => counters,
  reset() {
    entries.length = 0;
    counters.clear();
    notes.length = 0;
    emit();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Snapshot token for useSyncExternalStore. */
  version: () => version,
};
