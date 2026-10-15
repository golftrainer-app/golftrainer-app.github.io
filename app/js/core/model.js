// Daten im selben JSON-Format wie die App (AppData in App/Sources/AppModel.swift).
// So passt die Datensicherung in beide Richtungen: Zeitpunkte als Sekunden
// seit 2001, Kennungen als UUID in Großbuchstaben. Hier werden daraus
// Date-Objekte und vollständige Einträge mit Standardwerten.
import { AREAS, FACILITIES, SG_CATEGORIES } from "./categories.js";
import { fromStored, toStored } from "./dates.js";
import { decodeGolfWeek, encodeGolfWeek } from "./golfweek.js";
import { normalizedScoring } from "./scoring.js";
import { DELETION_KINDS, MAXIMUM_DELETIONS } from "./sync.js";
import { METRICS } from "./launch.js";
import { defaultSettings as defaultReminders } from "./reminders.js";
import { KINDS, LOCAL_MEMBER, PLACES } from "./traininglog.js";

export function newID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase();
  // Ältere Browser: zufällige Version-4-UUID.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

// MARK: - Grenzen

/**
 * Grenzen wie DataLimits in der App. Eine Sicherung kann von jemand anderem
 * stammen oder beschädigt sein. Werte, die die Eingabe nie erlaubt, z. B. 10
 * Millionen Minuten Training, ließen sonst den Planer ewig rechnen, oder die
 * Seite ließe sich gar nicht mehr öffnen. Was sich begrenzen lässt, kommt in
 * den Bereich der Eingabe. Ein Eintrag mit falscher Art von Wert oder einem
 * Datum, das nicht stimmen kann, fällt weg, wie beim Lesen in der App.
 */
export const LIMITS = {
  /** 1970 bis 2200. */
  earliest: Date.UTC(1970, 0, 1),
  latest: Date.UTC(2200, 0, 1),
  /** Dauer eines Golftags: bis 12 Stunden. */
  slotMinutes: [30, 720],
  tournamentDays: [1, 4],
  focusPriority: [1, 3],
  level: [0, 20],
  score: [0, 10000],
  roundScore: [1, 500],
  strokesGained: [-50, 50],
  /** Minuten einer Übung oder eines Bereichs, höchstens ein ganzer Golftag. */
  drillMinutes: [0, 720],
  /** Minuten an einem Tag, z. B. im Trainingstagebuch. */
  dayMinutes: [0, 24 * 60],
  /** Anstrengung: 1 (locker) bis 5 (sehr anstrengend). */
  effort: [1, 5],
  /** Messwerte vom Launch Monitor, z. B. Meter, km/h oder Umdrehungen. */
  launchValue: [-100000, 100000],
  /** Längste Liste, z. B. Schläge einer Session. */
  listLength: 10000,
  textLength: 5000,
};

/** Wert, mit dem sich ein Eintrag nicht lesen lässt. `lossy` lässt ihn weg. */
class InvalidValue extends Error {}

const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

/** Ganze Zahl im Bereich. Fehlt sie, gilt `fallback`. */
function integer(value, range, fallback) {
  if (value == null && fallback !== undefined) return fallback;
  if (!Number.isInteger(value)) throw new InvalidValue();
  return clamp(value, range);
}

function decimal(value, range) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidValue();
  return clamp(value, range);
}

function text(value, fallback, limit = LIMITS.textLength) {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw new InvalidValue();
  return value.length > limit ? value.slice(0, limit) : value;
}

function bool(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new InvalidValue();
  return value;
}

/** Kennung wie in der App, z. B. eine UUID. Keine Zeichen, die in Adressen oder Kalenderdateien stören. */
function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(value)) throw new InvalidValue();
  return value;
}

/** Kennung einer Übung, z. B. „putt-gate“. */
function drillIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value)) throw new InvalidValue();
  return value;
}

/** Kennung eines Tagebuch-Eintrags: eine UUID oder „Mitglied_JJJJ-MM-TT“, bis 200 Zeichen ohne Steuerzeichen. */
function logIdentifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || /[\u0000-\u001F\u007F]/.test(value)) throw new InvalidValue();
  return value;
}

