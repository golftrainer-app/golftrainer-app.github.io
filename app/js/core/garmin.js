// Importiert den CSV-Export der Garmin-Golf-App (Approach R10 und R50), wie
// GarminCSVImporter.swift im Kern der App. Aufbau des Exports: erste Zeile
// Spaltennamen in der Sprache des Handys, zweite Zeile Einheiten wie „[mph]“,
// danach ein Schlag pro Zeile. Was der Import nicht erkennt, lässt sich von
// Hand zuordnen.
import { METRICS, METRIC_INFO, canonicalClub, isPlausible, median } from "./launch.js";
import { newID } from "./model.js";

// MARK: - CSV

const INVISIBLE = /[\uFEFF\u200B\u200C\u200D\u2060\u00AD]/g;
const NEWLINE = /\r\n|[\n\r\u0085\u2028\u2029\u000B\u000C]/;
const SPACES = /^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu;

/** Entfernt unsichtbare Zeichen und macht geschützte Leerzeichen zu normalen. */
export function clean(text) {
  return text.replace(INVISIBLE, "").replace(/\u00A0/g, " ");
}

const CANDIDATES = [",", ";", "\t"];

function delimiterCounts(line) {
  const counts = {};
  let inQuotes = false;
  let atFieldStart = true;
  for (const character of line) {
    if (inQuotes) {
      if (character === '"') inQuotes = false;
      continue;
    }
    // Wie beim Lesen: Ein Anführungszeichen zählt nur am Anfang eines Felds.
    if (character === '"' && atFieldStart) {
      inQuotes = true;
    } else if (character === "," || character === ";" || character === "\t") {
      counts[character] = (counts[character] ?? 0) + 1;
      atFieldStart = true;
    } else if (!/\s/.test(character)) {
      atFieldStart = false;
    }
  }
  return counts;
}

/**
 * Das Trennzeichen der ersten Zeile, die nach einer Tabelle aussieht, also
 * mindestens zwei Trennzeichen außerhalb von Anführungszeichen hat. Bei
 * Gleichstand Komma vor Semikolon vor Tab.
 */
export function detectDelimiter(text) {
  let fallback = null;
  const lines = text.split(NEWLINE).filter((line) => line.length > 0).slice(0, 30);
  for (const line of lines) {
    const counts = delimiterCounts(line);
    let best = CANDIDATES[0];
    for (const candidate of CANDIDATES) {
      if ((counts[candidate] ?? 0) > (counts[best] ?? 0)) best = candidate;
    }
    const count = counts[best] ?? 0;
    if (count === 0) continue;
    if (count >= 2) return best;
    if (fallback === null) fallback = best;
  }
  return fallback ?? ",";
}

const isNewline = (character) => character === "\n" || character === "\r" || character === "\u0085" || character === "\u2028" || character === "\u2029" || character === "\u000B" || character === "\u000C";

