// Automatische Aufnahme: der Treffmoment am Geräusch, die Bewegung im Bild und
// das Muster eines Schwungs, wie ImpactDetector, MotionTracker,
// SwingMotionDetector, ManualSwingSave und ClipWindow im Kern der App
// (GolfCore/Sources/GolfCore/Video/). Reine Logik ohne Kamera und Mikrofon:
// views/camera.js füttert sie mit Tonblöcken und verkleinerten Bildern.

export const SWING_TYPES = ["full", "pitch", "chip"];
export const SWING_TYPE_NAMES = { full: "Voller Schwung", pitch: "Pitch", chip: "Chip" };
export const SWING_TYPE_SHORT = { full: "Voll", pitch: "Pitch", chip: "Chip" };
/** Kurze Schläge sind leiser und bewegen weniger im Bild: Die Schwellen sinken mit der Schlagart. */
export const SWING_TYPE_THRESHOLDS = {
  full: { peakFactor: 1, ratioFactor: 1, motionFactor: 3, minimumMotion: 0.01 },
  pitch: { peakFactor: 0.5, ratioFactor: 0.8, motionFactor: 2.5, minimumMotion: 0.006 },
  chip: { peakFactor: 0.25, ratioFactor: 0.65, motionFactor: 2, minimumMotion: 0.004 },
};
export const SENSITIVITIES = ["low", "medium", "high"];
export const SENSITIVITY_NAMES = { low: "Niedrig", medium: "Mittel", high: "Hoch" };
/** Verhältnis zum Hintergrund und Mindest-Ausschlag (0 bis 1) je Empfindlichkeit. */
const SENSITIVITY = { low: { ratio: 12, minimumPeak: 0.25 }, medium: { ratio: 8, minimumPeak: 0.12 }, high: { ratio: 5, minimumPeak: 0.06 } };
export const TRIGGERS = ["soundAndMotion", "sound", "motion", "manual"];
export const TRIGGER_NAMES = { soundAndMotion: "Geräusch + Bewegung", sound: "Nur Geräusch", motion: "Nur Bewegung", manual: "Nur per Knopf" };
export const listensForSound = (trigger) => trigger === "soundAndMotion" || trigger === "sound";

const thresholds = (swingType) => SWING_TYPE_THRESHOLDS[swingType] ?? SWING_TYPE_THRESHOLDS.full;
const sensitivity = (name) => SENSITIVITY[name] ?? SENSITIVITY.medium;

/**
 * Erkennt den Treffmoment am Geräusch. Ein Golfschlag ist ein kurzer, lauter
 * Knall: Jedes Fenster von 5 ms wird mit dem gleitenden Hintergrundpegel
 * verglichen. Ist es deutlich lauter, ist es ein Treffer; danach ist der
 * Detektor für eine Sperrzeit taub, damit ein Schlag nicht doppelt zählt.
 */
export class ImpactDetector {
  constructor({ sensitivity: level = "medium", swingType = "full" } = {}) {
    this.sensitivity = level;
    this.swingType = swingType;
    this.windowDuration = 0.005;
    this.refractoryPeriod = 2;
    /** Zeitkonstante, mit der sich der Hintergrundpegel anpasst. */
    this.backgroundTimeConstant = 0.5;
    /** Einschwingzeit, bevor der erste Treffer gemeldet werden kann. */
    this.warmUp = 0.3;
    this.reset();
  }

  get minimumPeak() {
    return sensitivity(this.sensitivity).minimumPeak * thresholds(this.swingType).peakFactor;
  }

  get ratio() {
    return sensitivity(this.sensitivity).ratio * thresholds(this.swingType).ratioFactor;
  }

  reset() {
    this.background = 0;
    this.processedDuration = 0;
    this.lastImpact = -Infinity;
    this.carry = new Float32Array(0);
    this.carryStart = 0;
  }

