// Dieses Gerät als Bildschirm, wie der Bildschirm-Modus des iPads in der App:
// zeigt einen Code für das Handy, dann das Live-Bild der Kamera, jeden neuen
// Schwung sofort in Zeitlupe in Schleife und darunter die letzten Clips.
// Vom Bildschirm aus lassen sich Schwünge speichern und die Aufnahme
// pausieren. Verbindung: link.js (WebRTC, Aufbau über den Server des Kontos).
import { clipStore } from "../clips.js";
import { displayCode, generateCode, isCode, normalizeCode } from "../core/screenlink.js";
import { ScreenHost } from "../link.js";
import { ask, chapter, empty, html, toast } from "../ui.js";
import { clipsMarkup, shareClip } from "./camera.js";
import { mountClipPlayer, playerMarkup } from "./player.js";

export const SCREEN_KEY = "golftrainer.bildschirm";
const STATE_TEXT = {
  idle: "Aus.",
  waiting: "Warte auf das Handy …",
  connecting: "Handy gefunden, verbindet …",
  connected: "Verbunden mit dem Handy.",
  error: "Keine Verbindung zum Server.",
};

/** Der Code dieses Geräts, bleibt im Browser, bis man einen neuen erzeugt. */
export function loadCode(storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(storage?.getItem(SCREEN_KEY) ?? "null");
    if (stored && isCode(stored.code)) return normalizeCode(stored.code);
  } catch {
    // Unlesbar: ein neuer Code.
  }
  const code = generateCode();
  saveCode(code, storage);
  return code;
}

function saveCode(code, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SCREEN_KEY, JSON.stringify({ code }));
  } catch {
    // Dann gilt der Code bis zum Neuladen.
  }
}

