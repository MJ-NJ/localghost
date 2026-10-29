import type { ReactNode, RefObject } from "react";
import type { Style } from "../cue/spec";
import type { PlayerState } from "../engine/player";

export interface StageProps {
  fxBlack: RefObject<HTMLDivElement | null>;
  fxRed: RefObject<HTMLDivElement | null>;
  fxVignette: RefObject<HTMLDivElement | null>;
  line: { text: string; style: Style; n: number } | null;
  hint: ReactNode;
  error: ReactNode;
  /** Raw streamed LLM text while the story is being written. */
  draft: string;
  controls: ReactNode;
  playerState: PlayerState;
}

export function Stage(p: StageProps) {
  return (
    <main className="stage">
      {p.hint && <div className="hint">{p.hint}</div>}
      {p.line && (
        <div key={p.line.n} className={`line ${p.line.style === "whisper" ? "whisper" : ""}`}>
          {p.line.text}
        </div>
      )}
      {p.draft && <div className="draft">{p.draft.replace(/\[[^\]]*\]?/g, "").trim().slice(-500)}</div>}
      {p.error && <div className="hint">{p.error}</div>}
      <div className="controls">{p.controls}</div>
      <div className="fx">
        <div className="fx-black" ref={p.fxBlack} />
        <div className="fx-red" ref={p.fxRed} />
        <div className="fx-vignette" ref={p.fxVignette} />
      </div>
    </main>
  );
}
