// Parser for OpenAI-style server-sent events. Feed raw text chunks; get `data:` payloads.
// "[DONE]" is surfaced as `done: true`.

export interface SseResult {
  data: string[];
  done: boolean;
}

export class SseParser {
  private buf = "";

  push(chunk: string): SseResult {
    this.buf += chunk;
    const lines = this.buf.split(/\r\n|\n|\r/);
    this.buf = lines.pop() ?? "";
    return this.consume(lines);
  }

  /** Flush a trailing line that had no newline terminator. */
  flush(): SseResult {
    const rest = this.buf;
    this.buf = "";
    return this.consume(rest ? [rest] : []);
  }

  private consume(lines: string[]): SseResult {
    const data: string[] = [];
    let done = false;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue; // comments, event:, blank lines
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") done = true;
      else if (payload) data.push(payload);
    }
    return { data, done };
  }
}
