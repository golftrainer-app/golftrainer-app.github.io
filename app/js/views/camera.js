// Kamera mit automatischem Auslöser in der Web-App, wie der Kamera-Modus der
// App (App/Sources/Video/CaptureEngine.swift, docs/KAMERA.md): Das Handy
// nimmt dauernd auf und behält nur die letzten Sekunden. Hört das Mikrofon den
// Treffmoment und zeigt das Bild kurz davor Bewegung, wird der Schwung als
// Clip gespeichert, von einigen Sekunden davor bis 1,5 Sekunden danach, ohne
// Ton. Die Erkennung rechnet core/capture.js, die Clips liegen in clips.js.
//
// Rollende Aufnahme im Browser: Ein MediaRecorder liefert nur ganze Dateien.
// Deshalb laufen zwei Aufnahmen versetzt, jede sechs Sekunden, alle drei
// Sekunden beginnt eine neue. Zu jedem Treffmoment gibt es so eine laufende
// Aufnahme mit drei bis sechs Sekunden Vorlauf; sie läuft bis 1,5 Sekunden nach
// dem Treffmoment weiter und wird dann zum Clip. Die andere wird verworfen.
import { clipStore } from "../clips.js";
import {
  ImpactDetector, MotionGrid, MotionTracker, SENSITIVITIES, SENSITIVITY_NAMES, SWING_TYPES, SWING_TYPE_SHORT, SwingMotionDetector, TRIGGERS, TRIGGER_NAMES,
  clipFileName, listensForSound, manualImpact, segmentFor,
} from "../core/capture.js";
import { newID } from "../core/model.js";
import { displayCode, isCode, normalizeCode } from "../core/screenlink.js";
import { CameraLink } from "../link.js";
import { ask, chapter, empty, html, toast } from "../ui.js";
import { openClip } from "./swing.js";

export const CAMERA_KEY = "golftrainer.kamera";
/** Eine Aufnahme dauert so lange, und alle so viele Sekunden beginnt die nächste. */
export const SEGMENT_SECONDS = 6;
export const ROTATE_SECONDS = 3;
/** Nach dem Treffmoment wird so lange weiter aufgenommen. */
export const POST_ROLL = 1.5;
/** Bewegung wird so oft gemessen, auf einem Bild von 32 × 18 Punkten. */
const MOTION_INTERVAL_MS = 66;
const GRID_WIDTH = 32;
const GRID_HEIGHT = 18;
/** Bevorzugt, was das Handy in Hardware kodiert; WebM mit VP8 kann jeder Chrome. */
const MIME_TYPES = ["video/mp4;codecs=avc1", "video/webm;codecs=h264", "video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
const FACINGS = ["environment", "user"];
const FACING_NAMES = { environment: "Rückseite", user: "Vorderseite" };
const DEFAULTS = { trigger: "soundAndMotion", sensitivity: "medium", swingType: "full", facing: "environment", screenCode: "", liveVideo: true };
const LINK_TEXT = {
  idle: "Nicht verbunden.",
  searching: "Sucht den Bildschirm … Dort muss „Dieses Gerät als Bildschirm“ offen sein.",
  connecting: "Bildschirm gefunden, verbindet …",
  connected: "Verbunden. Live-Bild und Clips gehen an den Bildschirm.",
  error: "Keine Verbindung zum Server.",
};
const oneDecimal = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const now = () => performance.now() / 1000;

/** Einstellungen der Kamera, nur in diesem Browser (localStorage). */
export function loadSettings(storage = globalThis.localStorage) {
  const settings = { ...DEFAULTS };
  try {
    const stored = JSON.parse(storage?.getItem(CAMERA_KEY) ?? "null");
    if (stored && typeof stored === "object") Object.assign(settings, stored);
  } catch {
    // Unlesbar: die Vorgaben.
  }
  if (!TRIGGERS.includes(settings.trigger)) settings.trigger = DEFAULTS.trigger;
  if (!SENSITIVITIES.includes(settings.sensitivity)) settings.sensitivity = DEFAULTS.sensitivity;
  if (!SWING_TYPES.includes(settings.swingType)) settings.swingType = DEFAULTS.swingType;
  if (!FACINGS.includes(settings.facing)) settings.facing = DEFAULTS.facing;
  return {
    trigger: settings.trigger,
    sensitivity: settings.sensitivity,
    swingType: settings.swingType,
    facing: settings.facing,
    screenCode: isCode(settings.screenCode) ? normalizeCode(settings.screenCode) : "",
    liveVideo: settings.liveVideo !== false,
  };
}

function saveSettings(settings) {
  try {
    globalThis.localStorage?.setItem(CAMERA_KEY, JSON.stringify(settings));
  } catch {
    // Gesperrt: dann gilt die Einstellung bis zum Neuladen.
  }
}

function clock(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Warum die Kamera nicht startet, in Worten. */
function describeCameraError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Kamera nicht erlaubt. Erlaube sie in den Einstellungen des Browsers für diese Seite und versuch es noch einmal.";
    case "NotFoundError":
      return "Keine Kamera gefunden.";
    case "NotReadableError":
    case "AbortError":
      return "Die Kamera ist gerade belegt, z. B. von einer anderen App.";
    default:
      return error?.message ? `Die Kamera lässt sich nicht starten: ${error.message}` : "Die Kamera lässt sich nicht starten.";
  }
}

