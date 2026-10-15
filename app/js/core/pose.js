// 3D-Pose pro Bild, wie Modul 2 der Schwunganalyse im Kern: Skelett mit 17
// Gelenken, Bildfolge im Format der App, Achsen ausrichten (PoseAxes), Glätten
// mit dem One-Euro-Filter (PoseSmoothing), Spielhand am ersten Ausholen
// (HandednessDetector), Hinweise zur Erkennung (PoseQuality) und die
// Kurzfassung (PoseAnalysis). Reine Funktionen, geprüft gegen
// Fixtures/web-pose.json aus dem Swift-Kern (WebPoseParityTests).
//
// Achsen wie die Kamera sie sieht: x nach rechts im Bild, y nach oben, z zur
// Kamera hin. Vor der Kamera ist z also negativ. Punkte sind [x, y, z] in Metern.
import { RELIABLE_CONFIDENCE } from "./analysis.js";

/** Gelenke in der Reihenfolge gespeicherter Bildfolgen. Nie umstellen. */
export const JOINTS = [
  "root", "spine", "centerShoulder", "centerHead", "topHead",
  "leftShoulder", "leftElbow", "leftWrist",
  "rightShoulder", "rightElbow", "rightWrist",
  "leftHip", "leftKnee", "leftAnkle",
  "rightHip", "rightKnee", "rightAnkle",
];

/** Körperteil jedes Gelenks für Hinweise wie „Hände nicht im Bild“. */
export const JOINT_PART = {
  centerHead: "head", topHead: "head",
  centerShoulder: "shoulders", leftShoulder: "shoulders", rightShoulder: "shoulders", spine: "shoulders",
  leftElbow: "arms", rightElbow: "arms",
  leftWrist: "hands", rightWrist: "hands",
  root: "hips", leftHip: "hips", rightHip: "hips",
  leftKnee: "knees", rightKnee: "knees",
  leftAnkle: "feet", rightAnkle: "feet",
};

export const BODY_PARTS = ["head", "shoulders", "arms", "hands", "hips", "knees", "feet"];
export const PART_JOINTS = Object.fromEntries(BODY_PARTS.map((part) => [part, JOINTS.filter((joint) => JOINT_PART[joint] === part)]));

/** Dasselbe Gelenk auf der anderen Körperseite. */
export const MIRRORED = Object.fromEntries(JOINTS.map((joint) => [joint, joint.startsWith("left") ? `right${joint.slice(4)}` : joint.startsWith("right") ? `left${joint.slice(5)}` : joint]));

/** Verbindungen für die Strichfigur. */
export const BONES = [
  ["root", "spine"], ["spine", "centerShoulder"], ["centerShoulder", "centerHead"], ["centerHead", "topHead"],
  ["centerShoulder", "leftShoulder"], ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"],
  ["centerShoulder", "rightShoulder"], ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"],
  ["root", "leftHip"], ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"],
  ["root", "rightHip"], ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"],
];

// MARK: - Vektoren

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.sqrt(dot(a, a));
export const distance = (a, b) => length(sub(a, b));
export const midpoint = (a, b) => scale(add(a, b), 0.5);

/** Richtung mit Länge 1. Null für den Nullvektor. */
export function normalized(a) {
  const size = length(a);
  return size > 1e-9 ? scale(a, 1 / size) : null;
}

/** Anteil senkrecht zu `axis`, z. B. eine Richtung in der Waagerechten. */
export function removingComponent(a, axis) {
  const unit = normalized(axis);
  return unit ? sub(a, scale(unit, dot(a, unit))) : a;
}

/** Winkel zwischen zwei Vektoren in Grad, 0 bis 180. Null, wenn einer null ist. */
export function angleBetween(a, b) {
  const first = normalized(a);
  const second = normalized(b);
  if (!first || !second) return null;
  return (Math.acos(Math.min(1, Math.max(-1, dot(first, second)))) * 180) / Math.PI;
}