/** Zeilen und Felder, dazu ob am Ende ein Anführungszeichen offen blieb. */
export function parseDetailed(text, delimiter = null) {
  const cleaned = clean(text);
  const separator = delimiter ?? detectDelimiter(cleaned);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const endField = () => {
    row.push(field.replace(SPACES, ""));
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };
  const characters = Array.from(cleaned);
  let index = 0;
  while (index < characters.length) {
    const character = characters[index];
    index += 1;
    if (inQuotes) {
      if (character === '"') {
        if (index < characters.length && characters[index] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"' && /^[\p{Zs}\t]*$/u.test(field)) {
      // Nur am Anfang eines Felds beginnt ein Zitat, wie in Excel. Ein
      // Anführungszeichen mitten im Feld („Driver 45"“) ist ein Zeichen.
      field = "";
      inQuotes = true;
    } else if (character === separator) {
      endField();
    } else if (isNewline(character)) {
      if (character === "\r" && characters[index] === "\n") index += 1;
      endRow();
    } else {
      field += character;
    }
  }
  const unclosedQuote = inQuotes;
  if (field !== "" || row.length > 0) endRow();
  return { rows, unclosedQuote };
}

export function parseCSV(text, delimiter = null) {
  return parseDetailed(text, delimiter).rows;
}

// MARK: - Einheiten

/** Einheiten, wie sie in Exporten vorkommen, z. B. "[mph]", "[Yards]" oder "(yds)". */
export function parseUnit(raw) {
  let token = raw.toLowerCase().replace(/[[\]()]/g, "").replace(SPACES, "");
  while (token.endsWith(".")) token = token.slice(0, -1);
  switch (token) {
    case "mph":
    case "mi/h":
    case "meilen/h":
      return "mph";
    case "km/h":
    case "kmh":
    case "kph":
    case "km/std":
      return "kmh";
    case "m/s":
    case "mps":
      return "mps";
    case "yds":
    case "yd":
    case "yards":
    case "yard":
      return "yd";
    case "m":
    case "meter":
    case "meters":
    case "metres":
    case "metre":
    case "mtr":
      return "m";
    case "ft":
    case "feet":
    case "foot":
    case "fuß":
    case "fuss":
      return "ft";
    case "deg":
    case "°":
    case "º":
    case "degrees":
    case "degree":
    case "grad":
      return "deg";
    case "rpm":
    case "u/min":
    case "upm":
    case "1/min":
      return "rpm";
    default:
      return null;
  }
}

/** Grad und U/min gehören zu keinem System. */
const UNIT_SYSTEM = { kmh: "metric", mps: "metric", m: "metric", mph: "imperial", yd: "imperial", ft: "imperial", deg: null, rpm: null };
const SYSTEM_UNITS = { metric: { speed: "kmh", distance: "m" }, imperial: { speed: "mph", distance: "yd" } };
export const SYSTEM_NAMES = { metric: "km/h und Meter", imperial: "mph und Yards" };

/** Rechnet einen Wert in die Speichereinheit des Messwerts um. */
export function canonicalValue(unit, value, quantity) {
  if (quantity === "speed") {
    if (unit === "mph") return value * 1.609344;
    if (unit === "mps") return value * 3.6;
  }
  if (quantity === "distance") {
    if (unit === "yd") return value * 0.9144;
    if (unit === "ft") return value * 0.3048;
  }
  return value;
}

// MARK: - Spalten

/** Spaltennamen aus echten Exporten (Englisch, Deutsch, Niederländisch, Spanisch) und von anderen Launch Monitoren. */
export const METRIC_HEADERS = {
  clubSpeed: ["Club Speed", "Club Head Speed", "Schl.gsch.", "Schlägerkopfgeschwindigkeit", "Schlägergeschwindigkeit", "Clubsnelh.", "Vel. palo"],
  ballSpeed: ["Ball Speed", "Ballgeschwindigkeit", "Balsnelheid", "Velocidad de la pelota"],
  smashFactor: ["Smash Factor", "Smash-Faktor", "Smash", "Calidad del impacto"],
  launchAngle: ["Launch Angle", "Abflugwinkel", "Slaghoek", "Ángulo de lanzamiento"],
  launchDirection: ["Launch Direction", "Abflugrichtung", "Slagrichting", "Dirección de lanzamiento"],
  spinRate: ["Spin Rate", "Spin", "Drehrate", "Spinsnelheid", "Velocidad de rotación"],
  spinAxis: ["Spin Axis", "Drehachse", "Spinachse", "Spinas", "Eje de rotación"],
  backspin: ["Backspin", "Retroceso"],
  sidespin: ["Sidespin", "Efecto lateral"],
  carryDistance: ["Carry Distance", "Carry", "Carry-Distanz", "Carry-afstand", "Dist. vuelo"],
  totalDistance: ["Total Distance", "Total", "Gesamtstrecke", "Gesamtdistanz", "Totale afstand", "Distancia total"],
  carryDeviation: ["Carry Deviation Distance", "Offline", "Lateral Distance", "Carry-Abweichungsdistanz", "Carry-afwijkingsafstand", "Distancia de desviación de vuelo"],
  totalDeviation: ["Total Deviation Distance", "Gesamtabweichungsdistanz", "Totale afwijkingsafstand", "Distancia de desviación total"],
  apexHeight: ["Apex Height", "Apex", "Peak Height", "Höhe des Scheitelpunkts", "Scheitelhöhe", "Apexhoogte", "Altura máxima"],
  attackAngle: ["Attack Angle", "Angle of Attack", "Anstellwinkel", "Aanvalshoek", "Ángulo de ataque"],
  clubPath: ["Club Path", "Schwungbahn", "Clubtraject", "Línea cabeza del palo"],
  faceAngle: ["Club Face", "Face Angle", "Schlagfläche", "Slagvlak van de club", "Cara del palo"],
  faceToPath: ["Face to Path", "Schlagflächenstellung", "Slagvlak t.o.v. traject", "Cara a línea"],
};
export const CLUB_NAME_HEADERS = ["Club Name", "Club", "Schlägername", "Schläger", "Clubnaam"];
export const CLUB_TYPE_HEADERS = ["Club Type", "Schlägerart", "Schlägertyp", "Type club", "Tipo de palo"];
export const DATE_HEADERS = ["Date", "Date/Time", "Timestamp", "Datum", "Uhrzeit", "Zeit", "Fecha"];
const SUMMARY_LABELS = ["average", "averages", "durchschnitt", "mittelwert", "stddev", "standarddeviation", "standardabweichung", "min", "max"];

/** Klein, ohne Akzente, ohne Einheiten in Klammern, nur Buchstaben und Ziffern. */
export function normalize(header) {
  return clean(header)
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

const METRIC_KEYS = new Map();
for (const metric of METRICS) {
  for (const header of METRIC_HEADERS[metric]) METRIC_KEYS.set(normalize(header), metric);
}
const CLUB_NAME_KEYS = new Set(CLUB_NAME_HEADERS.map(normalize));
const CLUB_TYPE_KEYS = new Set(CLUB_TYPE_HEADERS.map(normalize));
const DATE_KEYS = new Set(DATE_HEADERS.map(normalize));

/** Welche Spalte welchen Wert enthält: { club, clubType, date, metrics: { carryDistance: 20, … } }. */
export function emptyMapping() {
  return { club: null, clubType: null, date: null, metrics: {} };
}

/** Ohne Schläger und Carry ist ein Import nicht sinnvoll. */
export function hasEssentials(mapping) {
  return (mapping.club != null || mapping.clubType != null) && mapping.metrics.carryDistance != null;
}

/** Ordnet Spalten anhand ihrer Namen zu. Gibt es einen Namen doppelt, zählt die erste Spalte. */
export function detectMapping(headers) {
  const mapping = emptyMapping();
  headers.forEach((header, index) => {
    const key = normalize(header);
    const metric = METRIC_KEYS.get(key);
    if (metric) {
      if (mapping.metrics[metric] == null) mapping.metrics[metric] = index;
    } else if (CLUB_TYPE_KEYS.has(key)) {
      if (mapping.clubType == null) mapping.clubType = index;
    } else if (CLUB_NAME_KEYS.has(key)) {
      if (mapping.club == null) mapping.club = index;
    } else if (DATE_KEYS.has(key)) {
      if (mapping.date == null) mapping.date = index;
    }
  });
  return mapping;
}

/** Kennung für gespeicherte Spaltenzuordnungen: die Spaltennamen der Datei, wie in der App. */
export function mappingKey(headers) {
  return headers.join("|");
}

// MARK: - Zahlen

/**
 * Liest eine Zahl, egal ob mit Dezimalpunkt oder -komma. "L" bzw. "R" (links,
 * rechts) wird zu einem negativen bzw. positiven Wert. Auch in wissenschaftlicher
 * Schreibweise und mit typografischem Minus. Uhrzeiten und Felder mit mehreren
 * Zahlen, z. B. ein Datum, sind keine Messwerte.
 */
export function parseNumber(raw, decimalComma) {
  const unified = raw
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    // Leerzeichen als Tausendertrennung („6 515“, auch geschützte) fallen weg.
    .replace(/(?<=[0-9])[ \u00A0\u202F](?=[0-9]{3}(?![0-9]))/g, "");
  const trimmed = unified.replace(SPACES, "");
  if (trimmed.includes(":")) return null;
  if (trimmed.split(/\s+/).filter((part) => /\p{N}/u.test(part)).length > 1) return null;
  if (/^[+-]?[0-9]+([.,][0-9]+)?[eE][+-]?[0-9]+$/.test(trimmed)) {
    const value = Number(trimmed.replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }
  const isLeft = /(^|[^A-Z])L([^A-Z]|$)/.test(trimmed.toUpperCase());
  let text = [...trimmed].filter((character) => "0123456789.,-+".includes(character)).join("");
  if (!/[0-9]/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Beides vorhanden: das letzte Zeichen ist das Dezimalzeichen.
    text = lastDot > lastComma ? text.replace(/,/g, "") : text.replace(/\./g, "").replace(/,/g, ".");
  } else if (lastComma >= 0) {
    const parts = text.split(",");
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && !decimalComma);
    text = isThousands ? text.replace(/,/g, "") : text.replace(/,/g, ".");
  } else if (lastDot >= 0) {
    const parts = text.split(".");
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && decimalComma);
    if (isThousands) text = text.replace(/\./g, "");
  }
  // Wie Double(text) in Swift: nur eine Zahl mit höchstens einem Vorzeichen und Punkt.
  if (!/^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return isLeft && value > 0 ? -value : value;
}

/** Ob die Zahlen einer Datei ein Dezimalkomma haben. Eine einzelne Zahl wie „1,234“ ist mehrdeutig. */
export function usesDecimalComma(cells, delimiter) {
  let commas = 0;
  let dots = 0;
  for (const cell of cells) {
    if (/^[+-]?[0-9]+,[0-9]+$/.test(cell)) commas += 1;
    else if (/^[+-]?[0-9]+\.[0-9]+$/.test(cell)) dots += 1;
  }
  return commas === dots ? delimiter !== "," : commas > dots;
}

// MARK: - Datum

/** Ein Datum in seinen Zahlen, z. B. „26.11.23 12:38:50“ → 26, 11, 23, 12, 38, 50. */
function dateParts(text) {
  let raw = text.replace(SPACES, "");
  let zoneSeconds = null;
  // Ein „Z“ zählt nur direkt nach der Zahl als UTC, nicht am Ende von „MEZ“.
  if (raw.includes(":")) {
    const match = raw.match(/((?<=[0-9])Z|[+-][0-9]{2}:?[0-9]{2})$/);
    if (match) {
      const token = match[0].replace(":", "");
      if (token === "Z") {
        zoneSeconds = 0;
      } else {
        const hours = Number(token.slice(1, 3));
        const minutes = Number(token.slice(3, 5));
        zoneSeconds = (hours * 3600 + minutes * 60) * (token.startsWith("-") ? -1 : 1);
      }
      raw = raw.slice(0, match.index);
    }
  }
  const numbers = [];
  const words = [];
  let separator = null;
  let digits = "";
  let word = "";
  const flushDigits = () => {
    if (digits) numbers.push({ value: Number(digits), digits: digits.length });
    digits = "";
  };
  const flushWord = () => {
    if (word) words.push(word);
    word = "";
  };
  for (const character of raw) {
    if (/[0-9]/.test(character)) {
      flushWord();
      digits += character;
      continue;
    }
    flushDigits();
    if (/\p{L}/u.test(character)) {
      word += character.toLowerCase();
      continue;
    }
    flushWord();
    if (numbers.length === 1 && separator === null) {
      if (!".-/".includes(character)) return null;
      separator = character;
    }
  }
  flushDigits();
  flushWord();
  if (numbers.length < 3 || separator === null) return null;
  // „am“ und „pm“ nur als eigenes Wort: In „Samstag“ steckt auch ein „am“.
  const lowered = raw.toLowerCase();
  let isPM = null;
  if (words.includes("pm") || lowered.includes("p.m.")) isPM = true;
  else if (words.includes("am") || lowered.includes("a.m.")) isPM = false;
  return { numbers, separator, isPM, zoneSeconds, yearFirst: numbers[0].digits === 4 };
}

function dateFrom(parts, dayFirst) {
  const values = [...parts.numbers.map((number) => number.value), 0, 0, 0];
  let year = values[0];
  let month = values[1];
  let day = values[2];
  if (!parts.yearFirst) {
    year = parts.numbers[2].digits <= 2 ? 2000 + values[2] : values[2];
    if (parts.separator === "." || dayFirst) {
      day = values[0];
      month = values[1];
    } else {
      month = values[0];
      day = values[1];
    }
  }
  let hour = values[3];
  if (parts.isPM === true && hour < 12) hour += 12;
  if (parts.isPM === false && hour === 12) hour = 0;
  const minute = values[4];
  const second = values[5];
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour < 24 && minute < 60 && second < 61)) return null;
  // Ungültige Tage wie der 31.04. würde der Kalender in den Mai schieben.
  if (parts.zoneSeconds != null) {
    const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (utc.getUTCDate() !== day) return null;
    return new Date(utc.getTime() - parts.zoneSeconds * 1000);
  }
  const local = new Date(year, month - 1, day, hour, minute, second);
  return local.getDate() === day ? local : null;
}

/**
 * Datum und Uhrzeit, wie Garmin sie je nach Sprache und Region schreibt:
 * „26.11.23 12:38:50“, „4/19/26 11:45:45“, „05/23/26 08:27:28 AM“,
 * „19/04/2026, 11:45:45“ oder „2026-04-19 11:45:45“. Bei Schrägstrichen
 * entscheidet die ganze Spalte, ob der Tag vorne steht. Bleibt es offen, gilt
 * `preferDayFirst` (die Region des Handys). Ohne Zone die des Geräts.
 */
export function parseDates(cells, { preferDayFirst = false } = {}) {
  const parts = cells.map(dateParts);
  const ambiguous = parts.filter((part) => part && part.separator !== "." && !part.yearFirst);
  let dayFirst = preferDayFirst;
  if (ambiguous.some((part) => part.numbers[0].value > 12)) dayFirst = true;
  else if (ambiguous.some((part) => part.numbers[1].value > 12)) dayFirst = false;
  return parts.map((part) => (part ? dateFrom(part, dayFirst) : null));
}

export function parseDate(raw, options = {}) {
  return parseDates([raw], options)[0];
}

/** Ob die Region des Geräts den Tag vor den Monat schreibt, wie `Locale.prefersDayFirst` in der App. */
export function prefersDayFirst(locale = undefined) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date(2000, 11, 31));
    const day = parts.findIndex((part) => part.type === "day");
    const month = parts.findIndex((part) => part.type === "month");
    return day >= 0 && month >= 0 && day < month;
  } catch {
    return true;
  }
}

