// Schwunganalysen aus der App anzeigen: Angaben, Kurzfassung der Erkennung,
// Phasen, Kennzahlen mit Prüfung, Rückmeldung, Richtwerte und Verlauf. Eine
// Übertragung der Anzeige-Logik aus GolfCore/Sources/GolfCore/SwingAnalysis/
// (SwingAnalysis, SwingPhases, SwingMetrics, SwingReliability, SwingFeedback,
// PoseQuality, HandednessDetector). Reine Funktionen, geprüft gegen
// Fixtures/web-analysis.json aus dem Swift-Kern (WebAnalysisParityTests).
//
// Die Analysen liegen unverändert in `extra.analyses` der App-Daten, so wie die
// App sie speichert. Gelesen wird beim Anzeigen, nachsichtig wie im Kern: Was
// eine andere Version dazubringt, fällt weg, statt die Analyse unlesbar zu machen.
import { fromStored } from "./dates.js";

export const CAMERA_ANGLES = ["faceOn", "downTheLine"];
export const CAMERA_ANGLE_NAMES = { faceOn: "Von vorne", downTheLine: "Von hinten" };
/** Fachbegriff, wie er in Lehrvideos und bei Trainern üblich ist. */
export const CAMERA_ANGLE_TECHNICAL = { faceOn: "Face-on", downTheLine: "Down-the-Line" };
export const SWING_TYPES = ["full", "pitch", "chip"];
export const SWING_TYPE_NAMES = { full: "Voller Schwung", pitch: "Pitch", chip: "Chip" };
export const STATUSES = ["pending", "analyzed", "failed"];
export const HANDEDNESS_NAMES = { right: "Rechtshänder", left: "Linkshänder" };
/** Ab dieser Sicherheit vergleicht die App die erkannte Spielhand mit der Einstellung. */
export const RELIABLE_CONFIDENCE = 0.6;
/** Mehr Bilder pro Sekunde wertet die Analyse nicht aus. */
export const ANALYSIS_FRAME_RATE = 120;

export const BODY_PARTS = ["head", "shoulders", "arms", "hands", "hips", "knees", "feet"];
export const BODY_PART_NAMES = { head: "Kopf", shoulders: "Schultern", arms: "Arme", hands: "Hände", hips: "Hüfte", knees: "Knie", feet: "Füße" };