/** UUID wie in der App, in Großbuchstaben. */
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(value)) throw new InvalidValue();
  return value.toUpperCase();
}

/** Einer von festen Werten, z. B. die Art des Trainings. Fehlt er, gilt `fallback`. */
function oneOf(value, allowed, fallback) {
  if (value == null && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw new InvalidValue();
  return value;
}

function area(value) {
  if (!AREAS.includes(value)) throw new InvalidValue();
  return value;
}

/** Zeitpunkt zwischen 1970 und 2200, sonst stimmt etwas nicht. */
function date(value) {
  if (typeof value !== "number" && typeof value !== "string" && !(value instanceof Date)) throw new InvalidValue();
  const result = fromStored(value);
  const time = result.getTime();
  if (!Number.isFinite(time) || time < LIMITS.earliest || time > LIMITS.latest) throw new InvalidValue();
  return result;
}

const optionalDate = (value) => (value == null ? null : date(value));

/** Liste von Texten. Fehlt sie, ist sie leer. */
function texts(value, limit, length = 200) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InvalidValue();
  return value.slice(0, limit).map((item) => text(item, undefined, length));
}

/** Minuten je Bereich. Unbekannte Bereiche fallen weg. */
function areaNumbers(value, read) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new InvalidValue();
  const result = {};
  for (const key of AREAS) {
    if (Object.hasOwn(value, key)) result[key] = read(value[key]);
  }
  return result;
}

// MARK: - Übungen

/** Eine Übung aus drills.json mit denselben Standardwerten wie Drill in der App. */
export function decodeDrill(json) {
  return {
    id: json.id,
    name: json.name,
    area: json.area,
    mode: json.mode,
    facilities: json.facilities ?? [],
    minutes: json.minutes,
    summary: json.summary ?? "",
    purpose: json.purpose ?? "",
    steps: json.steps ?? [],
    tips: json.tips ?? [],
    equipment: json.equipment ?? [],
    levels: json.levels ?? [],
    scoring: normalizedScoring(json.scoring),
    isBenchmark: json.isBenchmark ?? false,
    isWarmUp: json.isWarmUp ?? false,
    isCorrective: json.isCorrective ?? false,
    isTournamentPrep: json.isTournamentPrep ?? false,
    suggestsVideo: json.suggestsVideo ?? false,
    isIndoor: json.indoor ?? false,
    generator: json.generator ?? null,
    sources: json.sources ?? [],
  };
}

/** Die Übungsbibliothek aus drills.json: { version, drills }. */
export function decodeLibrary(json) {
  if (!json || !Array.isArray(json.drills)) throw new Error("Die Übungen ließen sich nicht lesen.");
  return json.drills.map(decodeDrill);
}

// MARK: - Lesen

/** Ein Eintrag muss ein Objekt sein, sonst lässt er sich nicht lesen. */
function object(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new InvalidValue();
  return json;
}

/** Anlagen einer Trainingszeit. Fehlen sie, gelten alle. */
function facilities(value) {
  if (value == null) return [...FACILITIES];
  if (!Array.isArray(value)) throw new InvalidValue();
  return value.filter((facility) => FACILITIES.includes(facility));
}

export function decodeSlot(json) {
  object(json);
  return {
    id: identifier(json.id),
    weekday: integer(json.weekday, [1, 7]),
    startHour: integer(json.startHour, [0, 23], 17),
    startMinute: integer(json.startMinute, [0, 59], 0),
    durationMinutes: integer(json.durationMinutes, LIMITS.slotMinutes, 120),
    facilities: facilities(json.facilities),
    isOptional: bool(json.isOptional, false),
  };
}

export function decodeFocus(json) {
  object(json);
  return {
    id: identifier(json.id),
    text: text(json.text, ""),
    area: area(json.area),
    priority: integer(json.priority, LIMITS.focusPriority, 2),
    isActive: bool(json.isActive, true),
    drillIDs: texts(json.drillIDs, 200),
  };
}

