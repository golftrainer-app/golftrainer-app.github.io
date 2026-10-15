// Phasen, Kennzahlen und Prüfung der Werte eines Schwungs aus dem 3D-Skelett,
// wie Modul 3, 4 und 7 der Schwunganalyse im Kern: SwingPhaseDetector,
// SwingMetricsCalculator, SwingReliability und SwingSpace, dazu die ganze
// Auswertung wie PoseAnalysis.evaluate. Reine Funktionen, geprüft gegen
// Fixtures/web-pose.json aus dem Swift-Kern (WebPoseParityTests).
import { EVENTS, METRIC_KINDS, METRICS } from "./analysis.js";
import {
  JOINTS, JOINT_PART, add, cross, distance, dot, evaluatePose, hands, head, hipCenter, isDetected, isReliableHandedness, length, makeFrame, maximumSpeed, mean, median,
  normalized, removingComponent, scale, shoulderCenter, sub,
} from "./pose.js";

const UP = [0, 1, 0];
const DEGREES = 180 / Math.PI;

// MARK: - Glätten in beide Richtungen

/** Gauß-gewichteter Mittelwert in beide Richtungen. Wo im Fenster kein Wert liegt, bleibt die Lücke (null). */
export function gaussianSmoothed(values, times, sigma) {
  if (!(sigma > 0)) return values;
  const reach = 3 * sigma;
  let lower = 0;
  return times.map((time) => {
    while (lower < times.length && times[lower] < time - reach) lower += 1;
    let sum = 0;
    let total = 0;
    for (let index = lower; index < times.length && times[index] <= time + reach; index += 1) {
      const value = values[index];
      if (value == null) continue;
      const span = (times[index] - time) / sigma;
      const weight = Math.exp(-0.5 * span * span);
      sum += weight * value;
      total += weight;
    }
    return total > 0 ? sum / total : null;
  });
}

const intervalsOf = (times) => times.slice(1).map((time, index) => time - times[index]).filter((value) => value > 0);

// MARK: - Phasen

export const PHASE_SETTINGS = {
  smoothing: 0.015,
  minimumBackswing: 20,
  peakShare: 0.6,
  startShare: 0.03,
  minimumStartAngle: 2,
  stillAngle: 5,
  finishShare: 0.05,
  minimumFinishAngle: 3,
  finishSpeed: 30,
  restDuration: 0.1,
  minimumSideShift: 0.05,
  clipImpactTolerance: 0.15,
  backswingRange: [0.3, 2.5],
  downswingRange: [0.12, 0.9],
};

const emptyPhases = (notes) => ({ address: null, armBack: null, top: null, armDown: null, impact: null, impactSource: null, finish: null, notes, checks: {} });

/** Armwinkel und Neigung des Führungsarms über die Zeit, geglättet, wie `SwingCurves`. Null bei zu wenigen Bildern. */
export function swingCurves(frames, handedness, settings = PHASE_SETTINGS) {
  const samples = frames
    .flatMap((frame) => {
      const grip = hands(frame);
      const shoulders = shoulderCenter(frame);
      return grip && shoulders ? [{ frame, hands: grip, shoulders }] : [];
    })
    .sort((a, b) => a.frame.time - b.frame.time);
  if (samples.length < 10) return null;
  const times = samples.map((sample) => sample.frame.time);
  const sigma = Math.max(settings.smoothing, median(intervalsOf(times)));
  const addressCount = Math.min(15, Math.max(3, Math.round(samples.length * 0.1)));

  // Hüftlinie beim Ansprechen, waagerecht.
  const lines = samples.slice(0, addressCount).flatMap(({ frame }) => {
    if (frame.joints.leftHip && frame.joints.rightHip) return [sub(frame.joints.rightHip, frame.joints.leftHip)];
    if (frame.joints.leftShoulder && frame.joints.rightShoulder) return [sub(frame.joints.rightShoulder, frame.joints.leftShoulder)];
    return [];
  });
  const line = mean(lines);
  const right = line ? normalized(removingComponent(line, UP)) : null;
  if (!right) return null;

  // Die hintere Seite zeigt die Bewegung: Dorthin holen die Hände zuerst aus.
  const sides = gaussianSmoothed(samples.map((sample) => dot(sub(sample.hands, sample.shoulders), right)), times, sigma).map((value) => value ?? 0);
  const handsAreStill = distance(samples[addressCount - 1].hands, samples[0].hands) < settings.minimumSideShift;
  const sideAtAddress = handsAreStill ? median(sides.slice(0, addressCount)) : 0;
  const shifts = sides.map((value) => value - sideAtAddress);
  const largest = Math.max(0, ...shifts.map(Math.abs));
  let trailSign = handedness === "right" ? 1 : -1;
  if (largest >= settings.minimumSideShift) {
    const first = shifts.findIndex((value) => Math.abs(value) >= 0.4 * largest);
    if (first >= 0) trailSign = shifts[first] > 0 ? 1 : -1;
  }
  const trail = scale(right, trailSign);

  // Armwinkel, über ±180° hinaus fortgesetzt, damit ein langes Ausholen nicht springt.
  const rawAngles = [];
  let previous = null;
  for (const sample of samples) {
    const offset = sub(sample.hands, sample.shoulders);
    let value = Math.atan2(dot(offset, trail), -dot(offset, UP)) * DEGREES;
    if (previous != null) {
      while (value - previous > 180) value -= 360;
      while (value - previous < -180) value += 360;
    }
    previous = value;
    rawAngles.push(value);
  }
  const angle = gaussianSmoothed(rawAngles, times, sigma).map((value) => value ?? 0);

  // Führungsarm: auf der Seite, die nicht ausholt.
  const rawElevation = samples.map(({ frame }) => {
    const shoulder = trailSign > 0 ? frame.joints.leftShoulder : frame.joints.rightShoulder;
    const wrist = trailSign > 0 ? frame.joints.leftWrist : frame.joints.rightWrist;
    const direction = shoulder && wrist ? normalized(sub(wrist, shoulder)) : null;
    return direction ? Math.asin(Math.min(1, Math.max(-1, dot(direction, UP)))) * DEGREES : null;
  });

  const start = angle.slice(0, addressCount);
  const isStill = Math.abs((start[start.length - 1] ?? 0) - (start[0] ?? 0)) < settings.stillAngle;
  const addressAngle = isStill ? median(start) : 0;
  return {
    times,
    angle,
    elevation: gaussianSmoothed(rawElevation, times, sigma),
    addressIsStill: isStill,
    addressAngle,
    noise: isStill ? 1.4826 * median(start.map((value) => Math.abs(value - addressAngle))) : 0,
    sigma,
    settings,
    trailSign,
  };
}