  /**
   * Verarbeitet Mono-Samples von -1 bis 1, die zum Zeitpunkt `startTime`
   * (Sekunden) beginnen. Reste unter einer Fensterlänge bleiben für den
   * nächsten Aufruf. Gibt die Zeitpunkte erkannter Treffer zurück.
   */
  process(samples, startTime, sampleRate) {
    if (!(sampleRate > 0) || !samples || samples.length === 0) return [];
    const windowSize = Math.max(1, Math.trunc(sampleRate * this.windowDuration));
    // Passt der neue Block nicht lückenlos an den Rest, wird der Rest verworfen.
    const expectedStart = this.carryStart + this.carry.length / sampleRate;
    if (this.carry.length > 0 && Math.abs(expectedStart - startTime) > this.windowDuration) this.carry = new Float32Array(0);
    let buffer;
    let bufferStart;
    if (this.carry.length === 0) {
      buffer = samples;
      bufferStart = startTime;
    } else {
      buffer = new Float32Array(this.carry.length + samples.length);
      buffer.set(this.carry, 0);
      buffer.set(samples, this.carry.length);
      bufferStart = this.carryStart;
    }
    const alpha = Math.min(1, this.windowDuration / this.backgroundTimeConstant);
    const minimumPeak = this.minimumPeak;
    const ratio = this.ratio;
    const impacts = [];
    let index = 0;
    while (index + windowSize <= buffer.length) {
      let peak = 0;
      let peakIndex = index;
      let sumOfSquares = 0;
      for (let i = index; i < index + windowSize; i += 1) {
        const value = Math.abs(buffer[i]);
        sumOfSquares += value * value;
        if (value > peak) {
          peak = value;
          peakIndex = i;
        }
      }
      const rms = Math.sqrt(sumOfSquares / windowSize);
      const time = bufferStart + peakIndex / sampleRate;
      this.processedDuration += this.windowDuration;
      if (this.processedDuration > this.warmUp && peak >= minimumPeak && rms > Math.max(this.background, 0.0005) * ratio && time - this.lastImpact >= this.refractoryPeriod) {
        impacts.push(time);
        this.lastImpact = time;
      } else {
        this.background = this.background === 0 ? rms : this.background + alpha * (rms - this.background);
      }
      index += windowSize;
    }
    this.carry = Float32Array.from(typeof buffer.subarray === "function" ? buffer.subarray(index) : buffer.slice(index));
    this.carryStart = bufferStart + index / sampleRate;
    return impacts;
  }
}

/** Ein stark verkleinertes Graustufenbild, z. B. 32 × 18 Punkte, mit Werten von 0 bis 255. */
export class MotionGrid {
  constructor(width, height, values) {
    this.width = width;
    this.height = height;
    this.values = values;
  }

  /** Graustufen aus den RGBA-Bildpunkten eines Canvas (`ImageData.data`). */
  static fromRGBA(width, height, data) {
    const values = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < values.length; i += 1, p += 4) values[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    return new MotionGrid(width, height, values);
  }

  /** Anteil der Zellen, die für die Bewegung zählen: die stärksten 5 %. */
  static strongestShare = 0.05;

  /**
   * Helligkeitsänderung der am stärksten veränderten Zellen, normiert auf 0 bis 1.
   * Nicht der Durchschnitt über das ganze Bild: Ein Spieler füllt nur einen Teil
   * davon, ein Schwung bewegt Arme und Schläger durch wenige Zellen. Darum zählen
   * die stärksten 5 % der Zellen, mindestens vier, wie im Kern der App.
   */
  difference(other) {
    if (!other || this.width !== other.width || this.height !== other.height || this.values.length !== other.values.length || this.values.length === 0) return 0;
    const differences = new Array(this.values.length);
    for (let i = 0; i < this.values.length; i += 1) differences[i] = Math.abs(this.values[i] - other.values[i]);
    differences.sort((a, b) => b - a);
    const count = Math.min(differences.length, Math.max(4, Math.round(differences.length * MotionGrid.strongestShare)));
    let sum = 0;
    for (let i = 0; i < count; i += 1) sum += differences[i];
    return sum / count / 255;
  }
}

