// Der Clip-Player der Web-App für Clips mit bekanntem Treffmoment, wie der
// Clip-Player der App: Zeitlupe, Bild für Bild, Sprung zum Treffmoment. Genutzt
// vom Bildschirm-Modus (views/screen.js); Stelle und Geschwindigkeit bleiben
// beim Wechsel zwischen Clips erhalten.
import { uid } from "../core/team.js";

export const RATES = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [0.5, "½"],
  [1, "1×"],
];
const seconds = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Stelle und Geschwindigkeit überleben das Neuzeichnen und den Wechsel zwischen Clips. */
export const playback = { clipID: null, time: 0, rate: 0.25 };

/** Video, Regler, Zeit, Transport und Geschwindigkeiten; `mountClipPlayer` verdrahtet sie. */
export function playerMarkup(html, { impact = false } = {}) {
  return html`<div class="player clip-player" data-clip-player>
    <div class="video-frame"><video playsinline muted loop preload="auto" data-video></video></div>
    <input type="range" min="0" max="0" step="0.001" value="0" data-scrub aria-label="Stelle im Video">
    <p class="video-time"><span data-time>0,00 s</span><span data-length></span></p>
    <div class="transport">
      <button type="button" class="button outline" data-action="start">Anfang</button>
      <button type="button" class="button outline" data-action="previous" aria-label="Ein Bild zurück">‹ Bild</button>
      <button type="button" class="button" data-action="play">Abspielen</button>
      <button type="button" class="button outline" data-action="next" aria-label="Ein Bild vor">Bild ›</button>
    </div>
    <div class="choice" role="group" aria-label="Geschwindigkeit">
      ${RATES.map(([value, label]) => html`<button type="button" data-rate="${value}" aria-pressed="${String(value === playback.rate)}">${label}</button>`)}
    </div>
    ${impact ? html`<div class="buttons"><button type="button" class="button outline" data-action="impact">Zum Treffmoment</button></div>` : ""}
  </div>`;
}

/** Wiedergabe in Zeitlupe und Bild für Bild, wie der Clip-Player der App. Gibt eine Funktion zum Aufräumen zurück. */
export function mountClipPlayer(area, url, clip) {
  const video = area.querySelector("[data-video]");
  const scrub = area.querySelector("[data-scrub]");
  const timeLabel = area.querySelector("[data-time]");
  const lengthLabel = area.querySelector("[data-length]");
  const playButton = area.querySelector("[data-action='play']");
  const sameClip = playback.clipID === uid(clip.id);
  playback.clipID = uid(clip.id);
  if (!sameClip) playback.time = 0;
  /** Dauer eines Bilds: aus dem Eintrag, dann aus den gezeigten Bildern gelernt. */
  let frame = 1 / (Number(clip.frameRate) > 0 ? Number(clip.frameRate) : 30);
  let lastMediaTime = null;
  let frameHandle = null;
  let scrubbing = false;
  const deltas = [];

  video.src = url;
  video.playbackRate = playback.rate;
  video.defaultPlaybackRate = playback.rate;

  const showTime = () => {
    timeLabel.textContent = `${seconds.format(video.currentTime)} s`;
    if (!scrubbing) scrub.value = String(video.currentTime);
    playback.time = video.currentTime;
  };
  video.addEventListener("loadedmetadata", () => {
    scrub.max = String(video.duration || 0);
    lengthLabel.textContent = Number.isFinite(video.duration) ? ` von ${seconds.format(video.duration)} s` : "";
    if (sameClip && playback.time > 0 && playback.time < video.duration) video.currentTime = playback.time;
    else video.play().catch(() => {});
  });
  video.addEventListener("error", () => {
    lengthLabel.textContent = "";
    timeLabel.textContent = "Dieses Video kann der Browser nicht abspielen.";
  });
  video.addEventListener("timeupdate", showTime);
  video.addEventListener("seeked", showTime);
  video.addEventListener("play", () => {
    playButton.textContent = "Pause";
  });
  video.addEventListener("pause", () => {
    playButton.textContent = "Abspielen";
  });
  video.addEventListener("click", () => togglePlay());

  // Jedes neu gezeigte Bild: Anzeige nachführen und die Bilddauer lernen (Median der letzten Abstände).
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

  function seek(time) {
    video.pause();
    lastMediaTime = null;
    video.currentTime = Math.min(Math.max(time, 0), video.duration || 0);
  }

  scrub.addEventListener("input", () => {
    scrubbing = true;
    video.pause();
    video.currentTime = Number(scrub.value);
  });
  scrub.addEventListener("change", () => {
    scrubbing = false;
  });
  area.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.rate) {
      playback.rate = Number(button.dataset.rate);
      video.playbackRate = playback.rate;
      video.defaultPlaybackRate = playback.rate;
      for (const other of area.querySelectorAll("[data-rate]")) other.setAttribute("aria-pressed", String(other === button));
      return;
    }
    switch (button.dataset.action) {
      case "play":
        togglePlay();
        break;
      case "start":
        seek(0);
        break;
      case "previous":
        seek(video.currentTime - frame);
        break;
      case "next":
        seek(video.currentTime + frame);
        break;
      case "impact":
        seek(Number(clip.impactOffset) || 0);
        break;
      default:
        break;
    }
  });
  return () => {
    if (frameHandle != null && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(frameHandle);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