// MARK: - Einheiten der Datei

/** Prüft, ob eine Zeile nur Einheiten enthält (zweite Kopfzeile). */
export function isUnitsRow(row) {
  const filled = row.filter((cell) => cell !== "");
  if (filled.length === 0) return false;
  const recognized = filled.filter((cell) => parseUnit(cell) != null || cell.startsWith("["));
  const hasNumbers = filled.some((cell) => parseNumber(cell, false) != null && parseUnit(cell) == null && !cell.startsWith("["));
  return !hasNumbers && recognized.length * 2 >= filled.length;
}

/** Einheit aus der Einheiten-Zeile oder aus dem Spaltennamen, z. B. "Carry (m)". */
function unitFor(column, headers, unitsRow) {
  if (unitsRow && column < unitsRow.length) {
    const unit = parseUnit(unitsRow[column]);
    if (unit) return unit;
  }
  if (column >= headers.length) return null;
  const match = headers[column].match(/\[[^\]]*\]|\([^)]*\)/);
  return match ? parseUnit(match[0]) : null;
}

/**
 * Schätzt die Einheiten, wenn die Datei keine nennt. Die Carry-Länge wächst
 * ungefähr mit der Ballgeschwindigkeit hoch 1,4: in Yards etwa 0,21 · mph^1,4,
 * in Metern etwa 0,10 · (km/h)^1,4.
 */