/** Höchster Punkt im ersten großen Ausholen. Mit Treffmoment im Clip im letzten Ausholen davor. */
function topIndex(curves, clipImpact) {
  const { angle, times, addressAngle, settings } = curves;
  const highest = Math.max(...angle);
  if (!(highest - addressAngle >= settings.minimumBackswing)) return null;
  const threshold = addressAngle + settings.peakShare * (highest - addressAngle);
  const peaks = [];
  let index = 0;
  while (index < angle.length) {
    if (angle[index] < threshold) {
      index += 1;
      continue;
    }
    let peak = index;
    while (index < angle.length && angle[index] >= threshold) {
      if (angle[index] > angle[peak]) peak = index;
      index += 1;
    }
    peaks.push(peak);
  }
  if (clipImpact != null) {
    const before = [...peaks].reverse().find((peak) => times[peak] < clipImpact);
    if (before != null) return before;
  }
  return peaks.length > 0 ? peaks[0] : null;
}

/** Scheitel der Parabel durch den höchsten Punkt und seine Nachbarn, genauer als ein Bildabstand. */
function refinedPeak(curves, index) {
  const { angle, times } = curves;
  if (index <= 0 || index >= angle.length - 1) return times[index];
  const center = times[index];
  const t0 = times[index - 1] - center;
  const t2 = times[index + 1] - center;
  const [y0, y1, y2] = [angle[index - 1], angle[index], angle[index + 1]];
  const denominator = t0 * t2 * (t0 - t2);
  if (Math.abs(denominator) <= 1e-15) return center;
  const a = (t2 * (y0 - y1) - t0 * (y2 - y1)) / denominator;
  const b = (t0 * t0 * (y2 - y1) - t2 * t2 * (y0 - y1)) / denominator;
  if (!(a < 0)) return center;
  return center + Math.min(t2, Math.max(t0, -b / (2 * a)));
}

/** Krümmung des Armwinkels in einem Zeitraum: −c der Parabel nach kleinsten Quadraten. Positiv bei einem Hochpunkt. */
function curvature(curves, start, end) {
  const { angle, times } = curves;
  const indices = [];
  for (let index = 0; index < times.length; index += 1) if (times[index] >= start && times[index] <= end) indices.push(index);
  if (indices.length < 4) return null;
  const center = (start + end) / 2;
  const sums = [0, 0, 0, 0, 0];
  const products = [0, 0, 0];
  for (const index of indices) {
    const t = times[index] - center;
    let power = 1;
    for (let degree = 0; degree < 5; degree += 1) {
      sums[degree] += power;
      if (degree < 3) products[degree] += power * angle[index];
      power *= t;
    }
  }
  const matrix = [
    [sums[0], sums[1], sums[2]],
    [sums[1], sums[2], sums[3]],
    [sums[2], sums[3], sums[4]],
  ];
  const determinant = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const full = determinant(matrix);
  if (Math.abs(full) <= 1e-18) return null;
  const replaced = matrix.map((row, index) => [row[0], row[1], products[index]]);
  return -determinant(replaced) / full;
}

/** Umkehrpunkt ohne den Fehler des Glättens: aus der Krümmung vor und nach dem Hochpunkt. */
function debiasedPeak(curves, index) {
  const peak = refinedPeak(curves, index);
  const sigma = curves.sigma;
  const before = curvature(curves, peak - 6 * sigma, peak - 2 * sigma);
  const after = curvature(curves, peak + 2 * sigma, peak + 6 * sigma);
  if (before == null || after == null || !(before > 0) || !(after > 0)) return peak;
  const shift = (2 * sigma * (before - after)) / (Math.sqrt(2 * Math.PI) * (before + after));
  return peak - shift;
}

/** Beginn des Rückschwungs und der Armwinkel in der Ruhe davor. */
function takeawayStart(curves, peak) {
  const { angle, times, settings, noise } = curves;
  let level = curves.addressAngle;
  let result = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const rise = Math.max(settings.minimumStartAngle, 4 * noise, settings.startShare * (angle[peak] - level));
    const threshold = level + rise;
    let index = peak;
    while (index > 0 && angle[index - 1] > threshold) index -= 1;
    if (!(index > 0)) return result;
    const before = index - 1;
    const span = times[index] - times[before];
    const step = angle[index] - angle[before];
    if (!(span > 0 && step > 0)) return result;
    const crossing = times[before] + ((threshold - angle[before]) / step) * span;
    const start = Math.max(times[0], crossing - Math.min(0.3, (2 * rise) / (step / span)));
    result = { time: start, level };
    const quiet = [];
    for (let i = 0; i < times.length; i += 1) if (times[i] >= start - 0.3 && times[i] <= start - 0.02) quiet.push(angle[i]);
    if (quiet.length < 3) break;
    level = median(quiet);
  }
  return result;
}

/** Erste Stelle nach `index`, an der der Armwinkel unter `level` fällt, zwischen zwei Bildern eingepasst. */
function crossingBelow(curves, level, index) {
  const { angle, times } = curves;
  if (!(index < angle.length - 1)) return null;
  for (let current = index; current < angle.length - 1; current += 1) {
    if (angle[current] >= level && angle[current + 1] < level) {
      const fall = angle[current] - angle[current + 1];
      return times[current] + ((angle[current] - level) / fall) * (times[current + 1] - times[current]);
    }
  }
  return null;
}

/** Erste Stelle zwischen zwei Bildern, an der die Werte die Null kreuzen. */
function crossing(curves, values, upward, start, end) {
  const { times } = curves;
  if (!(start < end && end < values.length)) return null;
  for (let index = start; index < end; index += 1) {
    const first = values[index];
    const second = values[index + 1];
    if (first == null || second == null) continue;
    const crosses = upward ? first < 0 && second >= 0 : first >= 0 && second < 0;
    if (!crosses) continue;
    const share = first / (first - second);
    return times[index] + share * (times[index + 1] - times[index]);
  }
  return null;
}

