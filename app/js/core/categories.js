// Bereiche, Kategorien, Anlagen und Arten des Übens, wie im Kern der App
// (GolfCore/Sources/GolfCore/Model/Categories.swift). Die Reihenfolge ist
// dieselbe: Sie bestimmt die Reihenfolge der Bereiche in einer Einheit.

/** Trainingsbereiche: erst Range, dann Kurzspielanlage, zum Schluss Puttinggrün. */
export const AREAS = ["driving", "approach", "wedges", "shortGame", "bunker", "putting"];

export const AREA_NAMES = {
  driving: "Abschlag",
  approach: "Annäherung (Eisen)",
  wedges: "Wedges 30–100 m",
  shortGame: "Chippen & Pitchen",
  bunker: "Bunker",
  putting: "Putten",
};

/** Die vier Strokes-Gained-Kategorien, wie sie bebrassie auswertet. */
export const SG_CATEGORIES = ["offTheTee", "approach", "aroundTheGreen", "putting"];

export const SG_NAMES = {
  offTheTee: "Abschlag",
  approach: "Annäherung",
  aroundTheGreen: "Rund ums Grün",
  putting: "Putten",
};

/** Zu welcher Strokes-Gained-Kategorie ein Bereich gehört. */
export const AREA_CATEGORY = {
  driving: "offTheTee",
  approach: "approach",
  wedges: "approach",
  shortGame: "aroundTheGreen",
  bunker: "aroundTheGreen",
  putting: "putting",
};

export const FACILITIES = ["range", "shortGameArea", "bunker", "puttingGreen"];

export const FACILITY_NAMES = {
  range: "Range",
  shortGameArea: "Kurzspielanlage",
  bunker: "Übungsbunker",
  puttingGreen: "Puttinggrün",
};

/** Art des Übens nach Adam Young: Technik, variabel, Wettkampf. */
export const MODES = ["block", "variable", "competition"];

export const MODE_NAMES = {
  block: "Technik",
  variable: "Variabel",
  competition: "Wettkampf",
};

/** ISO-Wochentage, Index 0 ist Montag. */
export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export function weekdayName(isoWeekday) {
  return WEEKDAYS[Math.max(1, Math.min(7, isoWeekday)) - 1];
}

export function areaIndex(area) {
  return AREAS.indexOf(area);
}
