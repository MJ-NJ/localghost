import { useEffect, useRef, useState } from "react";
import { MAX_PHOTOS, type PhotoId, type StoredPhoto } from "../memories/store";

export interface MemoriesPanelProps {
  photos: StoredPhoto[];
  notes: string;
  /** Host the photos will be sent to (the story model endpoint). */
  host: string;
  locked: boolean;
  error: string;
  onAdd(files: File[]): void;
  onRemove(id: PhotoId): void;
  onNotes(notes: string): void;
}

export function MemoriesPanel(p: MemoriesPanelProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const ph of p.photos) next[ph.id] = URL.createObjectURL(ph.blob);
    setUrls(next);
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  }, [p.photos]);

  const full = p.photos.length >= MAX_PHOTOS;
  const pick = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) p.onAdd(files);
  };

  return (
    <>
      <h3>Your place</h3>
      <div className="badge">
        Photos stay in this browser and are sent only to your story model ({p.host || "not set"}). Up to {MAX_PHOTOS}.
      </div>

      <div className="thumbs">
        {p.photos.map((ph) => (
          <figure key={ph.id}>
            {urls[ph.id] && <img src={urls[ph.id]} alt={ph.id} />}
            <figcaption>{ph.id}</figcaption>
            <button aria-label={`Remove ${ph.id}`} disabled={p.locked} onClick={() => p.onRemove(ph.id)}>
              ✕
            </button>
          </figure>
        ))}
      </div>

      <div
        className={`drop ${over ? "over" : ""} ${full || p.locked ? "disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!full && !p.locked) pick(e.dataTransfer.files);
        }}
      >
        {full ? "All 4 slots are used." : "Drop photos here, or"}
        <button disabled={full || p.locked} onClick={() => input.current?.click()}>
          Choose photos
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {p.error && <div className="error">{p.error}</div>}

      <label>
        Notes (names, details, what scares you, anything to weave in)
        <textarea rows={5} value={p.notes} onChange={(e) => p.onNotes(e.target.value)} />
      </label>
    </>
  );
}
