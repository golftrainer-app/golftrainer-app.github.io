// Zeitanteile je Bereich, wie FocusWeighting in der App: Ausgangsverteilung
// nach Mark Broadie, bis zur Hälfte nach den verlorenen Schlägen der letzten
// Runden (Strokes Gained), dazu die Trainer-Schwerpunkte.
import { AREAS, AREA_CATEGORY, SG_CATEGORIES } from "./categories.js";

export const BASELINE = {
  driving: 0.2,
  approach: 0.25,
  wedges: 0.15,
  shortGame: 0.15,
  bunker: 0.05,
  putting: 0.2,
};

/** Anteil der Zeit, der höchstens nach Strokes Gained verteilt wird. */
export const STROKES_GAINED_INFLUENCE = 0.5;
/** Ab so vielen verlorenen Schlägen pro Runde wirkt Strokes Gained voll, darunter schwächer. */
export const STROKES_GAINED_FULL_EFFECT_LOSS = 2;
export const RECENT_ROUND_COUNT = 5;
export const FOCUS_BOOST_PER_PRIORITY = 0.05;

export function isComplete(strokesGained = {}) {
  return SG_CATEGORIES.every((category) => strokesGained[category] != null);
}

/** Durchschnitt der letzten Runden mit allen vier Werten, null ohne solche Runden. */
export function averageStrokesGained(rounds, limit = RECENT_ROUND_COUNT) {
  const recent = rounds
    .filter((round) => isComplete(round.strokesGained))
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
  if (recent.length === 0) return null;
  const average = {};
  for (const category of SG_CATEGORIES) {
    const values = recent.map((round) => round.strokesGained[category]).filter((value) => value != null);
    average[category] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return average;
}

export function weights(rounds, focus) {
  const result = { ...BASELINE };
  const average = averageStrokesGained(rounds);
  if (average) {
    const losses = {};
    for (const category of SG_CATEGORIES) losses[category] = Math.max(0, -average[category]);
    const totalLoss = SG_CATEGORIES.reduce((sum, category) => sum + losses[category], 0);
    if (totalLoss > 0) {
      // Wie stark die Verluste wirken, hängt von ihrer Größe ab, nicht nur von ihrer Verteilung.
      const influence = STROKES_GAINED_INFLUENCE * Math.min(1, totalLoss / STROKES_GAINED_FULL_EFFECT_LOSS);
      for (const area of AREAS) {
        const category = AREA_CATEGORY[area];
        const categoryBaseline = AREAS.filter((other) => AREA_CATEGORY[other] === category).reduce(
          (sum, other) => sum + BASELINE[other],
          0,
        );
        const areaShare = BASELINE[area] / categoryBaseline;
        const lossShare = (losses[category] / totalLoss) * areaShare;
        result[area] = (1 - influence) * BASELINE[area] + influence * lossShare;
      }
    }
  }
  for (const point of focus) {
    if (!point.isActive) continue;
    const priority = Math.min(3, Math.max(1, point.priority));
    result[point.area] = (result[point.area] ?? 0) + FOCUS_BOOST_PER_PRIORITY * priority;
  }
  return normalized(result);
}

/** Anteile, die zusammen 1 ergeben. Ohne positive Summe unverändert. Summiert in der Reihenfolge der Bereiche, wie in der App. */
export function normalized(weights) {
  const total = AREAS.reduce((sum, area) => sum + (weights[area] ?? 0), 0);
  if (!(total > 0)) return { ...weights };
  const result = {};
  for (const [area, value] of Object.entries(weights)) result[area] = value / total;
  return result;
}