export function guessUnitSystem(pairs) {
  const residuals = pairs
    .filter((pair) => pair.ballSpeed > 0 && pair.carry > 0)
    .map((pair) => Math.log(pair.carry) - Math.log(0.2127 * pair.ballSpeed ** 1.4));
  if (residuals.length < 3) return null;
  return median(residuals) > -0.45 ? "imperial" : "metric";
}

/**
 * Einheiten für alle Geschwindigkeiten und Längen. Fehlt eine Angabe, gilt
 * die Einheit einer anderen Spalte derselben Art, sonst das System der
 * übrigen Spalten, sonst eine Schätzung aus den Werten.
 */
export function resolveUnits(explicit, metrics, samples) {
  const units = { ...explicit };
  const missing = METRICS.filter((metric) => {
    const quantity = METRIC_INFO[metric].quantity;
    return metrics.has(metric) && units[metric] == null && (quantity === "speed" || quantity === "distance");
  });
  if (missing.length === 0) return { units, warning: null };

  // Die Scheitelhöhe steht oft in Fuß, sie taugt nicht als Vorbild für Längen.
  const known = (quantity) => {
    for (const metric of METRICS) {
      if (METRIC_INFO[metric].quantity === quantity && metric !== "apexHeight" && explicit[metric]) return explicit[metric];
    }
    return null;
  };
  let system = UNIT_SYSTEM[known("speed")] ?? UNIT_SYSTEM[known("distance")] ?? UNIT_SYSTEM[explicit.apexHeight] ?? null;
  let warning = null;
  if (system == null) {
    const pairs = samples
      .filter((values) => values.ballSpeed != null && values.carryDistance != null)
      .map((values) => ({ ballSpeed: values.ballSpeed, carry: values.carryDistance }));
    const guess = guessUnitSystem(pairs);
    if (guess) {
      system = guess;
      warning = `Einheiten fehlen in der Datei. Nach den Werten sind es vermutlich ${SYSTEM_NAMES[guess]}. Prüf kurz, ob die Längen stimmen.`;
    } else {
      warning = "Einheiten fehlen in der Datei. Die Werte werden als km/h und Meter übernommen.";
    }
  }
  const fallback = SYSTEM_UNITS[system ?? "metric"];
  for (const metric of missing) {
    const quantity = METRIC_INFO[metric].quantity;
    const sameKind = metric === "apexHeight" ? null : known(quantity);
    units[metric] = sameKind ?? fallback[quantity];
  }
  return { units, warning };
}