/** „Hände und Füße“, „Kopf, Hände und Füße“, in fester Reihenfolge. */
export function listParts(parts) {
  const names = BODY_PARTS.filter((part) => parts.includes(part)).map((part) => BODY_PART_NAMES[part]);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

export const EVENTS = ["address", "armBack", "top", "armDown", "impact", "finish"];
export const EVENT_NAMES = { address: "Ansprechen", armBack: "Arm waagerecht", top: "Umkehrpunkt", armDown: "Arm waagerecht", impact: "Treffmoment", finish: "Finish" };
export const EVENT_FULL_NAMES = { ...EVENT_NAMES, armBack: "Arm waagerecht im Rückschwung", armDown: "Arm waagerecht im Abschwung" };
/** „am Umkehrpunkt“, für Sätze wie „Hände am Umkehrpunkt unsicher erkannt“. */
export const EVENT_PHRASES = { address: "beim Ansprechen", armBack: "im Rückschwung", top: "am Umkehrpunkt", armDown: "im Abschwung", impact: "im Treffmoment", finish: "im Finish" };
export const PHASES = ["address", "backswing", "downswing", "followThrough", "finish"];
export const PHASE_NAMES = { address: "Ansprechen", backswing: "Rückschwung", downswing: "Abschwung", followThrough: "Durchschwung", finish: "Finish" };
export const IMPACT_SOURCES = ["clip", "skeleton"];
export const IMPACT_SOURCE_TEXTS = { clip: "aus dem Clip", skeleton: "aus dem Skelett geschätzt" };

export const GROUPS = ["rotation", "posture", "head", "hips", "tempo"];
export const GROUP_NAMES = { rotation: "Drehung", posture: "Haltung", head: "Kopf", hips: "Hüfte", tempo: "Tempo und Länge" };

const BOTH = ["faceOn", "downTheLine"];
const FRONT = ["faceOn"];
const BEHIND = ["downTheLine"];

/**
 * Die Kennzahlen in der Reihenfolge von `SwingMetric.Kind`: Gruppe, Name,
 * Ansichten, aus denen sie sich gut schätzen lassen, Art der Anzeige und Einheit
 * fürs Diagramm. Rohwerte in Grundeinheiten: Grad, Meter, Sekunden, Verhältnis
 * oder Stunden auf der Uhr.
 */
export const METRICS = {
  shoulderTurnTop: { group: "rotation", name: "Schulterdrehung am Umkehrpunkt", views: BOTH, format: "degrees", unit: "Grad" },
  hipTurnTop: { group: "rotation", name: "Hüftdrehung am Umkehrpunkt", views: BOTH, format: "degrees", unit: "Grad" },
  xFactorTop: { group: "rotation", name: "X-Faktor am Umkehrpunkt", views: BOTH, format: "degrees", unit: "Grad" },
  xFactorStretch: { group: "rotation", name: "X-Faktor im Abschwung, größter Wert", views: BOTH, format: "degrees", unit: "Grad" },
  hipOpenImpact: { group: "rotation", name: "Hüfte im Treffmoment", views: BOTH, format: "directedDegrees", words: ["offen", "geschlossen", "gerade"], unit: "Grad, plus heißt offen" },
  spineTiltAddress: { group: "posture", name: "Vorneigung beim Ansprechen", views: BEHIND, format: "degrees", unit: "Grad" },
  spineTiltChange: { group: "posture", name: "Vorneigung bis zum Treffmoment", views: BEHIND, format: "directedDegrees", words: ["mehr geneigt", "aufgerichtet", "gleich"], unit: "Grad, minus heißt aufgerichtet" },
  sideBendAddress: { group: "posture", name: "Seitneigung beim Ansprechen", views: FRONT, format: "directedDegrees", words: ["vom Ziel weg", "zum Ziel hin", "gerade"], unit: "Grad, plus heißt vom Ziel weg" },
  headSwayTop: { group: "head", name: "Kopf seitlich bis zum Umkehrpunkt", views: FRONT, format: "length", words: ["nach hinten", "zum Ziel"], unit: "cm, plus heißt nach hinten" },
  headSwayImpact: { group: "head", name: "Kopf seitlich bis zum Treffmoment", views: FRONT, format: "length", words: ["nach hinten", "zum Ziel"], unit: "cm, plus heißt nach hinten" },
  headHeightImpact: { group: "head", name: "Kopf in der Höhe bis zum Treffmoment", views: BOTH, format: "length", words: ["höher", "tiefer"], unit: "cm, plus heißt höher" },
  hipSwayTop: { group: "hips", name: "Hüfte seitlich bis zum Umkehrpunkt", views: FRONT, format: "length", words: ["nach hinten", "zum Ziel"], unit: "cm, plus heißt nach hinten" },
  hipSlideImpact: { group: "hips", name: "Hüfte seitlich bis zum Treffmoment", views: FRONT, format: "length", words: ["nach hinten", "zum Ziel"], unit: "cm, plus heißt nach hinten" },
  hipTowardBallImpact: { group: "hips", name: "Hüfte zum Ball bis zum Treffmoment", views: BEHIND, format: "length", words: ["näher", "weiter weg"], unit: "cm, plus heißt näher zum Ball" },
  tempoRatio: { group: "tempo", name: "Tempo, Rückschwung zu Abschwung", views: BOTH, format: "tempo", unit: "Rückschwung zu Abschwung" },
  swingTime: { group: "tempo", name: "Dauer bis zum Treffmoment", views: BOTH, format: "seconds", unit: "Sekunden" },
  armClockTop: { group: "tempo", name: "Führungsarm am Umkehrpunkt", views: FRONT, format: "clock", unit: "Uhr, 9 heißt waagerecht" },
};
export const METRIC_KINDS = Object.keys(METRICS);
export const ISSUES = ["wrongView", "notVisible", "implausible", "noisy", "unknown"];

// MARK: - Zahlen wie in der App

/** Wie `Double.rounded()` in Swift: Hälften weg von null, nicht wie Math.round. */
function roundHalfAway(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Zahl mit Komma wie `String(format: "%.Nf")`: genaue Hälften zur geraden Ziffer. */
export function number(value, decimals) {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  let text;
  if (Number.isFinite(scaled) && Number.isInteger(scaled * 2) && !Number.isInteger(scaled)) {
    text = ((2 * Math.round(scaled / 2)) / factor).toFixed(decimals);
  } else {
    text = value.toFixed(decimals);
  }
  return text.replace(".", ",");
}

/** Ganze Grad, negative mit echtem Minuszeichen. */
function degrees(value) {
  const rounded = roundHalfAway(value);
  return `${rounded < 0 ? "−" : ""}${number(Math.abs(rounded), 0)}°`;
}

function directedDegrees(value, [positive, negative, neutral]) {
  const rounded = roundHalfAway(value);
  if (rounded === 0) return neutral;
  return `${number(Math.abs(rounded), 0)}° ${rounded > 0 ? positive : negative}`;
}

/** Meter als ganze Zentimeter mit Richtung, unter 1 cm ohne Richtung. */
function directedLength(value, [positive, negative]) {
  const centimeters = roundHalfAway(value * 100);
  if (centimeters === 0) return "unter 1 cm";
  return `${number(Math.abs(centimeters), 0)} cm ${centimeters > 0 ? positive : negative}`;
}

/** Stunden auf dem Zifferblatt, 0 bis unter 12. */
function wrapHours(hours) {
  const wrapped = hours % 12;
  return wrapped < 0 ? wrapped + 12 : wrapped;
}

/** Wie `ArmClock.displayText`: auf Viertelstunden gerundet, z. B. „9 Uhr“ oder „7:30 Uhr“. */
export function clockText(hours) {
  const quarters = Math.round(wrapHours(hours) * 4) % 48;
  const hour = Math.floor(quarters / 4) === 0 ? 12 : Math.floor(quarters / 4);
  const minutes = (quarters % 4) * 15;
  return minutes === 0 ? `${hour} Uhr` : `${hour}:${String(minutes).padStart(2, "0")} Uhr`;
}

/** Sekunden wie in der App, z. B. „0,30 s“. */
export function secondsText(value) {
  return `${number(value, 2)} s`;
}

/** Der Wert zum Anzeigen, mit Richtung in Worten, z. B. „4 cm nach hinten“. */
export function formatMetric(kind, value) {
  const metric = METRICS[kind];
  switch (metric?.format) {
    case "degrees":
      return degrees(value);
    case "directedDegrees":
      return directedDegrees(value, metric.words);
    case "length":
      return directedLength(value, metric.words);
    case "tempo":
      return `${number(value, 1)} : 1`;
    case "seconds":
      return `${number(value, 2)} s`;
    case "clock":
      return clockText(value);
    default:
      return String(value);
  }
}

/** Wert für Diagramme: Längen in Zentimetern, alles andere wie gespeichert. */
export function chartValue(kind, value) {
  return METRICS[kind]?.format === "length" ? value * 100 : value;
}

/** Unsicherheit zum Lesen, z. B. „12°“ oder „5 cm“, großzügig aufgerundet. */
export function formattedSpread(kind, spread) {
  switch (METRICS[kind]?.format) {
    case "degrees":
    case "directedDegrees":
      return `${number(Math.ceil(spread), 0)}°`;
    case "length":
      return `${number(Math.ceil(spread * 100), 0)} cm`;
    case "tempo":
      return number(Math.ceil(spread * 10) / 10, 1);
    case "seconds":
      return `${number(Math.ceil(spread * 100) / 100, 2)} s`;
    case "clock":
      // Eine Stunde auf der Uhr sind 30°.
      return `${number(Math.ceil(spread * 30), 0)}°`;
    default:
      return String(spread);
  }
}

// MARK: - Lesen

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);

function decodeDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) return fromStored(value);
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Wie `ValueCheck.init(from:)`: ein unbekannter Grund zählt als unsicher, Unbekanntes fällt weg. */
export function decodeCheck(json) {
  if (!isObject(json)) return null;
  const rawIssue = typeof json.issue === "string" ? json.issue : null;
  return {
    spread: finite(json.spread),
    issue: rawIssue == null ? null : ISSUES.includes(rawIssue) ? rawIssue : "unknown",
    parts: Array.isArray(json.parts) ? json.parts.filter((part) => BODY_PARTS.includes(part)) : [],
    moment: oneOf(json.moment, EVENTS),
  };
}

