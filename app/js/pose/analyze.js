// Eine Analyse im Browser auswerten: das Video Bild für Bild lesen, in jedem
// das Skelett schätzen (MediaPipe im Worker), dann Phasen, Kennzahlen und die
// Prüfung der Werte rechnen wie im Kern. Alles bleibt im Browser.
import { evaluateSwing } from "../core/swing.js";
import { PoseEstimator, SOURCE, extractPoses } from "./estimator.js";

export { SOURCE };

/** Lädt ein Video aus einer Datei, bis Dauer und Maße bekannt sind. */
export function loadVideo(blob) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("loadedmetadata", () => resolve({ video, url }), { once: true });
    video.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(url);
        reject(new Error("Dieses Video kann der Browser nicht lesen."));
      },
      { once: true },
    );
    video.src = url;
  });
}

/**
 * Bilder pro Sekunde eines Videos: kurz abspielen und die Abstände der gezeigten
 * Bilder messen (Median), auf übliche Bildraten gerundet. Ohne Messung 30.
 */
export async function measureFrameRate(video, { seconds = 1.2, fallback = 30 } = {}) {
  if (!("requestVideoFrameCallback" in video)) return fallback;
  const deltas = [];
  const start = Math.min(video.duration || 0, 0.2);
  video.currentTime = start;
  await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
  await new Promise((resolve) => {
    let last = null;
    let handle = null;
    const finish = () => {
      if (handle != null) video.cancelVideoFrameCallback(handle);
      video.pause();
      resolve();
    };
    const timer = setTimeout(finish, seconds * 1000 + 500);
    const onFrame = (_, metadata) => {
      if (last != null) {
        const delta = metadata.mediaTime - last;
        if (delta > 1 / 300 && delta < 0.2) deltas.push(delta);
      }
      last = metadata.mediaTime;
      if (metadata.mediaTime - start >= seconds || deltas.length >= 60) {
        clearTimeout(timer);
        finish();
        return;
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    video.playbackRate = 1;
    video.play().catch(() => {
      clearTimeout(timer);
      finish();
    });
  });
  if (deltas.length < 5) return fallback;
  const sorted = [...deltas].sort((a, b) => a - b);
  const measured = 1 / sorted[Math.floor(sorted.length / 2)];
  // Übliche Bildraten: die nächste, wenn sie nah genug liegt.
  const common = [24, 25, 30, 50, 60, 100, 120, 240];
  const nearest = common.reduce((best, rate) => (Math.abs(rate - measured) < Math.abs(best - measured) ? rate : best), common[0]);
  return Math.abs(nearest - measured) / nearest < 0.08 ? nearest : Math.round(measured);
}

/**
 * Wertet den Ausschnitt eines Videos aus. `onProgress(done, total)` meldet die
 * ausgewerteten Bilder, `onStage(text)` den Schritt, `signal` bricht ab.
 * Ergebnis: wie `evaluateSwing`, mit `frames` zum Speichern.
 */
export async function analyzeClip({ blob, range, frameRate, cameraAngle, handedness, clipImpact = null, onProgress = () => {}, onStage = () => {}, signal = null }) {
  onStage("Die Erkennung lädt …");
  const estimator = new PoseEstimator();
  const { video, url } = await loadVideo(blob);
  try {
    await estimator.start();
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    onStage("Das 3D-Skelett wird Bild für Bild geschätzt.");
    const frames = await extractPoses(video, { range, frameRate, estimator, onProgress, signal });
    onStage("Phasen und Kennzahlen werden gerechnet.");
    return evaluateSwing(frames, { cameraAngle, handedness, clipImpact, source: SOURCE });
  } finally {
    estimator.stop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
