// Texte, die App und Web-App gleich setzen, wie CountText, DurationText und
// Countdown im Kern (GolfCore/Sources/GolfCore/Model/CountText.swift).

/** Ganze Zahl mit Tausenderpunkt ab 1.000, z. B. „12.500“. */
export function countNumber(count) {
  const digits = String(Math.abs(Math.trunc(count)));
  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return (count < 0 ? "-" : "") + groups.join(".");
}

/** Anzahl mit dem passenden Wort: „1 Tag“, „3 Tage“. Einzahl nur bei genau 1, auch bei 0 die Mehrzahl. */
export function countText(count, one, many) {
  return `${countNumber(count)} ${count === 1 ? one : many}`;
}

/** Dauer wie in der App: „45 Min.“ oder „2:30 h“. */
export function durationText(minutes) {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
  return `${minutes} Min.`;
}

/** Countdown zum Turnier: „in 5 Tagen“, „morgen“, „heute“, „läuft“ oder „vorbei“. */
export function countdown(daysUntil, days) {
  if (daysUntil >= 2) return `in ${daysUntil} Tagen`;
  if (daysUntil === 1) return "morgen";
  if (daysUntil === 0) return "heute";
  if (daysUntil < 0 && daysUntil >= 1 - Math.max(1, days)) return "läuft";
  return "vorbei";
}
