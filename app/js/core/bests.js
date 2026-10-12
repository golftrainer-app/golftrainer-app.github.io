// Bestleistungen pro Übung, wie PersonalBests in der App. Verglichen wird nur
// auf derselben Stufe: Eine höhere Stufe ist schwerer.
import { areaIndex } from "./categories.js";
import { normalizedScoring } from "./scoring.js";

export function isRanked(scoring) {
  return normalizedScoring(scoring).kind !== "none";
}

/** Ist `score` besser als `other`? Beim Par-Spiel zählen weniger Schläge. */
export function isBetter(score, other, scoring) {
  switch (normalizedScoring(scoring).kind) {
    case "strokes":
      return score < other;
    case "count":
    case "zones":
    case "streak":
      return score > other;
    default:
      return false;
  }
}

/** Bestes Ergebnis auf einer Stufe. Bei Gleichstand zählt das frühere. */
export function best(drill, level, results) {
  if (!isRanked(drill.scoring)) return null;
  return results
    .filter((result) => result.drillID === drill.id && result.level === level)
    .sort((a, b) => a.date - b.date)
    .reduce((current, result) => (current === null || isBetter(result.score, current.score, drill.scoring) ? result : current), null);
}

/** Bestleistung pro Stufe, auf der es Ergebnisse gibt. */
export function bests(drill, results) {
  const levels = [...new Set(results.filter((result) => result.drillID === drill.id).map((result) => result.level))].sort((a, b) => a - b);
  return levels.map((level) => ({ level, result: best(drill, level, results) })).filter((entry) => entry.result);
}

/**
 * Was ein neues Ergebnis bedeutet: { kind: "none" | "first" | "tied" | "record", previous }.
 * `replacingID`: Ergebnis, das dabei ersetzt wird, zählt nicht als frühere Leistung.
 */
export function outcome(score, level, drill, results, replacingID = null) {
  if (!isRanked(drill.scoring)) return { kind: "none" };
  const others = results.filter((result) => result.id !== replacingID);
  const current = best(drill, level, others);
  if (!current) return { kind: "first" };
  if (isBetter(score, current.score, drill.scoring)) return { kind: "record", previous: current.score };
  return score === current.score ? { kind: "tied" } : { kind: "none" };
}

const collator = new Intl.Collator("de", { numeric: true });

/**
 * Bestleistung jeder Übung mit Wertung, auf der höchsten Stufe mit
 * Ergebnissen. Nach Bereichen wie die Bibliothek, darin nach Namen.
 * Einträge: { drill, level, result, attempts }.
 */
export function overview(library, results) {
  const byDrill = new Map();
  for (const result of results) {
    if (!byDrill.has(result.drillID)) byDrill.set(result.drillID, []);
    byDrill.get(result.drillID).push(result);
  }
  return library
    .filter((drill) => isRanked(drill.scoring))
    .map((drill) => {
      const drillResults = byDrill.get(drill.id);
      if (!drillResults) return null;
      const level = Math.max(...drillResults.map((result) => result.level));
      const result = best(drill, level, drillResults);
      if (!result) return null;
      return { drill, level, result, attempts: drillResults.filter((other) => other.level === level).length };
    })
    .filter(Boolean)
    .sort((a, b) => areaIndex(a.drill.area) - areaIndex(b.drill.area) || collator.compare(a.drill.name, b.drill.name));
}

/** Neue Bestleistungen seit `since`, die jüngste zuerst. Das erste Ergebnis einer Stufe zählt nicht. */
export function records(since, library, results) {
  const drills = new Map(library.map((drill) => [drill.id, drill]));
  const ordered = [...results].sort((a, b) => a.date - b.date);
  const found = [];
  ordered.forEach((result, index) => {
    if (result.date < since) return;
    const drill = drills.get(result.drillID);
    if (!drill || !isRanked(drill.scoring)) return;
    const earlier = ordered.slice(0, index).filter((other) => other.drillID === result.drillID && other.level === result.level);
    const current = best(drill, result.level, earlier);
    if (current && isBetter(result.score, current.score, drill.scoring)) found.push(result);
  });
  return found.reverse();
}