/**
 * Merkt sich die Bewegungsenergie der letzten Sekunden. Hört das Mikrofon
 * einen Knall, muss es kurz davor auch eine deutliche Bewegung im Bild
 * gegeben haben: Schläge vom Nachbarplatz klingen ähnlich, bewegen aber nichts.
 */
export class MotionTracker {
  constructor() {
    /** So viele Sekunden Verlauf bleiben. */
    this.window = 8;
    this.samples = [];
    this.lastGrid = null;
  }

  add(grid, time) {
    if (this.lastGrid) this.samples.push({ time, energy: grid.difference(this.lastGrid) });
    this.lastGrid = grid;
    const cutoff = time - this.window;
    const firstKept = this.samples.findIndex((sample) => sample.time >= cutoff);
    if (firstKept > 0) this.samples.splice(0, firstKept);
  }

  /** Stärkste Bewegung zwischen `from` und `to`, bei Gleichstand die frühere. */
  peak(from, to) {
    let best = null;
    for (const sample of this.samples) {
      if (sample.time >= from && sample.time <= to && (best === null || sample.energy > best.energy)) best = sample;
    }
    return best;
  }

  /** Ruhepegel: Median der Bewegungsenergie im Verlauf. */
  get baseline() {
    if (this.samples.length === 0) return 0;
    const energies = this.samples.map((sample) => sample.energy).sort((a, b) => a - b);
    return energies[Math.floor(energies.length / 2)];
  }

  /** Nötige Bewegung: das Vielfache des Ruhepegels, mindestens die Schwelle der Schlagart. */
  required({ factor = 3, minimumEnergy = 0.01 } = {}) {
    return Math.max(minimumEnergy, this.baseline * factor);
  }

  requiredFor(swingType) {
    const t = thresholds(swingType);
    return this.required({ factor: t.motionFactor, minimumEnergy: t.minimumMotion });
  }

  /**
   * Prüft einen Schlag: kurz vor oder im Treffmoment deutlich mehr Bewegung als in Ruhe.
   * Gibt zurück, was gemessen wurde und was nötig wäre, damit die Seite es anzeigen kann.
   * `peak` ist null, wenn es in dem Zeitraum keine Bewegungsdaten gibt.
   */
  swingCheck(time, { factor = 3, minimumEnergy = 0.01 } = {}) {
    const peak = this.peak(time - 0.6, time + 0.3);
    const required = this.required({ factor, minimumEnergy });
    return { confirmed: peak ? peak.energy >= required : false, peak: peak?.energy ?? null, required, baseline: this.baseline };
  }

  swingCheckFor(time, swingType) {
    const t = thresholds(swingType);
    return this.swingCheck(time, { factor: t.motionFactor, minimumEnergy: t.minimumMotion });
  }

  /** Bestätigt einen Schlag, wenn kurz vor oder im Treffmoment deutlich mehr Bewegung war als in Ruhe. */
  confirmsSwing(time, options) {
    return this.swingCheck(time, options).confirmed;
  }

  /** Wie oben, mit den Schwellen der Schlagart: Ein Chip bewegt weniger als ein Driver. */
  confirmsSwingFor(time, swingType) {
    return this.swingCheckFor(time, swingType).confirmed;
  }

  /** Fürs Speichern per Knopf: Zeitpunkt der stärksten Bewegung der letzten Sekunden. */
  strongestMotion(before, within) {
    return this.peak(before - within, before)?.time ?? null;
  }
}

/**
 * Erkennt einen Schwung nur an der Bewegung im Bild: Ruhe beim Ansprechen,
 * ein kurzer deutlicher Ausschlag, dann wieder Ruhe im Finish. Wer durchs Bild
 * läuft, war vorher nicht ruhig. Als Treffmoment gilt die stärkste Bewegung.
 */