export function decodeRound(json) {
  object(json);
  const strokesGained = {};
  if (json.strokesGained != null) {
    object(json.strokesGained);
    for (const category of SG_CATEGORIES) {
      const value = json.strokesGained[category];
      if (value != null) strokesGained[category] = decimal(value, LIMITS.strokesGained);
    }
  }
  return {
    id: identifier(json.id),
    date: date(json.date),
    course: text(json.course, ""),
    score: json.score == null ? null : integer(json.score, LIMITS.roundScore),
    strokesGained,
  };
}

/**
 * Ein unlesbarer Verweis auf den Plan macht das Ergebnis nicht unlesbar, wie
 * in der App: Es bleibt, nur ohne den Verweis.
 */
function planReferenceOf(json) {
  if (json == null) return null;
  try {
    object(json);
    return { weekStart: date(json.weekStart), slotID: identifier(json.slotID) };
  } catch {
    return null;
  }
}

export function decodeResult(json) {
  object(json);
  const planReference = planReferenceOf(json.planReference);
  return {
    id: identifier(json.id),
    drillID: drillIdentifier(json.drillID),
    date: date(json.date),
    level: integer(json.level, LIMITS.level, 0),
    score: integer(json.score, LIMITS.score, 0),
    planReference,
    sessionID: json.sessionID == null ? null : identifier(json.sessionID),
    note: json.note == null ? null : text(json.note),
  };
}

export function decodeTournament(json) {
  object(json);
  return {
    id: identifier(json.id),
    name: text(json.name, ""),
    course: text(json.course, ""),
    start: date(json.start),
    days: integer(json.days, LIMITS.tournamentDays, 1),
    checkedItems: texts(json.checkedItems, 1000),
  };
}

const PHASES = ["weekOut", "halfWeek", "dayBefore", "tournamentDay"];

function decodeContext(json) {
  object(json);
  if (!PHASES.includes(json.phase)) throw new InvalidValue();
  return {
    tournamentID: identifier(json.tournamentID),
    name: text(json.name, ""),
    phase: json.phase,
    daysUntil: integer(json.daysUntil, [-366, 366]),
  };
}

export function decodeSession(json) {
  object(json);
  if (json.drills != null && !Array.isArray(json.drills)) throw new InvalidValue();
  return {
    slot: decodeSlot(json.slot),
    date: date(json.date),
    drills: (json.drills ?? []).slice(0, 100).map((drill) => {
      object(drill);
      return {
        drillID: drillIdentifier(drill.drillID),
        minutes: integer(drill.minutes, LIMITS.drillMinutes),
        level: integer(drill.level, LIMITS.level, 0),
        focusNotes: texts(drill.focusNotes, 50, LIMITS.textLength),
        stations: texts(drill.stations, 500),
      };
    }),
    areaMinutes: areaNumbers(json.areaMinutes, (value) => integer(value, LIMITS.drillMinutes)),
    tournament: json.tournament == null ? null : decodeContext(json.tournament),
  };
}

/** Eine Übung im Tagebuch, wie LoggedDrill in der App. */
export function decodeLoggedDrill(json) {
  object(json);
  return {
    drillID: text(json.drillID, undefined, 200),
    name: text(json.name, undefined, 200),
    area: area(json.area),
    minutes: integer(json.minutes, LIMITS.dayMinutes),
    score: json.score == null ? null : integer(json.score, LIMITS.score),
    maxScore: json.maxScore == null ? null : integer(json.maxScore, LIMITS.score),
    level: integer(json.level, LIMITS.level, 0),
    isBenchmark: bool(json.isBenchmark, false),
    lowerIsBetter: bool(json.lowerIsBetter, false),
    date: date(json.date),
  };
}

/**
 * Eine Einheit im Tagebuch, wie TrainingLogEntry in der App. Ohne Mitglied
 * gehört sie zu diesem Gerät. Eine unbekannte Art, z. B. aus einer neueren
 * Version, lässt den Eintrag weg, wie beim Lesen in der App.
 */
