// Was ein Spieler mit dem Team teilt und was das Team daraus rechnet, wie
// TrainingLogBuilder.publicStats/snapshot, SessionProgress und
// TeamAnalytics.leaderboard im Kern der App. Reine Funktionen; die Zeitzone
// ist die des Geräts, wie in der App.
import { addDays, startOfDay, toStored } from "./dates.js";
import { loggedDrill, streak } from "./traininglog.js";
import { dateOf, sameID, stamp, uid } from "./team.js";

const DAY_MINUTES = 24 * 60;

/** Zum Beispiel „2026-10“. */
export function monthKey(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
}

const clampMinutes = (value) => Math.min(DAY_MINUTES, Math.max(0, Number(value) || 0));

/** Zählt als Training, wenn man dabei war. */
export const countsAsTraining = (kind) => kind !== "meeting" && kind !== "other";

/** Wie viel eines Termins eigene Einträge abdecken, Überschneidungen nur einmal, in Sekunden. */
export function coveredSeconds(eventStart, eventEnd, logs) {
  const parts = logs
    .map((entry) => ({ start: Math.max(entry.start.getTime(), eventStart.getTime()), end: Math.min(entry.start.getTime() + entry.minutes * 60000, eventEnd.getTime()) }))
    .filter((part) => part.start < part.end)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let current = null;
  for (const part of parts) {
    if (current && part.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, part.end) };
    } else {
      if (current) covered += current.end - current.start;
      current = part;
    }
  }
  if (current) covered += current.end - current.start;
  return covered / 1000;
}

/**
 * Minuten pro Tag (0 Uhr, als Zahl) aus dem Tagebuch (dekodierte Einträge mit
 * Date-Objekten) und besuchten Teamterminen (Einträge des Teams). Was während
 * eines Termins selbst eingetragen ist, zählt nur einmal.
 */
export function dailyMinutes(logs, attendedEvents) {
  const minutes = new Map();
  const add = (day, value) => minutes.set(day, (minutes.get(day) ?? 0) + value);
  for (const entry of logs) {
    if (entry.minutes > 0) add(startOfDay(entry.start).getTime(), clampMinutes(entry.minutes));
  }
  for (const event of attendedEvents) {
    if (!countsAsTraining(event.kind) || event.isCancelled === true || !(Number(event.minutes) > 0)) continue;
    const start = dateOf(event.start);
    if (!start) continue;
    const end = new Date(start.getTime() + Number(event.minutes) * 60000);
    const seconds = (end.getTime() - start.getTime()) / 1000 - coveredSeconds(start, end, logs);
    const rest = Math.round(Math.min(Math.max(seconds / 60, 0), DAY_MINUTES));
    if (rest > 0) add(startOfDay(start).getTime(), rest);
  }
  return minutes;
}

/** Termine, bei denen der Spieler laut Trainer da war und die schon begonnen haben. */
export function attendedEvents(memberID, data, now = null) {
  const limit = now ? toStored(now) : Infinity;
  return data
    .values("attendance")
    .filter((record) => sameID(record.memberID, memberID) && record.status === "present")
    .map((record) => data.event(record.eventID))
    .filter((event) => event && event.isCancelled !== true && stamp(event.start) <= limit);
}

/** Bestes Ergebnis, bei Par-Spielen das niedrigste. */
function best(scores, lowerIsBetter) {
  if (scores.length === 0) return null;
  return lowerIsBetter ? Math.min(...scores) : Math.max(...scores);
}

/**
 * Werte für die Ranglisten aus Tagebuch und besuchten Teamterminen, als
 * Eintrag für das Team: Minuten und Tage der letzten sechs Monate, Serie,
 * Monatstests und Challenges.
 */