function decodeHandednessEstimate(json) {
  if (!isObject(json)) return null;
  // Eine unbekannte Spielhand macht in der App die ganze Kurzfassung unlesbar.
  if (json.handedness != null && !["right", "left"].includes(json.handedness)) return null;
  const confidence = finite(json.confidence);
  if (confidence == null) return null;
  return { handedness: json.handedness ?? null, confidence, topTime: finite(json.topTime), sidesDisagree: json.sidesDisagree === true };
}

const WARNING_KINDS = ["noPerson", "cutOff", "lowConfidence", "jumpy", "sidesUncertain", "handednessUnclear"];

/** Kurzfassung der 3D-Pose. Null, wenn ein Pflichtfeld fehlt, wie `try? decode` in der App. */
export function decodePoseSummary(json) {
  if (!isObject(json)) return null;
  const frameCount = finite(json.frameCount);
  const detectedCount = finite(json.detectedCount);
  const handedness = decodeHandednessEstimate(json.handedness);
  if (frameCount == null || detectedCount == null || !handedness || !Array.isArray(json.warnings)) return null;
  const warnings = [];
  for (const warning of json.warnings) {
    const kind = oneOf(warning?.kind, WARNING_KINDS);
    const share = finite(warning?.share);
    if (!kind || share == null) return null;
    warnings.push({ kind, share, parts: Array.isArray(warning.parts) ? warning.parts.filter((part) => BODY_PARTS.includes(part)) : [] });
  }
  return {
    frameCount,
    detectedCount,
    handedness,
    warnings,
    bodyHeight: finite(json.bodyHeight),
    heightIsMeasured: json.heightIsMeasured === true,
    source: typeof json.source === "string" ? json.source : "",
    analyzedAt: decodeDate(json.analyzedAt),
  };
}

