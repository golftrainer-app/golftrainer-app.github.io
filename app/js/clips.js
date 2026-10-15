// Clips der automatischen Aufnahme im Speicher des Browsers (IndexedDB,
// Datenbank „golftrainer-clips“): die Angaben zum Clip in „clips“, die
// Videodatei in „files“. Sie bleiben, bis man sie löscht, höchstens LIMIT;
// beim nächsten geht der älteste. „Meine Daten löschen“ nimmt alles mit.
// Kann der Browser nichts speichern, bleiben die Clips bis zum Neuladen.
export const DB_NAME = "golftrainer-clips";
export const CLIP_LIMIT = 50;

function request(target) {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error("IndexedDB"));
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB"));
  });
}

/** Clips nur im Speicher der Seite, wenn IndexedDB fehlt oder gesperrt ist. */
class MemoryClips {
  constructor(limit) {
    this.limit = limit;
    this.persistent = false;
    this.items = new Map();
  }

  async list() {
    return [...this.items.values()].map(({ blob, ...clip }) => clip).sort((a, b) => b.date - a.date);
  }

  async add(clip, blob) {
    this.items.set(clip.id, { ...clip, blob });
    const removed = [];
    const sorted = [...this.items.values()].sort((a, b) => b.date - a.date);
    for (const old of sorted.slice(this.limit)) {
      this.items.delete(old.id);
      removed.push(old.id);
    }
    return removed;
  }

  async blob(id) {
    return this.items.get(id)?.blob ?? null;
  }

  async update(clip) {
    const existing = this.items.get(clip.id);
    if (existing) this.items.set(clip.id, { ...clip, blob: existing.blob });
  }

  async remove(id) {
    this.items.delete(id);
  }

  async deleteAll() {
    this.items.clear();
  }
}

export class ClipStore {
  constructor({ limit = CLIP_LIMIT, indexedDB = globalThis.indexedDB } = {}) {
    this.limit = limit;
    this.indexedDB = indexedDB ?? null;
    this.persistent = Boolean(this.indexedDB);
    this.fallback = null;
    this.db = null;
  }

  async open() {
    if (this.fallback) return null;
    if (this.db) return this.db;
    try {
      const opening = this.indexedDB.open(DB_NAME, 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" }).createIndex("date", "date");
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      };
      this.db = await request(opening);
      this.db.onversionchange = () => {
        this.db?.close();
        this.db = null;
      };
      return this.db;
    } catch {
      // Privates Fenster oder gesperrte Website-Daten: dann nur bis zum Neuladen.
      this.fallback = new MemoryClips(this.limit);
      this.persistent = false;
      return null;
    }
  }

  /** Die Angaben aller Clips, neueste zuerst, ohne die Dateien. */
  async list() {
    const db = await this.open();
    if (!db) return this.fallback.list();
    const clips = await request(db.transaction("clips").objectStore("clips").getAll());
    return clips.sort((a, b) => b.date - a.date);
  }

  /** Speichert einen Clip mit Datei. Gibt die Kennungen der Clips zurück, die über die Grenze fielen. */
  async add(clip, blob) {
    const db = await this.open();
    if (!db) return this.fallback.add(clip, blob);
    const transaction = db.transaction(["clips", "files"], "readwrite");
    transaction.objectStore("clips").put(clip);
    transaction.objectStore("files").put(blob, clip.id);
    await done(transaction);
    const all = await this.list();
    const removed = [];
    for (const old of all.slice(this.limit)) {
      await this.remove(old.id);
      removed.push(old.id);
    }
    return removed;
  }

  async blob(id) {
    const db = await this.open();
    if (!db) return this.fallback.blob(id);
    return (await request(db.transaction("files").objectStore("files").get(id))) ?? null;
  }

  /** Ändert die Angaben eines Clips, z. B. den Treffmoment. Die Datei bleibt. */
  async update(clip) {
    const db = await this.open();
    if (!db) return this.fallback.update(clip);
    const transaction = db.transaction("clips", "readwrite");
    transaction.objectStore("clips").put(clip);
    await done(transaction);
    return undefined;
  }

  async remove(id) {
    const db = await this.open();
    if (!db) return this.fallback.remove(id);
    const transaction = db.transaction(["clips", "files"], "readwrite");
    transaction.objectStore("clips").delete(id);
    transaction.objectStore("files").delete(id);
    await done(transaction);
  }

  /** Für „Meine Daten löschen“: die ganze Datenbank. */
  async deleteAll() {
    if (this.fallback) return this.fallback.deleteAll();
    this.db?.close();
    this.db = null;
    if (!this.indexedDB) return;
    await request(this.indexedDB.deleteDatabase(DB_NAME));
  }
}

let shared = null;

export function clipStore() {
  if (!shared) shared = new ClipStore();
  return shared;
}

/** Löscht alle Clips der automatischen Aufnahme, auch ohne geöffnete Kamera-Seite. */
export async function deleteAllClips() {
  try {
    await clipStore().deleteAll();
  } catch {
    // Dann gab es dort nichts.
  }
}
