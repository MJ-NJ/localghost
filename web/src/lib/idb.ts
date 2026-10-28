// Minimal IndexedDB key-value wrapper (stand-in for idb-keyval; no dependency).

const DB_NAME = "localghost";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key));
export const idbSet = async (key: string, value: unknown) => void (await run("readwrite", (s) => s.put(value, key)));
export const idbDel = async (key: string) => void (await run("readwrite", (s) => s.delete(key)));
export const idbKeys = () => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
export const idbClear = async () => void (await run("readwrite", (s) => s.clear()));
