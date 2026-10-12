// Tab „Schwung“: Video in Zeitlupe, Bild für Bild, mit Linien zum Messen, und
// der Tempo-Trainer. Videos bleiben auf dem Handy: Die Seite öffnet die Datei
// nur im Browser, lädt nichts hoch und speichert nichts.
import { STYLES, PAUSE_OPTIONS, beats, cycleDuration, phase as tempoPhase, preset as tempoPreset } from "../core/tempo.js";
import { chapter, html, toast } from "../ui.js";
import { mountCompare } from "./compare.js";

/** Das geöffnete Video. Bleibt beim Wechsel zum Tempo-Trainer und zurück. */
let current = null;

const RATES = [
  [1, "1×"],
  [0.5, "½"],
  [0.25, "¼"],
  [0.125, "⅛"],
];

const secondsFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TIPS = [
  "Von vorne: Kamera auf Hüft- bis Bauchnabelhöhe, auf einer Linie, die rechtwinklig zur Ziellinie durch die Mitte deines Stands läuft.",
  "Von hinten: Kamera auf Höhe deiner Hände beim Ansprechen, parallel zur Ziellinie, auf der Linie deiner hinteren Fußspitze, nicht direkt hinter dem Ball.",
  "2 bis 3,5 m Abstand, Handy hochkant. Über dem Kopf und unter dem Ball etwas Platz lassen.",
  "Stativhöhe und Position markieren. Nur gleich aufgenommene Videos lassen sich ehrlich vergleichen.",
  "Zeitlupe: In der Kamera-App deines Handys gibt es dafür einen eigenen Modus. Je mehr Bilder pro Sekunde, desto mehr Licht braucht es.",
];

/** Tipp mit kurzem Stichwort bis zum Doppelpunkt, wie in der App. */
function tip(text) {
  const colon = text.indexOf(":");
  if (colon > 0 && colon < 32) return html`<p class="tip"><strong>${text.slice(0, colon + 1)}</strong>${text.slice(colon + 1)}</p>`;
  return html`<p class="tip">${text}</p>`;
}