/** Ob der Armwinkel bis `index` über `restDuration` im Mittel langsamer als `finishSpeed` fällt oder steigt. */
function isAtRest(curves, index, start) {
  const { angle, times, settings } = curves;
  let from = index;
  while (from > start && times[index] - times[from - 1] <= settings.restDuration) from -= 1;
  const span = times[index] - times[from];
  if (!(span >= settings.restDuration / 2)) return false;
  return (angle[from] - angle[index]) / span < settings.finishSpeed;
}

/** Wo die Hände am Ende des Durchschwungs ankommen. `isCut`, wenn sie sich am Ende noch deutlich bewegen. */
function finishTime(curves, impactIndex, level) {
  const { angle, times, settings } = curves;
  const last = angle.length - 1;
  if (!(impactIndex < last)) return { time: null, isCut: true };
  let low = impactIndex;
  let atRest = false;
  for (let index = impactIndex + 1; index <= last; index += 1) {
    if (angle[index] < angle[low]) low = index;
    if (angle[low] < level && isAtRest(curves, index, impactIndex)) {
      atRest = true;
      break;
    }
  }
  const depth = level - angle[low];
  if (!(depth > 0)) return { time: null, isCut: false };
  if (!atRest) return { time: null, isCut: true };
  const threshold = angle[low] + Math.max(settings.minimumFinishAngle, settings.finishShare * depth);
  let index = -1;
  for (let i = impactIndex; i <= low; i += 1) {
    if (angle[i] <= threshold) {
      index = i;
      break;
    }
  }
  if (index < 0) return { time: times[low], isCut: false };
  if (!(index > impactIndex)) return { time: times[index], isCut: false };
  const before = index - 1;
  const fall = angle[before] - angle[index];
  if (!(fall > 0)) return { time: times[index], isCut: false };
  return { time: times[before] + ((angle[before] - threshold) / fall) * (times[index] - times[before]), isCut: false };
}

/** Alle Zeitpunkte und Hinweise aus den Kurven, wie `SwingCurves.phases`. */
export function phasesFromCurves(curves, clipImpact = null) {
  const { times, settings } = curves;
  const peak = topIndex(curves, clipImpact);
  if (peak == null) return emptyPhases([{ kind: "noSwing" }]);
  const notes = [];
  const top = debiasedPeak(curves, peak);
  const takeaway = curves.addressIsStill ? takeawayStart(curves, peak) : null;
  if (!takeaway) notes.push({ kind: "startCut" });
  const level = takeaway ? takeaway.level : curves.addressAngle;

  const estimate = crossingBelow(curves, level, peak);
  let impact = estimate;
  let source = estimate == null ? null : "skeleton";
  if (clipImpact != null && times.length > 0 && clipImpact >= times[0] && clipImpact <= times[times.length - 1]) {
    const fitsTop = clipImpact > top && clipImpact - top <= settings.downswingRange[1];
    const fitsEstimate = estimate == null ? true : Math.abs(clipImpact - estimate) <= settings.clipImpactTolerance;
    if (fitsTop && fitsEstimate) {
      impact = clipImpact;
      source = "clip";
    } else {
      notes.push({ kind: "clipImpactIgnored" });
    }
  }
  let impactIndex = null;
  if (impact != null) {
    const found = times.findIndex((time) => time >= impact);
    impactIndex = found >= 0 ? found : times.length - 1;
  } else {
    notes.push({ kind: "impactCut" });
  }

  let startIndex = 0;
  if (takeaway) {
    const found = times.findIndex((time) => time >= takeaway.time);
    startIndex = found >= 0 ? found : 0;
  }
  const armBack = crossing(curves, curves.elevation, true, startIndex, peak);
  const armDown = crossing(curves, curves.elevation, false, peak, impactIndex ?? times.length - 1);

  let finish = null;
  if (impactIndex != null) {
    const result = finishTime(curves, impactIndex, level);
    finish = result.time;
    if (result.isCut) notes.push({ kind: "finishCut" });
  }

  const inRange = ([low, high], value) => value >= low && value <= high;
  const backswingIsOdd = takeaway ? !inRange(settings.backswingRange, top - takeaway.time) : false;
  const downswingIsOdd = impact != null ? !inRange(settings.downswingRange, impact - top) : false;
  if (backswingIsOdd || downswingIsOdd) notes.push({ kind: "unusualTiming" });

  return { address: takeaway ? takeaway.time : null, armBack, top, armDown, impact, impactSource: source, finish, notes, checks: {} };
}

/** Zeitpunkte aus den Bildern, so wie sie aus der Erkennung kommen: Achsen ausgerichtet, nicht geglättet. */
export function detectPhases(frames, handedness, clipImpact = null, settings = PHASE_SETTINGS) {
  const curves = swingCurves(frames, handedness, settings);
  if (!curves) return emptyPhases([{ kind: "noSwing" }]);
  return phasesFromCurves(curves, clipImpact);
}

/** Rückschwung im Verhältnis zum Abschwung, null ohne gültige Reihenfolge. */
export function tempoRatio(phases) {
  const { address, top, impact } = phases;
  if (address == null || top == null || impact == null || !(address < top && top < impact)) return null;
  return (top - address) / (impact - top);
}

// MARK: - Gelenke über die Zeit