export function publicStats({ memberID, logs, attendedEvents: events = [], challenges = [], now, months = 6 }) {
  const daily = dailyMinutes(logs, events);
  const firstMonth = addMonths(startOfMonth(now), -(months - 1)).getTime();
  const limit = now.getTime();
  const monthly = {};
  for (const [day, minutes] of daily) {
    if (minutes <= 0 || day < firstMonth || day > limit) continue;
    const key = monthKey(new Date(day));
    monthly[key] = monthly[key] ?? { minutes: 0, days: 0 };
    monthly[key].minutes += minutes;
    monthly[key].days += 1;
  }
  const drills = logs.flatMap((entry) => entry.drills).filter((drill) => drill.score != null);
  const benchmarks = {};
  for (const drill of drills) {
    if (!drill.isBenchmark) continue;
    const month = startOfMonth(drill.date).getTime();
    if (month < firstMonth) continue;
    const key = monthKey(new Date(month));
    const current = benchmarks[drill.drillID]?.[key];
    const value = best(current == null ? [drill.score] : [current, drill.score], drill.lowerIsBetter);
    benchmarks[drill.drillID] = benchmarks[drill.drillID] ?? {};
    benchmarks[drill.drillID][key] = value;
  }
  const challengeScores = {};
  for (const challenge of challenges) {
    const start = stamp(challenge.start);
    const end = stamp(challenge.end);
    const inWindow = drills.filter((drill) => drill.drillID === challenge.drillID && toStored(drill.date) >= start && toStored(drill.date) <= end);
    if (inWindow.length === 0) continue;
    const value = best(
      inWindow.map((drill) => drill.score),
      inWindow[0].lowerIsBetter,
    );
    if (value != null) challengeScores[uid(challenge.id)] = value;
  }
  const days = new Set([...daily].filter(([day, minutes]) => minutes > 0 && day <= limit).map(([day]) => day));
  const stats = {
    memberID: uid(memberID),
    months: monthly,
    currentStreak: streak(days, now),
    benchmarks,
    challenges: challengeScores,
    updatedAt: toStored(now),
  };
  if (days.size > 0) stats.lastTrainingDay = toStored(new Date(Math.max(...days)));
  return stats;
}

/** Ein Turnier über mehrere Tage zählt bis zu seinem letzten Tag. */
function isUpcomingTournament(tournament, now) {
  return startOfDay(addDays(tournament.start, Math.max(1, tournament.days) - 1)) >= startOfDay(now);
}

/** Stand für den Trainer: Wochenplan, laufendes oder nächstes Turnier und Weiten, als Eintrag für das Team. */
export function snapshot({ memberID, plan, results, tournaments, distances, now }) {
  let planned = 0;
  let done = 0;
  let plannedMinutes = 0;
  if (plan) {
    for (const session of plan.sessions) {
      for (const drill of session.drills) {
        planned += 1;
        plannedMinutes += drill.minutes;
        const isDone = results.some(
          (result) =>
            result.drillID === drill.drillID && result.planReference && result.planReference.slotID === session.slot.id && result.planReference.weekStart.getTime() === plan.weekStart.getTime(),
        );
        if (isDone) done += 1;
      }
    }
  }
  const next = tournaments.filter((tournament) => isUpcomingTournament(tournament, now)).sort((a, b) => a.start - b.start)[0] ?? null;
  const result = { memberID: uid(memberID), plannedDrills: planned, doneDrills: done, plannedMinutes, distances: { ...distances }, updatedAt: toStored(now) };
  if (plan) result.weekStart = toStored(plan.weekStart);
  if (next) {
    result.nextTournament = next.name;
    result.nextTournamentDate = toStored(next.start);
  }
  return result;
}

// MARK: - Einheiten vom Trainer

// Stand und Dauer einer Einheit liegen in team.js, hier nur weitergereicht.
export { SESSION_STATE_NAMES, sessionState, sessionTotalMinutes } from "./team.js";

/**
 * Aus den eigenen Ergebnissen: je Übung der Einheit das letzte Ergebnis, das
 * in dieser Einheit eingetragen wurde, als Eintrag für das Team (Zeitpunkte
 * als Sekunden seit 2001). Die Übungen bekommen die Minuten der Einheit.
 */
export function makeProgress({ session, results, library, includeScores, now }) {
  const drills = new Map();
  for (const drill of library) if (!drills.has(drill.id)) drills.set(drill.id, drill);
  const mine = results.filter((result) => result.sessionID != null && sameID(result.sessionID, session.id));
  const done = [];
  for (const item of Array.isArray(session.drills) ? session.drills : []) {
    const drill = drills.get(item.drillID);
    if (!drill) continue;
    const latest = mine.filter((result) => result.drillID === item.drillID).sort((a, b) => a.date - b.date).pop();
    if (!latest) continue;
    const logged = loggedDrill(latest, drill, includeScores);
    logged.minutes = Number.isInteger(item.minutes) ? item.minutes : 15;
    done.push(encodeLoggedDrill(logged));
  }
  return { sessionID: uid(session.id), memberID: uid(session.memberID), done, updatedAt: toStored(now) };
}