export function decodeLogEntry(json) {
  object(json);
  if (json.drills != null && !Array.isArray(json.drills)) throw new InvalidValue();
  const start = date(json.start);
  let updatedAt = start;
  try {
    if (json.updatedAt != null) updatedAt = date(json.updatedAt);
  } catch {
    // Ein unmöglicher Zeitstempel: Der Beginn gilt, wie in der App.
  }
  return {
    id: logIdentifier(json.id),
    memberID: json.memberID == null ? LOCAL_MEMBER : uuid(json.memberID),
    start,
    minutes: integer(json.minutes, LIMITS.dayMinutes),
    kind: oneOf(json.kind, KINDS, "free"),
    place: json.place == null ? null : oneOf(json.place, PLACES),
    areaMinutes: areaNumbers(json.areaMinutes, (value) => integer(value, LIMITS.dayMinutes)),
    drills: lossyItems(json.drills ?? [], decodeLoggedDrill, 500),
    note: text(json.note, ""),
    effort: json.effort == null ? null : integer(json.effort, LIMITS.effort),
    updatedAt,
  };
}

/** Ein Schlag vom Launch Monitor, wie LaunchShot in der App. Unmögliche Werte kommen in den Bereich, „keine Zahl“ fällt weg. */
export function decodeLaunchShot(json) {
  object(json);
  const values = {};
  if (json.values != null) {
    object(json.values);
    for (const metric of METRICS) {
      const value = json.values[metric];
      if (typeof value !== "number" || Number.isNaN(value)) continue;
      values[metric] = clamp(value, LIMITS.launchValue);
    }
  }
  let shotDate = null;
  try {
    shotDate = optionalDate(json.date);
  } catch {
    // Ein unmögliches Datum: der Schlag bleibt, nur ohne Uhrzeit, wie in der App.
  }
  return {
    id: uuid(json.id),
    index: integer(json.index, [0, LIMITS.listLength], 0),
    date: shotDate,
    club: text(json.club, "", 100),
    values,
  };
}

/** Eine Session vom Launch Monitor, wie LaunchSession in der App. */
export function decodeLaunchSession(json) {
  object(json);
  if (json.shots != null && !Array.isArray(json.shots)) throw new InvalidValue();
  const sessionDate = date(json.date);
  let importedAt = sessionDate;
  try {
    if (json.importedAt != null) importedAt = date(json.importedAt);
  } catch {
    // Wie in der App: Dann gilt das Datum der Session.
  }
  return {
    id: uuid(json.id),
    date: sessionDate,
    importedAt,
    source: text(json.source, "", 200),
    fileName: text(json.fileName, "", 500),
    shots: lossyItems(json.shots ?? [], decodeLaunchShot, LIMITS.listLength),
  };
}

/** Gespeicherte Zuordnung der Spalten einer CSV-Datei, wie ColumnMapping in der App. */
export function decodeColumnMapping(json) {
  object(json);
  const column = (value) => (value == null ? null : integer(value, [0, LIMITS.listLength]));
  const metrics = {};
  if (json.metrics != null) {
    object(json.metrics);
    for (const metric of METRICS) {
      if (json.metrics[metric] != null) metrics[metric] = integer(json.metrics[metric], [0, LIMITS.listLength]);
    }
  }
  return { club: column(json.club), clubType: column(json.clubType), date: column(json.date), metrics };
}

/** Zuordnungen nach Spaltennamen, höchstens 100, unlesbare fallen weg. */
function decodeMappings(json) {
  const mappings = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return mappings;
  for (const [key, value] of Object.entries(json).slice(0, 100)) {
    if (key === "__proto__" || key.length > LIMITS.textLength) continue;
    try {
      mappings[key] = decodeColumnMapping(value);
    } catch {
      // Zuordnung aus einer anderen Version: weglassen.
    }
  }
  return mappings;
}

/**
 * Erinnerung an Golftagen, wie ReminderSettings in der App: aus, bis du sie
 * einschaltest. Ältere Einstellungen ohne Uhrzeit bekommen 15:00 Uhr.
 */
