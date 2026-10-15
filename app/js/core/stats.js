// Persönliche Auswertung wie TrainingStatsBuilder im Kern der App
// (GolfCore/Sources/GolfCore/Planning/TrainingStats.swift), mit den
// Tagesminuten aus TeamAnalytics: Zeit pro Woche, Serie in Wochen, Bereiche
// der letzten 28 Tage und Monatstests. Alles aus dem Tagebuch und den
// Ergebnissen auf diesem Gerät.
import { addDays, startOfDay, startOfWeek } from "./dates.js";
import { normalizedScoring } from "./scoring.js";

/** Ein Tag hat höchstens 1 440 Minuten, wie DataLimits.dayMinutes. */
const DAY_MINUTES = 24 * 60;

const addWeeks = (date, weeks) => addDays(date, 7 * weeks);

/**
 * Minuten pro Tag (0 Uhr) aus dem Tagebuch, wie TeamAnalytics.dailyMinutes
 * ohne Teamtermine. Map: Tag als Zahl → Minuten.
 */
export function dailyMinutes(logs) {
  const minutes = new Map();
  for (const entry of logs) {
    if (!(entry.minutes > 0)) continue;
    const day = startOfDay(entry.start).getTime();
    minutes.set(day, (minutes.get(day) ?? 0) + Math.min(entry.minutes, DAY_MINUTES));
  }
  return minutes;
}

/** Minuten pro Bereich über mehrere Einträge, wie TeamAnalytics.areaMinutes. */
export function areaMinutes(logs) {
  const total = {};
  for (const entry of logs) {
    for (const [area, minutes] of Object.entries(entry.areaMinutes)) total[area] = (total[area] ?? 0) + minutes;
  }
  return total;
}

function minutesIn(daily, start, end) {
  let minutes = 0;
  let days = 0;
  for (const [day, value] of daily) {
    if (day >= start.getTime() && day < end.getTime() && value > 0) {
      minutes += value;
      days += 1;
    }
  }
  return { minutes, days };
}

/**
 * Pro Monatstest das jüngste Ergebnis und die Veränderung zum vorigen.
 * `improvement` ist positiv, wenn es besser wurde, auch beim Par-Spiel mit
 * weniger Schlägen. Der jüngste Test zuerst.
 */
export function benchmarks(results, library, now) {
  const byDrill = new Map();
  for (const result of results) {
    if (result.date > now) continue;
    if (!byDrill.has(result.drillID)) byDrill.set(result.drillID, []);
    byDrill.get(result.drillID).push(result);
  }
  return library
    .filter((drill) => drill.isBenchmark && normalizedScoring(drill.scoring).kind !== "none")
    .map((drill) => {
      const sorted = [...(byDrill.get(drill.id) ?? [])].sort((a, b) => b.date - a.date);
      if (sorted.length === 0) return null;
      const latest = sorted[0];
      const previous = sorted[1] ?? null;
      const difference = previous ? latest.score - previous.score : null;
      const improvement = difference == null ? null : normalizedScoring(drill.scoring).kind === "strokes" ? -difference : difference;
      return { drill, latest, previous, improvement };
    })
    .filter(Boolean)
    .sort((a, b) => b.latest.date - a.latest.date);
}

/**
 * Die Auswertung: { weeks: [{ weekStart, minutes, trainingDays }] (älteste
 * zuerst, die laufende am Ende), averageMinutesPerWeek (letzte vier
 * abgeschlossene Wochen), streakWeeks, areaMinutes und Minuten sowie
 * Trainingstage der letzten 28 Tage, benchmarks }.
 */
export function stats({ log, results, library, now, weeks: count = 12 }) {
  const past = log.filter((entry) => entry.start <= now);
  const daily = dailyMinutes(past);
  const thisWeek = startOfWeek(now);

  const weeks = [];
  for (let offset = Math.max(1, count) - 1; offset >= 0; offset -= 1) {
    const start = addWeeks(thisWeek, -offset);
    const { minutes, days } = minutesIn(daily, start, addWeeks(start, 1));
    weeks.push({ weekStart: start, minutes, trainingDays: days });
  }

  const completed = weeks.slice(0, -1).slice(-4);
  const average = completed.length === 0 ? 0 : Math.floor(completed.reduce((sum, week) => sum + week.minutes, 0) / completed.length);

  // Serie: ab der laufenden Woche rückwärts, solange jede Woche Training hat.
  // Die laufende Woche ohne Training unterbricht die Serie noch nicht.
  let streak = 0;
  const reversed = [...weeks].reverse();
  if (reversed[0]?.trainingDays === 0) reversed.shift();
  for (const week of reversed) {
    if (!(week.trainingDays > 0)) break;
    streak += 1;
  }
  // Reicht die Serie über den betrachteten Zeitraum hinaus, weiter zurückzählen.
  if (reversed.length > 0 && streak === reversed.length) {
    let start = reversed[reversed.length - 1].weekStart;
    for (;;) {
      const previous = addWeeks(start, -1);
      if (minutesIn(daily, previous, addWeeks(previous, 1)).days === 0) break;
      streak += 1;
      start = previous;
    }
  }

  // Die letzten 28 Tage einschließlich heute: heute und die 27 Tage davor.
  const firstRecentDay = addDays(startOfDay(now), -27);
  const recent = past.filter((entry) => entry.start >= firstRecentDay);
  const last28 = minutesIn(daily, firstRecentDay, new Date(8640000000000000));

  return {
    weeks,
    averageMinutesPerWeek: average,
    streakWeeks: streak,
    areaMinutes: areaMinutes(recent),
    minutesLast28Days: last28.minutes,
    trainingDaysLast28Days: last28.days,
    benchmarks: benchmarks(results, library, now),
  };
}