/** Bewegung in Prozent mit einer Nachkommastelle, wie in der Doku: 0,004 ergibt „0,4 %“. */
function percent(energy) {
  return `${String(Math.round(energy * 1000) / 10).replace(".", ",")} %`;
}

/** Kamera, Mikrofon, rollende Aufnahme und Erkennung, solange die Seite offen ist. */
class CameraSession {
  constructor({ preview, settings, onStatus, onClip, onMotion }) {
    this.preview = preview;
    this.settings = settings;
    this.onStatus = onStatus;
    this.onClip = onClip;
    this.onMotion = onMotion;
    this.motionReported = 0;
    this.stream = null;
    this.segments = [];
    this.withoutMicrophone = false;
    this.paused = false;
  }

  get isRunning() {
    return this.stream != null;
  }

  /** Ohne Mikrofon erkennt die Kamera Schwünge an der Bewegung, wie in der App. */
  get effectiveTrigger() {
    return listensForSound(this.settings.trigger) && this.withoutMicrophone ? "motion" : this.settings.trigger;
  }

  get listeningText() {
    if (this.paused) return "Pausiert. Weiter geht es hier oder vom Bildschirm.";
    if (listensForSound(this.settings.trigger) && this.withoutMicrophone) return "Ohne Mikrofon: erkennt Schwünge an der Bewegung im Bild.";
    switch (this.settings.trigger) {
      case "soundAndMotion":
        return "Hört auf das Treffgeräusch und schaut auf die Bewegung im Bild.";
      case "sound":
        return "Hört auf das Treffgeräusch.";
      case "motion":
        return "Schaut auf die Bewegung: Ruhe, Schwung, Ruhe.";
      default:
        return "Tippe nach dem Schwung auf „Schwung speichern“.";
    }
  }