export function decodeReminders(json) {
  const settings = defaultReminders();
  if (!json || typeof json !== "object" || Array.isArray(json)) return settings;
  if (typeof json.isEnabled === "boolean") settings.isEnabled = json.isEnabled;
  if (Number.isInteger(json.hour)) settings.hour = clamp(json.hour, [0, 23]);
  if (Number.isInteger(json.minute)) settings.minute = clamp(json.minute, [0, 59]);
  return settings;
}

/** Ein Plan mit unmöglichem Wert fällt ganz weg, die Web-App plant dann neu. */
export function decodeWeekPlan(json) {
  if (!json) return null;
  object(json);
  if (json.sessions != null && !Array.isArray(json.sessions)) throw new InvalidValue();
  return {
    weekStart: date(json.weekStart),
    sessions: (json.sessions ?? []).slice(0, 50).map(decodeSession),
    weights: areaNumbers(json.weights, (value) => decimal(value, [0, 1])),
    createdAt: optionalDate(json.createdAt),
  };
}

/**
 * Löschmarke, wie Deletion in der App: Liste, Kennung des gelöschten Eintrags
 * und Zeitpunkt. Beim Abgleich über das Konto kommt der Eintrag so nicht von
 * einem anderen Gerät zurück. Eine Kennung mit mehr als 100 Zeichen fällt
 * weg, wie beim Lesen in der App.
 */
export function decodeDeletion(json) {
  object(json);
  if (typeof json.id !== "string" || json.id.length > 100) throw new InvalidValue();
  return { kind: oneOf(json.kind, DELETION_KINDS), id: json.id, at: date(json.at), restored: json.restored === true };
}

/** `restored` steht nur in den Daten, wenn es gilt, wie in der App. */
export function encodeDeletion(deletion) {
  const json = { kind: deletion.kind, id: deletion.id, at: toStored(deletion.at) };
  if (deletion.restored) json.restored = true;
  return json;
}

/** Liest eine Liste und lässt unlesbare Einträge weg, statt alles zu verlieren (wie decodeLossy in der App). */
function lossyItems(list, decode, limit) {
  if (!Array.isArray(list)) return [];
  const items = [];
  for (const item of list.slice(0, limit)) {
    try {
      const decoded = decode(item);
      if (decoded) items.push(decoded);
    } catch {
      // Eintrag aus einer anderen Version oder mit unmöglichen Werten: weglassen.
    }
  }
  return items;
}

/** Wie `lossyItems`, für Einträge mit Kennung. */
function lossy(list, decode, limit) {
  return lossyItems(list, decode, limit).filter((item) => item.id != null);
}

/**
 * Eigene Daten aus dem gespeicherten JSON. Fehlendes bekommt den Standardwert.
 * Ohne Golfwoche, auch bei Daten älterer Versionen mit festen Trainingszeiten,
 * fragt die Woche danach. Bis dahin gibt es keine Vorschläge.
 */
export function decodeData(json = {}) {
  return {
    handedness: ["right", "left"].includes(json.handedness) ? json.handedness : null,
    golfWeek: decodeGolfWeek(json.golfWeek),
    focusPoints: lossy(json.focusPoints, decodeFocus, 500),
    rounds: lossy(json.rounds, decodeRound, 10000),
    results: lossy(json.results, decodeResult, 100000),
    tournaments: lossy(json.tournaments, decodeTournament, 1000),
    trainingLog: lossy(json.trainingLog, decodeLogEntry, 10000),
    launchSessions: lossy(json.launchSessions, decodeLaunchSession, LIMITS.listLength),
    csvMappings: decodeMappings(json.csvMappings),
    reminders: decodeReminders(json.reminders),
    deletions: lossy(json.deletions, decodeDeletion, MAXIMUM_DELETIONS),
    weekPlan: (() => {
      try {
        return decodeWeekPlan(json.weekPlan);
      } catch {
        return null;
      }
    })(),
  };
}

// MARK: - Schreiben

const encodeSlot = (slot) => ({ ...slot, facilities: [...slot.facilities] });

function encodeSession(session) {
  const json = {
    slot: encodeSlot(session.slot),
    date: toStored(session.date),
    drills: session.drills.map((drill) => ({ ...drill })),
    areaMinutes: { ...session.areaMinutes },
  };
  if (session.tournament) json.tournament = { ...session.tournament };
  return json;
}

