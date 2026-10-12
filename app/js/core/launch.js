// Messwerte eines Launch Monitors wie LaunchData.swift im Kern der App
// (GolfCore/Sources/GolfCore/LaunchMonitor/LaunchData.swift). Gespeichert wird
// immer metrisch: km/h, Meter, Grad, Umdrehungen pro Minute. Dazu die
// Statistik pro Schläger und der Verlauf über Sessions. Einheitliche
// Schlägernamen wie ClubName.swift.

/** Die 18 Messwerte in der Reihenfolge der App. */
export const METRICS = [
  "clubSpeed",
  "ballSpeed",
  "smashFactor",
  "launchAngle",
  "launchDirection",
  "spinRate",
  "spinAxis",
  "backspin",
  "sidespin",
  "carryDistance",
  "totalDistance",
  "carryDeviation",
  "totalDeviation",
  "apexHeight",
  "attackAngle",
  "clubPath",
  "faceAngle",
  "faceToPath",
];

const define = (name, quantity, range, isSideways = false) => ({ name, quantity, range, isSideways });

/**
 * Name, Art, plausibler Bereich in der Speichereinheit und ob das Vorzeichen
 * links oder rechts bedeutet. Alles darüber hinaus kommt aus einer falsch
 * zugeordneten Spalte, z. B. dem Datum.
 */
export const METRIC_INFO = {
  clubSpeed: define("Schlägerkopf", "speed", [0, 300]),
  ballSpeed: define("Ballgeschwindigkeit", "speed", [0, 400]),
  smashFactor: define("Smash-Faktor", "ratio", [0, 2]),
  launchAngle: define("Abflugwinkel", "angle", [-45, 85]),
  launchDirection: define("Abflugrichtung", "angle", [-60, 60], true),
  spinRate: define("Spin", "spin", [-5000, 20000]),
  spinAxis: define("Spinachse", "angle", [-90, 90], true),
  backspin: define("Backspin", "spin", [-5000, 20000]),
  sidespin: define("Sidespin", "spin", [-10000, 10000]),
  carryDistance: define("Carry", "distance", [0, 500]),
  totalDistance: define("Gesamt", "distance", [0, 500]),
  carryDeviation: define("Abweichung (Carry)", "distance", [-200, 200], true),
  totalDeviation: define("Abweichung (Gesamt)", "distance", [-200, 200], true),
  apexHeight: define("Scheitelhöhe", "distance", [-5, 100]),
  attackAngle: define("Anstellwinkel", "angle", [-30, 30]),
  clubPath: define("Schwungbahn", "angle", [-60, 60], true),
  faceAngle: define("Schlagfläche", "angle", [-60, 60], true),
  faceToPath: define("Fläche zu Bahn", "angle", [-60, 60]),
};

/** Einheit je Art, in der der Wert gespeichert und angezeigt wird. */
export const UNITS = { speed: "km/h", distance: "m", angle: "°", spin: "U/min", ratio: "" };
const FRACTION_DIGITS = { speed: 1, distance: 1, angle: 1, spin: 0, ratio: 2 };

export const metricName = (metric) => METRIC_INFO[metric]?.name ?? metric;
export const metricQuantity = (metric) => METRIC_INFO[metric].quantity;
export const metricUnit = (metric) => UNITS[METRIC_INFO[metric].quantity];
export const fractionDigits = (metric) => FRACTION_DIGITS[METRIC_INFO[metric].quantity];

export function isPlausible(metric, value) {
  const [min, max] = METRIC_INFO[metric].range;
  return value >= min && value <= max;
}

/** Wie `.rounded()` in Swift: die Hälfte weg von null. */
export const roundHalfAway = (value) => (value < 0 ? -Math.round(-value) : Math.round(value));

/** Wie String(format: "%.1f"): Nachkommastellen fest, genau die Hälfte zur geraden Ziffer. */
export function fixed(value, digits) {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const rounded = scaled - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return (rounded / scale).toFixed(digits);
}

/** Zum Beispiel „137,2 m“, „1,37“ oder „6515 U/min“. Kein „-0,0“. */
export function formatted(metric, value) {
  const quantity = METRIC_INFO[metric].quantity;
  let number = fixed(value, FRACTION_DIGITS[quantity]);
  if (/^-[0.]*$/.test(number)) number = number.slice(1);
  number = number.replace(".", ",");
  const unit = UNITS[quantity];
  if (unit === "") return number;
  if (unit === "°") return number + unit;
  return `${number} ${unit}`;
}

/**
 * Wie bei TrackMan: Richtungen mit L und R statt Vorzeichen, z. B. „2,1° R“
 * oder „13,0 m L“. Andere Winkel mit Vorzeichen, z. B. „−3,1°“.
 */
export function formattedForDisplay(metric, value) {
  const info = METRIC_INFO[metric];
  const scale = 10 ** FRACTION_DIGITS[info.quantity];
  const rounded = roundHalfAway(value * scale) / scale;
  if (info.isSideways) {
    if (rounded === 0) return formatted(metric, 0);
    return formatted(metric, Math.abs(value)) + (value < 0 ? " L" : " R");
  }
  if (info.quantity === "angle" && rounded !== 0) {
    // Der Abflugwinkel ist fast immer positiv, ein Plus wäre dort nur Ballast.
    const plus = metric === "launchAngle" ? "" : "+";
    return (value < 0 ? "−" : plus) + formatted(metric, Math.abs(value));
  }
  return formatted(metric, value);
}

/**
 * Was ein Wert für den Schwung bedeutet. Gemessen wird für beide Spielhände
 * gleich (rechts positiv), die Bedeutung ist gespiegelt: 2° nach rechts ist
 * beim Rechtshänder „von innen“, beim Linkshänder „von außen“.
 */