const NOTE_KINDS = ["noSwing", "startCut", "finishCut", "impactCut", "clipImpactIgnored", "unusualTiming"];

/** Wie `SwingPhases.init(from:)`: einzelne Werte aus einer anderen Version machen die Phasen nicht unlesbar. */
export function decodePhases(json) {
  if (!isObject(json)) return null;
  // Eine Liste mit einem unbekannten Hinweis liest die App als leere Liste.
  const rawNotes = Array.isArray(json.notes) ? json.notes : [];
  const notes = rawNotes.every((note) => NOTE_KINDS.includes(note?.kind)) ? rawNotes.map((note) => ({ kind: note.kind })) : [];
  const checks = {};
  if (isObject(json.checks)) {
    for (const [event, check] of Object.entries(json.checks)) {
      const decoded = EVENTS.includes(event) ? decodeCheck(check) : null;
      if (decoded) checks[event] = decoded;
    }
  }
  return {
    address: finite(json.address),
    armBack: finite(json.armBack),
    top: finite(json.top),
    armDown: finite(json.armDown),
    impact: finite(json.impact),
    impactSource: oneOf(json.impactSource, IMPACT_SOURCES),
    finish: finite(json.finish),
    notes,
    checks,
  };
}

/** Wie `SwingMetrics.init(from:)`: unbekannte Werte fallen weg, die übrigen bleiben. */
export function decodeMetrics(json) {
  if (!isObject(json)) return null;
  const values = [];
  for (const item of Array.isArray(json.values) ? json.values : []) {
    const kind = oneOf(item?.kind, METRIC_KINDS);
    const value = finite(item?.value);
    if (!kind || value == null) continue;
    values.push({ kind, value, check: decodeCheck(item.check) });
  }
  return {
    values,
    handedness: oneOf(json.handedness, ["right", "left"]) ?? "right",
    scaleIsMeasured: json.scaleIsMeasured === true,
  };
}

/** Eine Analyse, wie `SwingAnalysis.init(from:)`. Null ohne Kennung oder Datum. */
export function decodeAnalysis(json) {
  if (!isObject(json) || typeof json.id !== "string") return null;
  const date = decodeDate(json.date);
  if (!date) return null;
  const start = finite(json.start) ?? 0;
  const end = finite(json.end) ?? 0;
  return {
    id: json.id,
    date,
    createdAt: decodeDate(json.createdAt) ?? date,
    clipID: typeof json.clipID === "string" ? json.clipID : null,
    start,
    end,
    range: [Math.min(start, end), Math.max(start, end)],
    cameraAngle: oneOf(json.cameraAngle, CAMERA_ANGLES) ?? "faceOn",
    frameRate: finite(json.frameRate) ?? 30,
    swingType: oneOf(json.swingType, SWING_TYPES) ?? "full",
    club: typeof json.club === "string" ? json.club : "",
    status: oneOf(json.status, STATUSES) ?? "pending",
    note: typeof json.note === "string" ? json.note : "",
    pose: decodePoseSummary(json.pose),
    phases: decodePhases(json.phases),
    metrics: decodeMetrics(json.metrics),
  };
}

export function decodeAnalyses(list) {
  return (Array.isArray(list) ? list : []).map(decodeAnalysis).filter(Boolean);
}

/** Der neueste Schwung zuerst, wie `sortedAnalyses` in der App. */
export function sortAnalyses(analyses) {
  return [...analyses].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
}

// MARK: - Angaben

export const duration = (analysis) => analysis.range[1] - analysis.range[0];

/** „Von vorne · Eisen 7 · 120 B/s“, Schlagart nur, wenn es kein voller Schwung ist. */
export function analysisSubtitle(analysis) {
  const parts = [CAMERA_ANGLE_NAMES[analysis.cameraAngle]];
  if (analysis.club !== "") parts.push(analysis.club);
  if (analysis.swingType !== "full") parts.push(SWING_TYPE_NAMES[analysis.swingType]);
  parts.push(`${Math.round(analysis.frameRate)} B/s`);
  return parts.join(" · ");
}

export function analysisStatusText(analysis) {
  switch (analysis.status) {
    case "analyzed": {
      const hints = analysis.pose?.warnings.length ?? 0;
      return hints === 0 ? "Ausgewertet" : hints === 1 ? "Ausgewertet · 1 Hinweis" : `Ausgewertet · ${hints} Hinweise`;
    }
    case "failed":
      return "Auswertung fehlgeschlagen";
    default:
      return "Noch nicht ausgewertet";
  }
}