  status(text) {
    this.onStatus?.(text);
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Dieser Browser kann die Kamera nicht öffnen.");
    if (typeof MediaRecorder === "undefined") throw new Error("Dieser Browser kann nicht im Hintergrund aufnehmen.");
    const wantsSound = listensForSound(this.settings.trigger);
    // Die Tonverarbeitung muss in der Geste des Tippens entstehen, sonst bleibt sie auf dem iPhone stumm.
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this.audio = wantsSound && Context ? new Context() : null;
    const video = { facingMode: { ideal: this.settings.facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
    this.withoutMicrophone = false;
    let stream = null;
    if (wantsSound) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (error) {
        // Mikrofon abgelehnt oder belegt: dann nur die Kamera, die Erkennung läuft über die Bewegung.
        if (!["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError"].includes(error?.name)) throw error;
        this.withoutMicrophone = true;
      }
    }
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (error) {
        if (error?.name !== "OverconstrainedError") throw error;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    }
    if (wantsSound && stream.getAudioTracks().length === 0) this.withoutMicrophone = true;
    this.stream = stream;
    this.preview.srcObject = stream;
    this.preview.muted = true;
    try {
      await this.preview.play();
    } catch {
      // Autoplay ohne Ton geht; sonst startet das Bild mit dem ersten Tippen.
    }
    this.tracker = new MotionTracker();
    this.motionDetector = new SwingMotionDetector({ swingType: this.settings.swingType });
    this.impactDetector = new ImpactDetector({ sensitivity: this.settings.sensitivity, swingType: this.settings.swingType });
    this.detectedSwings = [];
    this.savedImpacts = [];
    this.holdUntil = 0;
    this.startRecorders();
    this.startMotion();
    if (wantsSound && !this.withoutMicrophone) {
      try {
        await this.startAudio();
      } catch {
        this.withoutMicrophone = true;
      }
    }
    if (!wantsSound || this.withoutMicrophone) {
      this.audio?.close().catch(() => {});
      this.audio = null;
    }
    try {
      this.lock = (await navigator.wakeLock?.request?.("screen")) ?? null;
    } catch {
      this.lock = null;
    }
    this.status(this.listeningText);
  }

  // MARK: Rollende Aufnahme

  startRecorders() {
    const supports = typeof MediaRecorder.isTypeSupported === "function" ? (type) => MediaRecorder.isTypeSupported(type) : () => false;
    this.mimeType = MIME_TYPES.find(supports) ?? "";
    this.videoStream = new MediaStream(this.stream.getVideoTracks());
    this.segments = [];
    this.startSegment();
    this.rotation = setInterval(() => this.rotate(), ROTATE_SECONDS * 1000);
  }

  startSegment() {
    let recorder;
    try {
      recorder = new MediaRecorder(this.videoStream, this.mimeType ? { mimeType: this.mimeType, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 });
    } catch {
      try {
        recorder = new MediaRecorder(this.videoStream);
      } catch {
        this.status("Dieser Browser kann die Kamera nicht aufnehmen.");
        return null;
      }
    }
    const segment = { id: newID(), recorder, start: now(), end: null, capturing: false, impact: null, trigger: null, chunks: [], stopTimer: null, done: false };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) segment.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => this.segmentStopped(segment));
    recorder.addEventListener("error", () => this.segmentStopped(segment));
    try {
      recorder.start();
    } catch {
      this.status("Dieser Browser kann die Kamera nicht aufnehmen.");
      return null;
    }
    this.segments.push(segment);
    return segment;
  }

  /** Alle drei Sekunden eine neue Aufnahme; was sechs Sekunden alt ist und keinen Schwung hält, fällt weg. */
  rotate() {
    const time = now();
    const newest = this.startSegment();
    if (time < this.holdUntil) return;
    for (const segment of [...this.segments]) {
      if (segment.capturing || segment === newest) continue;
      if (time - segment.start >= SEGMENT_SECONDS - 0.05) this.stopSegment(segment);
    }
  }

  stopSegment(segment) {
    clearTimeout(segment.stopTimer);
    if (segment.recorder.state !== "inactive") {
      try {
        segment.recorder.stop();
        return;
      } catch {
        // Dann unten abschließen.
      }
    }
    this.segmentStopped(segment);
  }

  segmentStopped(segment) {
    if (segment.done) return;
    segment.done = true;
    segment.end = now();
    this.segments = this.segments.filter((other) => other !== segment);
    if (segment.capturing) {
      if (segment.chunks.length > 0) {
        const blob = new Blob(segment.chunks, { type: segment.chunks[0].type || this.mimeType || "video/webm" });
        this.onClip?.({ blob, start: segment.start, end: segment.end, impact: segment.impact, trigger: segment.trigger });
      } else {
        this.status("Der Clip ließ sich nicht speichern.");
      }
    }
    segment.chunks = [];
  }

  /** Für den Bildschirm: Was die Kamera gerade tut. */
  get snapshot() {
    return { isRecording: this.stream != null && !this.paused, paused: this.paused, text: this.stream ? this.listeningText : "Kamera aus." };
  }

  /** Pause vom Bildschirm: Kamera bleibt an, Aufnahme und Erkennung ruhen. */
  pause() {
    if (!this.stream || this.paused) return;
    this.paused = true;
    clearInterval(this.rotation);
    clearInterval(this.motionTimer);
    this.rotation = null;
    this.motionTimer = null;
    for (const segment of [...this.segments]) this.stopSegment(segment);
    this.segments = [];
    this.status(this.listeningText);
  }

  resume() {
    if (!this.stream || !this.paused) return;
    this.paused = false;
    this.startRecorders();
    this.startMotion();
    this.status(this.listeningText);
  }

  /** Hält den Treffmoment fest: Die Aufnahme mit dem meisten Vorlauf läuft bis 1,5 Sekunden danach weiter. */
  capture(impact, trigger) {
    if (!this.stream || this.paused) return false;
    if (this.savedImpacts.some((saved) => Math.abs(saved - impact) < 1.5)) return false;
    let segment = segmentFor(this.segments, impact);
    if (!segment) {
      // Ganz am Anfang: Die älteste laufende Aufnahme, auch wenn sie erst nach dem Treffmoment begann.
      segment = this.segments.filter((other) => !other.capturing).sort((a, b) => a.start - b.start)[0] ?? null;
    }
    if (!segment) {
      this.status("Noch keine Aufnahme, gleich noch einmal.");
      return false;
    }
    segment.capturing = true;
    segment.impact = impact;
    segment.trigger = trigger;
    this.savedImpacts.push(impact);
    if (this.savedImpacts.length > 50) this.savedImpacts.shift();
    const delay = Math.max(0, impact + POST_ROLL - now());
    segment.stopTimer = setTimeout(() => this.stopSegment(segment), delay * 1000 + 50);
    // Die rollende Aufnahme läuft weiter: immer mindestens eine freie Aufnahme.
    if (!this.segments.some((other) => !other.capturing)) this.startSegment();
    this.status("Schwung erkannt, wird gespeichert …");
    return true;
  }

  // MARK: Erkennung

  async startAudio() {
    if (!this.audio?.audioWorklet) throw new Error("kein AudioWorklet");
    await this.audio.resume();
    await this.audio.audioWorklet.addModule(new URL("../audio/impact-worklet.js", import.meta.url));
    const source = this.audio.createMediaStreamSource(this.stream);
    this.relay = new AudioWorkletNode(this.audio, "sample-relay", { numberOfInputs: 1, numberOfOutputs: 0 });
    source.connect(this.relay);
    this.relay.port.onmessage = (event) => this.onSamples(event.data);
  }

  onSamples({ samples, startFrame }) {
    if (!this.audio || !this.stream) return;
    const rate = this.audio.sampleRate;
    const impacts = this.impactDetector.process(samples, startFrame / rate, rate);
    if (impacts.length === 0) return;
    // Von der Uhr der Tonausgabe auf die Uhr der Seite, mit der die Aufnahmen laufen.
    const offset = now() - this.audio.currentTime;
    for (const impactTime of impacts) this.onImpact(impactTime + offset);
  }

  onImpact(impact) {
    const trigger = this.effectiveTrigger;
    if (trigger === "sound") {
      this.capture(impact, "sound");
      return;
    }
    if (trigger !== "soundAndMotion") return;
    // Die Bewegung kurz nach dem Knall zählt mit: erst dann entscheiden, solange die Aufnahme noch läuft.
    this.holdUntil = now() + 0.6;
    setTimeout(() => {
      if (!this.stream) return;
      const check = this.tracker.swingCheckFor(impact, this.settings.swingType);
      if (check.confirmed) this.capture(impact, "soundAndMotion");
      else if (check.peak == null) {
        // Keine Bewegungsdaten um den Treffmoment, etwa weil das Bild nicht lesbar ist: Dann zählt das Geräusch allein.
        this.flash("Keine Bewegungsdaten, Geräusch zählt.");
        this.capture(impact, "sound");
      } else this.flash(`Geräusch ignoriert: Bewegung ${percent(check.peak)}, nötig ${percent(check.required)}.`);
    }, 400);
  }

  startMotion() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = GRID_WIDTH;
    this.canvas.height = GRID_HEIGHT;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.motionTimer = setInterval(() => this.sampleMotion(), MOTION_INTERVAL_MS);
  }

  sampleMotion() {
    const video = this.preview;
    if (!this.context || !video.videoWidth || video.readyState < 2) return;
    try {
      this.context.drawImage(video, 0, 0, GRID_WIDTH, GRID_HEIGHT);
    } catch {
      return;
    }
    const data = this.context.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT).data;
    const time = now();
    this.tracker.add(MotionGrid.fromRGBA(GRID_WIDTH, GRID_HEIGHT, data), time);
    const sample = this.tracker.samples[this.tracker.samples.length - 1];
    if (!sample || sample.time !== time) return;
    this.reportMotion(time);
    const swing = this.motionDetector.add(sample, this.tracker.baseline);
    if (swing == null) return;
    this.detectedSwings.push(swing);
    if (this.detectedSwings.length > 20) this.detectedSwings.shift();
    if (this.effectiveTrigger === "motion") this.capture(swing, "motion");
  }

  /** Viermal pro Sekunde zum Ablesen: stärkste Bewegung der letzten Sekunde, Ruhepegel und nötige Schwelle. */
  reportMotion(time) {
    if (!this.onMotion || time - this.motionReported < 0.25) return;
    this.motionReported = time;
    const trigger = this.effectiveTrigger;
    if (trigger !== "soundAndMotion" && trigger !== "motion") {
      this.onMotion(null);
      return;
    }
    this.onMotion({ recent: this.tracker.peak(time - 1, time)?.energy ?? 0, baseline: this.tracker.baseline, required: this.tracker.requiredFor(this.settings.swingType) });
  }

  /** „Schwung speichern“: der letzte erkannte Schwung, sonst die stärkste Bewegung. Am Handy getippt zählt die letzte Sekunde nicht. */
  saveManually({ fromScreen = false } = {}) {
    if (!this.stream || this.paused) return false;
    const impact = manualImpact({ now: now(), detectedSwings: this.detectedSwings, savedImpacts: this.savedImpacts, motion: this.tracker, tappedOnCamera: !fromScreen });
    const saved = this.capture(impact, "manual");
    if (!saved) this.flash("Schon gespeichert oder noch keine Aufnahme.");
    return saved;
  }

  flash(text) {
    this.status(text);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      if (this.stream) this.status(this.listeningText);
    }, 2500);
  }

  /** Einstellungen, die ohne Neustart greifen. Gibt zurück, ob ein Neustart nötig ist. */
  apply(settings) {
    const needsRestart = settings.facing !== this.settings.facing || listensForSound(settings.trigger) !== listensForSound(this.settings.trigger);
    this.settings = settings;
    if (this.impactDetector) {
      this.impactDetector.sensitivity = settings.sensitivity;
      this.impactDetector.swingType = settings.swingType;
    }
    if (this.motionDetector) this.motionDetector.swingType = settings.swingType;
    if (this.stream && !needsRestart) this.status(this.listeningText);
    return needsRestart;
  }

  stop() {
    clearInterval(this.rotation);
    clearInterval(this.motionTimer);
    clearTimeout(this.flashTimer);
    this.rotation = null;
    this.motionTimer = null;
    for (const segment of [...this.segments]) {
      clearTimeout(segment.stopTimer);
      // Ein Schwung, der gerade gespeichert wird, kommt noch als Clip; alles andere fällt weg.
      this.stopSegment(segment);
    }
    this.segments = [];
    if (this.relay) {
      this.relay.port.onmessage = null;
      this.relay.disconnect();
      this.relay = null;
    }
    this.audio?.close().catch(() => {});
    this.audio = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.videoStream = null;
    this.paused = false;
    if (this.preview) this.preview.srcObject = null;
    this.lock?.release?.().catch(() => {});
    this.lock = null;
    this.context = null;
  }
}