/** Gelenke über die Zeit, ohne Verzögerung geglättet, zum Ablesen an jedem Zeitpunkt, wie `SkeletonTrack`. */
export function skeletonTrack(frames, smoothing = 0.02) {
  const detected = frames.filter(isDetected).sort((a, b) => a.time - b.time);
  if (detected.length < 10) return null;
  const times = detected.map((frame) => frame.time);
  const sigma = Math.max(smoothing, median(intervalsOf(times)));
  const positions = {};
  for (const joint of JOINTS) {
    const raw = detected.map((frame) => frame.joints[joint] ?? null);
    if (!raw.some((point) => point != null)) continue;
    const xs = gaussianSmoothed(raw.map((point) => (point ? point[0] : null)), times, sigma);
    const ys = gaussianSmoothed(raw.map((point) => (point ? point[1] : null)), times, sigma);
    const zs = gaussianSmoothed(raw.map((point) => (point ? point[2] : null)), times, sigma);
    positions[joint] = raw.map((point, index) => (point != null && xs[index] != null && ys[index] != null && zs[index] != null ? [xs[index], ys[index], zs[index]] : null));
  }
  const poseAtIndex = (index) => {
    const joints = {};
    for (const [joint, values] of Object.entries(positions)) if (values[index]) joints[joint] = values[index];
    return makeFrame(times[index], joints);
  };
  return {
    times,
    positions,
    poseAtIndex,
    /** Zwischen zwei Bildern eingepasst. Fehlt ein Gelenk in einem der beiden, gilt das andere. */
    poseAt(time) {
      const upper = times.findIndex((value) => value >= time);
      if (upper < 0) return poseAtIndex(times.length - 1);
      if (!(upper > 0) || !(times[upper] > times[upper - 1])) return poseAtIndex(upper);
      const lower = upper - 1;
      const share = (time - times[lower]) / (times[upper] - times[lower]);
      const joints = {};
      for (const [joint, values] of Object.entries(positions)) {
        const first = values[lower];
        const second = values[upper];
        if (first && second) joints[joint] = add(first, scale(sub(second, first), share));
        else if (first) joints[joint] = first;
        else if (second) joints[joint] = second;
      }
      return makeFrame(time, joints);
    },
    /** Mittelwert der Bilder in einem Zeitraum, null bei weniger als drei Bildern. */
    averagePose(start, end) {
      const indices = [];
      for (let index = 0; index < times.length; index += 1) if (times[index] >= start && times[index] <= end) indices.push(index);
      if (indices.length < 3) return null;
      const joints = {};
      for (const [joint, values] of Object.entries(positions)) {
        const average = mean(indices.map((index) => values[index]).filter(Boolean));
        if (average) joints[joint] = average;
      }
      return makeFrame((start + end) / 2, joints);
    },
  };
}

// MARK: - Kennzahlen

/** Kopfmitte, sonst der Scheitel. Für Wege des Kopfs. */
const headCenter = (frame) => frame.joints.centerHead ?? frame.joints.topHead ?? null;

/** Uhrzeit des Arms aus seinem Winkel: 0° hängt er nach unten (6 Uhr), 90° waagerecht nach hinten (9 Uhr). */
export function clockHours(degrees) {
  let value = degrees;
  if (value < -90) value += 360;
  return 6 + value / 30;
}

/** Richtungen des Körpers beim Ansprechen und welche Seite ausholt, wie `BodyFrame`. Null ohne Hüft- oder Schulterlinie. */
export function bodyFrame(address, top, handedness) {
  let line = null;
  if (address.joints.leftHip && address.joints.rightHip) line = sub(address.joints.rightHip, address.joints.leftHip);
  else if (address.joints.leftShoulder && address.joints.rightShoulder) line = sub(address.joints.rightShoulder, address.joints.leftShoulder);
  const right = line ? normalized(removingComponent(line, UP)) : null;
  if (!right) return null;

  // Am Umkehrpunkt sind die Hände auf der hinteren Seite.
  let sign = handedness === "right" ? 1 : -1;
  const topHands = hands(top);
  const topShoulders = shoulderCenter(top);
  if (topHands && topShoulders) {
    const side = dot(sub(topHands, topShoulders), right);
    if (Math.abs(side) >= 0.05) sign = side > 0 ? 1 : -1;
  }
  const trail = scale(right, sign);
  const trailIsRight = sign > 0;

  // Beim Ansprechen hängen die Hände vor dem Körper, also zum Ball hin.
  const fallback = scale(cross(UP, trail), trailIsRight ? 1 : -1);
  let toBall = fallback;
  const addressHands = hands(address);
  const hips = hipCenter(address);
  if (addressHands && hips) {
    const forward = removingComponent(removingComponent(sub(addressHands, hips), UP), right);
    toBall = length(forward) >= 0.05 ? (normalized(forward) ?? fallback) : fallback;
  }

  const jointsOf = (line) => {
    if (line === "shoulders") return trailIsRight ? ["leftShoulder", "rightShoulder"] : ["rightShoulder", "leftShoulder"];
    return trailIsRight ? ["leftHip", "rightHip"] : ["rightHip", "leftHip"];
  };
  const body = {
    up: UP,
    trail,
    toBall,
    trailIsRight,
    /** Richtung einer Linie um die Senkrechte, in Grad. Beim Ausholen geht die hintere Seite vom Ball weg, der Winkel wächst. */
    angle(line, pose) {
      const [leadName, trailName] = jointsOf(line);
      const lead = pose.joints[leadName];
      const back = pose.joints[trailName];
      if (!lead || !back) return null;
      const direction = sub(back, lead);
      const along = dot(direction, trail);
      const away = -dot(direction, toBall);
      if (!(along * along + away * away > 1e-6)) return null;
      return Math.atan2(away, along) * DEGREES;
    },
    /** Drehung einer Linie gegenüber dem Ansprechen, in Grad zwischen −180 und 180. */
    turn(line, pose, addressPose) {
      const now = body.angle(line, pose);
      const start = body.angle(line, addressPose);
      if (now == null || start == null) return null;
      let delta = now - start;
      while (delta > 180) delta -= 360;
      while (delta <= -180) delta += 360;
      return delta;
    },
    forwardTilt(pose) {
      const shoulders = shoulderCenter(pose);
      const center = hipCenter(pose);
      if (!shoulders || !center) return null;
      const spine = sub(shoulders, center);
      return Math.atan2(dot(spine, toBall), dot(spine, UP)) * DEGREES;
    },
    sideBend(pose) {
      const shoulders = shoulderCenter(pose);
      const center = hipCenter(pose);
      if (!shoulders || !center) return null;
      const spine = sub(shoulders, center);
      return Math.atan2(dot(spine, trail), dot(spine, UP)) * DEGREES;
    },
    /** Weg eines Punkts seit dem Ansprechen entlang einer Richtung, in Metern. */
    shift(point, pose, addressPose, axis) {
      const now = point(pose);
      const start = point(addressPose);
      if (!now || !start) return null;
      return dot(sub(now, start), axis);
    },
    /** Führungsarm als Uhrzeit aus Sicht des Spielers. */
    armClock(pose) {
      const shoulder = trailIsRight ? pose.joints.leftShoulder : pose.joints.rightShoulder;
      const wrist = trailIsRight ? pose.joints.leftWrist : pose.joints.rightWrist;
      if (!shoulder || !wrist) return null;
      const arm = sub(wrist, shoulder);
      if (!(length(arm) > 0.05)) return null;
      return clockHours(Math.atan2(dot(arm, trail), -dot(arm, UP)) * DEGREES);
    },
  };
  return body;
}

