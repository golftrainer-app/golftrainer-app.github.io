// Zwei Videos nebeneinander wie CompareView in der App
// (App/Sources/Views/Swing/ClipLibraryView.swift): Beide laufen im selben
// Abstand zum Treffmoment, Bild für Bild oder in Zeitlupe, auf Wunsch
// gespiegelt. Die Videos bleiben auf dem Handy, die Seite öffnet sie nur hier.
import { html, toast } from "../ui.js";

const RATES = [
  [1, "1×"],
  [0.5, "½"],
  [0.25, "¼"],
  [0.125, "⅛"],
];
const SIDES = ["left", "right"];
const signed = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
const plain = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Die beiden Videos, bleiben beim Wechsel zu anderen Seiten. */
export const compare = { left: null, right: null, offset: -1.5, rate: 0.25 };

export function closeCompare() {
  for (const key of SIDES) {
    if (compare[key]) URL.revokeObjectURL(compare[key].url);
    compare[key] = null;
  }
  compare.offset = -1.5;
}

function sideMarkup(key, label) {
  const clip = compare[key];
  return html`<div class="compare-side">
    <div class="video-frame"><video playsinline muted preload="auto" data-side="${key}" class="${clip?.mirrored ? "mirrored" : ""}"></video></div>
    <p class="compare-caption"><span>${clip ? clip.name : label}</span>${clip ? html`<button type="button" class="text-button" data-mirror="${key}" aria-pressed="${String(Boolean(clip.mirrored))}">Spiegeln</button>` : ""}</p>
    <label class="button outline wide">${clip ? "Anderes Video" : "Video wählen"}<input class="visually-hidden" type="file" accept="video/*" data-compare-file="${key}"></label>
    ${clip
      ? html`<div class="compare-steps">
            <button type="button" class="button outline" data-step-side="${key}" data-direction="-1" aria-label="${label}: ein Bild zurück">‹</button>
            <button type="button" class="button outline" data-step-side="${key}" data-direction="1" aria-label="${label}: ein Bild vor">›</button>
          </div>
          <button type="button" class="text-button" data-impact="${key}">Treffmoment: ${clip.anchor != null ? `${plain.format(clip.anchor)} s` : "hier setzen"}</button>`
      : ""}
  </div>`;
}

export function compareMarkup() {
  const both = compare.left && compare.right;
  return html`<div class="compare-box">
    <div class="compare">${sideMarkup("left", "Links")}${sideMarkup("right", "Rechts")}</div>
    ${both
      ? html`<input type="range" min="-2.5" max="1.5" step="0.001" value="${compare.offset}" data-compare-scrub aria-label="Abstand zum Treffmoment">
          <p class="video-time"><span data-compare-offset>${signed.format(compare.offset)} s</span> zum Treffmoment</p>
          <div class="transport three">
            <button type="button" class="button outline" data-compare="previous" aria-label="Beide ein Bild zurück">‹ Bild</button>
            <button type="button" class="button" data-compare="play">Abspielen</button>
            <button type="button" class="button outline" data-compare="next" aria-label="Beide ein Bild vor">Bild ›</button>
          </div>
          <div class="choice" role="group" aria-label="Geschwindigkeit">${RATES.map(([rate, label]) => html`<button type="button" data-compare-rate="${rate}" aria-pressed="${String(rate === compare.rate)}">${label}</button>`)}</div>
          <button type="button" class="action" data-compare="close">Vergleich schließen<span class="mark">×</span></button>`
      : html`<p class="note">Wähle links und rechts je ein Video, such in jedem mit ‹ und › das Bild des Treffmoments und tippe „Treffmoment: hier setzen“. Danach laufen beide im selben Abstand dazu.</p>`}
  </div>`;
}

/** Zeichnet den Vergleich in `container` und hält ihn am Laufen. Gibt eine Funktion zum Aufräumen zurück. */
export function mountCompare(container) {
  let cleanup = null;
  const render = () => {
    cleanup?.();
    container.innerHTML = String(compareMarkup());
    cleanup = wire(container.firstElementChild, render);
  };
  render();
  return () => cleanup?.();
}

