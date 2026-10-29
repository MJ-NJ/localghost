import { LLMError } from "../adapters/llm/types";

/** Shows an error message, plus copyable fix commands for LLMError. */
export function ErrorView({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const commands = error instanceof LLMError ? error.commands : [];
  return (
    <div className="error">
      <div>{message}</div>
      {commands.map((c) => (
        <div key={c.command} className="cmd">
          <small>{c.label}</small>
          <code>{c.command}</code>
          <button onClick={() => void navigator.clipboard?.writeText(c.command)}>Copy</button>
        </div>
      ))}
    </div>
  );
}