/** Kennzahlen aus den Bildern, wie `SwingMetricsCalculator.metrics`. Null ohne Ansprechen oder Umkehrpunkt. */
export function computeMetrics(frames, phases, handedness, scaleIsMeasured, smoothing = 0.02) {
  const addressTime = phases.address;
  const topTime = phases.top;
  if (addressTime == null || topTime == null) return null;
  const track = skeletonTrack(frames, smoothing);
  if (!track) return null;
  const address = track.averagePose(addressTime - 0.25, addressTime - 0.02) ?? track.poseAt(addressTime);
  const top = track.poseAt(topTime);
  const body = bodyFrame(address, top, handedness);
  if (!body) return null;

  const values = {};
  const set = (kind, value) => {
    if (value != null && Number.isFinite(value)) values[kind] = value;
  };
  const shoulderTurn = body.turn("shoulders", top, address);
  const hipTurn = body.turn("hips", top, address);
  set("shoulderTurnTop", shoulderTurn);
  set("hipTurnTop", hipTurn);
  if (shoulderTurn != null && hipTurn != null) set("xFactorTop", shoulderTurn - hipTurn);
  const addressTilt = body.forwardTilt(address);
  set("spineTiltAddress", addressTilt);
  set("sideBendAddress", body.sideBend(address));
  set("headSwayTop", body.shift(headCenter, top, address, body.trail));
  set("hipSwayTop", body.shift(hipCenter, top, address, body.trail));
  set("armClockTop", body.armClock(top));

  const impactTime = phases.impact;
  if (impactTime != null) {
    const impact = track.poseAt(impactTime);
    let stretch = null;
    for (let index = 0; index < track.times.length; index += 1) {
      if (track.times[index] < topTime || track.times[index] > impactTime) continue;
      const pose = track.poseAtIndex(index);
      const shoulders = body.turn("shoulders", pose, address);
      const hips = body.turn("hips", pose, address);
      if (shoulders == null || hips == null) continue;
      const value = shoulders - hips;
      if (stretch == null || value > stretch) stretch = value;
    }
    set("xFactorStretch", stretch);
    const hipTurnImpact = body.turn("hips", impact, address);
    set("hipOpenImpact", hipTurnImpact == null ? null : -hipTurnImpact);
    const impactTilt = body.forwardTilt(impact);
    if (addressTilt != null && impactTilt != null) set("spineTiltChange", impactTilt - addressTilt);
    set("headSwayImpact", body.shift(headCenter, impact, address, body.trail));
    set("headHeightImpact", body.shift(headCenter, impact, address, body.up));
    set("hipSlideImpact", body.shift(hipCenter, impact, address, body.trail));
    set("hipTowardBallImpact", body.shift(hipCenter, impact, address, body.toBall));
    set("tempoRatio", tempoRatio(phases));
    set("swingTime", impactTime - addressTime);
  }
  return {
    values: METRIC_KINDS.filter((kind) => values[kind] != null).map((kind) => ({ kind, value: values[kind], check: null })),
    handedness,
    scaleIsMeasured,
  };
}

// MARK: - Prüfung der Werte

export const RELIABILITY = { runs: 16, seed: 0x601fn, window: 0.06, minimumVisibleShare: 0.5, minimumConfidence: 0.3, edgeMargin: 0.01, maximumMissingShare: 0.25 };

/** Größte Unsicherheit in Sekunden, bei der die App den Zeitpunkt noch zeigt. */
export const EVENT_TOLERANCE = { address: 0.08, armBack: 0.03, top: 0.03, armDown: 0.03, impact: 0.02, finish: 0.06 };

/** Größte Unsicherheit in der Einheit des Werts, bei der die App ihn noch zeigt. */
export const METRIC_TOLERANCE = {
  shoulderTurnTop: 8, hipTurnTop: 8, xFactorTop: 8, xFactorStretch: 8, hipOpenImpact: 8,
  spineTiltAddress: 4, sideBendAddress: 4, spineTiltChange: 5,
  headSwayTop: 0.03, headSwayImpact: 0.03, headHeightImpact: 0.03, hipSwayTop: 0.03, hipSlideImpact: 0.03, hipTowardBallImpact: 0.03,
  tempoRatio: 0.3, swingTime: 0.08, armClockTop: 0.5,
};

/** Was ein Körper im Golfschwung schaffen kann, mit reichlich Luft. */
export const PLAUSIBLE_RANGE = {
  shoulderTurnTop: [-30, 150], hipTurnTop: [-30, 100], xFactorTop: [-30, 100], xFactorStretch: [-30, 100], hipOpenImpact: [-45, 90],
  spineTiltAddress: [0, 70], spineTiltChange: [-40, 40], sideBendAddress: [-30, 40],
  headSwayTop: [-0.4, 0.4], headSwayImpact: [-0.4, 0.4], headHeightImpact: [-0.4, 0.4], hipSwayTop: [-0.4, 0.4], hipSlideImpact: [-0.4, 0.4], hipTowardBallImpact: [-0.4, 0.4],
  tempoRatio: [1, 8], swingTime: [0.3, 4], armClockTop: [5, 14],
};

const need = (part, moment) => ({ part, moment });

