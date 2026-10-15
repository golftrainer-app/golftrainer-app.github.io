// Zeichnet das geschätzte Skelett: über dem Video an der Stelle, an der es
// gerade steht, und im Raum zum Drehen, wie SkeletonOverlay und
// SkeletonScene3D in der App. Boden als Gitter auf Fußhöhe, Ziellinie
// gestrichelt mit Pfeil zum Ziel, Weg der Hände, Knochen; was weiter weg ist,
// ist blasser. Die linke Körperseite heller, die Hände in Fahnenrot.
import { phaseAt } from "../core/analysis.js";
import { BONES, hands, handsInImage, nearestFrame } from "../core/pose.js";
import { orbitAxes } from "../core/swing.js";

/** Farben der Seite aus den CSS-Variablen, mit Ersatz für Tests ohne Stile. */
export function themeColors() {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
  const read = (name, fallback) => style?.getPropertyValue(name)?.trim() || fallback;
  return { ink: read("--ink", "#000000"), secondary: read("--ink-secondary", "#6e6e73"), rule: read("--rule", "rgba(0, 0, 0, 0.14)"), flag: read("--flag", "#d1381f"), paper: read("--paper", "#ffffff") };
}

/** Farbe eines Abschnitts: Rück- und Durchschwung grau, der Abschwung in Tinte, Ansprechen und Finish nur die Linie. */
export function phaseTone(phase, colors) {
  switch (phase) {
    case "downswing":
      return colors.ink;
    case "backswing":
    case "followThrough":
      return colors.secondary;
    default:
      return colors.rule;
  }
}