export function angleText(analysis) {
  return `${CAMERA_ANGLE_NAMES[analysis.cameraAngle]} (${CAMERA_ANGLE_TECHNICAL[analysis.cameraAngle]})`;
}

/** Wie `AnalysisRange.sampling`: wie viele Bilder des Ausschnitts ausgewertet werden. */
export function samplingCount(range, frameRate) {
  if (!(frameRate > 0)) return 0;
  const stride = Math.max(1, Math.round(frameRate / ANALYSIS_FRAME_RATE));
  const first = Math.ceil(range[0] * frameRate - 1e-6);
  const last = Math.floor(range[1] * frameRate + 1e-6);
  const frames = Math.max(0, last - first + 1);
  return frames === 0 ? 0 : Math.floor((frames - 1) / stride) + 1;
}

/** Bereich der Übungen, zu dem der Schwung passt. */
export function skillArea(analysis) {
  if (analysis.swingType === "chip") return "shortGame";
  if (analysis.swingType === "pitch") return "wedges";
  const name = analysis.club.toLowerCase();
  return ["driver", "holz", "wood"].some((word) => name.includes(word)) ? "driving" : "approach";
}

// MARK: - Kurzfassung der Erkennung

export const isReliableHandedness = (estimate) => estimate.handedness != null && estimate.confidence >= RELIABLE_CONFIDENCE;

export function handednessText(estimate) {
  if (estimate.handedness == null) return "nicht erkennbar";
  return isReliableHandedness(estimate) ? HANDEDNESS_NAMES[estimate.handedness] : `${HANDEDNESS_NAMES[estimate.handedness]}, unsicher`;
}

/** Hinweis, wenn die Spielhand im Video sicher erkannt ist und nicht zur Einstellung passt. */
export function handednessMismatch(estimate, setting) {
  if (!isReliableHandedness(estimate) || estimate.handedness === setting) return null;
  return `Im Video sieht es nach ${HANDEDNESS_NAMES[estimate.handedness]} aus, eingestellt ist ${HANDEDNESS_NAMES[setting]}. Prüfe die Spielhand in den Einstellungen.`;
}

export function scaleText(summary) {
  if (summary.heightIsMeasured && summary.bodyHeight != null) return `${number(summary.bodyHeight, 2)} m, mit LiDAR gemessen`;
  return "angenommene Körpergröße";
}

export const detectedText = (summary) => `${summary.detectedCount} von ${summary.frameCount}`;

const percentText = (share) => `${Math.round(share * 100)} %`;

export function warningTitle(warning) {
  switch (warning.kind) {
    case "noPerson":
      return `In ${percentText(warning.share)} der Bilder keine Person erkannt`;
    case "cutOff":
      return `${listParts(warning.parts)} teilweise nicht im Bild`;
    case "lowConfidence":
      return `${listParts(warning.parts)} unsicher erkannt`;
    case "jumpy":
      return `Unruhige Erkennung in ${percentText(warning.share)} der Bilder`;
    case "sidesUncertain":
      return "Links und rechts unsicher";
    default:
      return "Spielhand nicht erkennbar";
  }
}

export function warningAdvice(warning) {
  switch (warning.kind) {
    case "noPerson":
      return "Filme mit dem ganzen Körper im Bild, bei gutem Licht und ohne andere Personen dahinter.";
    case "cutOff":
      return warning.parts.includes("hands")
        ? "Geh weiter weg oder stell die Kamera höher, damit auch die Hände oben im Rückschwung im Bild bleiben."
        : "Geh weiter weg, damit vom Kopf bis zu den Füßen alles im Bild bleibt.";
    case "lowConfidence":
      return "Mehr Licht, eng anliegende Kleidung in einer Farbe, die sich vom Hintergrund abhebt, und eine höhere Bildrate gegen Unschärfe helfen.";
    case "jumpy":
      return "Werte aus diesen Bildern sind weniger verlässlich. Mehr Licht und eine höhere Bildrate helfen.";
    case "sidesUncertain":
      return "Die Erkennung hat linke und rechte Körperseite womöglich vertauscht. Filme möglichst genau von vorne oder von hinten.";
    default:
      return "Der Ausschnitt zeigt kein deutliches Ausholen. Schneide ihn vom Ansprechen bis ins Finish zu.";
  }
}

// MARK: - Phasen

/** Sicher genug zum Anzeigen. Ohne Prüfung, also bei älteren Analysen, ja. */
export const isSureEvent = (phases, event) => phases.checks[event]?.issue == null;