/** Diese Zeitpunkte und Gelenke braucht ein Wert. */
export const REQUIREMENTS = {
  shoulderTurnTop: { events: ["address", "top"], visible: [need("shoulders", "address"), need("shoulders", "top")] },
  hipTurnTop: { events: ["address", "top"], visible: [need("hips", "address"), need("hips", "top")] },
  xFactorTop: { events: ["address", "top"], visible: [need("shoulders", "address"), need("hips", "address"), need("shoulders", "top"), need("hips", "top")] },
  xFactorStretch: { events: ["address", "top", "impact"], visible: [need("shoulders", "address"), need("hips", "address"), need("shoulders", "armDown"), need("hips", "armDown")] },
  hipOpenImpact: { events: ["address", "impact"], visible: [need("hips", "address"), need("hips", "impact")] },
  spineTiltAddress: { events: ["address"], visible: [need("shoulders", "address"), need("hips", "address")] },
  sideBendAddress: { events: ["address"], visible: [need("shoulders", "address"), need("hips", "address")] },
  spineTiltChange: { events: ["address", "impact"], visible: [need("shoulders", "address"), need("hips", "address"), need("shoulders", "impact"), need("hips", "impact")] },
  headSwayTop: { events: ["address", "top"], visible: [need("head", "address"), need("head", "top")] },
  headSwayImpact: { events: ["address", "impact"], visible: [need("head", "address"), need("head", "impact")] },
  headHeightImpact: { events: ["address", "impact"], visible: [need("head", "address"), need("head", "impact")] },
  hipSwayTop: { events: ["address", "top"], visible: [need("hips", "address"), need("hips", "top")] },
  hipSlideImpact: { events: ["address", "impact"], visible: [need("hips", "address"), need("hips", "impact")] },
  hipTowardBallImpact: { events: ["address", "impact"], visible: [need("hips", "address"), need("hips", "impact")] },
  tempoRatio: { events: ["address", "top", "impact"], visible: [] },
  swingTime: { events: ["address", "impact"], visible: [] },
  armClockTop: { events: ["top"], visible: [need("leadArm", "top")] },
};

const BODY_PART_ORDER = ["head", "shoulders", "arms", "hands", "hips", "knees", "feet"];

/** Wie gut jedes Gelenk in jedem Bild erkannt ist, wie `SwingReliability.Visibility`. */
function visibilityOf(frames, settings) {
  const times = frames.map((frame) => frame.time);
  const inside = (value) => value >= settings.edgeMargin && value <= 1 - settings.edgeMargin;
  const good = [];
  let previous = null;
  for (const frame of frames) {
    const joints = new Set();
    for (const joint of JOINTS) {
      const point = frame.joints[joint];
      if (!point) continue;
      if (frame.confidence[joint] != null && frame.confidence[joint] < settings.minimumConfidence) continue;
      const image = frame.image[joint];
      if (image && (!inside(image[0]) || !inside(image[1]))) continue;
      if (previous && previous.joints[joint]) {
        const interval = frame.time - previous.time;
        if (interval > 0 && interval <= 0.1 && distance(point, previous.joints[joint]) / interval > maximumSpeed(JOINT_PART[joint])) continue;
      }
      joints.add(joint);
    }
    good.push(joints);
    if (isDetected(frame)) previous = frame;
  }
  const window = Math.max(settings.window, 2.5 * median(intervalsOf(times)));
  const minimumShare = settings.minimumVisibleShare;

  const indicesBetween = (start, end) => {
    const result = [];
    for (let index = 0; index < times.length; index += 1) if (times[index] >= start && times[index] <= end) result.push(index);
    return result;
  };
  const indicesFor = (moment, phases) => {
    switch (moment) {
      case "address": {
        if (phases.address == null) return null;
        const still = indicesBetween(phases.address - 0.25, phases.address - 0.02);
        return still.length >= 3 ? still : indicesBetween(phases.address - window, phases.address + window);
      }
      case "armDown":
        if (phases.top == null || phases.impact == null || !(phases.impact > phases.top)) return null;
        return indicesBetween(phases.top, phases.impact);
      default:
        if (phases[moment] == null) return null;
        return indicesBetween(phases[moment] - window, phases[moment] + window);
    }
  };
  const isVisible = (joint, indices) => {
    if (indices.length === 0) return false;
    const count = indices.filter((index) => good[index].has(joint)).length;
    return count >= minimumShare * indices.length;
  };
  const jointsOf = (part, lead) => {
    switch (part) {
      case "shoulders":
        return { all: ["leftShoulder", "rightShoulder"], any: [], body: "shoulders" };
      case "hips":
        return { all: ["leftHip", "rightHip"], any: [], body: "hips" };
      case "head":
        return { all: [], any: ["centerHead", "topHead"], body: "head" };
      case "hands":
        return { all: [], any: ["leftWrist", "rightWrist"], body: "hands" };
      default:
        return { all: lead ?? ["leftShoulder", "leftWrist", "rightShoulder", "rightWrist"], any: [], body: "hands" };
    }
  };
  const visible = (joints, indices) => joints.all.every((joint) => isVisible(joint, indices)) && (joints.any.length === 0 || joints.any.some((joint) => isVisible(joint, indices)));
  return {
    /** Körperteile, die zuerst fehlen, mit ihrem Zeitpunkt. Null, wenn alle gut erkannt sind. */
    missing(needs, phases, lead) {
      const missingParts = new Map();
      for (const item of needs) {
        const indices = indicesFor(item.moment, phases);
        if (!indices) continue;
        const joints = jointsOf(item.part, lead);
        if (visible(joints, indices)) continue;
        if (!missingParts.has(item.moment)) missingParts.set(item.moment, []);
        const list = missingParts.get(item.moment);
        if (!list.includes(joints.body)) list.push(joints.body);
      }
      const first = missingParts.keys().next();
      if (first.done) return null;
      const parts = missingParts.get(first.value);
      return { parts: BODY_PART_ORDER.filter((part) => parts.includes(part)), moment: first.value };
    },
    /** Für einen Zeitpunkt der Phasen: fehlende Körperteile um diese Zeit. */
    missingAround(parts, time) {
      const indices = indicesBetween(time - window, time + window);
      const missing = parts.flatMap((part) => {
        const joints = jointsOf(part, null);
        return visible(joints, indices) ? [] : [joints.body];
      });
      return missing.length === 0 ? null : missing;
    },
  };
}

/** Zufall wie `SplitMix64` im Kern, mit 64 Bit. */
export class SplitMix64 {
  constructor(seed) {
    this.state = BigInt(seed) & SplitMix64.MASK;
  }