export function meaning(metric, value, handedness = "right") {
  if (Math.abs(value) < 0.05) return null;
  const awayFromBody = (handedness === "left" ? -value : value) > 0;
  switch (metric) {
    case "clubPath":
      return awayFromBody ? "von innen" : "von außen";
    case "faceAngle":
      return awayFromBody ? "offen zum Ziel" : "geschlossen zum Ziel";
    case "faceToPath":
      return awayFromBody ? "offen zur Bahn" : "geschlossen zur Bahn";
    case "attackAngle":
      return value > 0 ? "nach oben" : "nach unten";
    case "spinAxis":
      return (value > 0 ? "dreht nach rechts" : "dreht nach links") + (awayFromBody ? ", Fade" : ", Draw");
    default:
      return null;
  }
}

// MARK: - Schlägernamen

const IRON_WORDS = ["iron", "eisen", "hierro", "ijzer"];
const WOOD_WORDS = ["wood", "holz", "madera", "hout"];
const HYBRID_WORDS = ["hybrid", "hibrido", "rescue", "utility"];

/**
 * Zum Beispiel „7 Iron“, „Eisen 7“ oder „7i“ → „Eisen 7“, „Sandwedge“ → „Sand
 * Wedge“. Unbekannte Namen bleiben, wie sie sind.
 */
export function canonicalClub(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const compact = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.includes("driver")) return "Driver";
  if (compact.includes("putter")) return "Putter";
  if (compact.includes("pitching") || compact === "pw") return "Pitching Wedge";
  if (compact.includes("gap") || compact.includes("approach") || compact === "gw" || compact === "aw") return "Gap Wedge";
  if (compact.includes("sand") || compact === "sw") return "Sand Wedge";
  if (compact.includes("lob") || compact === "lw") return "Lob Wedge";

  const digits = compact.match(/\p{N}+/u)?.[0] ?? "";
  const number = /^[0-9]+$/.test(digits) ? Number(digits) : NaN;
  if (!(number >= 1 && number <= 9)) return trimmed;
  const letters = compact.replace(/[^\p{L}]/gu, "");
  const mentions = (words) => words.some((word) => letters.includes(word));
  if (mentions(IRON_WORDS) || letters === "i" || letters === "er") return `Eisen ${number}`;
  if (mentions(HYBRID_WORDS) || letters === "h") return `Hybrid ${number}`;
  if (mentions(WOOD_WORDS) || letters === "w") return `Holz ${number}`;
  return trimmed;
}

// MARK: - Sessions

/** Schläger einer Session in der Reihenfolge des ersten Schlags. */
export function sessionClubs(session) {
  return [...new Set(session.shots.map((shot) => shot.club))];
}

/**
 * Gleich für dieselbe Session, auch wenn sie ein zweites Mal importiert wird,
 * auch in einer anderen Zeitzone. Deshalb ohne Uhrzeiten.
 */
export function fingerprint(session) {
  const sum = (metric) => session.shots.reduce((total, shot) => total + (shot.values[metric] ?? 0), 0);
  return `${session.shots.length}|${roundHalfAway(sum("carryDistance") * 10)}|${roundHalfAway(sum("ballSpeed") * 10)}|${session.shots.map((shot) => shot.club).join(",")}`;
}

// MARK: - Statistik

/** Ein Schlag gilt als grober Fehlschlag, wenn sein Carry unter diesem Anteil des Medians des Schlägers liegt. */
export const MISHIT_SHARE = 0.6;

export function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function standardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const valuesOf = (shots, metric) => shots.map((shot) => shot.values[metric]).filter((value) => value != null);

/**
 * Schläge ohne grobe Fehlschläge. Ohne Carry ist ein Schlag nicht gemessen
 * und zählt nicht, sobald andere Schläge ein Carry haben.
 */
export function withoutMishits(shots) {
  const medianCarry = median(valuesOf(shots, "carryDistance"));
  if (medianCarry == null || !(medianCarry > 0)) return shots;
  return shots.filter((shot) => shot.values.carryDistance != null && shot.values.carryDistance >= medianCarry * MISHIT_SHARE);
}

/** Zusammenfassung pro Schläger, längster Schläger zuerst: { club, shotCount, usedShotCount, averages, carrySpread, lateralSpread }. */
export function summaries(shots) {
  const byClub = new Map();
  for (const shot of shots) {
    if (!byClub.has(shot.club)) byClub.set(shot.club, []);
    byClub.get(shot.club).push(shot);
  }
  return [...byClub.entries()]
    .map(([club, clubShots]) => {
      const used = withoutMishits(clubShots);
      const averages = {};
      for (const metric of METRICS) {
        const average = mean(valuesOf(used, metric));
        if (average != null) averages[metric] = average;
      }
      return {
        club,
        shotCount: clubShots.length,
        usedShotCount: used.length,
        averages,
        carrySpread: standardDeviation(valuesOf(used, "carryDistance")),
        lateralSpread: standardDeviation(valuesOf(used, "carryDeviation")),
      };
    })
    .sort((a, b) => {
      const left = a.averages.carryDistance ?? -1;
      const right = b.averages.carryDistance ?? -1;
      return left !== right ? right - left : a.club < b.club ? -1 : a.club > b.club ? 1 : 0;
    });
}

/** Verlauf eines Messwerts für einen Schläger über die Sessions: [{ date, value, shotCount }], älteste zuerst. */
export function trend(metric, club, sessions) {
  return sessions
    .map((session) => {
      const values = valuesOf(withoutMishits(session.shots.filter((shot) => shot.club === club)), metric);
      const average = mean(values);
      return average == null ? null : { date: session.date, value: average, shotCount: values.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}
