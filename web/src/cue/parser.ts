import {
  ALL_TAG_WORDS,
  AMBIENT_MODES,
  BLACKOUT_DEFAULT,
  BLACKOUT_MAX,
  BLACKOUT_MIN,
  LIGHT_MODES,
  NONVERBALS,
  PAUSE_DEFAULT,
  PAUSE_MAX,
  PAUSE_MIN,
  PHOTO_VERB,
  STYLES,
  TAG,
  TAG_ALIASES,
  normalizeSfx,
  clamp,
  type AmbientMode,
  type CueEvent,
  type LightMode,
  type NonVerbal,
  type Style,
  type StyleTag,
} from "./spec";

export interface ParserStats {
  /** Tags dropped because they were unknown or malformed (shown in DebugPanel). */
  unknownTags: number;
  /** Junk spans dropped (e.g. "(pause 2)", "*sighs*", unterminated "[tag"). */
  junkDropped: number;
  /** Tags with a missing/bad argument that fell back to a default. */
  defaulted: number;
}

const includes = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

// `[ ... ]` tag; `*...*` stage direction; `(word ...)` where word is a tag name.
const TOKEN_RE = new RegExp(
  String.raw`\[([^\[\]]*)\]` + // 1: bracket tag
    String.raw`|\*+([^*\n]{1,40})\*+` + // 2: *junk*
    String.raw`|\(\s*(?:${ALL_TAG_WORDS.join("|")})\b[^()]*\)`, // (pause 2)
  "gi",
);

function parseNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Incremental cue parser. Feed streamed chunks with push(); events are emitted
 * for each completed line. Call flush() at end of stream for the last line.
 * Never throws: bad input is dropped, logged and counted.
 */
export class CueParser {
  readonly stats: ParserStats = { unknownTags: 0, junkDropped: 0, defaulted: 0 };
  private buf = "";

  constructor(private readonly warn: (msg: string) => void = (m) => console.warn(m)) {}

  push(chunk: string): CueEvent[] {
    this.buf += chunk;
    const lines = this.buf.split(/\r\n|\n|\r/);
    this.buf = lines.pop() ?? "";
    return lines.flatMap((l) => this.parseLine(l));
  }

  flush(): CueEvent[] {
    const rest = this.buf;
    this.buf = "";
    return rest ? this.parseLine(rest) : [];
  }

  /** Convenience: parse a whole script. */
  static parse(text: string, warn?: (msg: string) => void): { events: CueEvent[]; stats: ParserStats } {
    const p = new CueParser(warn);
    const events = [...p.push(text), ...p.flush()];
    return { events, stats: p.stats };
  }

  private drop(what: string, raw: string) {
    this.stats.unknownTags++;
    this.warn(`cue: dropped ${what}: ${raw}`);
  }

  private parseLine(line: string): CueEvent[] {
    const events: CueEvent[] = [];
    let style: Style = "normal"; // style scope is one line; last style tag wins from that point
    let last = 0;

    const speech = (raw: string) => {
      // an unterminated "[tag" with no closing bracket is junk, not speech
      let text = raw;
      const open = text.indexOf("[");
      if (open !== -1) {
        this.stats.junkDropped++;
        this.warn(`cue: dropped unterminated tag: ${text.slice(open)}`);
        text = text.slice(0, open);
      }
      text = text.replace(/\s+/g, " ").trim();
      // nothing pronounceable (punctuation only) is not worth synthesizing
      if (text && /[\p{L}\p{N}]/u.test(text)) events.push({ kind: "speech", text, style });
    };

    for (const m of line.matchAll(TOKEN_RE)) {
      speech(line.slice(last, m.index));
      last = m.index + m[0].length;

      if (m[1] === undefined) {
        this.stats.junkDropped++;
        this.warn(`cue: dropped junk: ${m[0]}`);
        continue;
      }
      const tag = this.parseTag(m[1]);
      if (!tag) {
        this.drop("tag", m[0]);
      } else if ("setStyle" in tag) {
        style = tag.setStyle;
      } else {
        events.push(tag);
      }
    }
    speech(line.slice(last));
    return events;
  }

  private parseTag(inner: string): CueEvent | { setStyle: StyleTag } | null {
    const words = inner.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const [rawName, ...args] = words;
    if (!rawName) return null;
    const name = TAG_ALIASES[rawName] ?? rawName;

    if (includes(STYLES, name)) return { setStyle: name };
    if (includes(NONVERBALS, name)) return { kind: "nonverbal", nv: name as NonVerbal };

    switch (name) {
      case TAG.pause: {
        let n = parseNumber(args[0]);
        if (n === undefined) {
          this.stats.defaulted++;
          this.warn(`cue: [pause] without a valid number, using ${PAUSE_DEFAULT}s`);
          n = PAUSE_DEFAULT;
        }
        return { kind: "pause", seconds: clamp(n, PAUSE_MIN, PAUSE_MAX) };
      }
      case TAG.sfx: {
        const sfx = args[0] && normalizeSfx(args[0]);
        return sfx ? { kind: "sfx", name: sfx } : null;
      }
      case TAG.light: {
        const mode = args[0];
        if (!mode || !includes(LIGHT_MODES, mode)) return null;
        if (mode !== "blackout") return { kind: "light", mode: mode as LightMode };
        let n = parseNumber(args[1]);
        if (n === undefined) {
          this.stats.defaulted++;
          this.warn(`cue: [light blackout] without a valid number, using ${BLACKOUT_DEFAULT}s`);
          n = BLACKOUT_DEFAULT;
        }
        return { kind: "light", mode: "blackout", seconds: clamp(n, BLACKOUT_MIN, BLACKOUT_MAX) };
      }
      case TAG.ambient: {
        const mode = args[0];
        return mode && includes(AMBIENT_MODES, mode) ? { kind: "ambient", mode: mode as AmbientMode } : null;
      }
      case TAG.photo: {
        const [verb, id] = args;
        return verb === PHOTO_VERB && id ? { kind: "photo", id } : null;
      }
      default:
        return null;
    }
  }
}
