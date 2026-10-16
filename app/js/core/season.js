// Überblick der Saison oben auf der Startseite: Handicap, Golftage, Runden,
// Trainingszeit und Serie im laufenden Jahr, dazu das nächste Turnier, wie
// SeasonOverview im Kern (GolfCore/Sources/GolfCore/Planning/SeasonOverview.swift).
import { addDays, daysBetween, startOfDay, startOfWeek } from "./dates.js";
import { countText } from "./texts.js";
import { dailyMinutes } from "./teamshare.js";
import { dateOf } from "./team.js";
import { dayMonthText } from "./agenda.js";
import { handicapAt, handicapChange, handicapChangeText, handicapPoints } from "./handicap.js";

// MARK: - Überblick

/**
 * Teamtermine, bei denen du dabei warst: laut Trainer da, oder ohne Eintrag
 * des Trainers mit deiner Zusage, sobald der Termin vorbei ist. Nur Termine,
 * die als Training zählen. `team` wie für den Kalender (`agendaTeam`).
 */
export function attendedEvents(team, now) {
  if (!team) return [];
  return team.events.filter((event) => {
    const start = dateOf(event.start);
    if (!start || event.isCancelled === true || !countsAsTraining(event.kind) || start > now) return false;
    const status = team.attendance.get(event.id);
    if (status === "present") return true;
    if (status === "excused" || status === "absent") return false;
    const end = new Date(start.getTime() + (Number(event.minutes) || 0) * 60000);
    return team.responses.get(event.id) === "yes" && end <= now;
  });
}

const countsAsTraining = (kind) => kind !== "meeting" && kind !== "other";

/** Das nächste Turnier mit den Tagen bis zum Beginn, auch wenn es gerade läuft. */
export function nextTournament(tournaments, now) {
  let best = null;
  for (const tournament of tournaments) {
    const daysUntil = daysBetween(now, tournament.start);
    if (daysUntil <= -Math.max(1, tournament.days)) continue;
    if (best) {
      const earlier = tournament.start < best.tournament.start;
      const tie = tournament.start.getTime() === best.tournament.start.getTime() && tournament.id < best.tournament.id;
      if (!earlier && !tie) continue;
    }
    best = { tournament, daysUntil };
  }
  return best;
}

/**
 * Wochen in Folge mit mindestens einem Trainingstag, von der laufenden Woche
 * rückwärts. Hat die laufende Woche noch kein Training, beginnt die Serie in
 * der Woche davor. `trainingDays`: Tagesanfänge als Zahl (getTime).
 */
export function streakWeeks(trainingDays, now) {
  const days = [...trainingDays];
  if (days.length === 0) return 0;
  const hasTraining = (start) => {
    const end = addDays(start, 7).getTime();
    return days.some((day) => day >= start.getTime() && day < end && day <= now.getTime());
  };
  let weekStart = startOfWeek(now);
  if (!hasTraining(weekStart)) weekStart = addDays(weekStart, -7);
  const earliest = startOfWeek(new Date(Math.min(...days)));
  let count = 0;
  while (hasTraining(weekStart)) {
    count += 1;
    const previous = addDays(weekStart, -7);
    if (previous < earliest) break;
    weekStart = previous;
  }
  return count;
}

/**
 * Handicap, Golftage, Runden, Trainingszeit und Serie im laufenden Jahr,
 * dazu das nächste Turnier. Golftage zählen Training (ohne Athletik),
 * Runden, Turniertage und Teamtermine, bei denen du dabei warst.
 */
export function seasonOverview({ handicaps, trainingLog, attendedEvents: events, rounds, tournaments, now }) {
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const today = startOfDay(now);
  const pastLog = trainingLog.filter((entry) => entry.start <= now);
  const pastEvents = events.filter((event) => (dateOf(event.start) ?? now) <= now);
  const yearLog = pastLog.filter((entry) => entry.start >= yearStart);
  const yearEvents = pastEvents.filter((event) => dateOf(event.start) >= yearStart);

  const golfDays = new Set();
  for (const [day, minutes] of dailyMinutes(yearLog.filter((entry) => entry.kind !== "fitness"), yearEvents)) {
    if (minutes > 0) golfDays.add(day);
  }
  const yearRounds = rounds.filter((round) => round.date >= yearStart && round.date <= now);
  for (const round of yearRounds) golfDays.add(startOfDay(round.date).getTime());
  for (const tournament of tournaments) {
    const first = startOfDay(tournament.start);
    for (let index = 0; index < Math.max(1, tournament.days); index += 1) {
      const day = addDays(first, index);
      if (day >= yearStart && day <= today) golfDays.add(day.getTime());
    }
  }

  let trainingMinutes = 0;
  for (const minutes of dailyMinutes(yearLog, yearEvents).values()) trainingMinutes += minutes;
  const trainingDays = [...dailyMinutes(pastLog, pastEvents)].filter(([, minutes]) => minutes > 0).map(([day]) => day);
  const upcoming = nextTournament(tournaments, now);
  const change = handicapChange(yearStart, handicaps, now);

  return {
    year,
    handicap: handicapAt(now, handicaps),
    handicapChange: change?.delta ?? null,
    handicapChangeSince: change ? new Date(Math.max(change.reference.date.getTime(), yearStart.getTime())) : null,
    handicapPoints: handicapPoints(yearStart, handicaps, now),
    golfDays: golfDays.size,
    rounds: yearRounds.length,
    trainingMinutes,
    streakWeeks: streakWeeks(trainingDays, now),
    nextTournamentID: upcoming?.tournament.id ?? null,
    daysUntilNextTournament: upcoming?.daysUntil ?? null,
  };
}

/** Trainingszeit in ganzen Stunden: „112 Std.“, unter einer Stunde „45 Min.“. */
export function hoursText(minutes) {
  return minutes < 60 ? `${Math.max(0, minutes)} Min.` : `${Math.floor((minutes + 30) / 60)} Std.`;
}

/** „9 Wochen“, „1 Woche“. */
export function weeksText(count) {
  return countText(count, "Woche", "Wochen");
}

/**
 * Unter dem Handicap: „−1,6 seit Januar“, „−0,4 seit 3. Mai“. Mit nur einem
 * Eintrag „seit 11. Oktober“ oder „seit heute“. Leer ohne Handicap.
 */
export function handicapDetail(overview, now) {
  const handicap = overview.handicap;
  if (!handicap) return "";
  if (overview.handicapChange != null && overview.handicapChangeSince) {
    const since = overview.handicapChangeSince;
    const isYearStart = since.getMonth() === 0 && since.getDate() === 1;
    return `${handicapChangeText(overview.handicapChange)} seit ${isYearStart ? "Januar" : dayMonthText(since)}`;
  }
  if (startOfDay(handicap.date).getTime() === startOfDay(now).getTime()) return "seit heute";
  return `seit ${dayMonthText(handicap.date)}`;
}
