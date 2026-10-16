// Kalender der Startseite, wie Agenda im Kern
// (GolfCore/Sources/GolfCore/Planning/Agenda.swift): Golftage aus dem
// Wochenplan und der Golfwoche, Turniertage, Termine und Einheiten des
// Teams, eigene Termine, Runden und das Tagebuch werden zu Einträgen je Tag
// mit fertigen Texten. Dazu Woche und Monat als Raster und die Titel. Die
// Zeitzone ist die des Geräts, wie in der App. Die Vergleichsdaten in
// GolfCore/Tests/GolfCoreTests/Fixtures/web-agenda.json prüft
// test/agenda-parity.test.mjs.
import { totalMinutes } from "./calendar.js";
import { WEEKDAYS } from "./categories.js";
import { addDays, daysBetween, planCovers, startOfDay, startOfWeek } from "./dates.js";
import { isTeamDay, minutesOn } from "./golfweek.js";
import { EVENT_KIND_NAMES, dateOf, uid } from "./team.js";
import { PHASE_NAMES } from "./tournament.js";
import { KIND_NAMES, PLACE_NAMES, dayKey, isAutomatic } from "./traininglog.js";
import { appointmentEnd, appointmentTitle } from "./appointments.js";
import { countText, countdown, durationText } from "./texts.js";

/** Höchstens so viele Tage auf einmal, z. B. sechs Wochen eines Monats. */
export const MAXIMUM_DAYS = 400;
/** So lange vor einem Turnier steht der Countdown in Fahnenrot. */
export const ATTENTION_DAYS = 14;

/** Reihenfolge an einem Tag, wenn die Uhrzeit nicht entscheidet. */
const KIND_ORDER = { tournament: 0, golfDay: 1, teamDay: 2, coachSession: 3, teamEvent: 4, appointment: 5, round: 6, training: 7 };

export const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
/** Abkürzungen wie im Duden; kurze Monate bleiben ganz. */
export const SHORT_MONTH_NAMES = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
export const SHORT_WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
export function isoWeekday(date) {
  return ((date.getDay() + 6) % 7) + 1;
}

function makeItem({ id, kind, day, time = null, title, detail, status = "", tone = "plain", mark = "planned", isTournamentDay = false, reference = "" }) {
  return { id, kind, day, time, title, detail, status, tone, mark, isTournamentDay, reference };
}

const eventEndOf = (event, start) => new Date(start.getTime() + (Number(event.minutes) || 0) * 60000);

/**
 * Stand eines Teamtermins aus deiner Antwort und der Anwesenheit laut
 * Trainer: [Text, Ton, Kästchen]. Ohne Kästchen (null) z. B. bei einer Absage.
 */
export function eventStatus(event, team, now) {
  if (event.isCancelled === true) return ["Fällt aus", "muted", null];
  const id = uid(event.id);
  const answer = team.responses.get(id);
  const start = dateOf(event.start);
  if (start && eventEndOf(event, start) <= now) {
    switch (team.attendance.get(id)) {
      case "present":
        return ["Dabei", "muted", "done"];
      case "excused":
        return ["Entschuldigt", "muted", null];
      case "absent":
        return ["Gefehlt", "muted", null];
      default:
        if (answer === "yes") return ["Zugesagt", "muted", "done"];
        if (answer === "no") return ["Abgesagt", "muted", null];
        return ["", "plain", "planned"];
    }
  }
  if (answer === "yes") return ["Zugesagt", "muted", "planned"];
  if (answer === "maybe") return ["Vielleicht", "muted", "planned"];
  if (answer === "no") return ["Abgesagt", "muted", null];
  return event.asksForResponse === true && team.answersEvents ? ["Offen", "attention", "planned"] : ["", "plain", "planned"];
}

