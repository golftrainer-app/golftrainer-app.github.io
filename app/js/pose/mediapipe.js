// Aus den 33 Punkten von MediaPipe Pose wird das Skelett mit 17 Gelenken, wie
// es die App aus Apple Vision kennt (js/core/pose.js): Punkte im Raum relativ
// zur Kamera in Metern, ihre Lage im Bild und die Sicherheit je Gelenk.
//
// MediaPipe liefert die Punkte im Raum nur relativ zur Hüftmitte. Wo der
// Körper vor der Kamera steht, steckt in den Bildpunkten: Eine Ausgleichs-
// rechnung findet den Maßstab und die Verschiebung, mit denen die Punkte im
// Raum auf die Bildpunkte passen (schwache Perspektive). So bleiben seitliche
// Wege wie Sway und Slide in Metern erhalten. Die Tiefe ist nur grob, sie
// hängt von einer angenommenen Brennweite ab.
import { add, distance, makeFrame, midpoint, normalized, scale, sub } from "../core/pose.js";

/** Nummern der Punkte von MediaPipe Pose. Links und rechts aus Sicht der Person, wie bei Vision. */
export const LANDMARKS = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

/** Brennweite bezogen auf die Bildhöhe, wie bei Handykameras üblich. Nur für die grobe Tiefe. */
export const FOCAL = 1.1;
/** Punkte mit weniger Sichtbarkeit zählen für den Maßstab nicht. */
export const MINIMUM_VISIBILITY = 0.5;
/** Der Scheitel liegt etwa so weit über der Kopfmitte zwischen den Ohren, in Metern. */
export const HEAD_TOP = 0.1;
/** Weniger brauchbare Punkte reichen nicht für den Maßstab. */
export const MINIMUM_POINTS = 4;
export const SOURCE = "MediaPipe Pose";

/**
 * Maßstab und Verschiebung, mit denen Punkte im Raum (x nach rechts, y nach
 * oben, in Metern) auf Bildpunkte passen (u nach rechts, v nach oben, in
 * Bildhöhen). Kleinste Quadrate über u = k · (x + tx), v = k · (y + ty).
 * Null, wenn die Punkte zu wenige oder zu eng beieinander sind.
 */
export function fitPlacement(points) {
  if (points.length < MINIMUM_POINTS) return null;
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  const meanU = points.reduce((sum, point) => sum + point.u, 0) / n;
  const meanV = points.reduce((sum, point) => sum + point.v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.u - meanU) + (point.y - meanY) * (point.v - meanV);
    denominator += (point.x - meanX) ** 2 + (point.y - meanY) ** 2;
  }
  if (denominator < 1e-9) return null;
  const k = numerator / denominator;
  if (!(k > 1e-6)) return null;
  return { k, tx: (meanU - k * meanX) / k, ty: (meanV - k * meanY) / k };
}

/**
 * Ein Bild der Bildfolge aus einem Ergebnis von MediaPipe: `landmarks` die 33
 * Punkte im Bild (normiert), `worldLandmarks` dieselben im Raum relativ zur
 * Hüftmitte in Metern. Ohne Person ein leeres Bild.
 */
export function frameFromMediaPipe({ landmarks, worldLandmarks }, time, { width, height, focal = FOCAL, minimumVisibility = MINIMUM_VISIBILITY } = {}) {
  if (!Array.isArray(landmarks) || !Array.isArray(worldLandmarks) || landmarks.length < 33 || worldLandmarks.length < 33 || !(width > 0) || !(height > 0)) {
    return makeFrame(time);
  }
  const aspect = width / height;
  // MediaPipe: x nach rechts, y nach unten, z von der Kamera weg. Hier: y nach oben, z zur Kamera hin.
  const spatial = worldLandmarks.map((point) => [point.x, -point.y, -point.z]);
  const visibility = landmarks.map((point) => (typeof point.visibility === "number" ? point.visibility : 1));
  const samples = landmarks.map((point, index) => ({ x: spatial[index][0], y: spatial[index][1], u: (point.x - 0.5) * aspect, v: 0.5 - point.y, visibility: visibility[index] }));
  const placement = fitPlacement(samples.filter((sample) => sample.visibility >= minimumVisibility)) ?? fitPlacement(samples);
  if (!placement) return makeFrame(time);
  const shift = [placement.tx, placement.ty, -focal / placement.k];

  const camera = (index) => add(spatial[index], shift);
  const image = (index) => [landmarks[index].x, landmarks[index].y];
  const mid2 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const L = LANDMARKS;
  const joints = {};
  const points = {};
  const confidence = {};
  for (const [joint, index] of Object.entries(L)) {
    if (joint === "nose" || joint === "leftEar" || joint === "rightEar") continue;
    joints[joint] = camera(index);
    points[joint] = image(index);
    confidence[joint] = visibility[index];
  }
  joints.root = midpoint(camera(L.leftHip), camera(L.rightHip));
  points.root = mid2(image(L.leftHip), image(L.rightHip));
  confidence.root = Math.min(visibility[L.leftHip], visibility[L.rightHip]);
  joints.centerShoulder = midpoint(camera(L.leftShoulder), camera(L.rightShoulder));
  points.centerShoulder = mid2(image(L.leftShoulder), image(L.rightShoulder));
  confidence.centerShoulder = Math.min(visibility[L.leftShoulder], visibility[L.rightShoulder]);
  joints.spine = midpoint(joints.root, joints.centerShoulder);
  points.spine = mid2(points.root, points.centerShoulder);
  confidence.spine = Math.min(confidence.root, confidence.centerShoulder);
  joints.centerHead = midpoint(camera(L.leftEar), camera(L.rightEar));
  points.centerHead = mid2(image(L.leftEar), image(L.rightEar));
  confidence.centerHead = Math.min(visibility[L.leftEar], visibility[L.rightEar]);
  // Scheitel: von der Schultermitte durch die Kopfmitte weiter nach oben, im Bild mit demselben Faktor.
  const neck = sub(joints.centerHead, joints.centerShoulder);
  const up = normalized(neck);
  const factor = up ? HEAD_TOP / distance(joints.centerHead, joints.centerShoulder) : 0;
  joints.topHead = up ? add(joints.centerHead, scale(up, HEAD_TOP)) : joints.centerHead;
  points.topHead = [points.centerHead[0] + (points.centerHead[0] - points.centerShoulder[0]) * factor, points.centerHead[1] + (points.centerHead[1] - points.centerShoulder[1]) * factor];
  confidence.topHead = confidence.centerHead;
  return makeFrame(time, joints, points, confidence);
}
