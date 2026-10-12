// Datensicherung im selben Format wie die App (GolfCore/.../Model/Backup.swift):
// { format: "golftrainer-backup", version, createdAt, app, payload }. Eine
// Sicherung vom iPhone lässt sich hier öffnen und umgekehrt. Was die Web-App
// nicht kennt, z. B. Schwunganalysen, bleibt beim Speichern erhalten.
import { toStored, fromStored } from "./dates.js";
import { decodeData, encodeData } from "./model.js";

export const FORMAT = "golftrainer-backup";
export const CURRENT_VERSION = 1;

export class BackupError extends Error {
  constructor(kind) {
    const messages = {
      notABackup: "Diese Datei ist keine Sicherung von Golf Trainer.",
      newerVersion: "Die Sicherung stammt aus einer neueren Version der App. Aktualisiere zuerst die App.",
      damaged: "Die Sicherung ist beschädigt und lässt sich nicht lesen.",
    };
    super(messages[kind]);
    this.kind = kind;
  }
}

/** Sicherungsdatei als Text. `extra`: Felder anderer Versionen, die erhalten bleiben. */
export function createBackup(data, now = new Date(), app = "Golf Trainer im Browser") {
  return JSON.stringify(
    {
      format: FORMAT,
      version: CURRENT_VERSION,
      createdAt: toStored(now),
      app,
      payload: { ...(data.extra ?? {}), ...encodeData(data) },
    },
    null,
    2,
  );
}

/** „Golf Trainer Sicherung 2026-10-05.json“, wie in der App. */
export function fileName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `Golf Trainer Sicherung ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Liest eine Sicherung. Fehler sind immer BackupError. */
export function readBackup(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError("notABackup");
  }
  if (!json || json.format !== FORMAT) throw new BackupError("notABackup");
  if (typeof json.version !== "number" || json.version > CURRENT_VERSION) throw new BackupError("newerVersion");
  const payload = json.payload ?? {};
  const createdAt = typeof json.createdAt === "number" ? fromStored(json.createdAt) : new Date(NaN);
  if (typeof payload !== "object" || Array.isArray(payload) || !Number.isFinite(createdAt.getTime())) {
    throw new BackupError("damaged");
  }
  try {
    const data = decodeData(payload);
    data.extra = extraFields(payload);
    return { createdAt, app: typeof json.app === "string" ? json.app.slice(0, 100) : null, data };
  } catch {
    throw new BackupError("damaged");
  }
}

/** Felder der App, die die Web-App nicht bearbeitet, z. B. Schwunganalysen. */
export function extraFields(payload) {
  // „slots“ stammt aus älteren Versionen mit festen Trainingszeiten. Es fällt weg, statt mitzureisen.
  const known = new Set(["handedness", "golfWeek", "slots", "focusPoints", "rounds", "results", "tournaments", "trainingLog", "launchSessions", "csvMappings", "reminders", "weekPlan"]);
  const extra = {};
  for (const [key, value] of Object.entries(payload)) {
    // „__proto__“ würde den Prototyp ändern statt ein Feld anzulegen.
    if (!known.has(key) && key !== "__proto__") extra[key] = value;
  }
  return extra;
}

/** Fügt hinzu, was es noch nicht gibt. Bei gleicher Kennung bleibt der Eintrag auf dem Gerät. */
export function merge(local, imported) {
  const known = new Set(local.map((item) => item?.id));
  const items = [...local];
  for (const item of imported) {
    // Listen, die nur die App kennt, liest die Web-App nicht: Was kein Eintrag mit Kennung ist, bleibt draußen.
    if (!item || typeof item !== "object" || item.id == null) continue;
    if (!known.has(item.id)) {
      known.add(item.id);
      items.push(item);
    }
  }
  return { items, added: items.length - local.length };
}

/**
 * Ergebnisse aus den Vorschlägen gibt es pro Übung und Einheit nur einmal, auch
 * wenn zwei Geräte dasselbe Ergebnis unter verschiedenen Kennungen gespeichert
 * haben. Sonst zählte es doppelt, und die Stufe stiege zu früh. Wie
 * `Backup.mergeResults` in der App.
 */
export function mergeResults(local, imported) {
  const key = (result) => {
    const reference = result?.planReference;
    if (!reference || typeof reference !== "object") return null;
    const weekStart = reference.weekStart instanceof Date ? reference.weekStart.getTime() : reference.weekStart;
    return `${weekStart}|${reference.slotID}|${result.drillID}`;
  };
  const knownIDs = new Set(local.map((item) => item?.id));
  const knownKeys = new Set(local.map(key).filter(Boolean));
  const items = [...local];
  for (const item of imported) {
    if (!item || typeof item !== "object" || item.id == null || knownIDs.has(item.id)) continue;
    knownIDs.add(item.id);
    const planned = key(item);
    if (planned) {
      if (knownKeys.has(planned)) continue;
      knownKeys.add(planned);
    }
    items.push(item);
  }
  return { items, added: items.length - local.length };
}

/** Listen der App, die die Web-App nur aufbewahrt. Beim Zusammenführen zählen sie mit. */
export const KEPT_LISTS = ["analyses"];

/** Kurz, was in einer Sicherung steckt, z. B. „Enthält 84 Ergebnisse, 12 Runden.“ Wie PendingBackup in der App. */
export function summary(data) {
  const kept = (key) => (Array.isArray(data.extra?.[key]) ? data.extra[key].length : 0);
  const parts = [
    [data.results.length, "Ergebnis", "Ergebnisse"],
    [data.trainingLog.length, "Tagebuch-Eintrag", "Tagebuch-Einträge"],
    [data.rounds.length, "Runde", "Runden"],
    [data.tournaments.length, "Turnier", "Turniere"],
    [data.launchSessions.length, "Launch-Monitor-Session", "Launch-Monitor-Sessions"],
    [kept("analyses"), "Schwunganalyse", "Schwunganalysen"],
    [data.focusPoints.length, "Schwerpunkt", "Schwerpunkte"],
  ]
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return parts.length === 0 ? "Die Sicherung enthält nur Einstellungen." : `Enthält ${parts.join(", ")}.`;
}