export class SwingMotionDetector {
  constructor({ swingType = "full" } = {}) {
    this.swingType = swingType;
    /** So lange muss es vor dem Schwung ruhig sein (Ansprechen). */
    this.stillBefore = 0.5;
    /** So lange muss es danach ruhig sein, länger als die Pause am höchsten Punkt. */
    this.stillAfter = 0.4;
    /** Ein langsames Ausholen bleibt unter der Schwelle. So lange darf es dauern. */
    this.slowStart = 2;
    /** Dauer der Bewegung: kürzer ist Rauschen, länger ist Herumlaufen. */
    this.durationRange = [0.3, 3];
    this.refractoryPeriod = 2;
    /** Eine kurze Bewegung nach einer ruhigen Phase, z. B. ein Waggle, unterbricht die Ruhe nicht, wenn sie kürzer ist. */
    this.waggleTolerance = 1;
    this.reset();
  }

  reset() {
    this.state = { kind: "idle", quietSince: null, quietUntil: null };
    this.lastSwing = -Infinity;
  }

  /** Verarbeitet eine Bewegungsprobe `{ time, energy }` mit dem Ruhepegel. Gibt den Treffmoment zurück, wenn ein Schwung zu Ende ging. */
  add(sample, baseline) {
    const t = thresholds(this.swingType);
    const threshold = Math.max(t.minimumMotion, baseline * t.motionFactor);
    const { time, energy } = sample;
    // Ruhig heißt: nicht deutlich mehr Bewegung als sonst. Die Hälfte der Schwelle
    // läge beim Chip genau auf dem Ruhepegel, und Bildrauschen schwankt um ihn herum.
    const quietLimit = Math.min(threshold * 0.75, Math.max(t.minimumMotion * 0.5, baseline * 1.5));
    const isQuiet = energy < quietLimit;
    const isSwing = energy >= threshold;
    const state = this.state;
    switch (state.kind) {
      case "idle": {
        if (isSwing) {
          const quietEnd = state.quietUntil ?? time;
          if (state.quietSince != null && quietEnd - state.quietSince >= this.stillBefore && time - quietEnd <= this.slowStart) {
            this.state = { kind: "swinging", start: quietEnd, peakTime: time, peakEnergy: energy, quietSince: null, quietBefore: state.quietSince };
          } else {
            this.state = { kind: "ignoring", quietSince: null };
          }
        } else if (isQuiet) {
          if (state.quietSince != null && state.quietUntil != null) {
            // Wieder ruhig nach leichter Bewegung: Ein kurzes Waggle nach einer ruhigen
            // Phase unterbricht sie nicht, die Ruhe geht weiter.
            const wasStill = state.quietUntil - state.quietSince >= this.stillBefore;
            this.state = { kind: "idle", quietSince: wasStill && time - state.quietUntil <= this.waggleTolerance ? state.quietSince : time, quietUntil: null };
          } else if (state.quietSince == null) {
            // Neue ruhige Phase, wenn vorher Bewegung war.
            this.state = { kind: "idle", quietSince: time, quietUntil: null };
          }
        } else if (state.quietSince != null && state.quietUntil == null) {
          // Leichte Bewegung, z. B. das Ausholen: Die Ruhe ist hier zu Ende.
          this.state = { kind: "idle", quietSince: state.quietSince, quietUntil: time };
        }
        return null;
      }
      case "swinging": {
        let { peakTime, peakEnergy } = state;
        const { start, quietBefore } = state;
        if (energy > peakEnergy) {
          peakTime = time;
          peakEnergy = energy;
        }
        if (!isQuiet) {
          // Die Pause am höchsten Punkt ist vorbei, der Schwung geht weiter. Zu lange Bewegung ist kein Schwung.
          if (time - start > this.durationRange[1] + this.stillAfter) this.state = { kind: "ignoring", quietSince: null };
          else this.state = { kind: "swinging", start, peakTime, peakEnergy, quietSince: null, quietBefore };
          return null;
        }
        const since = state.quietSince ?? time;
        if (time - since < this.stillAfter) {
          this.state = { kind: "swinging", start, peakTime, peakEnergy, quietSince: since, quietBefore };
          return null;
        }
        const duration = since - start;
        if (duration < this.durationRange[0]) {
          // Zu kurz für einen Schwung, z. B. ein Waggle: Die Ruhe davor gilt weiter, der Schwung kann gleich kommen.
          this.state = { kind: "idle", quietSince: quietBefore, quietUntil: null };
          return null;
        }
        this.state = { kind: "idle", quietSince: since, quietUntil: null };
        if (duration > this.durationRange[1] || peakTime - this.lastSwing < this.refractoryPeriod) return null;
        this.lastSwing = peakTime;
        return peakTime;
      }
      case "ignoring": {
        if (isQuiet) {
          const since = state.quietSince ?? time;
          this.state = time - since >= this.stillBefore ? { kind: "idle", quietSince: since, quietUntil: null } : { kind: "ignoring", quietSince: since };
        } else {
          this.state = { kind: "ignoring", quietSince: null };
        }
        return null;
      }
      default:
        return null;
    }
  }
}

