// Pose-Erkennung aus der Seite heraus: startet den Worker mit MediaPipe, gibt
// ihm Bilder und bekommt das Skelett mit 17 Gelenken zurück, wie es die
// Schwunganalyse der App kennt. Die Bilder eines Videos holt `extractPoses`
// Bild für Bild über das Video-Element, höchstens 120 pro Sekunde.
import { ANALYSIS_FRAME_RATE } from "../core/analysis.js";
import { makeFrame } from "../core/pose.js";
import { SOURCE, frameFromMediaPipe } from "./mediapipe.js";

export { SOURCE };

export class PoseEstimator {
  constructor({ delegate = "GPU" } = {}) {
    this.preferred = delegate;
    this.worker = null;
    this.delegate = null;
    this.pending = new Map();
    this.nextID = 1;
  }

  get isRunning() {
    return this.worker != null && this.delegate != null;
  }

  /** Lädt MediaPipe und das Modell. Beim ersten Mal dauert das einige Sekunden, danach kommen die Dateien aus dem Zwischenspeicher. */
  async start() {
    if (this.isRunning) return this.delegate;
    this.worker = new Worker(new URL("./pose-worker.js", import.meta.url));
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) => this.fail(new Error(event.message || "Der Worker der Pose-Erkennung ist abgestürzt."));
    const ready = this.expect("ready");
    this.worker.postMessage({ type: "start", delegate: this.preferred });
    const message = await ready;
    this.delegate = message.delegate;
    return this.delegate;
  }

  /** Ein Bild: `bitmap` geht an den Worker über (danach nicht mehr nutzbar). Antwort ist ein Bild der Bildfolge, ohne Person leer. */
  async detect(bitmap, time, { width = bitmap.width, height = bitmap.height } = {}) {
    if (!this.isRunning) throw new Error("Pose-Erkennung nicht gestartet.");
    const id = this.nextID;
    this.nextID += 1;
    const answer = this.expect("pose", id);
    this.worker.postMessage({ type: "frame", id, bitmap, time }, [bitmap]);
    const message = await answer;
    if (!message.landmarks || !message.worldLandmarks) return makeFrame(time);
    return frameFromMediaPipe(message, time, { width, height });
  }

  stop() {
    if (!this.worker) return;
    this.fail(new Error("Pose-Erkennung beendet."));
    this.worker.terminate();
    this.worker = null;
    this.delegate = null;
  }

  expect(type, id = null) {
    return new Promise((resolve, reject) => {
      this.pending.set(`${type}:${id ?? ""}`, { resolve, reject });
    });
  }

  receive(message) {
    if (message.type === "error") {
      const waiting = this.pending.get(`pose:${message.id ?? ""}`) ?? this.pending.get("ready:");
      if (waiting) {
        this.pending.delete(waiting === this.pending.get("ready:") ? "ready:" : `pose:${message.id ?? ""}`);
        waiting.reject(new Error(message.message));
      } else {
        this.fail(new Error(message.message));
      }
      return;
    }
    const key = `${message.type}:${message.id ?? ""}`;
    const waiting = this.pending.get(key);
    if (!waiting) return;
    this.pending.delete(key);
    waiting.resolve(message);
  }

  fail(error) {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }
}

/** Was schiefging, in einem Satz für die Seite. */
export function describePoseError(error) {
  const text = String(error?.message ?? error ?? "");
  if (/nosimd|SIMD|wasm_nosimd/i.test(text) || /404|fehlt|Failed to fetch|not found/i.test(text)) {
    return "Dieser Browser kann die Pose-Erkennung nicht laden. Es braucht WebAssembly SIMD, also Chrome ab Version 91 oder Safari ab 16.4, und beim ersten Mal eine Netzverbindung für die Dateien der Erkennung (etwa 19 MB).";
  }
  if (/memory|Speicher/i.test(text)) return "Dem Browser ging der Speicher aus. Schließe andere Tabs und versuche es noch einmal.";
  return `Die Pose-Erkennung hat nicht geklappt: ${text}`;
}

/** Zeitpunkte der Bilder, die ausgewertet werden, wie `AnalysisRange.sampling` im Kern. */
export function sampleTimes(range, frameRate) {
  if (!(frameRate > 0)) return [];
  const stride = Math.max(1, Math.round(frameRate / ANALYSIS_FRAME_RATE));
  // „|| 0“ macht aus −0 eine 0.
  const first = Math.ceil(range[0] * frameRate - 1e-6) || 0;
  const last = Math.floor(range[1] * frameRate + 1e-6);
  const times = [];
  for (let index = first; index <= last; index += stride) times.push(index / frameRate);
  return times;
}

/** Springt im Video an eine Stelle und wartet, bis das Bild da ist. */
function seek(video, time) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
      reject(new Error("Das Video lässt sich nicht lesen."));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", failed);
    video.currentTime = time;
  });
}

/**
 * Liest den Ausschnitt eines Videos Bild für Bild und schätzt in jedem das
 * Skelett. `video` muss geladen sein (Metadaten da), `range` in Sekunden,
 * `frameRate` die Bildrate des Videos. `onProgress(done, total)` meldet den
 * Fortschritt, `signal` bricht ab.
 */
export async function extractPoses(video, { range, frameRate, estimator, onProgress = () => {}, signal = null }) {
  const times = sampleTimes(range, frameRate);
  const frames = [];
  const width = video.videoWidth;
  const height = video.videoHeight;
  let last = -1;
  for (const [index, time] of times.entries()) {
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    await seek(video, time);
    // Die Zeit, die das Video wirklich zeigt: Sie muss für MediaPipe streng steigen.
    const shown = Math.max(video.currentTime, last + 1e-3);
    last = shown;
    const bitmap = await createImageBitmap(video);
    const frame = await estimator.detect(bitmap, shown, { width, height });
    frame.time = time;
    frames.push(frame);
    onProgress(index + 1, times.length);
  }
  return frames;
}