/** Nur die sicheren Zeitpunkte. Unsichere fallen weg, samt der Abschnitte und Dauern, die an ihnen hängen. */
export function sureOnly(phases) {
  const shown = { ...phases };
  for (const event of EVENTS) {
    if (isSureEvent(phases, event)) continue;
    shown[event] = null;
    if (event === "impact") shown.impactSource = null;
  }
  return shown;
}

/** Unsichere Zeitpunkte, die erkannt wurden, in der Reihenfolge des Schwungs. */
export const unsureEvents = (phases) => EVENTS.filter((event) => phases[event] != null && !isSureEvent(phases, event));

/** Erkannte Zeitpunkte in der Reihenfolge des Schwungs. */
export const marks = (phases) => EVENTS.filter((event) => phases[event] != null).map((event) => ({ event, time: phases[event] }));

/** Dauer von Rückschwung, Abschwung und Durchschwung. Ansprechen und Finish haben keine. */
export function durationOf(phases, phase) {
  const span = (start, end) => (start != null && end != null && end > start ? end - start : null);
  switch (phase) {
    case "backswing":
      return span(phases.address, phases.top);
    case "downswing":
      return span(phases.top, phases.impact);
    case "followThrough":
      return span(phases.impact, phases.finish);
    default:
      return null;
  }
}

/** Rückschwung im Verhältnis zum Abschwung, sobald beides erkannt ist. */
export function tempoOf(phases) {
  const { address, top, impact } = phases;
  if (address == null || top == null || impact == null || !(address < top && top < impact)) return null;
  const ratio = (top - address) / (impact - top);
  return { backswing: top - address, downswing: impact - top, ratio, ratioText: `${number(ratio, 1)} : 1` };
}

/** Richtwert der Tour-Spieler für die Schlagart, gezählt am Schläger. */
export const tourRatio = (swingType) => (swingType === "full" ? 3 : 2);

/** Abstand zum Treffmoment, z. B. „−0,30 s“. Ohne Treffmoment ab Beginn des Ausschnitts. */
export function markTimeText(phases, range, time) {
  if (phases.impact == null) return secondsText(time - range[0]);
  const offset = time - phases.impact;
  if (Math.abs(offset) < 0.005) return secondsText(0);
  return `${offset < 0 ? "−" : "+"}${secondsText(Math.abs(offset))}`;
}

/** Warum ein erkannter Zeitpunkt nicht dasteht, in einem Satz. Null, wenn er dasteht. */
export function phaseMissingReason(phases, event) {
  const check = phases.checks[event];
  if (phases[event] == null || !check || check.issue == null) return null;
  switch (check.issue) {
    case "notVisible":
      return `${check.parts.length === 0 ? "Körper" : listParts(check.parts)} ${EVENT_PHRASES[event]} unsicher erkannt`;
    case "noisy":
      return check.spread != null ? `Schwankt um ±${number(Math.ceil(check.spread * 100) / 100, 2)} s` : "Schwankt zu stark";
    default:
      return "Zu unsicher";
  }
}

export const NOTE_TITLES = {
  noSwing: "Kein Schwung erkannt",
  startCut: "Ansprechen fehlt im Ausschnitt",
  finishCut: "Finish fehlt im Ausschnitt",
  impactCut: "Treffmoment fehlt im Ausschnitt",
  clipImpactIgnored: "Treffmoment im Clip passt nicht",
  unusualTiming: "Ungewöhnliche Zeiten",
};

export const NOTE_ADVICE = {
  noSwing: "Die Hände holen kaum aus. Prüfe, ob der Ausschnitt den ganzen Schwung zeigt.",
  startCut: "Der Ausschnitt beginnt erst im Rückschwung. Leg den Anfang etwas früher, dann stimmt auch die Dauer des Rückschwungs.",
  finishCut: "Der Ausschnitt endet, bevor die Hände im Finish ankommen. Leg das Ende etwas später.",
  impactCut:
    "Nach dem Umkehrpunkt kommen die Hände im Ausschnitt nicht mehr an der Stelle vom Ansprechen vorbei. Endet der Ausschnitt zu früh, leg das Ende später. Ohne Treffmoment fehlen Abschwung, Finish, Tempo und die Kennzahlen im Treffmoment.",
  clipImpactIgnored:
    "Der Treffmoment im Clip liegt weit weg von dem, was das Skelett zeigt. Die Phasen nutzen deshalb die Schätzung aus dem Skelett. Prüfe den Treffmoment des Clips.",
  unusualTiming: "Rückschwung oder Abschwung dauern ungewöhnlich kurz oder lang. Vielleicht sind die Phasen falsch erkannt. Sieh sie dir im Skelett an.",
};

// MARK: - Kennzahlen mit Prüfung

/** Lässt sich aus dieser Ansicht gut schätzen. */
export const isReliable = (kind, view) => METRICS[kind]?.views.includes(view) ?? false;

