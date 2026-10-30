import type { LightMode } from "../cue/spec";

export interface ScareProfile {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  words: readonly [number, number];
  jumps: number;
  /** Max [sfx]/[light] tags in total. */
  budget: number;
  /** The director is asked to use [light] at least this many times (small models otherwise skip them). */
  minLights: number;
  /** [light] modes the director may use (cumulative ladder; ADR-017). */
  lights: readonly LightMode[];
  ending: string;
  ceiling: string;
}

export const PROFILES: readonly ScareProfile[] = [
  { level: 1, minLights: 1, name: "Campfire", words: [350, 450], jumps: 0, budget: 3, lights: ["pulse", "calm"], ending: "warm, resolved", ceiling: "eerie only" },
  { level: 2, minLights: 2, name: "Uneasy", words: [400, 550], jumps: 1, budget: 5, lights: ["flicker", "pulse", "calm"], ending: "ambiguous", ceiling: "eerie, no violence" },
  { level: 3, minLights: 2, name: "Haunted", words: [450, 650], jumps: 2, budget: 8, lights: ["flicker", "blackout", "pulse", "calm"], ending: "ambiguous", ceiling: "implied threat" },
  { level: 4, minLights: 3, name: "Dread", words: [550, 750], jumps: 3, budget: 12, lights: ["flicker", "blackout", "red", "pulse", "calm"], ending: "bleak", ceiling: "implied violence, no gore" },
  { level: 5, minLights: 4, name: "Nightmare", words: [600, 800], jumps: 4, budget: 16, lights: ["flicker", "blackout", "red", "pulse", "calm"], ending: "twist: it's in your room now", ceiling: "implied violence, no graphic gore" },
];

export function profileFor(level: number): ScareProfile {
  return PROFILES[Math.min(5, Math.max(1, Math.round(level))) - 1];
}