/** Teilen über das Menü des Handys, sonst herunterladen. */
export async function shareClip(clip, blob) {
  const name = clipFileName(new Date(clip.date), clip.swingType, blob.type || clip.mimeType);
  if (typeof File !== "undefined" && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type || "video/webm" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function choice(name, values, names, selected, { wrap = false } = {}) {
  return html`<div class="choice${wrap ? " wrap" : ""}" role="group" aria-label="${name}">
    ${values.map((value) => html`<button type="button" data-setting="${name}" data-value="${value}" aria-pressed="${String(value === selected)}">${names[value]}</button>`)}
  </div>`;
}

function clipRow(clip) {
  const date = new Date(clip.date);
  return html`<li class="clip">
    <div class="row-main">
      <span class="row-title">${SWING_TYPE_SHORT[clip.swingType] ?? "Voll"} · ${clock(date)} Uhr</span>
      <span class="row-sub">${oneDecimal.format(clip.duration)} s · Treffmoment bei ${oneDecimal.format(clip.impactOffset)} s · ${TRIGGER_NAMES[clip.trigger] ?? "Knopf"}</span>
    </div>
    <div class="buttons compact">
      <button type="button" class="button outline" data-action="open" data-id="${clip.id}">Ansehen</button>
      <button type="button" class="button outline" data-action="share" data-id="${clip.id}">Teilen</button>
      <button type="button" class="button outline" data-action="delete" data-id="${clip.id}">Löschen</button>
    </div>
  </li>`;
}

export function clipsMarkup(clips) {
  if (clips.length === 0) return empty("Noch kein Clip. Starte die Kamera und schlag ein paar Bälle.");
  return html`<ul class="rows clips">${clips.map(clipRow)}</ul>`;
}

/** #/schwung/kamera: die Kamera mit automatischem Auslöser und ihre Clips. */
export function cameraPage(app) {
  const settings = loadSettings();
  const store = clipStore();
  let clips = [];
  return {
    title: "Kamera",
    tab: "schwung",
    parent: "#/schwung",
    keepOnChange: true,
    render() {
      return html`
        ${chapter(
          "",
          html`<div class="video-frame camera">
              <video autoplay muted playsinline data-preview></video>
              <p class="camera-status" data-status>Kamera aus. Tippe auf „Kamera starten“.</p>
            </div>
            <p class="hint camera-motion" data-motion hidden></p>
            <div class="buttons">
              <button type="button" class="button flag" data-action="toggle">Kamera starten</button>
              <button type="button" class="button outline" data-action="save" disabled>Schwung speichern</button>
            </div>
            <p class="hint" data-message hidden></p>`,
          {
            footer:
              "Das Handy nimmt dauernd auf und behält nur die letzten Sekunden. Erkennt es einen Schwung, speichert es den Clip von einigen Sekunden davor bis 1,5 Sekunden danach, ohne Ton. Der Bildschirm bleibt an, solange die Kamera läuft. Nichts davon verlässt das Handy.",
          },
        )}
        ${chapter(
          "Auslöser",
          html`${choice("trigger", TRIGGERS, TRIGGER_NAMES, settings.trigger, { wrap: true })}
            <p class="kicker">Schlagart</p>
            ${choice("swingType", SWING_TYPES, SWING_TYPE_SHORT, settings.swingType)}
            <p class="kicker">Empfindlichkeit</p>
            ${choice("sensitivity", SENSITIVITIES, SENSITIVITY_NAMES, settings.sensitivity)}
            <p class="kicker">Kamera</p>
            ${choice("facing", FACINGS, FACING_NAMES, settings.facing)}`,
          {
            footer:
              "Geräusch + Bewegung ist der Standard auf der Range: Schläge vom Nachbarplatz klingen ähnlich, bewegen aber nichts im Bild. Nur Bewegung hilft bei Wind oder sehr weichen Chips, nimmt aber auch Probeschwünge. Chip und Pitch sind leiser und bewegen weniger, dafür sinken die Schwellen. Hohe Empfindlichkeit für weiten Abstand und leise Treffer, niedrige bei vielen lauten Nachbarn.",
          },
        )}
        ${chapter(
          "Bildschirm",
          html`<label class="field"><span>Code vom Bildschirm</span><input name="screenCode" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="14" placeholder="ABCD-EFGH-JKLM" value="${displayCode(settings.screenCode)}" data-key="screenCode"></label>
            <div class="buttons"><button type="button" class="button outline" data-action="connect">${settings.screenCode ? "Trennen" : "Verbinden"}</button></div>
            <p class="note" data-screen-state>${settings.screenCode ? LINK_TEXT.idle : "Kein Bildschirm eingerichtet."}</p>
            <p class="kicker">Live-Bild</p>
            ${choice("liveVideo", ["true", "false"], { true: "Live-Bild an", false: "Nur Clips" }, String(settings.liveVideo !== false))}`,
          {
            footer:
              "Ein Tablet oder iPad zeigt jeden Schwung sofort in Zeitlupe: Dort die Web-App öffnen, Schwung → „Dieses Gerät als Bildschirm“, und den Code hier eintippen. Beide Geräte im selben WLAN oder am Hotspot des Handys. Den Weg zueinander vermittelt der Server des Kontos, Bild und Clips gehen direkt von Gerät zu Gerät. Vom Bildschirm aus lassen sich Schwünge speichern und die Aufnahme pausieren.",
          },
        )}
        ${chapter("Clips", html`<div data-clips>${clipsMarkup(clips)}</div>`, {
          footer:
            "Die Clips liegen im Speicher dieses Browsers, bis du sie löschst, höchstens 50; beim nächsten geht der älteste. Teilen schickt die Datei z. B. per WhatsApp, sonst landet sie in den Downloads. „Meine Daten löschen“ unter Mehr nimmt die Clips mit.",
        })}
        <p class="note">Aufstellen wie in der App: Handy hochkant auf dem Stativ, 2 bis 3,5 m Abstand, Hüfthöhe, beim Chippen näher. Mehr unter Schwung → „So stellst du die Kamera auf“.</p>
      `;
    },
    mount(root) {
      const preview = root.querySelector("[data-preview]");
      const statusLine = root.querySelector("[data-status]");
      const motionLine = root.querySelector("[data-motion]");
      const message = root.querySelector("[data-message]");
      const toggle = root.querySelector("[data-action='toggle']");
      const save = root.querySelector("[data-action='save']");
      const list = root.querySelector("[data-clips]");
      const setStatus = (text) => {
        statusLine.textContent = text;
      };
      const showMotion = (motion) => {
        motionLine.hidden = !motion;
        motionLine.textContent = motion ? `Bewegung zuletzt ${percent(motion.recent)} · Ruhe ${percent(motion.baseline)} · nötig ${percent(motion.required)}` : "";
      };
      const setMessage = (text) => {
        message.textContent = text ?? "";
        message.hidden = !text;
      };
      const renderClips = () => {
        list.innerHTML = String(clipsMarkup(clips));
      };
      store
        .list()
        .then((items) => {
          clips = items;
          renderClips();
          if (!store.persistent) setMessage("Dieser Browser speichert keine Clips dauerhaft: Sie bleiben, bis du die Seite neu lädst. Teile oder lade herunter, was du behalten willst.");
        })
        .catch(() => {});

      const screenState = root.querySelector("[data-screen-state]");
      const codeInput = root.querySelector("input[name='screenCode']");
      const connectButton = root.querySelector("[data-action='connect']");
      let link = null;
      let session = null;
      const pushStatus = () => link?.sendStatus({ ...session.snapshot, clipCount: clips.length });
      const setLinkState = (state, detail) => {
        screenState.textContent = state === "error" && detail ? `${LINK_TEXT.error} ${detail}` : (LINK_TEXT[state] ?? LINK_TEXT.idle);
      };
      const stopLink = () => {
        link?.stop();
        link = null;
      };
      const startLink = () => {
        if (link || !isCode(settings.screenCode) || !session?.isRunning) return;
        link = new CameraLink({
          code: settings.screenCode,
          liveVideo: settings.liveVideo !== false,
          onState: setLinkState,
          onCommand: (command) => {
            if (command === "save") session.saveManually({ fromScreen: true });
            else if (command === "pause") session.pause();
            else if (command === "resume") session.resume();
            pushStatus();
          },
        });
        link.start(session.stream);
        // Der erste Stand wartet, bis die Verbindung steht.
        pushStatus();
      };
      session = new CameraSession({
        preview,
        settings: { ...settings },
        onStatus: (text) => {
          setStatus(text);
          pushStatus();
        },
        onMotion: showMotion,
        onClip: async ({ blob, start, end, impact, trigger }) => {
          const clip = {
            id: newID(),
            date: Date.now(),
            duration: Math.max(0, end - start),
            impactOffset: Math.min(Math.max(0, impact - start), Math.max(0, end - start)),
            swingType: settings.swingType,
            trigger,
            mimeType: blob.type,
            size: blob.size,
          };
          try {
            const removed = await store.add(clip, blob);
            clips = [clip, ...clips.filter((other) => !removed.includes(other.id))];
          } catch {
            clips = [clip, ...clips];
            setMessage("Der Clip ließ sich nicht im Browser speichern. Er bleibt, bis du die Seite neu lädst.");
          }
          renderClips();
          if (session.isRunning) session.flash(`Schwung gespeichert (${clips.length}).`);
          link?.sendClip(clip, blob);
        },
      });

      const start = async () => {
        toggle.disabled = true;
        setMessage(null);
        setStatus("Kamera startet …");
        try {
          await session.start();
          toggle.textContent = "Kamera stoppen";
          save.disabled = false;
          startLink();
        } catch (error) {
          session.stop();
          setStatus("Kamera aus.");
          showMotion(null);
          setMessage(describeCameraError(error));
        }
        toggle.disabled = false;
      };
      const stop = () => {
        stopLink();
        if (settings.screenCode) setLinkState("idle");
        session.stop();
        toggle.textContent = "Kamera starten";
        save.disabled = true;
        setStatus("Kamera aus.");
        showMotion(null);
      };

      root.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || button.disabled) return;
        if (button.dataset.setting) {
          const key = button.dataset.setting;
          settings[key] = key === "liveVideo" ? button.dataset.value === "true" : button.dataset.value;
          saveSettings(settings);
          for (const other of root.querySelectorAll(`[data-setting='${key}']`)) other.setAttribute("aria-pressed", String(other === button));
          if (key === "liveVideo") {
            if (link) {
              stopLink();
              startLink();
            }
            return;
          }
          const wasRunning = session.isRunning;
          if (session.apply({ ...settings }) && wasRunning) {
            stop();
            await start();
          }
          return;
        }
        if (button.dataset.action === "connect") {
          if (settings.screenCode) {
            stopLink();
            settings.screenCode = "";
            saveSettings(settings);
            connectButton.textContent = "Verbinden";
            screenState.textContent = "Getrennt. Der Code bleibt im Feld.";
            return;
          }
          if (!isCode(codeInput.value)) {
            screenState.textContent = "Der Code hat zwölf Zeichen, ohne 0, O, 1 und I.";
            return;
          }
          settings.screenCode = normalizeCode(codeInput.value);
          codeInput.value = displayCode(settings.screenCode);
          saveSettings(settings);
          connectButton.textContent = "Trennen";
          if (session.isRunning) startLink();
          else screenState.textContent = "Verbindet sich, sobald die Kamera läuft.";
          return;
        }
        const id = button.dataset.id;
        switch (button.dataset.action) {
          case "toggle":
            if (session.isRunning) stop();
            else await start();
            break;
          case "save":
            session.saveManually();
            break;
          case "open": {
            const clip = clips.find((item) => item.id === id);
            const blob = clip ? await store.blob(id) : null;
            if (!clip || !blob) {
              toast("Der Clip ist nicht mehr da.");
              break;
            }
            openClip({ blob, name: clipFileName(new Date(clip.date), clip.swingType, blob.type || clip.mimeType), impact: clip.impactOffset });
            app.navigate("#/schwung");
            break;
          }
          case "share": {
            const clip = clips.find((item) => item.id === id);
            const blob = clip ? await store.blob(id) : null;
            if (!clip || !blob) {
              toast("Der Clip ist nicht mehr da.");
              break;
            }
            await shareClip(clip, blob);
            break;
          }
          case "delete": {
            const choiceMade = await ask({ title: "Clip löschen?", message: "", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
            if (choiceMade !== "delete") break;
            await store.remove(id).catch(() => {});
            clips = clips.filter((item) => item.id !== id);
            renderClips();
            break;
          }
          default:
            break;
        }
      });

      const onVisibility = () => {
        if (document.hidden && session.isRunning) {
          stop();
          setMessage("Die Kamera ist aus, weil die Seite im Hintergrund war. Tippe auf „Kamera starten“.");
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        stopLink();
        session.stop();
      };
    },
  };
}
