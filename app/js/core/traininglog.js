// Trainingstagebuch wie TrainingLogBuilder im Kern der App
// (GolfCore/Sources/GolfCore/Team/TrainingLogBuilder.swift). Eigene Einheiten
// mit Stoppuhr oder von Hand bekommen die Übungen, die in ihre Zeit fallen.
// Alle übrigen Ergebnisse ergeben einen Eintrag pro Tag „Übungen aus dem Plan“.
import { addDays, startOfDay } from "./dates.js";
import { maxScore, normalizedScoring } from "./scoring.js";

/** Platzhalter, solange das Tagebuch zu keinem Team gehört, wie `TrainingLogEntry.localMember`. */
export const LOCAL_MEMBER = "00000000-0000-0000-0000-000000000000";

/** Art des Trainings. „plan“ vergibt nur die App für die Übungen aus den Vorschlägen. */
export const KINDS = ["plan", "free", "lesson", "round", "fitness", "other"];

export const KIND_NAMES = {
  plan: "Übungen aus dem Plan",
  free: "Freies Training",
  lesson: "Trainerstunde",
  round: "Runde auf dem Platz",
  fitness: "Athletik",
  other: "Sonstiges",
};

export const PLACES = ["range", "shortGameArea", "puttingGreen", "course", "indoor", "home"];

export const PLACE_NAMES = {
  range: "Range",
  shortGameArea: "Kurzspielanlage",
  puttingGreen: "Puttinggrün",
  course: "Platz",
  indoor: "Halle / Simulator",
  home: "Zuhause",
};

/**
 * Ein Ergebnis gehört zu einem eigenen Eintrag, wenn es in dessen Zeit fällt.
 * Etwas Spielraum, weil Ergebnisse oft erst nach dem Ende eingetragen werden.
 */
export const ATTACH_TOLERANCE = 15 * 60 * 1000;