/** Tag, dann Einträge ohne Uhrzeit, dann nach Uhrzeit, dann nach Art und Kennung. */
export function orderItems(left, right) {
  if (left.day.getTime() !== right.day.getTime()) return left.day - right.day;
  if (left.time == null && right.time != null) return -1;
  if (left.time != null && right.time == null) return 1;
  if (left.time != null && right.time != null && left.time.getTime() !== right.time.getTime()) return left.time - right.time;
  if (KIND_ORDER[left.kind] !== KIND_ORDER[right.kind]) return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Die Tagesanfänge von `start` bis vor `end`, höchstens `MAXIMUM_DAYS`. */
export function dayList(start, end) {
  const days = [];
  let day = startOfDay(start);
  while (day < end && days.length < MAXIMUM_DAYS) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

/**
 * Alle Einträge von `from` (einschließlich) bis `to` (ausschließlich), nach
 * Tag sortiert. `sources`: golfWeek, weekPlan, planProgress (Map Kennung der
 * Einheit → { done, total }), tournaments, rounds, trainingLog (mit den
 * Übungen aus dem Plan), appointments und team (`agendaTeam` oder null).
 */
export function agendaItems({ from, to, sources, now }) {
  const days = dayList(from, to);
  if (days.length === 0) return [];
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const today = startOfDay(now);
  const inRange = (day) => day >= firstDay && day <= lastDay;
  const items = [];

  // Turniere: jeder Turniertag.
  const tournamentDays = new Set();
  for (const tournament of sources.tournaments ?? []) {
    const firstTournamentDay = startOfDay(tournament.start);
    const count = Math.max(1, tournament.days);
    for (let index = 0; index < count; index += 1) {
      const day = addDays(firstTournamentDay, index);
      tournamentDays.add(day.getTime());
      if (!inRange(day)) continue;
      const daysUntil = daysBetween(today, day);
      const detail = ["Turnier"];
      if (count > 1) detail.push(`Tag ${index + 1} von ${count}`);
      if (tournament.course) detail.push(tournament.course);
      const status = day.getTime() === today.getTime() ? "heute" : index === 0 && day > today ? countdown(daysUntil, count) : "";
      const name = tournament.name.trim();
      items.push(makeItem({
        id: `turnier-${tournament.id}-${index}`,
        kind: "tournament",
        day,
        time: index === 0 ? tournament.start : null,
        title: name || "Turnier",
        detail: detail.join(" · "),
        status,
        tone: status && daysUntil <= ATTENTION_DAYS ? "attention" : "plain",
        mark: day < today ? "done" : "planned",
        isTournamentDay: true,
        reference: tournament.id,
      }));
    }
  }

  // Golftage aus dem Wochenplan, für andere Wochen aus der Golfwoche.
  const plan = sources.weekPlan ?? null;
  const planDays = new Set();
  for (const session of plan?.sessions ?? []) {
    const day = startOfDay(session.date);
    planDays.add(day.getTime());
    if (!inRange(day)) continue;
    const progress = sources.planProgress?.get(session.slot.id) ?? { done: 0, total: session.drills.length };
    let detail = durationText(totalMinutes(session));
    if (session.tournament) detail += ` · ${PHASE_NAMES[session.tournament.phase] ?? ""}`;
    items.push(makeItem({
      id: `golftag-${session.slot.id}-${dayKey(day)}`,
      kind: "golfDay",
      day,
      title: "Golftag",
      detail,
      status: day > today ? countText(progress.total, "Übung", "Übungen") : `${progress.done} von ${progress.total}`,
      mark: progress.done > 0 ? "done" : "planned",
      reference: session.slot.id,
    }));
  }
  // Ein Training des Teams an dem Tag, auch ein abgesagtes, ersetzt den Platzhalter aus der Golfwoche.
  const teamTrainingDays = new Set(
    (sources.team?.events ?? [])
      .filter((event) => event.kind === "training")
      .map((event) => dateOf(event.start))
      .filter(Boolean)
      .map((start) => startOfDay(start).getTime()),
  );
  const week = sources.golfWeek ?? null;
  if (week) {
    for (const day of days) {
      if (day < today) continue;
      const weekday = isoWeekday(day);
      const coveredByPlan = plan ? planCovers(plan.weekStart, day) : false;
      const minutes = minutesOn(week, weekday);
      if (!coveredByPlan && !tournamentDays.has(day.getTime()) && minutes != null) {
        items.push(makeItem({
          id: `golftag-${weekday}-${dayKey(day)}`,
          kind: "golfDay",
          day,
          title: "Golftag",
          detail: durationText(minutes),
          status: "Vorschläge zum Wochenbeginn",
          tone: "muted",
        }));
      }
      if (isTeamDay(week, weekday) && !teamTrainingDays.has(day.getTime()) && !tournamentDays.has(day.getTime())) {
        items.push(makeItem({ id: `teamtag-${dayKey(day)}`, kind: "teamDay", day, title: "Teamtraining", detail: "Plant dein Trainer", tone: "muted" }));
      }
    }
  }

  const team = sources.team ?? null;
  if (team) {
    // Einheiten vom Trainer: am Tag der Frist, ohne Frist am ersten Tag.
    for (const entry of team.sessions) {
      const session = entry.session;
      const date = dateOf(session.due ?? session.start ?? session.createdAt);
      if (!date) continue;
      const day = startOfDay(date);
      if (!inRange(day)) continue;
      let status = `${entry.done} von ${entry.total}`;
      let tone = "plain";
      if (entry.state === "done") [status, tone] = ["Erledigt", "muted"];
      else if (entry.state === "upcoming") [status, tone] = ["Kommt noch", "muted"];
      else if (entry.state === "overdue") tone = "attention";
      const title = String(session.title ?? "").trim();
      items.push(makeItem({
        id: `einheit-${uid(session.id)}`,
        kind: "coachSession",
        day,
        title: title || "Einheit vom Trainer",
        detail: session.due == null ? "Einheit vom Trainer · ohne Frist" : "Einheit vom Trainer · Frist",
        status,
        tone,
        mark: entry.state === "done" ? "done" : "planned",
        reference: uid(session.id),
      }));
    }

    // Termine des Teams.
    for (const event of team.events) {
      const start = dateOf(event.start);
      if (!start) continue;
      const day = startOfDay(start);
      if (!inRange(day)) continue;
      const [status, tone, mark] = eventStatus(event, team, now);
      const title = String(event.title ?? "").trim();
      const kindName = EVENT_KIND_NAMES[event.kind] ?? "Termin";
      const detail = [];
      // Die Art nur, wenn der Titel sie nicht schon sagt: Ein Training heißt meist so.
      if (title && title !== kindName && event.kind !== "training") detail.push(kindName);
      if (event.place) detail.push(event.place);
      if (Number(event.minutes) > 0) detail.push(durationText(Number(event.minutes)));
      items.push(makeItem({
        id: `termin-${uid(event.id)}`,
        kind: "teamEvent",
        day,
        time: start,
        title: title || (event.kind === "training" ? "Teamtraining" : kindName),
        detail: detail.join(" · "),
        status,
        tone,
        mark,
        reference: uid(event.id),
      }));
    }
  }

  // Eigene Termine.
  const loggedByAppointment = new Set();
  for (const appointment of sources.appointments ?? []) {
    if (appointment.trainingEntryID != null) loggedByAppointment.add(appointment.trainingEntryID);
    const day = startOfDay(appointment.start);
    if (!inRange(day)) continue;
    const detail = ["Eigener Termin"];
    if (appointment.place) detail.push(appointment.place);
    detail.push(durationText(appointment.minutes));
    let state = ["Geplant", "muted", "planned"];
    if (appointment.trainingEntryID != null) state = ["Im Tagebuch", "muted", "done"];
    else if (appointmentEnd(appointment) <= now) state = ["Ins Tagebuch", "plain", "planned"];
    items.push(makeItem({
      id: `eigener-${appointment.id}`,
      kind: "appointment",
      day,
      time: appointment.start,
      title: appointmentTitle(appointment),
      detail: detail.join(" · "),
      status: state[0],
      tone: state[1],
      mark: state[2],
      reference: appointment.id,
    }));
  }

  // Runden.
  for (const round of sources.rounds ?? []) {
    const day = startOfDay(round.date);
    if (!inRange(day)) continue;
    const course = round.course.trim();
    items.push(makeItem({
      id: `runde-${round.id}`,
      kind: "round",
      day,
      title: "Runde",
      detail: course || "Auf dem Platz",
      status: round.score != null ? countText(round.score, "Schlag", "Schläge") : "",
      mark: day <= today ? "done" : "planned",
      reference: round.id,
    }));
  }

  // Tagebuch: ohne die Tage aus dem Plan, die als Golftag dastehen, und ohne
  // Einträge, die ein eigener Termin schon zeigt.
  for (const entry of sources.trainingLog ?? []) {
    const day = startOfDay(entry.start);
    if (!inRange(day) || loggedByAppointment.has(entry.id)) continue;
    const automatic = isAutomatic(entry);
    if (automatic && planDays.has(day.getTime())) continue;
    const detail = [durationText(entry.minutes)];
    if (entry.place) detail.push(PLACE_NAMES[entry.place] ?? entry.place);
    if (entry.id.startsWith("platz-")) detail.push("am Golfplatz erkannt");
    items.push(makeItem({
      id: `training-${entry.id}`,
      kind: "training",
      day,
      time: automatic ? null : entry.start,
      title: KIND_NAMES[entry.kind] ?? "Training",
      detail: detail.join(" · "),
      tone: "muted",
      mark: entry.start <= now ? "done" : "planned",
      reference: entry.id,
    }));
  }

  return items.sort(orderItems);
}

/** Kästchen je Tag (Map Tagesanfang → { marks, isTournamentDay, count }): höchstens drei, erledigte zuerst. */
export function marksFor(items) {
  const result = new Map();
  for (const item of items) {
    const key = item.day.getTime();
    const marks = result.get(key) ?? { marks: [], isTournamentDay: false, count: 0 };
    marks.count += 1;
    if (item.isTournamentDay) marks.isTournamentDay = true;
    if (item.mark) marks.marks.push(item.mark);
    result.set(key, marks);
  }
  for (const marks of result.values()) {
    marks.marks = [...marks.marks.filter((mark) => mark === "done"), ...marks.marks.filter((mark) => mark === "planned")].slice(0, 3);
  }
  return result;
}

// MARK: - Raster

/** Die Woche von Montag bis Sonntag, in der `date` liegt. */
export function weekOf(date) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** Der Monat als Wochen von Montag bis Sonntag, mit den Tagen der Nachbarmonate am Anfang und am Ende. */
export function monthGrid(date) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const weeks = [];
  let weekStart = startOfWeek(monthStart);
  while (weekStart < monthEnd && weeks.length < 6) {
    weeks.push(weekOf(weekStart));
    weekStart = addDays(weekStart, 7);
  }
  return weeks;
}

// MARK: - Titel

/** „Oktober 2026“. */
export function monthTitle(date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** „Freitag, 16. Oktober“. */
export function dayTitle(date) {
  return `${WEEKDAYS[isoWeekday(date) - 1]}, ${date.getDate()}. ${MONTH_NAMES[date.getMonth()]}`;
}

/** Zeitraum einer Woche: „12. – 18. Oktober“, „28. Sept. – 4. Okt.“ oder über den Jahreswechsel „29. Dez. 2025 – 4. Jan. 2026“. */
export function rangeTitle(start, end) {
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()}. ${SHORT_MONTH_NAMES[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()}. ${SHORT_MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()}. ${SHORT_MONTH_NAMES[start.getMonth()]} – ${end.getDate()}. ${SHORT_MONTH_NAMES[end.getMonth()]}`;
  }
  return `${start.getDate()}. – ${end.getDate()}. ${MONTH_NAMES[end.getMonth()]}`;
}

/** „3. Mai“. */
export function dayMonthText(date) {
  return `${date.getDate()}. ${MONTH_NAMES[date.getMonth()]}`;
}

/** „So., 25. Okt.“, im Mai „So., 3. Mai“. */
export function shortDayText(date) {
  return `${SHORT_WEEKDAYS[isoWeekday(date) - 1]}., ${date.getDate()}. ${SHORT_MONTH_NAMES[date.getMonth()]}`;
}

/** „11. Oktober 2026“. */
export function longDateText(date) {
  return `${dayMonthText(date)} ${date.getFullYear()}`;
}

/** Kalenderwoche nach ISO 8601. */
export function weekNumber(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
}

/** Unter dem Datum auf der Startseite: „KW 42 · noch 2 Golftage diese Woche“, gezählt ab heute bis Sonntag. */
export function weekLine(items, now) {
  const today = startOfDay(now);
  const end = addDays(startOfWeek(now), 7);
  const golfDays = new Set(items.filter((item) => item.kind === "golfDay" && item.day >= today && item.day < end).map((item) => item.day.getTime())).size;
  const week = `KW ${weekNumber(now)}`;
  if (golfDays === 0) return week;
  if (golfDays === 1) return `${week} · noch 1 Golftag diese Woche`;
  return `${week} · noch ${golfDays} Golftage diese Woche`;
}
