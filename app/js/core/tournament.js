// Turnierphasen, wie TournamentPrep in der App (docs/TURNIERVORBEREITUNG.md).
import { AREAS } from "./categories.js";
import { daysBetween } from "./dates.js";
import { normalized } from "./weighting.js";

export const PHASE_NAMES = {
  weekOut: "Eine Woche vorher",
  halfWeek: "Halbe Woche vorher",
  dayBefore: "Vortag",
  tournamentDay: "Turniertag",
};

/** Zwei Drittel kurzes Spiel, ein Drittel langes Spiel. */
export const TOURNAMENT_WEIGHTS = {
  driving: 0.1,
  approach: 0.12,
  wedges: 0.12,
  shortGame: 0.25,
  bunker: 0.08,
  putting: 0.33,
};

export const BLEND = 0.7;

/** Leichtes Programm am Vortag. */
export const DAY_BEFORE_WEIGHTS = { putting: 0.4, shortGame: 0.3, approach: 0.3 };

/** Am Vortag ein Bereich pro volle 15 Minuten. */
export const DAY_BEFORE_MINUTES_PER_AREA = 15;

export function rules(phase) {
  switch (phase) {
    case "weekOut":
      return { maxSessionMinutes: null, modes: ["variable", "competition"], trains: true };
    case "halfWeek":
      return { maxSessionMinutes: 150, modes: ["variable", "competition"], trains: true };
    case "dayBefore":
      return { maxSessionMinutes: 120, modes: ["variable", "competition"], trains: true };
    default:
      return { maxSessionMinutes: null, modes: [], trains: false };
  }
}

/** Phase nach den Tagen bis zum ersten Turniertag, null außerhalb der Vorbereitung. */
export function phase(daysUntil, tournamentDays = 1) {
  if (daysUntil >= 4 && daysUntil <= 7) return "weekOut";
  if (daysUntil >= 2 && daysUntil <= 3) return "halfWeek";
  if (daysUntil === 1) return "dayBefore";
  if (daysUntil <= 0 && daysUntil >= 1 - Math.max(1, tournamentDays)) return "tournamentDay";
  return null;
}

/** Das Turnier, auf das sich ein Tag vorbereitet. Bei mehreren das nächste. */
export function context(date, tournaments) {
  let best = null;
  for (const tournament of tournaments) {
    const daysUntil = daysBetween(date, tournament.start);
    const current = phase(daysUntil, tournament.days);
    if (!current) continue;
    if (!best || daysUntil < best.daysUntil) {
      best = { tournamentID: tournament.id, name: tournament.name, phase: current, daysUntil };
    }
  }
  return best;
}

/** Normale Gewichte mit den Turniergewichten gemischt. */
export function blendedWeights(normal) {
  const result = {};
  for (const area of AREAS) {
    result[area] = (1 - BLEND) * (normal[area] ?? 0) + BLEND * (TOURNAMENT_WEIGHTS[area] ?? 0);
  }
  return normalized(result);
}

/** Einspielplan mit Uhrzeiten, rückwärts von der Startzeit. */
export function warmUpSchedule(guide, teeTime) {
  return [...guide.warmUp]
    .sort((a, b) => b.minutesBefore - a.minutesBefore)
    .map((step) => ({ start: new Date(teeTime.getTime() - step.minutesBefore * 60000), step }));
}