export function swingPage(app) {
  let stopPlayer = null;
  let stopCompare = null;
  return {
    title: "Schwung",
    tab: "schwung",
    parent: null,
    keepOnChange: true,
    render() {
      return html`
        ${chapter(
          "Zeitlupe",
          html`<div class="buttons">
              <label class="button flag">Video aufnehmen<input class="visually-hidden" type="file" accept="video/*" capture="environment" data-file></label>
              <label class="button outline">Video wählen<input class="visually-hidden" type="file" accept="video/*" data-file></label>
            </div>
            <div data-player></div>`,
          {
            footer:
              "Das Video bleibt auf deinem Handy. Die Seite öffnet es nur hier im Browser, lädt es nicht hoch und speichert es nicht. In deiner Galerie bleibt es, wie es ist.",
          },
        )}
        ${chapter("Zwei Videos vergleichen", html`<div data-compare></div>`, {
          footer:
            "Beide Videos laufen im selben Abstand zum Treffmoment und starten 1,5 Sekunden davor, oder später, wenn eines nicht so weit zurückreicht. Ohne gesetzten Treffmoment gilt 1,5 Sekunden nach dem Anfang. Mit „Spiegeln“ vergleichst du Links- und Rechtshänder.",
        })}
        ${chapter("Tempo", html`<a class="action" href="#/schwung/tempo">Tempo-Trainer<span class="mark">›</span></a>`, {
          footer: "Drei Töne geben den Takt vor: ausholen, oben umkehren, treffen. Volle Schwünge 3 : 1, Kurzspiel und Putten 2 : 1.",
        })}
        ${chapter(
          "Launch Monitor",
          html`<ul class="rows">
            <li><a class="row" href="#/schwung/launch"><span class="row-main row-title">Garmin-Daten</span><span class="row-value">${app.store.data.launchSessions.length} ${app.store.data.launchSessions.length === 1 ? "Session" : "Sessions"}</span></a></li>
            ${app.store.data.launchSessions.length > 0 ? html`<li><a class="row" href="#/schwung/launch/tabelle"><span class="row-main row-title">Distanztabelle</span></a></li>` : ""}
          </ul>`,
          { footer: "Der CSV-Export der Garmin-Golf-App (Approach R10 und R50): Schläge, Distanztabelle pro Schläger und Verlauf über die Sessions." },
        )}
        ${chapter("So stellst du die Kamera auf", TIPS.map(tip))}
        <p class="note">Aufnahme mit automatischem Auslöser, ein zweites Gerät als Bildschirm, den Treffmoment aus dem Ton und die Schwunganalyse gibt es nur in der App für iPhone und iPad.</p>
      `;
    },
    mount(root) {
      const area = root.querySelector("[data-player]");
      const show = () => {
        stopPlayer?.();
        stopPlayer = null;
        area.innerHTML = current ? String(playerMarkup()) : "";
        if (current) stopPlayer = mountPlayer(area);
      };
      for (const input of root.querySelectorAll("[data-file]")) {
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          input.value = "";
          if (!file) return;
          if (current) URL.revokeObjectURL(current.url);
          current = { url: URL.createObjectURL(file), name: file.name, time: 0, rate: 0.25, lines: [] };
          show();
          area.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      area.addEventListener("click", (event) => {
        if (event.target.closest("[data-action='close']")) {
          stopPlayer?.();
          stopPlayer = null;
          URL.revokeObjectURL(current.url);
          current = null;
          show();
        }
      });
      show();
      stopCompare = mountCompare(root.querySelector("[data-compare]"));
      return () => {
        stopPlayer?.();
        stopCompare?.();
      };
    },
  };
}

function playerMarkup() {
  return html`<div class="player"><div class="video-frame">
      <video playsinline muted loop preload="auto" data-video></video>
      <canvas data-canvas aria-hidden="true"></canvas>
    </div>
    <input type="range" min="0" max="0" step="0.001" value="0" data-scrub aria-label="Stelle im Video">
    <p class="video-time"><span data-time>0,00 s</span><span data-length></span></p>
    <div class="transport">
      <button type="button" class="button outline" data-action="start">Anfang</button>
      <button type="button" class="button outline" data-action="previous" aria-label="Ein Bild zurück">‹ Bild</button>
      <button type="button" class="button" data-action="play">Abspielen</button>
      <button type="button" class="button outline" data-action="next" aria-label="Ein Bild vor">Bild ›</button>
    </div>
    <div class="choice" role="group" aria-label="Geschwindigkeit">
      ${RATES.map(([rate, label]) => html`<button type="button" data-rate="${rate}" aria-pressed="${String(rate === current.rate)}">${label}</button>`)}
    </div>
    <div class="buttons">
      <button type="button" class="button outline" data-action="draw" aria-pressed="false">Linie zeichnen</button>
      <button type="button" class="button outline" data-action="clear">Linien löschen</button>
      <button type="button" class="button outline" data-action="close">Video schließen</button>
    </div>
    <p class="note" data-draw-hint hidden>Zieh mit dem Finger eine Linie über das Video, z. B. entlang des Schafts oder des Rückens. Die Zahl ist der Winkel zur Waagerechten.</p></div>`;
}

/** Wiedergabe, Bild für Bild und Linien. Gibt eine Funktion zum Aufräumen zurück. */
function mountPlayer(container) {
  // Knöpfe hängen am Player selbst: Mit einem neuen Video verschwinden sie mit ihm.
  const area = container.querySelector(".player");
  const video = area.querySelector("[data-video]");
  const canvas = area.querySelector("[data-canvas]");
  const scrub = area.querySelector("[data-scrub]");
  const timeLabel = area.querySelector("[data-time]");
  const lengthLabel = area.querySelector("[data-length]");
  const playButton = area.querySelector("[data-action='play']");
  const drawButton = area.querySelector("[data-action='draw']");
  const drawHint = area.querySelector("[data-draw-hint]");
  const context = canvas.getContext("2d");
  /** Dauer eines Bilds. Geschätzt aus den gezeigten Bildern, bis dahin 30 pro Sekunde. */
  let frame = 1 / 30;
  let lastMediaTime = null;
  let frameHandle = null;
  let drawing = false;
  let draft = null;
  let scrubbing = false;

  video.src = current.url;
  video.playbackRate = current.rate;
  video.defaultPlaybackRate = current.rate;

  const showTime = () => {
    timeLabel.textContent = `${secondsFormat.format(video.currentTime)} s`;
    if (!scrubbing) scrub.value = String(video.currentTime);
    current.time = video.currentTime;
  };

  video.addEventListener("loadedmetadata", () => {
    scrub.max = String(video.duration || 0);
    lengthLabel.textContent = Number.isFinite(video.duration) ? ` von ${secondsFormat.format(video.duration)} s` : "";
    if (current.time > 0 && current.time < video.duration) video.currentTime = current.time;
    resize();
  });
  video.addEventListener("error", () => toast("Dieses Video kann der Browser nicht abspielen. Versuch es mit einer anderen Aufnahme."));
  video.addEventListener("timeupdate", showTime);
  video.addEventListener("seeked", showTime);
  video.addEventListener("play", () => {
    playButton.textContent = "Pause";
  });
  video.addEventListener("pause", () => {
    playButton.textContent = "Abspielen";
  });
  video.addEventListener("click", () => {
    if (!drawing) togglePlay();
  });

  // Jedes neu gezeigte Bild: Anzeige nachführen und die Bilddauer lernen.
  // Der Median der letzten Abstände, nicht das Minimum: Bei 25 Bildern pro
  // Sekunde blieb der Schritt sonst bei 1/30 s und „Bild ›“ zeigte Bilder doppelt.
  const deltas = [];
  const onFrame = (_, metadata) => {
    if (lastMediaTime != null) {
      const delta = metadata.mediaTime - lastMediaTime;
      if (delta > 1 / 300 && delta < 0.2) {
        deltas.push(delta);
        if (deltas.length > 30) deltas.shift();
        const sorted = [...deltas].sort((a, b) => a - b);
        frame = sorted[Math.floor(sorted.length / 2)];
      }
    }
    lastMediaTime = metadata.mediaTime;
    showTime();
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };
  if ("requestVideoFrameCallback" in video) frameHandle = video.requestVideoFrameCallback(onFrame);

  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function step(direction) {
    video.pause();
    lastMediaTime = null;
    const target = video.currentTime + direction * frame;
    video.currentTime = Math.min(Math.max(target, 0), video.duration || 0);
  }

  scrub.addEventListener("input", () => {
    scrubbing = true;
    video.pause();
    video.currentTime = Number(scrub.value);
  });
  scrub.addEventListener("change", () => {
    scrubbing = false;
  });

  // MARK: Linien

  /** Bereich, in dem das Bild zu sehen ist: Das Video füllt den Rahmen nicht immer ganz. */
  function contentRect() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const videoWidth = video.videoWidth || width;
    const videoHeight = video.videoHeight || height;
    const scale = Math.min(width / videoWidth, height / videoHeight) || 1;
    const contentWidth = videoWidth * scale;
    const contentHeight = videoHeight * scale;
    return { x: (width - contentWidth) / 2, y: (height - contentHeight) / 2, width: contentWidth, height: contentHeight };
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint();
  }

  function toPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    const rect = contentRect();
    return {
      x: (event.clientX - bounds.left - rect.x) / rect.width,
      y: (event.clientY - bounds.top - rect.y) / rect.height,
    };
  }

  function paint() {
    const rect = contentRect();
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const flag = getComputedStyle(document.documentElement).getPropertyValue("--flag").trim() || "#d1381f";
    for (const line of draft ? [...current.lines, draft] : current.lines) {
      const x1 = rect.x + line.x1 * rect.width;
      const y1 = rect.y + line.y1 * rect.height;
      const x2 = rect.x + line.x2 * rect.width;
      const y2 = rect.y + line.y2 * rect.height;
      context.strokeStyle = flag;
      context.fillStyle = flag;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        context.beginPath();
        context.arc(x, y, 5, 0, Math.PI * 2);
        context.fill();
      }
      // Winkel zur Waagerechten, 0 bis 90 Grad, in Bildpunkten gemessen.
      let angle = Math.abs((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
      if (angle > 90) angle = 180 - angle;
      const label = `${Math.round(angle)}°`;
      context.font = "600 15px system-ui, sans-serif";
      const labelX = Math.min(Math.max(x2 + 10, 4), canvas.clientWidth - 44);
      const labelY = Math.min(Math.max(y2 - 10, 18), canvas.clientHeight - 6);
      context.fillStyle = "rgba(0, 0, 0, 0.65)";
      context.fillRect(labelX - 4, labelY - 15, context.measureText(label).width + 8, 20);
      context.fillStyle = "#ffffff";
      context.fillText(label, labelX, labelY);
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!drawing) return;
    canvas.setPointerCapture(event.pointerId);
    const point = toPoint(event);
    draft = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    paint();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!draft) return;
    const point = toPoint(event);
    draft.x2 = point.x;
    draft.y2 = point.y;
    paint();
  });
  const finish = () => {
    if (!draft) return;
    const rect = contentRect();
    const length = Math.hypot((draft.x2 - draft.x1) * rect.width, (draft.y2 - draft.y1) * rect.height);
    if (length > 12) current.lines.push(draft);
    draft = null;
    paint();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", () => {
    draft = null;
    paint();
  });

  const setDrawing = (value) => {
    drawing = value;
    canvas.classList.toggle("drawing", drawing);
    drawButton.setAttribute("aria-pressed", String(drawing));
    drawHint.hidden = !drawing;
    if (drawing) video.pause();
  };

  area.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.rate) {
      current.rate = Number(button.dataset.rate);
      video.playbackRate = current.rate;
      video.defaultPlaybackRate = current.rate;
      for (const other of area.querySelectorAll("[data-rate]")) other.setAttribute("aria-pressed", String(other === button));
      return;
    }
    switch (button.dataset.action) {
      case "play":
        togglePlay();
        break;
      case "start":
        video.pause();
        video.currentTime = 0;
        break;
      case "previous":
        step(-1);
        break;
      case "next":
        step(1);
        break;
      case "draw":
        setDrawing(!drawing);
        break;
      case "clear":
        current.lines = [];
        paint();
        break;
      default:
        break;
    }
  });

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);

  return () => {
    observer?.disconnect();
    if (frameHandle != null && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(frameHandle);
    if (current) current.time = video.currentTime;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}

// MARK: - Tempo-Trainer

/**
 * Spielt die drei Töne in Schleife, wie TempoPlayer in der App: erst eine
 * stille Pause zum Ansprechen, dann ausholen, oben, treffen. Die Töne plant
 * der Browser ein paar Hundertstel im Voraus auf der Uhr der Tonausgabe, so
 * bleiben die Abstände genau.
 */
class TempoPlayer {
  constructor() {
    this.context = null;
    this.timer = null;
    this.startTime = null;
    this.wakeLock = null;
  }

  get isPlaying() {
    return this.startTime != null;
  }

  /** Sekunden seit dem Start, auf der Uhr der Tonausgabe. */
  get elapsed() {
    return this.context && this.startTime != null ? this.context.currentTime - this.startTime : 0;
  }

  async start(tempo, pause) {
    this.stop();
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Dieser Browser kann keine Töne erzeugen.");
    this.context = new AudioContextClass();
    await this.context.resume();
    this.tempo = tempo;
    this.pause = pause;
    this.cycle = 0;
    this.startTime = this.context.currentTime + 0.1;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 50);
    // Solange der Takt läuft, bleibt der Bildschirm an.
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      this.wakeLock = null;
    }
  }

  schedule() {
    if (!this.context) return;
    const horizon = this.context.currentTime + 0.3;
    const length = cycleDuration(this.tempo, this.pause);
    while (this.startTime + Math.max(0, this.pause) + this.cycle * length <= horizon) {
      for (const beat of beats(this.tempo, this.pause)) {
        this.tone(this.startTime + beat.time + this.cycle * length, beat.tone === "impact" ? 1480 : 988);
      }
      this.cycle += 1;
    }
  }

  /** Kurzer Sinuston, eingeblendet und abklingend, damit es nicht knackt. Der Treffmoment ist höher. */
  tone(time, frequency) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.8, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.07, time + 0.07);
    gain.gain.linearRampToValueAtTime(0, time + 0.08);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.09);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.startTime = null;
    this.context?.close().catch(() => {});
    this.context = null;
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}