function wire(box, rerender) {
  const videos = { left: box.querySelector("[data-side='left']"), right: box.querySelector("[data-side='right']") };
  /** Dauer eines Bilds je Seite, geschätzt aus den gezeigten Bildern, bis dahin 30 pro Sekunde. */
  const frames = { left: 1 / 30, right: 1 / 30 };
  const handles = {};
  const scrub = box.querySelector("[data-compare-scrub]");
  const offsetLabel = box.querySelector("[data-compare-offset]");
  const playButton = box.querySelector("[data-compare='play']");
  let playing = false;
  let scrubbing = false;

  const both = () => Boolean(compare.left && compare.right);
  /** Treffmoment im Video. Ohne Markierung 1,5 Sekunden nach dem Anfang. */
  const anchor = (key) => {
    const clip = compare[key];
    return Math.min(Math.max(0, clip?.anchor ?? 1.5), clip?.duration ?? Infinity);
  };
  /** Abstände zum Treffmoment, die beide Videos zeigen können. */
  const range = () => {
    if (!both()) return null;
    const lower = Math.max(-2.5, -anchor("left"), -anchor("right"));
    const upper = Math.min(1.5, (compare.left.duration ?? Infinity) - anchor("left"), (compare.right.duration ?? Infinity) - anchor("right"));
    return lower < upper ? [lower, upper] : null;
  };
  const showOffset = (value) => {
    if (offsetLabel) offsetLabel.textContent = `${signed.format(value)} s`;
    if (scrub && !scrubbing) scrub.value = String(value);
  };
  function seek(value) {
    const limits = range();
    const clamped = limits ? Math.min(Math.max(value, limits[0]), limits[1]) : value;
    compare.offset = clamped;
    for (const key of SIDES) {
      if (!compare[key]) continue;
      const target = anchor(key) + clamped;
      if (Number.isFinite(target)) videos[key].currentTime = Math.max(0, target);
    }
    showOffset(clamped);
  }
  function updateRange() {
    const limits = range();
    if (scrub && limits) {
      scrub.min = String(limits[0]);
      scrub.max = String(limits[1]);
    }
    if (both()) seek(compare.offset);
  }
  function pauseBoth() {
    const wasPlaying = playing;
    playing = false;
    for (const key of SIDES) videos[key].pause();
    if (playButton) playButton.textContent = "Abspielen";
    // Wieder genau übereinander, falls sie beim Abspielen etwas auseinandergelaufen sind.
    if (wasPlaying) seek(videos.left.currentTime - anchor("left"));
  }
  function playBoth() {
    const limits = range();
    // Am Ende wieder von vorn, sonst ab dem gemeinsamen Stand.
    if (limits && compare.offset >= limits[1] - 0.02) seek(Math.max(limits[0], -1.5));
    else seek(compare.offset);
    playing = true;
    if (playButton) playButton.textContent = "Pause";
    for (const key of SIDES) videos[key].play().catch(() => {});
  }
  /** Beide um dieselbe Zeit weiter: ein Bild des schnelleren Videos. */
  function stepBoth(direction) {
    pauseBoth();
    seek(compare.offset + direction * Math.min(frames.left, frames.right));
  }
  function stepSide(key, direction) {
    pauseBoth();
    const video = videos[key];
    video.currentTime = Math.min(Math.max(video.currentTime + direction * frames[key], 0), video.duration || 0);
  }

  for (const key of SIDES) {
    const clip = compare[key];
    const video = videos[key];
    if (!clip) continue;
    video.src = clip.url;
    video.playbackRate = compare.rate;
    video.defaultPlaybackRate = compare.rate;
    video.addEventListener("loadedmetadata", () => {
      clip.duration = video.duration;
      if (!both() && clip.time > 0 && clip.time < video.duration) video.currentTime = clip.time;
      updateRange();
    });
    video.addEventListener("error", () => toast("Dieses Video kann der Browser nicht abspielen. Versuch es mit einer anderen Aufnahme."));
    video.addEventListener("timeupdate", () => {
      clip.time = video.currentTime;
    });
    // Ein Video ist am Ende: beide anhalten, sonst laufen sie auseinander.
    video.addEventListener("ended", () => {
      if (playing) pauseBoth();
    });
    const deltas = [];
    let lastMediaTime = null;
    const onFrame = (_, metadata) => {
      if (lastMediaTime != null) {
        const delta = metadata.mediaTime - lastMediaTime;
        if (delta > 1 / 300 && delta < 0.2) {
          deltas.push(delta);
          if (deltas.length > 30) deltas.shift();
          frames[key] = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
        }
      }
      lastMediaTime = metadata.mediaTime;
      if (playing && key === "left") showOffset(video.currentTime - anchor("left"));
      handles[key] = video.requestVideoFrameCallback(onFrame);
    };
    if ("requestVideoFrameCallback" in video) handles[key] = video.requestVideoFrameCallback(onFrame);
  }

  box.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.mirror) {
      const key = button.dataset.mirror;
      compare[key].mirrored = !compare[key].mirrored;
      videos[key].classList.toggle("mirrored", compare[key].mirrored);
      button.setAttribute("aria-pressed", String(compare[key].mirrored));
    } else if (button.dataset.stepSide) {
      stepSide(button.dataset.stepSide, Number(button.dataset.direction));
    } else if (button.dataset.impact) {
      const key = button.dataset.impact;
      pauseBoth();
      compare[key].anchor = videos[key].currentTime;
      button.textContent = `Treffmoment: ${plain.format(compare[key].anchor)} s`;
      updateRange();
    } else if (button.dataset.compareRate) {
      compare.rate = Number(button.dataset.compareRate);
      for (const key of SIDES) {
        videos[key].playbackRate = compare.rate;
        videos[key].defaultPlaybackRate = compare.rate;
      }
      for (const other of box.querySelectorAll("[data-compare-rate]")) other.setAttribute("aria-pressed", String(other === button));
    } else {
      switch (button.dataset.compare) {
        case "play":
          if (playing) pauseBoth();
          else playBoth();
          break;
        case "previous":
          stepBoth(-1);
          break;
        case "next":
          stepBoth(1);
          break;
        case "close":
          closeCompare();
          rerender();
          break;
        default:
          break;
      }
    }
  });
  box.addEventListener("change", (event) => {
    const input = event.target.closest("[data-compare-file]");
    if (!input) return;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const key = input.dataset.compareFile;
    if (compare[key]) URL.revokeObjectURL(compare[key].url);
    compare[key] = { url: URL.createObjectURL(file), name: file.name, anchor: null, mirrored: false, time: 0, duration: null };
    compare.offset = -1.5;
    rerender();
  });
  scrub?.addEventListener("input", () => {
    scrubbing = true;
    pauseBoth();
    seek(Number(scrub.value));
  });
  scrub?.addEventListener("change", () => {
    scrubbing = false;
  });

  return () => {
    for (const key of SIDES) {
      const video = videos[key];
      if (handles[key] != null && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handles[key]);
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  };
}
