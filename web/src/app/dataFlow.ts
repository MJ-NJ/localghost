// Where the user's data goes, computed from the current settings. Drives the DataFlowBadge.
import { hostOf, isLocalUrl } from "../adapters/llm/openaiCompat";

export type FlowLevel = "green" | "yellow" | "red";

export interface FlowInput {
  llmBaseUrl: string;
  tts: "kokoro-web" | "elevenlabs";
  /** Photos are stored and the image setting is not "No": they may be sent to the model. */
  photosMaySend: boolean;
  photoCount: number;
  hasNotes: boolean;
}

export interface FlowRow {
  what: string;
  where: string;
  /** true when this leaves the computer */
  leaves: boolean;
}

export interface Flow {
  level: FlowLevel;
  emoji: string;
  headline: string;
  rows: FlowRow[];
}

export function dataFlow(i: FlowInput): Flow {
  const host = hostOf(i.llmBaseUrl);
  const llmLocal = isLocalUrl(i.llmBaseUrl);
  const eleven = i.tts === "elevenlabs";
  const photosSent = i.photoCount > 0 && i.photosMaySend;

  let level: FlowLevel;
  let headline: string;
  if (!llmLocal && photosSent) {
    level = "red";
    headline = `Photos are sent to ${host}`;
  } else if (eleven && llmLocal) {
    level = "yellow";
    headline = "Story text → ElevenLabs. Photos stay on this device.";
  } else if (eleven) {
    level = "yellow";
    headline = `Notes → ${host}; story text → ElevenLabs.`;
  } else if (!llmLocal) {
    level = "yellow";
    headline = `Notes and prompts are sent to ${host}.`;
  } else {
    level = "green";
    headline = "Fully local";
  }

  const rows: FlowRow[] = [];
  if (i.photoCount > 0) {
    rows.push(
      photosSent
        ? { what: "Your photos (downscaled, no EXIF)", where: llmLocal ? `Your local model (${host})` : host, leaves: !llmLocal }
        : { what: "Your photos", where: "Stay in this browser; not sent anywhere", leaves: false },
    );
  }
  if (i.hasNotes) rows.push({ what: "Your notes", where: llmLocal ? `Your local model (${host})` : host, leaves: !llmLocal });
  rows.push({ what: "The story prompt and the story the model writes", where: llmLocal ? `Your local model (${host})` : host, leaves: !llmLocal });
  rows.push(
    eleven
      ? { what: "Story text, to be spoken", where: "ElevenLabs (api.elevenlabs.io)", leaves: true }
      : { what: "Story text, to be spoken", where: "Kokoro, running in this browser", leaves: false },
  );
  rows.push({ what: "API keys", where: "Saved in this browser; sent only to the service they belong to", leaves: false });
  rows.push({ what: "Anything else", where: "Nothing. There is no server of ours to send it to.", leaves: false });

  return { level, emoji: { green: "🟢", yellow: "🟡", red: "🔴" }[level], headline, rows };
}