const TONES = ["takeaway", "top", "impact"];

export function tempoPage() {
  const player = new TempoPlayer();
  let style = "fullSwing";
  let frames = STYLES.fullSwing.standard;
  let pause = 5;
  let error = null;
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const tempo = () => tempoPreset(frames[0], frames[1]);
  const seconds = (value) => `${secondsFormat.format(value)} s`;

  function title(phase) {
    if (!phase) return `Takt ${tempo().id}`;
    switch (phase.kind) {
      case "address":
        return `Ansprechen ${Math.ceil(phase.remaining)}`;
      case "backswing":
        return "Rückschwung";
      case "downswing":
        return "Abschwung";
      default:
        return "Treffen";
    }
  }

  function isLit(tone, phase) {
    if (!phase) return false;
    switch (phase.kind) {
      case "backswing":
        return tone === "takeaway";
      case "downswing":
        return tone !== "impact";
      case "impact":
        return true;
      default:
        return false;
    }
  }

  function display() {
    const phase = player.isPlaying ? tempoPhase(player.elapsed, tempo(), pause) : null;
    return html`<p class="tempo-title${phase?.kind === "impact" ? " flag" : ""}">${title(phase)}</p>
      <div class="tempo-bars">${TONES.map((tone) => html`<span class="${isLit(tone, phase) ? (tone === "impact" ? "on flag" : "on") : ""}"></span>`)}</div>
      <p class="kicker">${player.isPlaying ? `${tempo().id} · ${style === "fullSwing" ? "3 : 1" : "2 : 1"} · Pause ${pause} s` : "Bereit"}</p>`;
  }

  function choice(label, options, selected, attribute) {
    return html`<div class="choice-block"><p class="kicker">${label}</p><div class="choice" role="group" aria-label="${label}">
      ${options.map(([value, text]) => html`<button type="button" ${attribute}="${value}" aria-pressed="${String(value === selected)}">${text}</button>`)}
    </div></div>`;
  }

  return {
    title: "Tempo-Trainer",
    tab: "schwung",
    parent: "#/schwung",
    keepOnChange: true,
    render() {
      const selected = tempo();
      return html`
        <div class="tempo-display" data-display role="status" aria-label="${player.isPlaying ? `Tempo-Trainer läuft, ${selected.id}` : "Tempo-Trainer bereit"}">${display()}</div>
        <button type="button" class="button wide tall" data-toggle>${player.isPlaying ? "Stopp" : "Start"}</button>
        ${error ? html`<p class="note flag">${error}</p>` : ""}
        ${chapter(
          "Einstellung",
          html`${choice("Art", [["fullSwing", "Voller Schwung"], ["shortGame", "Kurzspiel"]], style, "data-style")}
            ${choice("Takt", STYLES[style].presets.map((value) => [`${value[0]}/${value[1]}`, `${value[0]}/${value[1]}`]), selected.id, "data-preset")}
            ${choice("Pause", PAUSE_OPTIONS.map((value) => [String(value), `${value} s`]), String(pause), "data-pause")}`,
          {
            footer: `${STYLES[style].name}. Der Takt zählt Videobilder bei 30 pro Sekunde: ${selected.id} heißt ${seconds(selected.backswing)} Rückschwung und ${seconds(selected.downswing)} Abschwung. Wähle den Takt, der sich mit vollem Schwung natürlich anfühlt, dann bleib dabei.`,
          },
        )}
        ${chapter(
          "So geht es",
          html`<p class="tip">Ton 1: ausholen. Ton 2: oben, der Abschwung beginnt. Ton 3, etwas höher: Treffmoment.</p>
            <p class="tip">Erst ein paar Schwünge ohne Ball, dann mit Ball. Reagiere auf die Töne, statt sie vorauszuahnen.</p>
            <p class="tip">Stell die Medienlautstärke laut genug. Solange der Takt läuft, bleibt der Bildschirm an. Am besten mit einem Ohrhörer, dann hört niemand sonst mit.</p>`,
        )}
      `;
    },
    mount(root) {
      let frameRequest = null;
      let interval = null;
      const redraw = () => {
        root.innerHTML = String(this.render());
      };
      const tick = () => {
        const element = root.querySelector("[data-display]");
        if (element) element.innerHTML = String(display());
        if (!player.isPlaying) return;
        if (!reduceMotion) frameRequest = requestAnimationFrame(tick);
      };
      const startTicking = () => {
        cancelAnimationFrame(frameRequest);
        clearInterval(interval);
        if (reduceMotion) interval = setInterval(tick, 250);
        tick();
      };
      const start = async () => {
        error = null;
        try {
          await player.start(tempo(), pause);
        } catch (failure) {
          error = `Der Ton ließ sich nicht starten: ${failure.message}`;
        }
        redraw();
        startTicking();
      };
      const stop = () => {
        player.stop();
        cancelAnimationFrame(frameRequest);
        clearInterval(interval);
        redraw();
      };
      root.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.hasAttribute("data-toggle")) {
          if (player.isPlaying) stop();
          else start();
          return;
        }
        if (button.dataset.style) {
          style = button.dataset.style;
          frames = STYLES[style].standard;
        } else if (button.dataset.preset) {
          frames = button.dataset.preset.split("/").map(Number);
        } else if (button.dataset.pause) {
          pause = Number(button.dataset.pause);
        } else {
          return;
        }
        // Mit neuer Einstellung neu starten, damit Töne und Anzeige zusammenpassen.
        if (player.isPlaying) start();
        else redraw();
      });
      // Im Hintergrund hält der Browser die Seite an. Dann lieber neu starten, als dass der Takt verrutscht.
      const onVisibility = () => {
        if (document.visibilityState === "hidden" && player.isPlaying) stop();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        cancelAnimationFrame(frameRequest);
        clearInterval(interval);
        player.stop();
      };
    },
  };
}