  static MASK = (1n << 64n) - 1n;

  next() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & SplitMix64.MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & SplitMix64.MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & SplitMix64.MASK;
    return z ^ (z >> 31n);
  }

  /** Gleichverteilt in [0, 1), aus den oberen 53 Bit. */
  unit() {
    return Number(this.next() >> 11n) / 2 ** 53;
  }
}

/** Zittern je Gelenk und Achse als Standardabweichung in Metern, wie `JointNoise`. */
function jointNoise(frames) {
  const detected = frames.filter(isDetected);
  const times = detected.map((frame) => frame.time);
  const typical = median(intervalsOf(times));
  const factor = 1.4826 / Math.sqrt(6);
  const sigma = {};
  if (typical > 0 && detected.length >= 3) {
    for (const joint of JOINTS) {
      const xs = [];
      const ys = [];
      const zs = [];
      for (let index = 1; index < detected.length - 1; index += 1) {
        const before = detected[index - 1].joints[joint];
        const point = detected[index].joints[joint];
        const after = detected[index + 1].joints[joint];
        if (!before || !point || !after) continue;
        if (Math.abs(times[index] - times[index - 1] - typical) > 0.25 * typical || Math.abs(times[index + 1] - times[index] - typical) > 0.25 * typical) continue;
        const second = sub(add(before, after), scale(point, 2));
        xs.push(Math.abs(second[0]));
        ys.push(Math.abs(second[1]));
        zs.push(Math.abs(second[2]));
      }
      if (xs.length < 8) continue;
      sigma[joint] = [median(xs) * factor, median(ys) * factor, median(zs) * factor];
    }
  }
  const values = JOINTS.filter((joint) => sigma[joint]).map((joint) => sigma[joint]);
  const fallback = [median(values.map((value) => value[0])), median(values.map((value) => value[1])), median(values.map((value) => value[2]))];
  return { sigma, fallback };
}

/** Mehrere Durchläufe mit verwackelten Punkten, dazu einer ohne Zittern, wie `Simulation`. */
function simulate(frames, handedness, clipImpact, scaleIsMeasured, settings) {
  const detected = frames.filter(isDetected);
  const track = settings.runs > 0 ? skeletonTrack(detected, 0.02) : null;
  const result = { runs: 0, metricValues: {}, eventTimes: {}, baseMetrics: {}, baseEvents: {} };
  if (!track || track.times.length !== detected.length) return result;
  result.runs = settings.runs;
  const noise = jointNoise(detected);

  const base = detected.map((frame, index) => makeFrame(frame.time, track.poseAtIndex(index).joints, frame.image, frame.confidence));
  const basePhases = detectPhases(base, handedness, clipImpact);
  for (const event of EVENTS) result.baseEvents[event] = basePhases[event];
  const computed = computeMetrics(base, basePhases, handedness, scaleIsMeasured);
  for (const metric of computed?.values ?? []) result.baseMetrics[metric.kind] = metric.value;

  const random = new SplitMix64(settings.seed);
  const gaussian = () => {
    const first = Math.max(Number.EPSILON, random.unit());
    const second = random.unit();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  };
  for (let run = 0; run < result.runs; run += 1) {
    const simulated = detected.map((frame, index) => {
      const smooth = track.poseAtIndex(index);
      const joints = {};
      for (const joint of JOINTS) {
        const point = smooth.joints[joint];
        if (!point) continue;
        const sigma = noise.sigma[joint] ?? noise.fallback;
        joints[joint] = [point[0] + gaussian() * sigma[0], point[1] + gaussian() * sigma[1], point[2] + gaussian() * sigma[2]];
      }
      return makeFrame(frame.time, joints, frame.image, frame.confidence);
    });
    const phases = detectPhases(simulated, handedness, clipImpact);
    for (const event of EVENTS) {
      if (phases[event] != null) (result.eventTimes[event] ??= []).push(phases[event]);
    }
    const metrics = computeMetrics(simulated, phases, handedness, scaleIsMeasured);
    for (const metric of metrics?.values ?? []) (result.metricValues[metric.kind] ??= []).push(metric.value);
  }
  return result;
}

/** 2,5-fache Standardabweichung plus die Verschiebung des Mittels gegenüber dem Durchlauf ohne Zittern. */
function spreadOf(values, base, measured) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / (values.length - 1);
  let spread = 2.5 * Math.sqrt(variance) + (base != null ? Math.abs(mean - base) : 0);
  if (base != null && measured != null) spread = Math.max(spread, Math.abs(measured - base));
  return spread;
}

const missingShare = (simulation, list, key) => (simulation.runs > 0 ? 1 - (list[key]?.length ?? 0) / simulation.runs : 0);

/** Gelenke des Führungsarms, wie die Kennzahlen sie wählen. */
function leadArm(frames, phases, handedness) {
  if (phases.address == null || phases.top == null) return null;
  const track = skeletonTrack(frames, 0.02);
  if (!track) return null;
  const body = bodyFrame(track.poseAt(phases.address), track.poseAt(phases.top), handedness);
  if (!body) return null;
  return body.trailIsRight ? ["leftShoulder", "leftWrist"] : ["rightShoulder", "rightWrist"];
}

const makeCheck = (spread) => ({ spread, issue: null, parts: [], moment: null });