/** #/schwung/bildschirm: Code, Live-Bild, letzter Schwung, Clips, Fernbedienung. */
export function screenPage(app) {
  const code = loadCode();
  const store = clipStore();
  let clips = [];
  return {
    title: "Bildschirm",
    tab: "schwung",
    parent: "#/schwung",
    keepOnChange: true,
    render() {
      return html`
        ${chapter(
          "",
          html`<p class="kicker">Code für das Handy</p>
            <p class="code-display" data-code>${displayCode(code)}</p>
            <p class="note" data-state>${STATE_TEXT.waiting}</p>
            <div class="buttons"><button type="button" class="button outline" data-action="new-code">Neuer Code</button></div>`,
          {
            footer:
              "Auf dem Handy: Schwung → Kamera → „Bildschirm“, diesen Code eintippen und „Verbinden“. Beide Geräte im selben WLAN oder am Hotspot des Handys. Den Weg zueinander vermittelt der Server des Kontos, Bild und Clips gehen direkt von Gerät zu Gerät. Der Code bleibt auf diesem Gerät; hat ihn jemand Fremdes gesehen, erzeuge einen neuen.",
          },
        )}
        ${chapter(
          "Kamera",
          html`<div class="video-frame screen-live">
              <video autoplay muted playsinline data-live></video>
              <p class="camera-status" data-status>Kein Live-Bild.</p>
            </div>
            <div class="buttons">
              <button type="button" class="button flag" data-action="save" disabled>Schwung speichern</button>
              <button type="button" class="button outline" data-action="pause" data-command="pause" disabled>Pause</button>
            </div>
            <p class="screen-progress" data-progress></p>`,
          { footer: "„Schwung speichern“ sichert den letzten Schwung auf dem Handy, falls die Kamera ihn verpasst hat. Pause hält Aufnahme und Erkennung an, die Kamera bleibt an." },
        )}
        ${chapter("Letzter Schwung", html`<div data-replay>${empty("Noch kein Schwung angekommen.")}</div>`, { footer: "Jeder neue Schwung läuft hier sofort in Zeitlupe in Schleife." })}
        ${chapter("Clips", html`<div data-clips>${clipsMarkup(clips)}</div>`, {
          footer: "Die Clips vom Handy liegen auch im Speicher dieses Browsers, höchstens 50; beim nächsten geht der älteste. „Meine Daten löschen“ nimmt sie mit.",
        })}
      `;
    },
    mount(root) {
      const stateLine = root.querySelector("[data-state]");
      const live = root.querySelector("[data-live]");
      const liveStatus = root.querySelector("[data-status]");
      const progress = root.querySelector("[data-progress]");
      const saveButton = root.querySelector("[data-action='save']");
      const pauseButton = root.querySelector("[data-action='pause']");
      const replay = root.querySelector("[data-replay]");
      const list = root.querySelector("[data-clips]");
      let host = null;
      let stopReplay = null;
      let replayURL = null;
      let lock = null;
      const renderClips = () => {
        list.innerHTML = String(clipsMarkup(clips));
      };
      const showReplay = (clip, blob) => {
        stopReplay?.();
        stopReplay = null;
        if (replayURL) URL.revokeObjectURL(replayURL);
        replayURL = URL.createObjectURL(blob);
        replay.innerHTML = String(playerMarkup(html, { impact: clip.impactOffset != null }));
        stopReplay = mountClipPlayer(replay.querySelector("[data-clip-player]"), replayURL, clip);
      };
      store
        .list()
        .then((items) => {
          clips = items;
          renderClips();
        })
        .catch(() => {});

      const startHost = () => {
        host?.stop();
        host = new ScreenHost({
          code,
          onState: (state, detail) => {
            stateLine.textContent = state === "error" && detail ? `${STATE_TEXT.error} ${detail}` : (STATE_TEXT[state] ?? STATE_TEXT.idle);
            const connected = state === "connected";
            saveButton.disabled = !connected;
            pauseButton.disabled = !connected;
            // Das Live-Bild kommt schon beim Verbinden an; weg ist es erst, wenn das Handy weg ist.
            if (state === "waiting" || state === "idle" || state === "error") {
              live.srcObject = null;
              liveStatus.textContent = "Kein Live-Bild.";
              progress.textContent = "";
            }
          },
          onStream: (stream) => {
            live.srcObject = stream;
            live.play().catch(() => {});
          },
          onStatus: (status) => {
            liveStatus.textContent = status.text ?? "";
            pauseButton.textContent = status.paused ? "Weiter" : "Pause";
            pauseButton.dataset.command = status.paused ? "resume" : "pause";
          },
          onProgress: (value) => {
            progress.textContent = value == null ? "" : `Clip kommt an … ${Math.round(value * 100)} %`;
          },
          onClip: async (clip, blob) => {
            const stored = { ...clip, source: "handy", receivedAt: Date.now() };
            try {
              const removed = await store.add(stored, blob);
              clips = [stored, ...clips.filter((other) => other.id !== stored.id && !removed.includes(other.id))];
            } catch {
              clips = [stored, ...clips.filter((other) => other.id !== stored.id)];
            }
            renderClips();
            showReplay(stored, blob);
          },
        });
        host.start();
      };
      startHost();
      navigator.wakeLock
        ?.request?.("screen")
        .then((granted) => {
          lock = granted;
        })
        .catch(() => {});

      root.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || button.disabled) return;
        if (button.closest("[data-clip-player]")) return;
        const id = button.dataset.id;
        switch (button.dataset.action) {
          case "new-code": {
            const choice = await ask({ title: "Neuen Code erzeugen?", message: "Das Handy muss danach den neuen Code eintippen.", actions: [{ label: "Neuer Code", value: "new", style: "danger" }] });
            if (choice !== "new") break;
            const fresh = generateCode();
            saveCode(fresh);
            app.render();
            break;
          }
          case "save":
            if (!host?.sendCommand("save")) toast("Kein Handy verbunden.");
            break;
          case "pause":
            if (!host?.sendCommand(pauseButton.dataset.command ?? "pause")) toast("Kein Handy verbunden.");
            break;
          case "open": {
            const clip = clips.find((item) => item.id === id);
            const blob = clip ? await store.blob(id) : null;
            if (!clip || !blob) {
              toast("Der Clip ist nicht mehr da.");
              break;
            }
            showReplay(clip, blob);
            replay.scrollIntoView({ behavior: "smooth", block: "start" });
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
            const choice = await ask({ title: "Clip löschen?", message: "", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
            if (choice !== "delete") break;
            await store.remove(id).catch(() => {});
            clips = clips.filter((item) => item.id !== id);
            renderClips();
            break;
          }
          default:
            break;
        }
      });

      return () => {
        host?.stop();
        host = null;
        stopReplay?.();
        if (replayURL) URL.revokeObjectURL(replayURL);
        lock?.release?.().catch(() => {});
      };
    },
  };
}