// MARK: - Import

export class LaunchImportError extends Error {
  constructor(kind) {
    super(kind === "empty" ? "Die Datei ist leer." : "In der Datei wurde keine Kopfzeile mit Messwerten gefunden.");
    this.kind = kind;
  }
}

/**
 * Importiert eine Datei. `mapping`: Zuordnung von Hand, sonst aus den
 * Spaltennamen. Ergebnis: { session, mapping, headers, sampleRow, warnings }.
 * Wirft LaunchImportError, wenn die Datei leer ist oder keine Kopfzeile hat.
 */
export function importSession(text, fileName, { importDate = new Date(), preferDayFirst = false, mapping: customMapping = null } = {}) {
  const cleaned = clean(text);
  const delimiter = detectDelimiter(cleaned);
  const table = parseDetailed(cleaned, delimiter);
  const rows = table.rows;
  if (rows.length === 0) throw new LaunchImportError("empty");

  // Kopfzeile: die erste Zeile mit zwei bekannten Messwerten oder einem
  // Messwert und dem Schläger. Davor dürfen Infozeilen stehen.
  let headerIndex = rows.slice(0, 20).findIndex((row) => {
    const detected = detectMapping(row);
    const count = Object.keys(detected.metrics).length;
    return count >= 2 || (count > 0 && (detected.club != null || detected.clubType != null));
  });
  if (headerIndex < 0) {
    if (!customMapping) throw new LaunchImportError("noHeader");
    headerIndex = 0;
  }

  const headers = rows[headerIndex];
  let dataStart = headerIndex + 1;
  let unitsRow = null;
  if (dataStart < rows.length && isUnitsRow(rows[dataStart])) {
    unitsRow = rows[dataStart];
    dataStart += 1;
  }
  const dataRows = rows.slice(Math.min(dataStart, rows.length));

  const mapping = customMapping ?? detectMapping(headers);
  const metricColumns = Object.values(mapping.metrics);
  const decimalComma = usesDecimalComma(
    dataRows.flatMap((row) => metricColumns.filter((column) => column < row.length).map((column) => row[column])),
    delimiter,
  );
  const warnings = [];
  if (table.unclosedQuote) {
    warnings.push("Ein Anführungszeichen in der Datei wurde nicht geschlossen. Alles danach wurde als ein Feld gelesen, diese Schläge fehlen.");
  }

  // Erst alle Zeilen lesen, dann die Einheiten bestimmen: Für die Schätzung
  // fehlender Einheiten braucht es die Werte.
  const parsed = [];
  const trailing = (row) => {
    let count = row.length;
    while (count > 0 && row[count - 1] === "") count -= 1;
    return count;
  };
  // Leere Felder am Zeilenende zählen nicht, z. B. nach einem Komma am Schluss.
  const headerCount = trailing(headers);
  let widerRows = 0;
  for (const row of dataRows) {
    // Mehr Felder als die Kopfzeile: Ein Komma in einem Namen hat alle Werte verschoben.
    if (trailing(row) > headerCount) {
      widerRows += 1;
      continue;
    }
    const cell = (index) => (index == null || index >= row.length ? "" : row[index]);
    // Summenzeilen wie „Average“ oder „Max“ haben kein Datum. Mit Datum ist „Max“ ein Spieler.
    const labels = [row[0] ?? "", cell(mapping.clubType), cell(mapping.club)].map(normalize);
    if (cell(mapping.date) === "" && labels.some((label) => SUMMARY_LABELS.includes(label))) continue;

    const values = {};
    for (const [metric, column] of Object.entries(mapping.metrics)) {
      const value = parseNumber(cell(column), decimalComma);
      if (value != null) values[metric] = value;
    }
    const clubType = cell(mapping.clubType);
    const club = canonicalClub(clubType === "" ? cell(mapping.club) : clubType);
    if (Object.keys(values).length === 0) continue;
    if (club === "" && values.carryDistance == null) continue;
    parsed.push({ club, date: cell(mapping.date), values });
  }

  const explicitUnits = {};
  for (const [metric, column] of Object.entries(mapping.metrics)) {
    const unit = unitFor(column, headers, unitsRow);
    if (unit) explicitUnits[metric] = unit;
  }
  const resolved = resolveUnits(explicitUnits, new Set(Object.keys(mapping.metrics)), parsed.map((entry) => entry.values));
  if (resolved.warning) warnings.push(resolved.warning);

  const dates = parseDates(parsed.map((entry) => entry.date), { preferDayFirst });
  const shots = [];
  let phantoms = 0;
  let implausible = 0;
  const hasCarryColumn = mapping.metrics.carryDistance != null;
  parsed.forEach((entry, index) => {
    const values = {};
    for (const [metric, value] of Object.entries(entry.values)) {
      const unit = resolved.units[metric];
      const canonical = unit ? canonicalValue(unit, value, METRIC_INFO[metric].quantity) : value;
      // Unmögliche Werte kommen aus einer falsch zugeordneten Spalte, z. B. dem Datum als Carry.
      if (!isPlausible(metric, canonical)) {
        implausible += 1;
        continue;
      }
      values[metric] = canonical;
    }
    // Der R10 speichert manchmal einen Schwung, ohne den Ball zu erfassen.
    if (values.ballSpeed === 0 || values.carryDistance === 0 || (hasCarryColumn && values.carryDistance == null)) {
      phantoms += 1;
      return;
    }
    shots.push({ id: newID(), index: shots.length, date: dates[index], club: entry.club === "" ? "Unbekannt" : entry.club, values });
  });

  if (phantoms === 1) warnings.push("1 Schlag ohne Ballflug (Fehlmessung des R10) wurde übersprungen.");
  else if (phantoms > 1) warnings.push(`${phantoms} Schläge ohne Ballflug (Fehlmessungen des R10) wurden übersprungen.`);
  if (implausible > 0) warnings.push(`${implausible} Werte lagen außerhalb des Möglichen und wurden nicht übernommen. Passt die Zuordnung der Spalten?`);
  if (widerRows === 1) warnings.push("1 Zeile hatte mehr Spalten als die Kopfzeile und wurde übersprungen. Steht ein Komma in einem Namen?");
  else if (widerRows > 1) warnings.push(`${widerRows} Zeilen hatten mehr Spalten als die Kopfzeile und wurden übersprungen. Steht ein Komma in einem Namen?`);
  if (mapping.date == null || shots.some((shot) => shot.date == null)) {
    warnings.push("Nicht jeder Schlag hat eine Uhrzeit. Ohne Uhrzeit lassen sich Schläge in der App nicht automatisch mit Videos verknüpfen.");
  }
  if (!hasEssentials(mapping)) warnings.push("Schläger oder Carry wurden nicht erkannt. Bitte ordne die Spalten zu.");

  const shotDates = shots.map((shot) => shot.date).filter(Boolean);
  const session = {
    id: newID(),
    date: shotDates.length > 0 ? new Date(Math.min(...shotDates.map((date) => date.getTime()))) : importDate,
    importedAt: importDate,
    source: "Garmin Golf",
    fileName,
    shots,
  };
  return { session, mapping, headers, sampleRow: dataStart < rows.length ? rows[dataStart] : [], warnings };
}

// MARK: - Datei

/**
 * Text einer Datei aus einer anderen App, wie TextFileDecoding.swift: UTF-16
 * nur mit Byte Order Mark oder an den Nullbytes erkennbar, sonst UTF-8, und
 * was kein UTF-8 ist, als Windows-1252, wie Excel es schreibt.
 */
export function decodeTextFile(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const decode = (label, fatal = false) => {
    try {
      return new TextDecoder(label, { fatal }).decode(bytes);
    } catch {
      return null;
    }
  };
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return decode(bytes[0] === 0xff ? "utf-16le" : "utf-16be");
  }
  const sample = bytes.subarray(0, 400);
  if (sample.length >= 4) {
    const even = [];
    const odd = [];
    sample.forEach((byte, index) => (index % 2 === 0 ? even : odd).push(byte));
    const mostlyZero = (list) => list.length > 0 && list.filter((byte) => byte === 0).length * 10 >= list.length * 9;
    if (mostlyZero(odd) && !even.includes(0)) return decode("utf-16le");
    if (mostlyZero(even) && !odd.includes(0)) return decode("utf-16be");
  }
  return decode("utf-8", true) ?? decode("windows-1252") ?? decode("iso-8859-1");
}
