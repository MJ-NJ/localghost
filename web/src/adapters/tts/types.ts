import type { NonVerbal, Style } from "../../cue/spec";

export type { NonVerbal, Style };

export interface VoiceInfo {
  id: string;
  label: string;
}

export interface TTSAdapter {
  id: "kokoro-web" | "elevenlabs" | "voice-server";
  label: string;
  caps: {
    styles: Set<Style>; // natively supported styles
    nonverbals: Set<NonVerbal>; // natively supported non-verbals
    offline: boolean;
    latency: "low" | "high";
    maxChars: number;
  };
  synth(
    seg: { text: string; style: Style; leadingNonverbal?: NonVerbal; voice: string },
    signal?: AbortSignal,
  ): Promise<AudioBuffer>;
}
