// Tempo-Trainer wie in der App (GolfCore/.../Video/TempoTrainer.swift): Takte
// in Videobildern bei 30 Bildern pro Sekunde nach John Novosel, z. B. 21/7.

export const FRAMES_PER_SECOND = 30;

export const STYLES = {
  fullSwing: {
    name: "Voller Schwung 3 : 1",
    presets: [
      [18, 6],
      [21, 7],
      [24, 8],
      [27, 9],
    ],
    standard: [21, 7],
  },
  shortGame: {
    name: "Kurzspiel und Putten 2 : 1",
    presets: [
      [14, 7],
      [16, 8],
      [18, 9],
      [20, 10],
    ],
    standard: [16, 8],
  },
};

export const PAUSE_OPTIONS = [3, 5, 8];
export const IMPACT_HOLD = 0.4;

export function preset(backswingFrames, downswingFrames) {
  const backswing = backswingFrames / FRAMES_PER_SECOND;
  const downswing = downswingFrames / FRAMES_PER_SECOND;
  return {
    id: `${backswingFrames}/${downswingFrames}`,
    backswing,
    downswing,
    swingDuration: backswing + downswing,
    ratio: backswingFrames / Math.max(downswingFrames, 1),
  };
}

export function cycleDuration(tempo, pause) {
  return Math.max(0, pause) + tempo.swingDuration;
}

/** Die drei Töne eines Durchgangs: ausholen, oben, treffen. */
export function beats(tempo, pause) {
  const start = Math.max(0, pause);
  return [
    { time: start, tone: "takeaway" },
    { time: start + tempo.backswing, tone: "top" },
    { time: start + tempo.swingDuration, tone: "impact" },
  ];
}

/** Phase `elapsed` Sekunden nach dem Start: address (mit Restzeit), backswing, downswing, impact. */
export function phase(elapsed, tempo, pause) {
  const cycle = cycleDuration(tempo, pause);
  if (!(cycle > 0)) return { kind: "address", remaining: 0 };
  const time = Math.max(0, elapsed) % cycle;
  const start = Math.max(0, pause);
  if (elapsed >= cycle && time < Math.min(IMPACT_HOLD, start)) return { kind: "impact" };
  if (time < start) return { kind: "address", remaining: start - time };
  if (time < start + tempo.backswing) return { kind: "backswing" };
  return { kind: "downswing" };
}
