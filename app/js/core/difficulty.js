// Schwierigkeit nach dem Challenge-Point-Prinzip, wie DifficultyAdapter in der
// App: Liegen die letzten beiden Ergebnisse auf derselben Stufe über 70 %, wird
// es eine Stufe schwerer, unter 30 % eine leichter.
import { normalizedScoring, successRate } from "./scoring.js";

export const UPPER_THRESHOLD = 0.7;
export const LOWER_THRESHOLD = 0.3;
export const RESULTS_NEEDED = 2;

export function level(drill, results) {
  const levels = drill.levels ?? [];
  if (levels.length <= 1) return 0;
  const maxLevel = levels.length - 1;
  const history = results.filter((result) => result.drillID === drill.id).sort((a, b) => a.date - b.date);
  const last = history[history.length - 1];
  if (!last) return 0;

  const current = Math.min(maxLevel, Math.max(0, last.level));
  const recent = history.slice(-RESULTS_NEEDED);
  if (recent.length !== RESULTS_NEEDED || !recent.every((result) => result.level === last.level)) {
    return current;
  }
  const scoring = normalizedScoring(drill.scoring);
  const rates = recent.map((result) => successRate(scoring, result.score)).filter((rate) => rate != null);
  if (rates.length !== RESULTS_NEEDED) return current;
  if (rates.every((rate) => rate >= UPPER_THRESHOLD)) return Math.min(maxLevel, current + 1);
  if (rates.every((rate) => rate <= LOWER_THRESHOLD)) return Math.max(0, current - 1);
  return current;
}
