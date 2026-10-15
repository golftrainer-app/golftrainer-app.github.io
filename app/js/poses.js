// Bildfolgen der Schwunganalyse im Speicher des Browsers (IndexedDB,
// Datenbank „golftrainer-posen“, Tabelle „sequences“): je Analyse die
// Gelenke aller ausgewerteten Bilder im Format der App, wie die Datei
// `Analysen/<Kennung>.json` auf dem iPhone. Sie gehen nicht in den Abgleich
// und nicht in die Datensicherung. „Meine Daten löschen“ nimmt alles mit.
// Kann der Browser nichts speichern, bleiben sie bis zum Neuladen.
export const DB_NAME = "golftrainer-posen";
export const SEQUENCE_VERSION = 1;

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

class MemoryPoses {
  constructor() {
    this.persistent = false;
    this.items = new Map();
  }

  async put(sequence) {
    this.items.set(sequence.analysisID, sequence);
  }

  async get(analysisID) {
    return this.items.get(analysisID) ?? null;
  }

  async remove(analysisID) {
    this.items.delete(analysisID);
  }

  async deleteAll() {
    this.items.clear();
  }
}

export class PoseStore {
  constructor({ indexedDB = globalThis.indexedDB } = {}) {
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
        if (!db.objectStoreNames.contains("sequences")) db.createObjectStore("sequences", { keyPath: "analysisID" });
      };
      this.db = await request(opening);
      this.db.onversionchange = () => {
        this.db?.close();
        this.db = null;
      };
      return this.db;
    } catch {
      // Privates Fenster oder gesperrte Website-Daten: dann nur bis zum Neuladen.
      this.fallback = new MemoryPoses();
      this.persistent = false;
      return null;
    }
  }

  /** Speichert die Bildfolge einer Analyse: { analysisID, version, createdAt, source, bodyHeight, heightIsMeasured, frames } mit Bildern im Format der App. */
  async put(sequence) {
    const db = await this.open();
    if (!db) return this.fallback.put(sequence);
    const transaction = db.transaction("sequences", "readwrite");
    transaction.objectStore("sequences").put(sequence);
    await done(transaction);
    return undefined;
  }

  async get(analysisID) {
    const db = await this.open();
    if (!db) return this.fallback.get(analysisID);
    return (await request(db.transaction("sequences").objectStore("sequences").get(analysisID))) ?? null;
  }

  async remove(analysisID) {
    const db = await this.open();
    if (!db) return this.fallback.remove(analysisID);
    const transaction = db.transaction("sequences", "readwrite");
    transaction.objectStore("sequences").delete(analysisID);
    await done(transaction);
    return undefined;
  }

  /** Für „Meine Daten löschen“: die ganze Datenbank. */
  async deleteAll() {
    if (this.fallback) return this.fallback.deleteAll();
    this.db?.close();
    this.db = null;
    if (!this.indexedDB) return undefined;
    await request(this.indexedDB.deleteDatabase(DB_NAME));
    return undefined;
  }
}

let shared = null;

export function poseStore() {
  if (!shared) shared = new PoseStore();
  return shared;
}

/** Löscht alle Bildfolgen, auch ohne geöffnete Analyse-Seite. */
export async function deleteAllPoses() {
  try {
    await poseStore().deleteAll();
  } catch {
    // Dann gab es dort nichts.
  }
}