function encodeLoggedDrill(drill) {
  const json = {
    drillID: drill.drillID,
    name: drill.name,
    area: drill.area,
    minutes: drill.minutes,
    level: drill.level,
    isBenchmark: drill.isBenchmark,
    lowerIsBetter: drill.lowerIsBetter,
    date: toStored(drill.date),
  };
  if (drill.score != null) json.score = drill.score;
  if (drill.maxScore != null) json.maxScore = drill.maxScore;
  return json;
}

/** Eine Einheit im Tagebuch als JSON der App, z. B. für das Team. */
export function encodeLogEntry(entry) {
  const json = {
    id: entry.id,
    memberID: entry.memberID,
    start: toStored(entry.start),
    minutes: entry.minutes,
    kind: entry.kind,
    areaMinutes: { ...entry.areaMinutes },
    drills: entry.drills.map(encodeLoggedDrill),
    note: entry.note,
    updatedAt: toStored(entry.updatedAt),
  };
  if (entry.place) json.place = entry.place;
  if (entry.effort != null) json.effort = entry.effort;
  return json;
}

function encodeLaunchSession(session) {
  return {
    id: session.id,
    date: toStored(session.date),
    importedAt: toStored(session.importedAt),
    source: session.source,
    fileName: session.fileName,
    shots: session.shots.map((shot) => {
      const json = { id: shot.id, index: shot.index, club: shot.club, values: { ...shot.values } };
      if (shot.date) json.date = toStored(shot.date);
      return json;
    }),
  };
}

function encodeColumnMapping(mapping) {
  const json = { metrics: { ...mapping.metrics } };
  if (mapping.club != null) json.club = mapping.club;
  if (mapping.clubType != null) json.clubType = mapping.clubType;
  if (mapping.date != null) json.date = mapping.date;
  return json;
}

/** Eine Runde als JSON der App, z. B. für das Team. */
export function encodeRound(round) {
  const item = { id: round.id, date: toStored(round.date), course: round.course, strokesGained: { ...round.strokesGained } };
  if (round.score != null) item.score = round.score;
  return item;
}

/** Eigene Daten als JSON im Format der App. Nur Felder, die die Web-App kennt. */
export function encodeData(data) {
  const json = {
    focusPoints: data.focusPoints.map((point) => ({ ...point })),
    rounds: data.rounds.map(encodeRound),
    results: data.results.map((result) => {
      const item = { id: result.id, drillID: result.drillID, date: toStored(result.date), level: result.level, score: result.score };
      if (result.planReference) {
        item.planReference = { weekStart: toStored(result.planReference.weekStart), slotID: result.planReference.slotID };
      }
      if (result.sessionID) item.sessionID = result.sessionID;
      if (result.note) item.note = result.note;
      return item;
    }),
    tournaments: data.tournaments.map((tournament) => ({ ...tournament, start: toStored(tournament.start), checkedItems: [...tournament.checkedItems] })),
    trainingLog: data.trainingLog.map(encodeLogEntry),
    launchSessions: data.launchSessions.map(encodeLaunchSession),
    csvMappings: Object.fromEntries(Object.entries(data.csvMappings).map(([key, mapping]) => [key, encodeColumnMapping(mapping)])),
    reminders: { isEnabled: data.reminders.isEnabled, hour: data.reminders.hour, minute: data.reminders.minute },
    deletions: (data.deletions ?? []).map(encodeDeletion),
  };
  if (data.handedness) json.handedness = data.handedness;
  if (data.golfWeek) json.golfWeek = encodeGolfWeek(data.golfWeek);
  if (data.weekPlan) {
    json.weekPlan = {
      weekStart: toStored(data.weekPlan.weekStart),
      sessions: data.weekPlan.sessions.map(encodeSession),
      weights: { ...data.weekPlan.weights },
    };
    if (data.weekPlan.createdAt) json.weekPlan.createdAt = toStored(data.weekPlan.createdAt);
  }
  return json;
}