/** Fürs Speichern per Knopf: So weit zurück zählen erkannte Schwünge, so lange wackelt das Bild beim Tippen, so nah ist es derselbe Schwung. */
export const MANUAL_SAVE = { lookback: 10, tapShake: 1, sameSwing: 1.5 };

/**
 * Treffmoment für „Schwung speichern“: am liebsten der letzte erkannte Schwung,
 * der noch nicht gespeichert ist, sonst die stärkste Bewegung seit dem zuletzt
 * gespeicherten Clip. Beim Tippen am Gerät mit der Kamera zählt die letzte
 * Sekunde davor nicht: Das Bild wackelt, und davor kommt man auf die Kamera zu.
 */
export function manualImpact({ now, detectedSwings, savedImpacts, motion, tappedOnCamera }) {
  const latest = tappedOnCamera ? now - MANUAL_SAVE.tapShake : now;
  const isSaved = (time) => savedImpacts.some((saved) => Math.abs(saved - time) < MANUAL_SAVE.sameSwing);
  const swings = detectedSwings.filter((swing) => swing <= latest && swing >= now - MANUAL_SAVE.lookback && !isSaved(swing));
  if (swings.length > 0) return Math.max(...swings);
  const saved = savedImpacts.filter((time) => time <= latest);
  const lastSaved = saved.length > 0 ? Math.max(...saved) : -Infinity;
  const lower = Math.max(now - motion.window, lastSaved + MANUAL_SAVE.sameSwing);
  if (lower < latest) {
    const peak = motion.peak(lower, latest);
    if (peak) return peak.time;
  }
  return latest;
}

/** Bereich von `preRoll` vor bis `postRoll` nach dem Treffmoment, begrenzt auf die Aufnahme `[von, bis]`. */
export function clipWindow(impact, preRoll, postRoll, available) {
  const lower = Math.max(available[0], impact - preRoll);
  const upper = Math.min(available[1], impact + postRoll);
  return lower < upper ? [lower, upper] : null;
}

/**
 * Rollende Aufnahme im Browser: Zwei Aufnahmen laufen versetzt, jede ein paar
 * Sekunden, damit zu jedem Treffmoment eine Aufnahme mit Vorlauf existiert.
 * Wählt die laufende Aufnahme mit dem meisten Vorlauf vor dem Treffmoment.
 */
export function segmentFor(segments, impact) {
  let best = null;
  for (const segment of segments) {
    if (segment.capturing || segment.start > impact) continue;
    if (best === null || segment.start < best.start) best = segment;
  }
  return best;
}

/** Dateiname eines Clips, z. B. „Schwung 2026-10-15 14-03-21 Chip.webm“. */
export function clipFileName(date, swingType, mimeType) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const extension = /mp4/i.test(mimeType ?? "") ? "mp4" : "webm";
  return `Schwung ${stamp} ${SWING_TYPE_SHORT[swingType] ?? "Voll"}.${extension}`;
}
