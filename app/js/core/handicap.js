// Verlauf des Handicaps, wie HandicapEntry im Kern
// (GolfCore/Sources/GolfCore/Model/Handicap.swift). Du trägst es selbst ein,
// wenn es sich ändert. Weniger ist besser, Werte unter null sind
// Plus-Handicaps und stehen als „+1,2“ da.
import { fromStored, toStored } from "./dates.js";

/** Handicap-Index nach WHS: höchstens 54, Plus-Handicaps bis +10. */
export const HANDICAP_RANGE = [-10, 54];

const EARLIEST = Date.UTC(1970, 0, 1);
const LATEST = Date.UTC(2200, 0, 1);
const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** Gerundet wie `Double.rounded()` in Swift: Hälften weg von null. */
function roundHalfAway(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

const validDate = (date) => Number.isFinite(date?.getTime?.()) && date.getTime() >= EARLIEST && date.getTime() <= LATEST;
const limited = (value, limit) => ([...value].length > limit ? [...value].slice(0, limit).join("") : value);

// MARK: - Texte

/** Auf Zehntel gerundet, Hälften weg von null. */
export function roundedHandicap(value) {
  return roundHalfAway(value * 10) / 10;
}

const digits = (tenths) => `${Math.floor(tenths / 10)},${tenths % 10}`;

/** „18,4“, „0,0“ und „+1,2“ für Werte unter null. */
export function handicapText(value) {
  const tenths = roundHalfAway(value * 10);
  return (tenths < 0 ? "+" : "") + digits(Math.abs(tenths));
}

/** Veränderung: „−1,6“, „+0,3“, „±0,0“. Weniger ist besser. */
export function handicapChangeText(delta) {
  const tenths = roundHalfAway(delta * 10);
  if (tenths === 0) return "±0,0";
  return (tenths < 0 ? "−" : "+") + digits(Math.abs(tenths));
}

/**
 * Liest eine Eingabe wie „18,4“ oder „+1,2“. Ein Plus davor heißt
 * Plus-Handicap, also unter null. Ein Minus ist mehrdeutig und gilt nicht,
 * genauso Werte außerhalb von 54 bis +10. Gerundet auf Zehntel.
 */
export function parseHandicap(text) {
  const trimmed = String(text).trim();
  const isPlus = trimmed.startsWith("+");
  const rest = isPlus ? trimmed.slice(1) : trimmed;
  if (rest.startsWith("-") || rest.startsWith("−") || rest.startsWith("+")) return null;
  const cleaned = rest.replaceAll(",", ".").replace(/\s+/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number < 0) return null;
  const value = roundedHandicap(isPlus ? -number : number);
  return value >= HANDICAP_RANGE[0] && value <= HANDICAP_RANGE[1] ? (Object.is(value, -0) ? 0 : value) : null;
}

// MARK: - Einträge

/**
 * Ein Eintrag aus dem JSON der App. Fehlen Notiz oder Zeitpunkt der
 * Änderung, gelten leer und das Datum. Null, wenn sich der Eintrag nicht
 * lesen lässt oder nicht stimmen kann, wie `sanitized` in der App.
 */
export function decodeHandicap(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  if (typeof json.id !== "string" || !UUID_RE.test(json.id)) return null;
  if (typeof json.date !== "number" || typeof json.value !== "number") return null;
  // Wie in der App: Eine Notiz oder ein Zeitpunkt mit falscher Art von Wert macht den Eintrag unlesbar.
  if (json.note != null && typeof json.note !== "string") return null;
  if (json.updatedAt != null && typeof json.updatedAt !== "number") return null;
  return sanitizeHandicap({
    id: json.id.toUpperCase(),
    date: fromStored(json.date),
    value: json.value,
    note: json.note ?? "",
    updatedAt: fromStored(json.updatedAt ?? json.date),
  });
}

/** Im Bereich der Eingabe, auf eine Nachkommastelle gerundet. Null bei unmöglichem Datum oder Wert. */
export function sanitizeHandicap(entry) {
  if (!validDate(entry.date) || !Number.isFinite(entry.value)) return null;
  const clamped = Math.min(HANDICAP_RANGE[1], Math.max(HANDICAP_RANGE[0], entry.value));
  return {
    ...entry,
    value: roundedHandicap(clamped),
    note: limited(entry.note, 200),
    updatedAt: validDate(entry.updatedAt) ? entry.updatedAt : entry.date,
  };
}

export function encodeHandicap(entry) {
  return { id: entry.id, date: toStored(entry.date), value: entry.value, note: entry.note, updatedAt: toStored(entry.updatedAt) };
}

/** Älteste zuerst. Bei gleichem Tag gilt der zuletzt geänderte Eintrag. */
export function sortedHandicaps(entries) {
  return [...entries].sort((left, right) => {
    if (left.date.getTime() !== right.date.getTime()) return left.date - right.date;
    if (left.updatedAt.getTime() !== right.updatedAt.getTime()) return left.updatedAt - right.updatedAt;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/** Der Eintrag, der an `date` gilt: der letzte bis einschließlich diesem Zeitpunkt. */
export function handicapAt(date, entries) {
  const sorted = sortedHandicaps(entries).filter((entry) => entry.date <= date);
  return sorted[sorted.length - 1] ?? null;
}

/**
 * Wie viel sich das Handicap seit `start` verändert hat: der Wert heute minus
 * der Wert, der zu Beginn galt. Gab es zu Beginn noch keinen, zählt der erste
 * Eintrag danach. Null, wenn es nur einen Eintrag gibt oder keinen bis `now`.
 */
export function handicapChange(start, entries, now) {
  const current = handicapAt(now, entries);
  if (!current) return null;
  const sorted = sortedHandicaps(entries).filter((entry) => entry.date <= now);
  const before = sorted.filter((entry) => entry.date <= start);
  const reference = before[before.length - 1] ?? sorted.find((entry) => entry.date > start) ?? null;
  if (!reference || reference.id === current.id) return null;
  return { delta: roundedHandicap(current.value - reference.value), reference };
}

/** Bestes, also niedrigstes Handicap seit `start` bis `now`. */
export function bestHandicap(start, entries, now) {
  const inRange = sortedHandicaps(entries).filter((entry) => entry.date <= now);
  const before = inRange.filter((entry) => entry.date <= start);
  const starting = before[before.length - 1];
  const candidates = [...(starting ? [starting] : []), ...inRange.filter((entry) => entry.date > start)];
  return candidates.reduce((best, entry) => (best == null || entry.value < best.value ? entry : best), null);
}

/** Punkte für die Kurve von `start` bis `now`: der Wert zu Beginn am Beginn selbst, dann jeder Eintrag. Gleiche Tage einmal. */
export function handicapPoints(start, entries, now) {
  const inRange = sortedHandicaps(entries).filter((entry) => entry.date <= now);
  const points = [];
  const before = inRange.filter((entry) => entry.date <= start);
  const starting = before[before.length - 1];
  if (starting) points.push({ date: new Date(start.getTime()), value: starting.value });
  for (const entry of inRange) {
    if (entry.date <= start) continue;
    const last = points[points.length - 1];
    if (last && last.date.getTime() === entry.date.getTime()) last.value = entry.value;
    else points.push({ date: new Date(entry.date.getTime()), value: entry.value });
  }
  return points;
}

