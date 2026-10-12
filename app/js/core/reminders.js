// Erinnerung an Golftagen wie TrainingReminders im Kern der App
// (GolfCore/Sources/GolfCore/Planning/TrainingReminders.swift): für die
// laufende Woche mit dem Vorschlag aus dem Plan, für die Wochen danach aus den
// Golftagen. Tage, an denen wegen eines Turniers kein Training stattfindet,
// bleiben ohne Erinnerung, Tage mit Teamtraining auch: Sie sind keine Golftage.
// Im Browser plant kein System Mitteilungen; die Erinnerungen kommen als
// Wecker in die Kalenderdatei (core/calendar.js).
import { AREA_NAMES } from "./categories.js";
import { addDays, atTime, planCovers, startOfDay, startOfWeek } from "./dates.js";
import { context as tournamentContext, rules } from "./tournament.js";

export const IDENTIFIER_PREFIX = "training-reminder-";
/** iOS hält höchstens 64 geplante Mitteilungen pro App, die App nimmt 24. */
export const MAXIMUM_COUNT = 24;

/** Aus, bis du sie einschaltest. */
export function defaultSettings() {
  return { isEnabled: false, hour: 15, minute: 0 };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad = (value) => String(value).padStart(2, "0");

/** „15:00 Uhr“, für die Einstellungen. */
export function timeText(hour, minute) {
  return `${pad(clamp(hour, 0, 23))}:${pad(clamp(minute, 0, 59))} Uhr`;
}

export function title(tournament) {
  return tournament ? "Heute: Turniervorbereitung" : "Heute ist Golftag";
}

/** „Vorschlag: Putten 40 Min., Bunker 20 Min. Los geht es mit „Leiter“.“ */
export function sessionBody(session, drills) {
  const areas = Object.entries(session.areaMinutes)
    .filter(([, minutes]) => minutes > 0)
    .sort(([leftArea, left], [rightArea, right]) => (left !== right ? right - left : leftArea < rightArea ? -1 : leftArea > rightArea ? 1 : 0))
    .map(([area, minutes]) => `${AREA_NAMES[area] ?? area} ${minutes} Min.`);
  const first = session.drills.map((planned) => drills.get(planned.drillID)).find((drill) => drill && !drill.isWarmUp);
  let text = areas.length === 0 ? "Den Vorschlag für heute siehst du in der App." : `Vorschlag: ${areas.join(", ")}`;
  if (first) text += ` Los geht es mit „${first.name}“.`;
  return text;
}

export function slotBody(slot) {
  return `Etwa ${slot.durationMinutes} Minuten. Den Vorschlag für heute siehst du in der App.`;
}

/** Die Uhrzeit der Erinnerung an einem Tag. */
export function fireDate(day, settings) {
  return atTime(startOfDay(day), clamp(settings.hour, 0, 23), clamp(settings.minute, 0, 59));
}

/** Bleibt für denselben Golftag gleich, so ersetzt eine neue Planung die alte Erinnerung. */
export function identifier(day, slotID) {
  const stamp = `${String(day.getFullYear()).padStart(4, "0")}${pad(day.getMonth() + 1)}${pad(day.getDate())}`;
  return `${IDENTIFIER_PREFIX}${stamp}-${slotID}`;
}

/** Der Tag einer Trainingszeit in einer Woche, um Mitternacht. */
export function dayOfSlot(slot, weekStart) {
  return startOfDay(addDays(startOfDay(weekStart), clamp(slot.weekday, 1, 7) - 1));
}

/**
 * Die Erinnerungen: [{ id, fireDate, sessionStart, title, body }], die
 * nächste zuerst, höchstens 24. `plan` zählt nur, wenn er diese Woche gilt.
 */
export function reminders({ settings, plan, slots, tournaments, library, now, weeksAhead = 2 }) {
  if (!settings?.isEnabled) return [];
  const drills = new Map();
  for (const drill of library) {
    if (!drills.has(drill.id)) drills.set(drill.id, drill);
  }
  const currentWeek = startOfWeek(now);
  const list = [];

  // Diese Woche stehen die Vorschläge schon fest, mit Übungen und Bereichen.
  const currentPlan = plan && planCovers(plan.weekStart, now) ? plan : null;
  if (currentPlan) {
    for (const session of currentPlan.sessions) {
      if (session.drills.length === 0) continue;
      const day = startOfDay(session.date);
      const fire = fireDate(day, settings);
      if (!(fire > now)) continue;
      list.push({ id: identifier(day, session.slot.id), fireDate: fire, sessionStart: day, title: title(Boolean(session.tournament)), body: sessionBody(session, drills) });
    }
  }

  // Ohne Plan für diese Woche zählt sie wie die folgenden.
  const firstWeek = currentPlan ? 1 : 0;
  for (let offset = firstWeek; offset <= weeksAhead; offset += 1) {
    const weekStart = addDays(currentWeek, 7 * offset);
    for (const slot of slots) {
      const day = dayOfSlot(slot, weekStart);
      const fire = fireDate(day, settings);
      if (!(fire > now)) continue;
      const context = tournamentContext(day, tournaments);
      if (context && !rules(context.phase).trains) continue;
      list.push({ id: identifier(day, slot.id), fireDate: fire, sessionStart: day, title: title(Boolean(context)), body: slotBody(slot) });
    }
  }

  const unique = new Map();
  for (const reminder of list) {
    if (!unique.has(reminder.id)) unique.set(reminder.id, reminder);
  }
  return [...unique.values()]
    .sort((a, b) => a.fireDate - b.fireDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAXIMUM_COUNT);
}
