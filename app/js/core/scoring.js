// Wertung einer Übung, wie in GolfCore/Sources/GolfCore/Model/Drill.swift.
// scoring: { kind: "none" | "count" | "zones" | "strokes" | "streak", attempts, zones: [{label, points}], par }

export function normalizedScoring(scoring = {}) {
  return {
    kind: scoring.kind ?? "none",
    attempts: scoring.attempts ?? 0,
    zones: scoring.zones ?? [],
    par: scoring.par ?? 2,
  };
}

export function maxZonePoints(scoring) {
  return scoring.zones.reduce((max, zone) => Math.max(max, zone.points), 0);
}

/** Höchstmögliche Punktzahl, null ohne Wertung oder beim Par-Spiel. */
export function maxScore(scoring) {
  switch (scoring.kind) {
    case "count":
    case "streak":
      return scoring.attempts;
    case "zones":
      return scoring.attempts * maxZonePoints(scoring);
    default:
      return null;
  }
}

/** Par des ganzen Spiels, nur beim Par-Spiel. */
export function totalPar(scoring) {
  return scoring.kind === "strokes" ? scoring.attempts * scoring.par : null;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * Erfolgsquote zwischen 0 und 1 für die Anpassung der Schwierigkeit. Beim
 * Par-Spiel entspricht Par genau 50 %.
 */
export function successRate(scoring, score) {
  switch (scoring.kind) {
    case "count":
    case "streak":
    case "zones": {
      const max = maxScore(scoring);
      if (!(max > 0)) return null;
      return clamp01(score / max);
    }
    case "strokes": {
      if (!(scoring.attempts > 0)) return null;
      const best = scoring.attempts * (scoring.par - 1);
      const worst = scoring.attempts * (scoring.par + 1);
      return clamp01((worst - score) / (worst - best));
    }
    default:
      return null;
  }
}

/** Kurz für die Anzeige, z. B. „14 von 20“ oder „31 Schläge (Par 27)“. */
export function scoreText(scoring, score) {
  switch (scoring.kind) {
    case "count":
      return `${score} von ${scoring.attempts}`;
    case "zones":
      return `${score} von ${maxScore(scoring)} Punkten`;
    case "strokes":
      return `${score} Schläge (Par ${totalPar(scoring)})`;
    case "streak":
      return `Serie ${score}`;
    default:
      return "Erledigt";
  }
}