/** Prüft, wie sicher die Zeitpunkte und Kennzahlen sind, wie `SwingReliability.check`. */
export function checkReliability(rawFrames, phases, metrics, handedness, cameraAngle, clipImpact = null, settings = RELIABILITY) {
  const frames = [...rawFrames].sort((a, b) => a.time - b.time);
  const visibility = visibilityOf(frames, settings);
  const simulation = simulate(frames, handedness, clipImpact, metrics?.scaleIsMeasured ?? false, settings);

  const phaseChecks = {};
  for (const event of EVENTS) {
    const time = phases[event];
    if (time == null) continue;
    const check = makeCheck(spreadOf(simulation.eventTimes[event], simulation.baseEvents[event], time));
    if (event === "impact" && phases.impactSource === "clip") {
      check.spread = 0;
    } else {
      const missing = visibility.missingAround(["hands"], time);
      if (missing) {
        check.issue = "notVisible";
        check.parts = missing;
        check.moment = event;
      } else if (missingShare(simulation, simulation.eventTimes, event) > settings.maximumMissingShare || (check.spread ?? 0) > EVENT_TOLERANCE[event]) {
        check.issue = "noisy";
      }
    }
    phaseChecks[event] = check;
  }

  const metricChecks = {};
  const lead = metrics ? leadArm(frames, phases, metrics.handedness) : null;
  for (const metric of metrics?.values ?? []) {
    const check = makeCheck(spreadOf(simulation.metricValues[metric.kind], simulation.baseMetrics[metric.kind], metric.value));
    const requirements = REQUIREMENTS[metric.kind];
    const hidden = requirements.events.find((event) => phaseChecks[event]?.issue === "notVisible");
    const range = PLAUSIBLE_RANGE[metric.kind];
    if (!METRICS[metric.kind].views.includes(cameraAngle)) {
      check.issue = "wrongView";
    } else if (hidden) {
      check.issue = "notVisible";
      check.parts = phaseChecks[hidden].parts;
      check.moment = hidden;
    } else {
      const missing = visibility.missing(requirements.visible, phases, lead);
      if (missing) {
        check.issue = "notVisible";
        check.parts = missing.parts;
        check.moment = missing.moment;
      } else if (!(metric.value >= range[0] && metric.value <= range[1])) {
        check.issue = "implausible";
      } else if (missingShare(simulation, simulation.metricValues, metric.kind) > settings.maximumMissingShare || (check.spread ?? 0) > METRIC_TOLERANCE[metric.kind]) {
        check.issue = "noisy";
      }
    }
    metricChecks[metric.kind] = check;
  }
  return { metrics: metricChecks, phases: phaseChecks };
}

// MARK: - Ganze Auswertung

/**
 * Wertet eine Bildfolge aus wie `PoseAnalysis.evaluate`: Achsen, Qualität,
 * Spielhand, Phasen, Kennzahlen und die Prüfung jedes Werts. `frames` zum
 * Speichern sind ausgerichtet, nicht geglättet.
 */
export function evaluateSwing(raw, { cameraAngle, handedness: setting = "right", clipImpact = null, source, bodyHeights = [], heightIsMeasured = false, now = new Date() }) {
  const pose = evaluatePose(raw, { cameraAngle, source, bodyHeights, heightIsMeasured, now });
  let phases = null;
  let metrics = null;
  if (pose.isUsable) {
    const estimate = pose.summary.handedness;
    // Die Phasen brauchen die Spielhand nur, wenn die Bewegung sie nicht zeigt.
    const playing = isReliableHandedness(estimate) ? (estimate.handedness ?? setting) : setting;
    const detected = detectPhases(pose.frames, playing, clipImpact);
    const computed = computeMetrics(pose.frames, detected, playing, heightIsMeasured);
    const reliability = checkReliability(pose.frames, detected, computed, playing, cameraAngle, clipImpact);
    phases = { ...detected, checks: reliability.phases };
    metrics = computed ? { ...computed, values: computed.values.map((metric) => ({ ...metric, check: reliability.metrics[metric.kind] ?? null })) } : null;
  }
  return { ...pose, phases, metrics };
}

// MARK: - Raum zum Anzeigen

/** Achsen der Kamera: zum Ziel nach rechts im Bild, zum Ball zur Kamera hin. */
export function cameraSpace(frames) {
  const first = frames.find(isDetected);
  return { origin: (first && hipCenter(first)) ?? [0, 0, 0], up: UP, lead: [1, 0, 0], toBall: [0, 0, 1] };
}

/** Raum eines Schwungs mit den Richtungen des Körpers beim Ansprechen, wie `SwingSpace.make`. */
export function swingSpace(frames, phases, handedness) {
  const fallback = cameraSpace(frames);
  if (!phases || phases.address == null || phases.top == null) return fallback;
  const track = skeletonTrack(frames, 0.02);
  if (!track) return fallback;
  const address = track.averagePose(phases.address - 0.25, phases.address - 0.02) ?? track.poseAt(phases.address);
  const body = bodyFrame(address, track.poseAt(phases.top), handedness);
  const origin = hipCenter(address);
  if (!body || !origin) return fallback;
  return { origin, up: body.up, lead: scale(body.trail, -1), toBall: body.toBall };
}

export const ORBIT_LOWEST = -10;
export const ORBIT_HIGHEST = 89;
export const ORBIT_VIEWS = { front: { azimuth: 0, elevation: 0 }, behind: { azimuth: 90, elevation: 0 }, above: { azimuth: 0, elevation: ORBIT_HIGHEST } };

export function orbitView(azimuth, elevation) {
  return { azimuth, elevation: Math.min(ORBIT_HIGHEST, Math.max(ORBIT_LOWEST, elevation)) };
}

/** Gedreht um so viele Grad, z. B. beim Ziehen mit dem Finger. */
export function rotatedView(view, deltaAzimuth, deltaElevation) {
  let turned = (view.azimuth + deltaAzimuth) % 360;
  if (turned < 0) turned += 360;
  return orbitView(turned, view.elevation + deltaElevation);
}

/** Achsen auf dem Bildschirm: nach rechts, nach oben und in die Tiefe (Blickrichtung). */
export function orbitAxes(view, space) {
  const phi = (view.azimuth * Math.PI) / 180;
  const theta = (view.elevation * Math.PI) / 180;
  const horizontal = add(scale(space.toBall, -Math.cos(phi)), scale(space.lead, Math.sin(phi)));
  const direction = sub(scale(horizontal, Math.cos(theta)), scale(space.up, Math.sin(theta)));
  const right = normalized(cross(horizontal, space.up)) ?? space.lead;
  const screenUp = normalized(cross(right, direction)) ?? space.up;
  return { right, up: screenUp, depth: direction };
}

/** Punkt auf dem Bildschirm in Metern ab dem Mittelpunkt: x nach rechts, y nach oben, Tiefe größer heißt weiter weg. */
export function projectPoint(view, space, point) {
  const axes = orbitAxes(view, space);
  const offset = sub(point, space.origin);
  return { x: dot(offset, axes.right), y: dot(offset, axes.up), depth: dot(offset, axes.depth) };
}

export { head };