/** Lässt sich aus dieser Ansicht gut schätzen und ist, falls geprüft, sicher genug. */
export const isShown = (metric, view) => isReliable(metric.kind, view) && metric.check?.issue == null;

/** Satz für Werte aus der falschen Ansicht, null wenn beide passen. */
export function viewHint(kind) {
  const views = METRICS[kind]?.views ?? BOTH;
  if (views.length === 1) return views[0] === "faceOn" ? "Nur von vorne gefilmt verlässlich" : "Nur von hinten gefilmt verlässlich";
  return null;
}

/** Warum der Wert nicht dasteht, in einem Satz. Null, wenn er dasteht. */
export function missingReason(metric, view) {
  if (!isReliable(metric.kind, view)) return viewHint(metric.kind) ?? "Aus dieser Ansicht nicht verlässlich";
  const check = metric.check;
  if (!check || check.issue == null) return null;
  switch (check.issue) {
    case "wrongView":
      return viewHint(metric.kind) ?? "Aus dieser Ansicht nicht verlässlich";
    case "notVisible":
      return [check.parts.length === 0 ? "Körper" : listParts(check.parts), check.moment ? EVENT_PHRASES[check.moment] : null, "unsicher erkannt"].filter(Boolean).join(" ");
    case "implausible":
      return "Unmöglicher Wert, die Erkennung lag hier daneben";
    case "noisy":
      return check.spread != null ? `Schwankt um ±${formattedSpread(metric.kind, check.spread)}` : "Schwankt zu stark";
    default:
      return "Zu unsicher";
  }
}

/** Mit Prüfung gerechnet. Analysen von vor Modul 7 haben keine. */
export const isChecked = (metrics) => metrics.values.some((metric) => metric.check != null);

/** Werte, die nicht dastehen: zu unsicher oder aus dieser Ansicht nicht verlässlich. */
export const hiddenCount = (metrics, view) => metrics.values.filter((metric) => !isShown(metric, view)).length;

/** Was beim nächsten Video am meisten hilft, nach dem häufigsten Grund für unsichere Werte. */
export function metricsAdvice(metrics, view) {
  const issues = metrics.values.filter((metric) => isReliable(metric.kind, view)).map((metric) => metric.check?.issue).filter(Boolean);
  let best = null;
  for (const issue of ["notVisible", "noisy", "implausible"]) {
    const count = issues.filter((other) => other === issue).length;
    if (count > (best?.count ?? 0)) best = { issue, count };
  }
  switch (best?.issue) {
    case "notVisible":
      return "Am meisten hilft beim nächsten Video: der ganze Körper im Bild, gutes Licht und Kleidung, die sich vom Hintergrund abhebt.";
    case "noisy":
      return "Am meisten hilft beim nächsten Video: mehr Licht und Zeitlupe mit 120 oder 240 Bildern pro Sekunde. Dann zittert die Erkennung weniger.";
    case "implausible":
      return "Am meisten hilft beim nächsten Video: genau von vorne oder von hinten filmen, mit dem ganzen Körper im Bild.";
    default:
      return null;
  }
}

/** Hinweis unter dem Namen einer Kennzahl, wo einer nötig ist. */
export function metricDetail(kind, swingType) {
  if (kind === "xFactorTop") return "Schulterdrehung minus Hüftdrehung";
  if (kind === "tempoRatio") return `Profis etwa ${tourRatio(swingType)} : 1 am Schläger, an den Händen meist etwas weniger`;
  return null;
}

export function valuesInGroup(metrics, group) {
  return metrics.values.filter((metric) => METRICS[metric.kind].group === group);
}

// MARK: - Rückmeldung

/** Richtwert einer Kennzahl für eine Schlagart, falls es einen gibt. */
export function targetFor(rules, kind, swingType) {
  return rules?.targets?.find((target) => target.metric === kind && target.swingTypes.includes(swingType)) ?? null;
}

/** Liegt der Wert im Bereich guter Spieler? */
export const targetContains = (target, value) => (target.low == null || value >= target.low) && (target.high == null || value <= target.high);

/** Trifft der Hinweis auf diesen Wert zu? */
export const hintApplies = (hint, value) => (hint.below != null && value < hint.below) || (hint.above != null && value > hint.above);

function feedbackItem(metric, formatted, target, hint) {
  if (hint) {
    return {
      id: hint.id,
      metric: metric.kind,
      value: metric.value,
      formattedValue: formatted,
      title: hint.title,
      text: hint.text.replaceAll("{wert}", formatted),
      advice: hint.advice,
      drillIDs: [...(hint.drills ?? [])],
      focus: hint.focus,
      priority: hint.priority,
      note: target.note,
      sources: target.sources ?? [],
    };
  }
  return {
    id: metric.kind,
    metric: metric.kind,
    value: metric.value,
    formattedValue: formatted,
    title: METRICS[metric.kind].name,
    text: target.strength,
    advice: "",
    drillIDs: [],
    focus: "",
    priority: 0,
    note: target.note,
    sources: target.sources ?? [],
  };
}

