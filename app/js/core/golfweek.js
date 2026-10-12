// Deine Golfwoche wie GolfWeek im Kern der App
// (GolfCore/Sources/GolfCore/Model/GolfWeek.swift): an welchen Tagen festes
// Teamtraining ist und an welchen du sonst voraussichtlich golfen kannst. Für
// jeden Golftag schlägt der Planer vor, was du trainierst. Das Teamtraining
// plant dein Trainer, dort schlägt er nichts vor. Ein Tag ist entweder
// Teamtag oder Golftag.
import { FACILITIES } from "./categories.js";

/** Eigene Zeit pro Golftag in Minuten, wie der Regler in der App: bis 12 Stunden. */
export const MINUTE_RANGE = [30, 720];
export const MINUTE_STEP = 15;

const isWeekday = (value) => Number.isInteger(value) && value >= 1 && value <= 7;
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

/** Neue Golfwoche: kein Tag ausgewählt, alle Anlagen. */
export function emptyGolfWeek() {
  return { teamDays: [], golfDays: [], facilities: [...FACILITIES] };
}

/** An wie vielen Tagen der Woche du golfst, Teamtraining eingeschlossen. */
export function dayCount(week) {
  return new Set([...week.teamDays, ...week.golfDays.map((day) => day.weekday)]).size;
}

/**
 * Vorschlag für die Zeit an einem Golftag: 3 Stunden, 2½ oder 2. Wer selten
 * golft, braucht pro Tag mehr Zeit, damit das Wichtigste drankommt. Wer oft
 * golft, verteilt es auf mehr Tage.
 */
export function suggestedMinutes(count) {
  if (count <= 2) return 180;
  if (count <= 4) return 150;
  return 120;
}

export function isTeamDay(week, weekday) {
  return week.teamDays.includes(weekday);
}

export function isGolfDay(week, weekday) {
  return !isTeamDay(week, weekday) && week.golfDays.some((day) => day.weekday === weekday);
}

/** Zeit an einem Golftag: deine eigene oder der Vorschlag. Null, wenn der Tag kein Golftag ist. */
export function minutesOn(week, weekday) {
  if (!isGolfDay(week, weekday)) return null;
  const day = week.golfDays.find((other) => other.weekday === weekday);
  return day.minutes ?? suggestedMinutes(dayCount(week));
}

/** Hast du die Zeit an diesem Tag selbst eingestellt? */
export function hasOwnMinutes(week, weekday) {
  return week.golfDays.find((day) => day.weekday === weekday)?.minutes != null;
}

/** Feste Kennung je Wochentag, gleich wie in der App: 601F0000-0000-4000-8000-000000000001 für Montag. */
export function slotID(weekday) {
  return `601F0000-0000-4000-8000-${String(weekday).padStart(12, "0")}`;
}

/**
 * Die Golftage als Trainingszeiten für den Planer. Ohne Uhrzeit, also um
 * Mitternacht, und mit fester Kennung je Wochentag: So bleiben Ergebnisse und
 * Kalendereinträge beim Neuplanen bei ihrem Tag.
 */
export function golfWeekSlots(week) {
  if (!week) return [];
  const suggested = suggestedMinutes(dayCount(week));
  return week.golfDays
    .filter((day) => isWeekday(day.weekday) && !isTeamDay(week, day.weekday))
    .sort((a, b) => a.weekday - b.weekday)
    .map((day) => ({
      id: slotID(day.weekday),
      weekday: day.weekday,
      startHour: 0,
      startMinute: 0,
      durationMinutes: day.minutes ?? suggested,
      facilities: [...week.facilities],
      isOptional: false,
    }));
}

// MARK: - Ändern

/** Schaltet Teamtraining an einem Tag an oder aus. Ein Teamtag ist kein Golftag. */
export function setTeamDay(week, weekday, isOn) {
  if (!isWeekday(weekday)) return;
  week.teamDays = week.teamDays.filter((day) => day !== weekday);
  if (isOn) {
    week.teamDays = [...week.teamDays, weekday].sort((a, b) => a - b);
    week.golfDays = week.golfDays.filter((day) => day.weekday !== weekday);
  }
}

/** Schaltet einen Golftag an oder aus. Neu gilt der Vorschlag für die Zeit. */
export function setGolfDay(week, weekday, isOn) {
  if (!isWeekday(weekday)) return;
  if (isOn) {
    if (week.golfDays.some((day) => day.weekday === weekday)) return;
    week.golfDays = [...week.golfDays, { weekday, minutes: null }].sort((a, b) => a.weekday - b.weekday);
    week.teamDays = week.teamDays.filter((day) => day !== weekday);
  } else {
    week.golfDays = week.golfDays.filter((day) => day.weekday !== weekday);
  }
}

/** Eigene Zeit an einem Golftag, null für den Vorschlag der App. */
export function setMinutes(week, weekday, minutes) {
  const day = week.golfDays.find((other) => other.weekday === weekday);
  if (!day) return;
  day.minutes = minutes == null ? null : clamp(minutes, MINUTE_RANGE);
}

// MARK: - Lesen und Schreiben

/** Gültige Wochentage, jeder nur einmal, ein Teamtag nie zugleich Golftag, Zeiten im Bereich der Eingabe. */
export function sanitizeGolfWeek(week) {
  const teamDays = [...new Set(week.teamDays.filter(isWeekday))].sort((a, b) => a - b);
  const taken = new Set(teamDays);
  const golfDays = [];
  for (const day of [...week.golfDays].filter((other) => isWeekday(other.weekday)).sort((a, b) => a.weekday - b.weekday)) {
    if (taken.has(day.weekday)) continue;
    taken.add(day.weekday);
    golfDays.push({ weekday: day.weekday, minutes: day.minutes == null ? null : clamp(day.minutes, MINUTE_RANGE) });
  }
  return { teamDays, golfDays, facilities: [...week.facilities] };
}

/**
 * Golfwoche aus dem gespeicherten JSON, wie in der App: Unlesbare Tage fallen
 * weg, fehlen die Anlagen, gelten alle. Null, solange sie noch nicht gewählt ist.
 */
export function decodeGolfWeek(json) {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return null;
  const teamDays = Array.isArray(json.teamDays) ? json.teamDays.filter(Number.isInteger) : [];
  const golfDays = Array.isArray(json.golfDays)
    ? json.golfDays.flatMap((day) => {
        if (!day || typeof day !== "object" || !Number.isInteger(day.weekday)) return [];
        if (day.minutes != null && !Number.isInteger(day.minutes)) return [];
        return [{ weekday: day.weekday, minutes: day.minutes ?? null }];
      })
    : [];
  const facilities = Array.isArray(json.facilities) ? json.facilities.filter((facility) => FACILITIES.includes(facility)) : [...FACILITIES];
  return sanitizeGolfWeek({ teamDays, golfDays, facilities });
}

/** Im Format der App: ohne eigene Zeit fehlt „minutes“. */
export function encodeGolfWeek(week) {
  return {
    teamDays: [...week.teamDays],
    golfDays: week.golfDays.map((day) => (day.minutes == null ? { weekday: day.weekday } : { weekday: day.weekday, minutes: day.minutes })),
    facilities: [...week.facilities],
  };
}