/** Mittelwert, null für eine leere Liste. */
export function mean(values) {
  if (values.length === 0) return null;
  return scale(values.reduce((sum, value) => add(sum, value), [0, 0, 0]), 1 / values.length);
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// MARK: - Bildfolge

/** Auf Millimeter gerundet, wie `Vector3` beim Speichern. */
const mm = (value) => Math.round(value * 1000) / 1000;

/**
 * Ein Bild der Bildfolge: `time` in Sekunden ab Clip-Beginn, `joints` im Raum
 * relativ zur Kamera in Metern, `image` die Lage im Bild (normiert, Ursprung
 * oben links, auch außerhalb von 0 bis 1) und `confidence` der 2D-Erkennung,
 * jeweils als Objekt je Gelenk. Ohne Person sind alle drei leer.
 */
export function makeFrame(time, joints = {}, image = {}, confidence = {}) {
  return { time, joints, image, confidence };
}

export const isDetected = (frame) => Object.keys(frame.joints).length > 0;

/** Liest ein Bild im Format der App: kurze Schlüssel, Gelenke als Listen in fester Reihenfolge. */
export function decodeFrame(json) {
  const frame = makeFrame(Number(json.t));
  (json.p ?? []).forEach((point, index) => {
    if (Array.isArray(point) && point.length === 3 && index < JOINTS.length) frame.joints[JOINTS[index]] = [Number(point[0]), Number(point[1]), Number(point[2])];
  });
  (json.i ?? []).forEach((point, index) => {
    if (Array.isArray(point) && point.length === 2 && index < JOINTS.length) frame.image[JOINTS[index]] = [Number(point[0]), Number(point[1])];
  });
  (json.c ?? []).forEach((value, index) => {
    if (typeof value === "number" && index < JOINTS.length) frame.confidence[JOINTS[index]] = value;
  });
  return frame;
}

/** Schreibt ein Bild im Format der App, gerundet wie dort. */
export function encodeFrame(frame) {
  const json = { t: Math.round(frame.time * 100000) / 100000 };
  if (Object.keys(frame.joints).length > 0) json.p = JOINTS.map((joint) => (frame.joints[joint] ? frame.joints[joint].map(mm) : null));
  if (Object.keys(frame.image).length > 0) json.i = JOINTS.map((joint) => (frame.image[joint] ? frame.image[joint].map(mm) : null));
  if (Object.keys(frame.confidence).length > 0) json.c = JOINTS.map((joint) => (frame.confidence[joint] != null ? Math.round(frame.confidence[joint] * 100) / 100 : null));
  return json;
}

export const decodeFrames = (list) => (Array.isArray(list) ? list : []).map(decodeFrame);
export const encodeFrames = (frames) => frames.map(encodeFrame);

/** Mitte zwischen beiden Handgelenken, also ungefähr der Griff. */
export const hands = (frame) => (frame.joints.leftWrist && frame.joints.rightWrist ? midpoint(frame.joints.leftWrist, frame.joints.rightWrist) : null);
export const feet = (frame) => (frame.joints.leftAnkle && frame.joints.rightAnkle ? midpoint(frame.joints.leftAnkle, frame.joints.rightAnkle) : null);
/** Hüftmitte, notfalls aus beiden Hüftgelenken. */
export const hipCenter = (frame) => frame.joints.root ?? (frame.joints.leftHip && frame.joints.rightHip ? midpoint(frame.joints.leftHip, frame.joints.rightHip) : null);
export const shoulderCenter = (frame) => frame.joints.centerShoulder ?? (frame.joints.leftShoulder && frame.joints.rightShoulder ? midpoint(frame.joints.leftShoulder, frame.joints.rightShoulder) : null);
/** Kopf: Scheitel, sonst Kopfmitte. */
export const head = (frame) => frame.joints.topHead ?? frame.joints.centerHead ?? null;
export const handsInImage = (frame) => (frame.image.leftWrist && frame.image.rightWrist ? [(frame.image.leftWrist[0] + frame.image.rightWrist[0]) / 2, (frame.image.leftWrist[1] + frame.image.rightWrist[1]) / 2] : null);

/** Bild, das `time` am nächsten liegt. */
export function nearestFrame(frames, time) {
  let best = null;
  for (const frame of frames) {
    if (!best || Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
  }
  return best;
}

// MARK: - Achsen

/**
 * Schätzt, ob Achsen umgedreht werden müssen, wie `AxisOrientation.estimate`:
 * Was im Raum nach rechts geht, muss im Bild nach rechts gehen, was nach oben
 * geht, im Bild nach oben. Die Person steht vor der Kamera, also bei negativem z.
 */
export function estimateOrientation(frames) {
  let horizontal = 0;
  let vertical = 0;
  let count = 0;
  const depths = [];
  for (const frame of frames) {
    if (!isDetected(frame)) continue;
    const pairs = Object.entries(frame.joints).filter(([joint]) => frame.image[joint]).map(([joint, point]) => [point, frame.image[joint]]);
    if (pairs.length < 3) continue;
    const meanPoint = mean(pairs.map((pair) => pair[0]));
    const meanX = pairs.reduce((sum, pair) => sum + pair[1][0], 0) / pairs.length;
    const meanY = pairs.reduce((sum, pair) => sum + pair[1][1], 0) / pairs.length;
    for (const [point, image] of pairs) {
      horizontal += (point[0] - meanPoint[0]) * (image[0] - meanX);
      // Im Bild zählt y von oben, im Raum nach oben.
      vertical += (point[1] - meanPoint[1]) * (meanY - image[1]);
      count += 1;
    }
    depths.push(meanPoint[2]);
  }
  if (count < 6) return { flipX: false, flipY: false, flipZ: false };
  return { flipX: horizontal < 0, flipY: vertical < 0, flipZ: median(depths) > 0 };
}

export function applyOrientation(orientation, frame) {
  const joints = {};
  for (const [joint, point] of Object.entries(frame.joints)) {
    joints[joint] = [orientation.flipX ? -point[0] : point[0], orientation.flipY ? -point[1] : point[1], orientation.flipZ ? -point[2] : point[2]];
  }
  return { ...frame, joints };
}

// MARK: - Glätten

/** One-Euro-Filter nach Casiez, Roussel und Vogel (CHI 2012), wie `OneEuroFilter` im Kern. */
export class OneEuroFilter {
  constructor(minCutoff, beta, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  static alpha(cutoff, interval) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / interval);
  }

  /** Geglätteter Wert zum Zeitpunkt `time`. Der erste Wert und jeder, dessen Zeit nicht nach dem vorigen liegt, beginnt neu. */
  filter(value, time) {
    if (this.lastValue == null || this.lastTime == null || !(time > this.lastTime)) {
      this.reset();
      this.lastValue = value;
      this.lastTime = time;
      return value;
    }
    const interval = time - this.lastTime;
    const derivative = (value - this.lastValue) / interval;
    const smoothedDerivative = this.lastDerivative + OneEuroFilter.alpha(this.derivativeCutoff, interval) * (derivative - this.lastDerivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    const result = this.lastValue + OneEuroFilter.alpha(cutoff, interval) * (value - this.lastValue);
    this.lastValue = result;
    this.lastTime = time;
    this.lastDerivative = smoothedDerivative;
    return result;
  }

  reset() {
    this.lastValue = null;
    this.lastTime = null;
    this.lastDerivative = 0;
  }
}

export const SMOOTHING = { minCutoff: 1.0, beta: 10, imageMinCutoff: 1.0, imageBeta: 20, derivativeCutoff: 1.0, maximumGap: 0.1 };

/** Dieselben Bilder, die Gelenke geglättet, Gelenk für Gelenk und Achse für Achse. Bilder ohne Person bleiben leer. */
export function smoothed(frames, settings = SMOOTHING) {
  const spatial = {};
  const planar = {};
  const lastSeen = {};
  const lastSeenInImage = {};
  const filters = (count, minCutoff, beta) => Array.from({ length: count }, () => new OneEuroFilter(minCutoff, beta, settings.derivativeCutoff));
  return frames.map((frame) => {
    const result = { ...frame, joints: { ...frame.joints }, image: { ...frame.image } };
    for (const joint of JOINTS) {
      const point = frame.joints[joint];
      if (!point) continue;
      if (!spatial[joint] || lastSeen[joint] == null || frame.time - lastSeen[joint] > settings.maximumGap) spatial[joint] = filters(3, settings.minCutoff, settings.beta);
      lastSeen[joint] = frame.time;
      result.joints[joint] = [spatial[joint][0].filter(point[0], frame.time), spatial[joint][1].filter(point[1], frame.time), spatial[joint][2].filter(point[2], frame.time)];
    }
    for (const joint of JOINTS) {
      const point = frame.image[joint];
      if (!point) continue;
      if (!planar[joint] || lastSeenInImage[joint] == null || frame.time - lastSeenInImage[joint] > settings.maximumGap) planar[joint] = filters(2, settings.imageMinCutoff, settings.imageBeta);
      lastSeenInImage[joint] = frame.time;
      result.image[joint] = [planar[joint][0].filter(point[0], frame.time), planar[joint][1].filter(point[1], frame.time)];
    }
    return result;
  });
}

// MARK: - Spielhand

/** Richtungen des Körpers beim Ansprechen: oben, zur rechten Körperseite und die Rumpflänge als Maßstab. */
export function bodyAxes(addressFrames) {
  const upVectors = addressFrames.flatMap((frame) => {
    const top = head(frame);
    const bottom = feet(frame);
    if (top && bottom) return [sub(top, bottom)];
    const shoulders = shoulderCenter(frame);
    const hips = hipCenter(frame);
    return shoulders && hips ? [sub(shoulders, hips)] : [];
  });
  const upSum = mean(upVectors);
  const up = upSum ? normalized(upSum) : null;
  if (!up) return null;
  const rightVectors = addressFrames.flatMap((frame) => {
    if (frame.joints.leftHip && frame.joints.rightHip) return [sub(frame.joints.rightHip, frame.joints.leftHip)];
    if (frame.joints.leftShoulder && frame.joints.rightShoulder) return [sub(frame.joints.rightShoulder, frame.joints.leftShoulder)];
    return [];
  });
  const rightSum = mean(rightVectors);
  const right = rightSum ? normalized(removingComponent(rightSum, up)) : null;
  if (!right) return null;
  const torsos = addressFrames.flatMap((frame) => {
    const shoulders = shoulderCenter(frame);
    const hips = hipCenter(frame);
    return shoulders && hips ? [distance(shoulders, hips)] : [];
  });
  const torso = torsos.length === 0 ? 0.5 : Math.max(0.2, torsos.reduce((sum, value) => sum + value, 0) / torsos.length);
  return {
    up,
    right,
    torso,
    /** Höhe der Hände über der Hüftmitte. */
    height(frame) {
      const grip = hands(frame);
      const hips = hipCenter(frame);
      return grip && hips ? dot(sub(grip, hips), up) : 0;
    },
    /** Seitliche Lage der Hände zur Hüftmitte, positiv zur rechten Körperseite. */
    side(frame) {
      const grip = hands(frame);
      const hips = hipCenter(frame);
      return grip && hips ? dot(sub(grip, hips), right) : 0;
    },
  };
}

export const HANDEDNESS = { addressShare: 0.1, minimumRise: 0.5, peakShare: 0.6, minimumSideShift: 0.1, minimumImageShift: 0.04 };
export const UNCLEAR_HANDEDNESS = Object.freeze({ handedness: null, confidence: 0, topTime: null, sidesDisagree: false });

/** Geschätzte Spielhand aus geglätteten Bildern, wie `HandednessDetector.estimate`. */
export function estimateHandedness(frames, cameraAngle, settings = HANDEDNESS) {
  const usable = frames.filter((frame) => hands(frame) && hipCenter(frame));
  if (usable.length < 10) return { ...UNCLEAR_HANDEDNESS };
  const addressCount = Math.min(15, Math.max(3, Math.round(usable.length * settings.addressShare)));
  const address = usable.slice(0, addressCount);
  const axes = bodyAxes(address);
  if (!axes) return { ...UNCLEAR_HANDEDNESS };
  const heights = usable.map((frame) => axes.height(frame));
  const sides = usable.map((frame) => axes.side(frame));
  const addressHeight = median(heights.slice(0, addressCount));
  const addressSide = median(sides.slice(0, addressCount));
  const highest = Math.max(...heights);
  if (!(highest - addressHeight >= settings.minimumRise * axes.torso)) return { ...UNCLEAR_HANDEDNESS };

  // Erster zusammenhängender Abschnitt über der Schwelle, darin der höchste Punkt.
  const threshold = addressHeight + settings.peakShare * (highest - addressHeight);
  const first = heights.findIndex((value) => value >= threshold);
  if (first < 0) return { ...UNCLEAR_HANDEDNESS };
  let peak = first;
  for (let index = first; index < heights.length && heights[index] >= threshold; index += 1) {
    if (heights[index] > heights[peak]) peak = index;
  }

  const shift = sides[peak] - addressSide;
  let handedness = Math.abs(shift) >= settings.minimumSideShift * axes.torso ? (shift > 0 ? "right" : "left") : null;
  let confidence = handedness == null ? 0 : Math.min(1, Math.abs(shift) / (0.5 * axes.torso));

  // Von vorne: Die Hände gehen beim Rechtshänder im Bild nach links.
  let sidesDisagree = false;
  if (cameraAngle === "faceOn") {
    const starts = address.map(handsInImage).filter(Boolean).map((point) => point[0]);
    const top = handsInImage(usable[peak]);
    if (starts.length > 0 && top) {
      const imageShift = top[0] - median(starts);
      if (Math.abs(imageShift) >= settings.minimumImageShift) {
        const fromImage = imageShift < 0 ? "right" : "left";
        if (handedness != null && handedness !== fromImage) {
          // Das Bild hängt nicht davon ab, wie das Modell links und rechts benennt.
          sidesDisagree = true;
          confidence = Math.min(confidence, 0.5);
        }
        handedness = fromImage;
        confidence = Math.max(confidence, sidesDisagree ? 0.5 : Math.min(1, Math.abs(imageShift) / 0.15));
      }
    }
  }
  if (handedness == null) return { ...UNCLEAR_HANDEDNESS };
  return { handedness, confidence, topTime: usable[peak].time, sidesDisagree };
}

export const isReliableHandedness = (estimate) => estimate.handedness != null && estimate.confidence >= RELIABLE_CONFIDENCE;

// MARK: - Hinweise zur Erkennung

export const QUALITY = {
  edgeMargin: 0.01,
  minimumConfidence: 0.3,
  noPersonShare: 0.1,
  cutOffShare: 0.05,
  lowConfidenceShare: 0.2,
  jumpyShare: 0.05,
  maximumInterval: 0.1,
  minimumDetectedShare: 0.5,
  minimumDetectedFrames: 10,
};

/** Höchste plausible Geschwindigkeit eines Körperteils in m/s. */
export function maximumSpeed(part) {
  switch (part) {
    case "hands":
      return 25;
    case "arms":
      return 20;
    case "hips":
      return 6;
    default:
      return 8;
  }
}

/** Lässt sich die Bildfolge auswerten? Sonst ist die Analyse fehlgeschlagen. */
export function isUsable(frames, settings = QUALITY) {
  const detected = frames.filter(isDetected).length;
  return detected >= settings.minimumDetectedFrames && detected >= settings.minimumDetectedShare * Math.max(frames.length, 1);
}

function shareByPart(frames, test) {
  const result = {};
  for (const part of BODY_PARTS) {
    const count = frames.filter((frame) => test(frame, part)).length;
    if (count > 0) result[part] = count / frames.length;
  }
  return result;
}

const partsAtLeast = (shares, threshold) => BODY_PARTS.filter((part) => (shares[part] ?? 0) >= threshold);
const worst = (shares) => Math.max(0, ...Object.values(shares));

/** Hinweise zu ungeglätteten Bildern, das Wichtigste zuerst, wie `PoseQuality.warnings`. */
export function warnings(frames, settings = QUALITY) {
  if (frames.length === 0) return [{ kind: "noPerson", share: 1, parts: [] }];
  const result = [];
  const detected = frames.filter(isDetected);
  const missing = 1 - detected.length / frames.length;
  if (missing >= settings.noPersonShare) result.push({ kind: "noPerson", share: missing, parts: [] });
  if (detected.length === 0) return result;

  // Abgeschnitten: ein Gelenk des Körperteils am Rand oder außerhalb des Bilds.
  const inside = (value) => value >= settings.edgeMargin && value <= 1 - settings.edgeMargin;
  const cutOff = shareByPart(detected, (frame, part) => PART_JOINTS[part].some((joint) => frame.image[joint] && (!inside(frame.image[joint][0]) || !inside(frame.image[joint][1]))));
  if (Object.keys(cutOff).length > 0 && worst(cutOff) >= settings.cutOffShare) result.push({ kind: "cutOff", share: worst(cutOff), parts: partsAtLeast(cutOff, settings.cutOffShare) });

  // Unsicher: Die 2D-Erkennung hat ein Gelenk nicht oder nur unsicher gefunden.
  const rated = detected.filter((frame) => Object.keys(frame.confidence).length > 0);
  if (rated.length > 0) {
    const uncertain = shareByPart(rated, (frame, part) => PART_JOINTS[part].some((joint) => frame.confidence[joint] != null && frame.confidence[joint] < settings.minimumConfidence));
    if (Object.keys(uncertain).length > 0 && worst(uncertain) >= settings.lowConfidenceShare) {
      result.push({ kind: "lowConfidence", share: worst(uncertain), parts: partsAtLeast(uncertain, settings.lowConfidenceShare) });
    }
  }

  // Sprünge: schneller, als sich der Körperteil bewegen kann.
  let jumps = 0;
  let pairs = 0;
  for (let index = 1; index < detected.length; index += 1) {
    const previous = detected[index - 1];
    const frame = detected[index];
    const interval = frame.time - previous.time;
    if (!(interval > 0) || interval > settings.maximumInterval) continue;
    pairs += 1;
    const jumped = Object.entries(frame.joints).some(([joint, point]) => previous.joints[joint] && distance(point, previous.joints[joint]) / interval > maximumSpeed(JOINT_PART[joint]));
    if (jumped) jumps += 1;
  }
  if (pairs > 0 && jumps / pairs >= settings.jumpyShare) result.push({ kind: "jumpy", share: jumps / pairs, parts: [] });
  return result;
}

// MARK: - Auswertung

/**
 * Wertet eine Bildfolge aus, wie `PoseAnalysis.evaluate` ohne Phasen und
 * Kennzahlen: Achsen ausrichten, Qualität prüfen, Spielhand aus geglätteten
 * Bildern, Kurzfassung. `frames` zum Speichern sind ausgerichtet, nicht geglättet.
 */
export function evaluatePose(raw, { cameraAngle, source, bodyHeights = [], heightIsMeasured = false, now = new Date() }) {
  const frames = [...raw].sort((a, b) => a.time - b.time);
  const orientation = estimateOrientation(frames);
  const oriented = frames.map((frame) => applyOrientation(orientation, frame));
  const usable = isUsable(oriented);
  const hints = warnings(oriented);
  let handedness = { ...UNCLEAR_HANDEDNESS };
  if (usable) {
    handedness = estimateHandedness(smoothed(oriented), cameraAngle);
    if (handedness.sidesDisagree) hints.push({ kind: "sidesUncertain", share: 1, parts: [] });
    if (handedness.handedness == null) hints.push({ kind: "handednessUnclear", share: 1, parts: [] });
  }
  const heights = bodyHeights.filter((value) => value > 0.5 && value < 2.5);
  const bodyHeight = heights.length === 0 ? null : median(heights);
  return {
    orientation,
    frames: oriented,
    isUsable: usable,
    summary: {
      frameCount: frames.length,
      detectedCount: frames.filter(isDetected).length,
      handedness,
      warnings: hints,
      bodyHeight,
      heightIsMeasured,
      source,
      analyzedAt: now,
    },
  };
}