/**
 * Bewertet die Kennzahlen einer Analyse, wie `SwingFeedback.evaluate`: nur Werte,
 * die aus dieser Ansicht gut zu schätzen und sicher genug sind. Höchstens `limit`
 * Hinweise oben, das Wichtigste zuerst.
 */
export function evaluateFeedback(metrics, swingType, cameraAngle, frameRate, rules, limit = 2) {
  const hints = [];
  const strengths = [];
  const tooFewFrames = [];
  const unsure = [];
  for (const metric of metrics.values) {
    if (!isReliable(metric.kind, cameraAngle)) continue;
    const target = targetFor(rules, metric.kind, swingType);
    if (!target) continue;
    if (!isShown(metric, cameraAngle)) {
      unsure.push(metric.kind);
      continue;
    }
    if (target.minimumFrameRate != null && frameRate != null && frameRate < target.minimumFrameRate) {
      tooFewFrames.push(metric.kind);
      continue;
    }
    const formatted = formatMetric(metric.kind, metric.value);
    const hint = (target.hints ?? []).find((candidate) => hintApplies(candidate, metric.value));
    if (hint) hints.push({ item: feedbackItem(metric, formatted, target, hint), order: hints.length });
    else if (targetContains(target, metric.value) && target.strength) strengths.push(feedbackItem(metric, formatted, target, null));
  }
  const sorted = hints.sort((a, b) => b.item.priority - a.item.priority || a.order - b.order).map((entry) => entry.item);
  const count = Math.max(0, limit);
  return { hints: sorted.slice(0, count), strengths, moreHints: sorted.slice(count), tooFewFrames, unsure };
}

/** „Hinweis bei unter 70°“ oder „Hinweis bei unter 20° oder über 50°“. */
export function hintLimitText(hint, kind) {
  const values = [hint.below != null ? `unter ${formatMetric(kind, hint.below)}` : null, hint.above != null ? `über ${formatMetric(kind, hint.above)}` : null];
  return `Hinweis bei ${values.filter(Boolean).join(" oder ")}`;
}

/**
 * Schwerpunkt aus einem Hinweis, wie `FocusPoint.suggested`: Es bleiben nur
 * Übungen, die der Editor für den Bereich zeigt. Passt keine zum Bereich, gilt
 * der Bereich der ersten Übung.
 */
export function suggestedFocus(hint, area, library) {
  const drills = hint.drillIDs.map((id) => library.find((drill) => drill.id === id)).filter(Boolean);
  const isShownIn = (drill, chosen) => drill.mode === "block" && !drill.isWarmUp && (drill.area === chosen || drill.isCorrective);
  let chosen = area;
  if (!drills.some((drill) => isShownIn(drill, area))) {
    const first = drills.find((drill) => drill.mode === "block" && !drill.isWarmUp);
    if (first) chosen = first.area;
  }
  return { text: hint.focus, area: chosen, priority: 2, isActive: true, drillIDs: drills.filter((drill) => isShownIn(drill, chosen)).map((drill) => drill.id) };
}

// MARK: - Verlauf

/** Werte einer Kennzahl, der älteste zuerst: nur diese Schlagart, nur sichere Werte aus passender Ansicht. */
export function historyPoints(kind, swingType, analyses) {
  return analyses
    .filter((analysis) => analysis.swingType === swingType)
    .flatMap((analysis) => {
      const metric = analysis.metrics?.values.find((candidate) => candidate.kind === kind && isShown(candidate, analysis.cameraAngle));
      return metric ? [{ analysisID: analysis.id, date: analysis.date, value: metric.value, cameraAngle: analysis.cameraAngle }] : [];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Kennzahlen mit mindestens so vielen Werten, in fester Reihenfolge. */
export function historyKinds(swingType, analyses, minimum = 1) {
  return METRIC_KINDS.filter((kind) => historyPoints(kind, swingType, analyses).length >= minimum);
}

/** Schlagarten, für die es ausgewertete Kennzahlen gibt. */
export function historySwingTypes(analyses) {
  return SWING_TYPES.filter((type) => analyses.some((analysis) => analysis.swingType === type && (analysis.metrics?.values.length ?? 0) > 0));
}

/** Wie oft die letzten Werte im Bereich guter Spieler lagen, z. B. 3 der letzten 5. */
export function recentShare(points, target, count = 5) {
  const recent = points.slice(Math.max(0, points.length - Math.max(0, count)));
  return { inside: recent.filter((point) => targetContains(target, point.value)).length, total: recent.length };
}
