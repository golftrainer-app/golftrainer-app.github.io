// Die Vorschläge der Woche als Kalenderdatei (.ics), wie PlanCalendar in der
// App (GolfCore/Sources/GolfCore/Planning/PlanCalendar.swift). Jeder Golftag
// wird ein ganztägiger Termin mit den Übungen in der Beschreibung, ohne
// Uhrzeit. Der Samsung Kalender übernimmt die Datei mit allen Tagen auf einmal.
// Mit eingeschalteter Erinnerung bekommt jeder Golftag einen Wecker zur
// gewählten Uhrzeit, dazu kommen die Golftage der nächsten Wochen, damit die
// Erinnerung nicht mit der Woche endet (core/reminders.js).
import { AREA_NAMES } from "./categories.js";
import { addDays } from "./dates.js";
import { dayOfSlot, fireDate, sessionBody, slotBody, title as reminderTitle } from "./reminders.js";
import { context as tournamentContext, rules } from "./tournament.js";

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

/** Zeitpunkt in UTC, z. B. „20261006T150000Z“. */
export function icsDate(date) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Tag für ganztägige Termine in der Zeitzone des Geräts, z. B. „20261017“. */
export function icsDay(date) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** Sonderzeichen nach RFC 5545 maskieren, jeder Zeilenumbruch wird „\n“. */
export function icsText(text) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll("\n", "\\n");
}

/**
 * Zeichen wie die App: zusammengesetzte Zeichen (Flaggen, Emoji mit
 * Verbindern, zerlegte Umlaute) bleiben ein Zeichen, wie `Character` in Swift.
 */
function graphemes(text) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("de", { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
  }
  return [...text];
}

/** Zeilen über 75 Bytes umbrechen, ohne ein Zeichen zu zerteilen. */
export function fold(line) {
  if (byteLength(line) <= 75) return line;
  const parts = [];
  let current = "";
  let limit = 75;
  for (const character of graphemes(line)) {
    if (byteLength(current) + byteLength(character) > limit) {
      parts.push(current);
      current = "";
      // Folgezeilen beginnen mit einem Leerzeichen, das mitzählt.
      limit = 74;
    }
    current += character;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function totalMinutes(session) {
  return session.drills.reduce((total, drill) => total + drill.minutes, 0);
}

/** „Golftag: Putten, Bunker“, die Bereiche mit der meisten Zeit zuerst. */
export function title(session) {
  const areas = Object.entries(session.areaMinutes)
    .filter(([, minutes]) => minutes > 0)
    .sort(([leftArea, left], [rightArea, right]) => (left !== right ? right - left : leftArea < rightArea ? -1 : leftArea > rightArea ? 1 : 0))
    .map(([area]) => AREA_NAMES[area] ?? area);
  const base = session.tournament ? "Turniervorbereitung" : "Golftag";
  return areas.length === 0 ? base : `${base}: ${areas.join(", ")}`;
}

/** Eine Zeile pro Übung mit Dauer, dazu die Trainer-Schwerpunkte. */
export function description(session, drills) {
  const lines = ["Vorschlag der App:"];
  lines.push(...session.drills.map((planned) => `${planned.minutes} Min. ${drills.get(planned.drillID)?.name ?? planned.drillID}`));
  const focus = [...new Set(session.drills.flatMap((planned) => planned.focusNotes))].sort();
  if (focus.length > 0) {
    lines.push("");
    lines.push(`Schwerpunkte: ${focus.join(", ")}`);
  }
  lines.push("");
  lines.push("Ergebnisse trägst du in der App ein.");
  return lines.join("\n");
}

/** Wecker zur Erinnerungszeit des Tags, mit Titel und Text wie die Mitteilung der App. */
function alarmLines(day, settings, summary, body) {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER;VALUE=DATE-TIME:${icsDate(fireDate(day, settings))}`, `DESCRIPTION:${icsText(`${summary}\n${body}`)}`, "END:VALARM"];
}

/** Nur Buchstaben, Ziffern und Bindestriche: Ein Zeilenumbruch in einer Kennung ergäbe sonst einen eigenen Termin. */
const uid = (weekStart, slotID) => `UID:plan-${icsDate(weekStart)}-${String(slotID).toUpperCase().replace(/[^A-Z0-9-]/g, "")}@golftrainer`;

/**
 * Termine der Woche. Die Kennung jedes Termins hängt nur an Woche und
 * Golftag: Wer nach dem Neuplanen noch einmal exportiert, ersetzt im
 * Kalender die alten Termine, statt sie zu verdoppeln.
 *
 * `reminders`: die Einstellung der Erinnerung. Ist sie an, bekommt jeder
 * Termin einen Wecker, und die Golftage der nächsten `weeksAhead` Wochen
 * kommen als Termine ohne Übungen dazu (aus `slots`, ohne Turniertage ohne
 * Training). Ist sie aus, ist die Datei genau die der App.
 */
export function planCalendar(plan, library, now, { reminders = null, slots = [], tournaments = [], weeksAhead = 2 } = {}) {
  const drills = new Map();
  for (const drill of library) {
    if (!drills.has(drill.id)) drills.set(drill.id, drill);
  }
  const withReminders = Boolean(reminders?.isEnabled);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Golf Trainer//Wochenplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Golftraining",
  ];
  const event = (weekStart, slotID, day, summary, body, alarm) => {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      uid(weekStart, slotID),
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART;VALUE=DATE:${icsDay(day)}`,
      `DTEND;VALUE=DATE:${icsDay(next)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(body)}`,
    );
    if (alarm) lines.push(...alarm);
    lines.push("END:VEVENT");
  };
  for (const session of [...plan.sessions].sort((a, b) => a.date - b.date)) {
    const day = new Date(session.date.getFullYear(), session.date.getMonth(), session.date.getDate());
    const alarm = withReminders ? alarmLines(day, reminders, reminderTitle(Boolean(session.tournament)), sessionBody(session, drills)) : null;
    event(plan.weekStart, session.slot.id, day, title(session), description(session, drills), alarm);
  }
  if (withReminders) {
    for (let offset = 1; offset <= weeksAhead; offset += 1) {
      const weekStart = addDays(plan.weekStart, 7 * offset);
      for (const slot of slots) {
        const day = dayOfSlot(slot, weekStart);
        const context = tournamentContext(day, tournaments);
        if (context && !rules(context.phase).trains) continue;
        const summary = context ? "Turniervorbereitung" : "Golftag";
        const body = `${slotBody(slot).replace("für heute ", "")}\n\nDie Übungen kommen, sobald die Woche beginnt. Dann die Kalenderdatei neu holen.`;
        event(weekStart, slot.id, day, summary, body, alarmLines(day, reminders, reminderTitle(Boolean(context)), slotBody(slot)));
      }
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