/** Behält, was schon im Team steht und hier fehlt, z. B. nach einem Gerätewechsel. Punkte nur, wenn sie geteilt werden. */
export function keepingProgress(progress, existing, session, includeScores) {
  if (!existing) return progress;
  const local = new Map(progress.done.map((drill) => [drill.drillID, drill]));
  const reported = new Map((Array.isArray(existing.done) ? existing.done : []).map((drill) => [drill.drillID, drill]));
  const done = [];
  for (const item of Array.isArray(session.drills) ? session.drills : []) {
    if (local.has(item.drillID)) {
      done.push(local.get(item.drillID));
      continue;
    }
    const entry = reported.get(item.drillID);
    if (!entry) continue;
    // Gemeldete Übungen bleiben, wie sie sind: Zeitpunkte als Sekunden seit 2001.
    const kept = { ...entry };
    if (!includeScores) {
      delete kept.score;
      delete kept.maxScore;
    }
    done.push(kept);
  }
  return { ...progress, done };
}

/** Eine erledigte Übung als Eintrag für das Team, mit Zeitpunkten als Sekunden seit 2001. */
export function encodeLoggedDrill(drill) {
  const json = {
    drillID: drill.drillID,
    name: drill.name,
    area: drill.area,
    minutes: drill.minutes,
    level: drill.level,
    isBenchmark: drill.isBenchmark,
    lowerIsBetter: drill.lowerIsBetter,
    date: drill.date instanceof Date ? toStored(drill.date) : drill.date,
  };
  if (drill.score != null) json.score = drill.score;
  if (drill.maxScore != null) json.maxScore = drill.maxScore;
  return json;
}

// MARK: - Ranglisten

/** Die Serie aus heutiger Sicht: ohne Training seit gestern ist sie vorbei. */
export function streakAt(stats, now) {
  const last = dateOf(stats.lastTrainingDay);
  if (!last) return 0;
  const yesterday = addDays(startOfDay(now), -1);
  return last >= yesterday ? Number(stats.currentStreak) || 0 : 0;
}

export function leaderboardUnit(kind) {
  switch (kind.type) {
    case "minutes":
      return "Min.";
    case "trainingDays":
      return "Tage";
    case "streak":
      return "Tage in Folge";
    default:
      return kind.lowerIsBetter ? "Schläge" : "Punkte";
  }
}

/**
 * Rangliste des Teams. `kind`: { type: "minutes" | "trainingDays", month },
 * { type: "streak" }, { type: "benchmark", drillID, month, lowerIsBetter } oder
 * { type: "challenge", id, lowerIsBetter }. Es zählen nur Spieler, die ihre
 * Werte teilen. Gleich gut heißt gleicher Platz: 1, 1, 3.
 */
export function leaderboard(kind, data, now = new Date()) {
  let players = data.activePlayers;
  if (kind.type === "challenge") {
    const group = data.challenge(kind.id)?.group ?? null;
    players = players.filter((player) => data.concerns(group, player.id));
  }
  const values = [];
  for (const player of players) {
    const stats = data.get(`stats.${uid(player.id)}`);
    if (!stats) continue;
    let value = null;
    switch (kind.type) {
      case "minutes":
        value = stats.months?.[kind.month]?.minutes ?? null;
        break;
      case "trainingDays":
        value = stats.months?.[kind.month]?.days ?? null;
        break;
      case "streak":
        value = streakAt(stats, now);
        break;
      case "benchmark":
        value = stats.benchmarks?.[kind.drillID]?.[kind.month] ?? null;
        break;
      case "challenge":
        value = stats.challenges?.[uid(kind.id)] ?? stats.challenges?.[String(kind.id).toLowerCase()] ?? null;
        break;
      default:
        break;
    }
    if (!Number.isFinite(value)) continue;
    if (["minutes", "trainingDays", "streak"].includes(kind.type) && value <= 0) continue;
    values.push({ member: player, value });
  }
  const lowerIsBetter = (kind.type === "benchmark" || kind.type === "challenge") && kind.lowerIsBetter === true;
  values.sort((a, b) => {
    if (a.value !== b.value) return lowerIsBetter ? a.value - b.value : b.value - a.value;
    return String(a.member.name).localeCompare(String(b.member.name), "de", { sensitivity: "base" });
  });
  const rows = [];
  values.forEach((entry, index) => {
    const rank = index > 0 && values[index - 1].value === entry.value ? rows[index - 1].rank : index + 1;
    rows.push({ rank, memberID: uid(entry.member.id), name: entry.member.name, value: entry.value });
  });
  return rows;
}
