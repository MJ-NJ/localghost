import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";

describe("SseParser", () => {
  it("parses data lines and DONE", () => {
    const p = new SseParser();
    const r = p.push('data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n');
    expect(r.data).toEqual(['{"a":1}', '{"a":2}']);
    expect(r.done).toBe(true);
  });
  it("handles chunks split mid-line", () => {
    const p = new SseParser();
    expect(p.push('data: {"a"').data).toEqual([]);
    expect(p.push(":1}\n").data).toEqual(['{"a":1}']);
  });
  it("ignores comments and flushes trailing line", () => {
    const p = new SseParser();
    expect(p.push(": keepalive\ndata: x").data).toEqual([]);
    expect(p.flush().data).toEqual(["x"]);
  });
});