/** Passt die Zeichenfläche an ihre Größe auf dem Bildschirm an, scharf auf dichten Displays. Gibt Breite und Höhe in CSS-Pixeln zurück. */
export function fitCanvas(canvas) {
  const ratio = Math.min(3, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth || canvas.width);
  const height = Math.max(1, canvas.clientHeight || canvas.height);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

/** Wo das Video in seinem Rahmen liegt (eingepasst, mit Rändern), in CSS-Pixeln. */
export function fittedVideoRect(videoWidth, videoHeight, width, height) {
  if (!(videoWidth > 0) || !(videoHeight > 0) || !(width > 0) || !(height > 0)) return { x: 0, y: 0, width, height };
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = videoWidth * scale;
  const h = videoHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/**
 * Das Skelett über dem Video: Knochen weiß mit dunklem Rand, der Kopf ein
 * Kreis, die Hände in Fahnenrot, der Handweg bis zur gezeigten Stelle. Außerhalb
 * des ausgewerteten Ausschnitts (mehr als 0,06 s vom nächsten Bild) zeigt es nichts.
 */
export function drawOverlay(canvas, { frames, time, video, showsSkeleton = true, showsHandPath = true, colors = themeColors() }) {
  const { context, width, height } = fitCanvas(canvas);
  const nearest = nearestFrame(frames, time);
  if (!nearest || Math.abs(nearest.time - time) > 0.06) return;
  const rect = fittedVideoRect(video?.videoWidth, video?.videoHeight, width, height);
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  const place = (point) => [rect.x + point[0] * rect.width, rect.y + point[1] * rect.height];
  const stroke = (path, color, lineWidth) => {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(path);
  };
  if (showsHandPath) {
    const points = [];
    for (const frame of frames) {
      if (frame.time > nearest.time) break;
      const grip = handsInImage(frame);
      if (grip) points.push(place(grip));
    }
    if (points.length > 1) {
      const path = new Path2D();
      points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      stroke(path, "rgba(0, 0, 0, 0.5)", 4);
      stroke(path, colors.flag, 2);
    }
  }
  if (showsSkeleton) {
    const bones = new Path2D();
    for (const [start, end] of BONES) {
      if (end === "topHead") continue;
      const first = nearest.image[start];
      const second = nearest.image[end];
      if (!first || !second) continue;
      const [x1, y1] = place(first);
      const [x2, y2] = place(second);
      bones.moveTo(x1, y1);
      bones.lineTo(x2, y2);
    }
    stroke(bones, "rgba(0, 0, 0, 0.55)", 5);
    stroke(bones, "#ffffff", 2.5);
    if (nearest.image.centerHead) {
      const [x, y] = place(nearest.image.centerHead);
      let radius = 10;
      if (nearest.image.topHead) {
        const [tx, ty] = place(nearest.image.topHead);
        radius = Math.hypot(tx - x, ty - y);
      }
      const circle = new Path2D();
      circle.arc(x, y, radius, 0, 2 * Math.PI);
      stroke(circle, "rgba(0, 0, 0, 0.55)", 4);
      stroke(circle, "#ffffff", 2);
    }
    for (const joint of ["leftWrist", "rightWrist"]) {
      if (!nearest.image[joint]) continue;
      const [x, y] = place(nearest.image[joint]);
      context.fillStyle = colors.flag;
      context.beginPath();
      context.arc(x, y, 4, 0, 2 * Math.PI);
      context.fill();
    }
  }
  context.restore();
}

/** Maße der Szene: größter Abstand vom Mittelpunkt, Höhe des Bodens, Abstand des Balls. */
export function sceneGeometry(frames, space) {
  let radius = 0.5;
  const heights = [];
  let ball = 0.6;
  let ballFound = false;
  for (const frame of frames) {
    for (const point of Object.values(frame.joints)) {
      radius = Math.max(radius, Math.hypot(point[0] - space.origin[0], point[1] - space.origin[1], point[2] - space.origin[2]));
    }
    const ankles = [frame.joints.leftAnkle, frame.joints.rightAnkle].filter(Boolean).map((point) => dot(sub(point, space.origin), space.up));
    if (ankles.length > 0) heights.push(Math.min(...ankles));
    if (!ballFound) {
      const grip = hands(frame);
      if (grip) {
        ball = dot(sub(grip, space.origin), space.toBall) + 0.2;
        ballFound = true;
      }
    }
  }
  let ground = -0.95;
  if (heights.length > 0) {
    const sorted = [...heights].sort((a, b) => a - b);
    ground = sorted[Math.floor(sorted.length / 2)] - 0.05;
  }
  return { radius, ground, ball };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Ein Bild des Skeletts im Raum, wie `SkeletonScene3D`. `frames` sind die Bilder mit Person, `current` der Index des gezeigten. */
export function drawScene(canvas, { frames, current, space, view, phases = null, showsHandPath = true, colors = themeColors(), geometry = sceneGeometry(frames, space) }) {
  const { context, width, height } = fitCanvas(canvas);
  if (frames.length === 0) return;
  const axes = orbitAxes(view, space);
  const unit = Math.min(width, height) / (2.3 * geometry.radius);
  const center = [width / 2, height / 2];
  const place = (point) => {
    const offset = sub(point, space.origin);
    return [center[0] + dot(offset, axes.right) * unit, center[1] - dot(offset, axes.up) * unit];
  };
  const depth = (point) => dot(sub(point, space.origin), axes.depth);
  const line = (from, to, color, lineWidth, dash = []) => {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
    context.stroke();
    context.setLineDash([]);
  };

  // Boden und Ziellinie.
  const floor = add(space.origin, scale(space.up, geometry.ground));
  for (let step = -2; step <= 2; step += 1) {
    const across = scale(space.toBall, step * 0.3);
    line(place(sub(add(floor, across), scale(space.lead, 1.2))), place(add(add(floor, across), scale(space.lead, 1.2))), colors.rule, 0.5);
  }
  for (let step = -4; step <= 4; step += 1) {
    const along = scale(space.lead, step * 0.3);
    line(place(sub(add(floor, along), scale(space.toBall, 0.6))), place(add(add(floor, along), scale(space.toBall, 0.6))), colors.rule, 0.5);
  }
  const ballLine = add(floor, scale(space.toBall, geometry.ball));
  const from = place(sub(ballLine, scale(space.lead, 1.2)));
  const to = place(add(ballLine, scale(space.lead, 1.2)));
  line(from, to, colors.secondary, 1, [5, 4]);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const span = Math.hypot(dx, dy);
  if (span > 40) {
    const ux = dx / span;
    const uy = dy / span;
    line([to[0] - 9 * ux - 5 * uy, to[1] - 9 * uy + 5 * ux], to, colors.secondary, 1);
    line([to[0] - 9 * ux + 5 * uy, to[1] - 9 * uy - 5 * ux], to, colors.secondary, 1);
  }

  // Weg der Hände: ganz und blass, bis zum Bild kräftig nach Abschnitt.
  if (showsHandPath) {
    const points = frames.flatMap((frame) => {
      const grip = hands(frame);
      return grip ? [{ time: frame.time, point: place(grip) }] : [];
    });
    if (points.length > 1) {
      context.strokeStyle = colors.rule;
      context.lineWidth = 1.5;
      context.beginPath();
      points.forEach(({ point }, index) => (index === 0 ? context.moveTo(point[0], point[1]) : context.lineTo(point[0], point[1])));
      context.stroke();
      const now = frames[current].time;
      for (let step = 1; step < points.length && points[step].time <= now; step += 1) {
        line(points[step - 1].point, points[step].point, phaseTone(phaseAt(phases, points[step].time), colors) === colors.rule ? colors.secondary : phaseTone(phaseAt(phases, points[step].time), colors), 2);
      }
    }
  }

  // Knochen, weiter weg blasser.
  const frame = frames[current];
  const depths = Object.values(frame.joints).map(depth);
  const nearest = depths.length > 0 ? Math.min(...depths) : 0;
  const farthest = depths.length > 0 ? Math.max(...depths) : 0;
  const opacity = (point) => (farthest - nearest > 0.01 ? 1 - (0.5 * (depth(point) - nearest)) / (farthest - nearest) : 1);
  const headRadius = Math.max(6, 0.09 * unit);
  for (const [start, end] of BONES) {
    if (end === "topHead") continue;
    const first = frame.joints[start];
    const second = frame.joints[end];
    if (!first || !second) continue;
    const a = place(first);
    let b = place(second);
    if (end === "centerHead") {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length <= headRadius) continue;
      b = [b[0] - ((b[0] - a[0]) * headRadius) / length, b[1] - ((b[1] - a[1]) * headRadius) / length];
    }
    const isLeft = start.startsWith("left") || end.startsWith("left");
    context.globalAlpha = opacity([(first[0] + second[0]) / 2, (first[1] + second[1]) / 2, (first[2] + second[2]) / 2]);
    line(a, b, isLeft ? colors.secondary : colors.ink, 3);
    context.globalAlpha = 1;
  }
  if (frame.joints.centerHead) {
    const [x, y] = place(frame.joints.centerHead);
    context.globalAlpha = opacity(frame.joints.centerHead);
    context.strokeStyle = colors.ink;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, headRadius, 0, 2 * Math.PI);
    context.stroke();
    context.globalAlpha = 1;
  }
  for (const joint of ["leftWrist", "rightWrist"]) {
    if (!frame.joints[joint]) continue;
    const [x, y] = place(frame.joints[joint]);
    context.fillStyle = colors.flag;
    context.beginPath();
    context.arc(x, y, 5, 0, 2 * Math.PI);
    context.fill();
  }
}