/** Zum Beispiel „2026-10-01“, in der Zeitzone des Geräts. */
export function dayKey(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function entryEnd(entry) {
  return new Date(entry.start.getTime() + entry.minutes * 60000);
}

/** Automatisch aus den Übungen des Plans entstanden, nicht von Hand. */
export function isAutomatic(entry) {
  return entry.kind === "plan" && entry.id.includes("_");
}

/** Übung im Tagebuch aus einem Ergebnis. */
export function loggedDrill(result, drill, includeScore = true) {
  const scoring = normalizedScoring(drill.scoring);
  const hasScore = scoring.kind !== "none";
  return {
    drillID: drill.id,
    name: drill.name,
    area: drill.area,
    minutes: drill.minutes,
    score: includeScore && hasScore ? result.score : null,
    maxScore: includeScore && hasScore ? maxScore(scoring) : null,
    level: result.level ?? 0,
    isBenchmark: Boolean(drill.isBenchmark),
    lowerIsBetter: scoring.kind === "strokes",
    date: new Date(result.date.getTime()),
  };
}

/** Zum Beispiel „7 / 10“ oder „38 Schläge“, null ohne Wertung. */
export function scoreText(drill) {
  if (drill.score == null) return null;
  if (drill.lowerIsBetter) return `${drill.score} Schläge`;
  if (drill.maxScore != null) return `${drill.score} / ${drill.maxScore}`;
  return `${drill.score} Punkte`;
}

/** Minuten pro Bereich aus den Übungen. */
export function areaMinutes(drills) {
  const minutes = {};
  for (const drill of drills) minutes[drill.area] = (minutes[drill.area] ?? 0) + drill.minutes;
  return minutes;
}

/** Bereiche eines Eintrags, längster zuerst. */
export function sortedAreas(entry) {
  return Object.entries(entry.areaMinutes)
    .filter(([, minutes]) => minutes > 0)
    .map(([area, minutes]) => ({ area, minutes }))
    .sort((a, b) => (a.minutes !== b.minutes ? b.minutes - a.minutes : a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
}

function withoutScore(drill) {
  return { ...drill, score: null, maxScore: null };
}

/**
 * Das Tagebuch, neueste Einheit zuerst.
 *
 * Eigene Einträge (von Hand oder mit der Stoppuhr) bekommen die Übungen, die
 * in ihre Zeit fallen. Alle übrigen Ergebnisse ergeben einen Eintrag pro Tag
 * („Übungen aus dem Plan“), mit den üblichen Minuten der Übungen. Ergebnisse
 * von Übungen, die es nicht mehr gibt, fallen weg.
 */
export function entries({ memberID = LOCAL_MEMBER, manual, results, library, includeScores = true, since = null }) {
  const drills = new Map();
  for (const drill of library) {
    if (!drills.has(drill.id)) drills.set(drill.id, drill);
  }
  // Aufwärmen ist Trainingszeit, aber kein Bereich: Es soll nicht als Wedge-Training zählen.
  const warmUps = new Set(library.filter((drill) => drill.isWarmUp).map((drill) => drill.id));
  // Ein Eintrag, der vor `since` beginnt und danach endet, bleibt dabei. Sonst
  // fiele er weg, und seine Übungen nach `since` würden zum Tageseintrag.
  const manualEntries = manual.filter((entry) => !since || entryEnd(entry) >= since).sort((a, b) => a.start - b.start);
  let remaining = results
    .filter((result) => !since || result.date >= since)
    .filter((result) => drills.has(result.drillID))
    .sort((a, b) => a.date - b.date);

  const list = [];
  for (const original of manualEntries) {
    const entry = { ...original, memberID, areaMinutes: { ...original.areaMinutes }, drills: original.drills.map((drill) => ({ ...drill })) };
    if (!includeScores) entry.drills = entry.drills.map(withoutScore);
    const windowStart = entry.start.getTime();
    const windowEnd = Math.max(windowStart, entryEnd(entry).getTime()) + ATTACH_TOLERANCE;
    const inWindow = (result) => result.date.getTime() >= windowStart && result.date.getTime() <= windowEnd;
    const attached = remaining.filter(inWindow);
    if (attached.length > 0) {
      remaining = remaining.filter((result) => !inWindow(result));
      const known = new Set(entry.drills.map((drill) => `${drill.drillID}|${drill.date.getTime()}`));
      const added = attached
        .map((result) => loggedDrill(result, drills.get(result.drillID), includeScores))
        .filter((drill) => !known.has(`${drill.drillID}|${drill.date.getTime()}`));
      entry.drills = [...entry.drills, ...added].sort((a, b) => a.date - b.date);
      if (Object.keys(entry.areaMinutes).length === 0) {
        entry.areaMinutes = areaMinutes(entry.drills.filter((drill) => !warmUps.has(drill.drillID)));
      }
      const latest = Math.max(...attached.map((result) => result.date.getTime()));
      if (latest > entry.updatedAt.getTime()) entry.updatedAt = new Date(latest);
    }
    list.push(entry);
  }

  const byDay = new Map();
  for (const result of remaining) {
    const key = dayKey(result.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(result);
  }
  for (const [day, dayResults] of byDay) {
    const logged = dayResults.map((result) => loggedDrill(result, drills.get(result.drillID), includeScores));
    const first = logged[0];
    const last = logged[logged.length - 1];
    list.push({
      id: `${memberID}_${day}`,
      memberID,
      start: new Date(first.date.getTime() - first.minutes * 60000),
      minutes: logged.reduce((total, drill) => total + drill.minutes, 0),
      kind: "plan",
      place: null,
      areaMinutes: areaMinutes(logged.filter((drill) => !warmUps.has(drill.drillID))),
      drills: logged,
      note: "",
      effort: null,
      updatedAt: new Date(last.date.getTime()),
    });
  }
  return list.sort((a, b) => b.start - a.start);
}

/**
 * Tage in Folge mit Training. Zählt ab heute, oder ab gestern, wenn heute
 * noch nicht trainiert wurde. `trainingDays`: Set der Tage (0 Uhr) als Zahl.
 */
export function streak(trainingDays, today) {
  let day = startOfDay(today);
  if (!trainingDays.has(day.getTime())) {
    const yesterday = addDays(day, -1);
    if (!trainingDays.has(yesterday.getTime())) return 0;
    day = yesterday;
  }
  let count = 0;
  while (trainingDays.has(day.getTime())) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}
