// Bausteine für die Seiten, gesetzt wie in der App (docs/GESTALTUNG.md):
// Kapitel mit Linie und Rubrik, Zeilen zwischen Haarlinien, Ziffern in
// Serifenschrift. Alles, was aus Daten kommt, wird maskiert.
import { normalizedScoring, maxScore, totalPar } from "./core/scoring.js";

// MARK: - HTML

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** Fertiges HTML, das nicht noch einmal maskiert wird. */
class Markup {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }
}

export const raw = (text) => new Markup(text);

function render(value) {
  if (value == null || value === false) return "";
  if (value instanceof Markup) return value.text;
  if (Array.isArray(value)) return value.map(render).join("");
  return escape(value);
}

/**
 * html`<p>${text}</p>`: Werte werden maskiert, außer sie stammen selbst aus
 * html`` oder raw(). Listen werden aneinandergehängt, null und false fallen weg.
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += render(value) + strings[index + 1];
  });
  return new Markup(out);
}

// MARK: - Bausteine

/** Kapitel: Linie in Tinte, Rubrik in Versalien, darunter der Inhalt und ein Hinweis. */
export function chapter(title, body, { footer = null, side = null, flag = false } = {}) {
  return html`<section class="chapter">
    <div class="rule"></div>
    ${title ? html`<h2 class="${flag ? "flag" : ""}">${title}${side ? html`<span class="side">${side}</span>` : ""}</h2>` : ""}
    ${body}
    ${footer ? html`<p class="note">${footer}</p>` : ""}
  </section>`;
}

/**
 * Fortschritt als Linie, 3 Punkte hoch, auf einer Haarlinie. Als SVG, weil die
 * Content-Security-Policy keine style-Attribute im HTML erlaubt.
 */
export function progress(value, total, { flag = false, label = "" } = {}) {
  const fraction = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  return html`<div class="progress${flag ? " flag" : ""}" role="img" aria-label="${label}"><svg viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true"><rect width="${(fraction * 100).toFixed(1)}" height="3"></rect></svg></div>`;
}

/** Ein Strich pro Versuch wie auf einer Strichliste. */
export function ticks(done, total) {
  const count = Math.max(total, 1);
  return html`<div class="ticks" aria-hidden="true">${Array.from({ length: count }, (_, index) => html`<span class="${index < done ? "on" : ""}"></span>`)}</div>`;
}

export function check(isOn) {
  return html`<span class="check${isOn ? " on" : ""}" aria-hidden="true">${isOn ? "✓" : ""}</span>`;
}

/** Leere Seite oder leeres Kapitel: ein Satz kursiv in Grau. */
export function empty(text) {
  return html`<p class="empty">${text}</p>`;
}

export function headline(title, kicker = null) {
  return html`<div class="headline-block">
    ${kicker ? html`<p class="kicker">${kicker}</p>` : ""}
    <span class="flagmark" aria-hidden="true"></span>
    <h1 class="headline">${title}</h1>
  </div>`;
}

/** Zeile mit Wert rechts, z. B. „Dauer · ca. 15 Min.“ */
export function labeled(label, value) {
  return html`<li class="row labeled"><span class="row-main">${label}</span><span class="row-value">${value}</span></li>`;
}

// MARK: - Texte

/** Dauer wie in der App: „45 Min.“ oder „2:30 h“. */
export function durationText(minutes) {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
  return `${minutes} Min.`;
}

/** Ergebnis wie ScoreText in der App: „14 von 20“, „31 Schläge (Par 27)“ oder „erledigt“. */
export function scoreLabel(score, scoring) {
  const normalized = normalizedScoring(scoring);
  switch (normalized.kind) {
    case "none":
      return "erledigt";
    case "strokes":
      return `${score} Schläge (Par ${totalPar(normalized) ?? 0})`;
    default:
      return `${score} von ${maxScore(normalized) ?? 0}`;
  }
}

/** Countdown zum Turnier wie in der App. */
export function countdown(daysUntil, days) {
  if (daysUntil >= 2) return `in ${daysUntil} Tagen`;
  if (daysUntil === 1) return "morgen";
  if (daysUntil === 0) return "heute";
  if (daysUntil < 0 && daysUntil >= 1 - Math.max(1, days)) return "läuft";
  return "vorbei";
}

const signedFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" });

/** Strokes Gained mit Vorzeichen und einer Nachkommastelle, „–“ ohne Wert. */
export function strokesGainedText(value) {
  return value == null ? "–" : signedFormat.format(value);
}

/** Zahl aus einem Textfeld, mit Komma oder Punkt. Leer oder unlesbar: null. */
export function parseDecimal(text) {
  const cleaned = String(text).replaceAll("−", "-").replaceAll(",", ".").replace(/\s+/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Mit Komma, höchstens zwei Nachkommastellen, z. B. „-1,25“. */
export function formatDecimal(value) {
  let text = (Math.round(value * 100) / 100).toFixed(2);
  text = text.replace(/0+$/, "").replace(/\.$/, "");
  if (text === "-0") text = "0";
  return text.replace(".", ",");
}

/** Kalenderwoche nach ISO 8601, wie der Kalender der App. */
export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
}

/**
 * Feld als fehlerhaft markieren oder nicht. Bildschirmleser lesen am Feld dann
 * auch den Hinweis vor, der sagt, was fehlt (`message`: Element mit id).
 */
export function markField(field, isInvalid, message = null) {
  field.setAttribute("aria-invalid", String(isInvalid));
  if (isInvalid && message?.id) field.setAttribute("aria-describedby", message.id);
  else field.removeAttribute("aria-describedby");
}

// MARK: - Meldungen

let toastTimer = null;

/** Kurze Meldung unten, verschwindet nach ein paar Sekunden. */
export function toast(message) {
  const element = document.getElementById("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4000);
}

let dialogCount = 0;

/** Dialog mit Titel und Text als Namen und Beschreibung für Bildschirmleser. */
function makeDialog(title, message, actions) {
  dialogCount += 1;
  const id = `dialog-${dialogCount}`;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  if (message) dialog.setAttribute("aria-describedby", `${id}-message`);
  dialog.innerHTML = html`<form method="dialog">
    <h2 id="${id}-title">${title}</h2>
    ${message ? html`<p id="${id}-message">${message}</p>` : ""}
    <div class="dialog-actions">${actions}</div>
  </form>`.text;
  return dialog;
}

/**
 * Frage mit Knöpfen, z. B. Zusammenführen oder Ersetzen. Gibt den Wert des
 * gewählten Knopfs zurück, null bei Abbrechen oder Zurück.
 * actions: [{ label, value, style: "flag" | "outline" | "danger" }]
 *
 * Löscht oder ersetzt eine der Aktionen etwas („danger“), steht der Fokus
 * zuerst auf „Abbrechen“: Enter löst dann nichts aus, was sich nicht
 * rückgängig machen lässt.
 */
export function ask({ title, message = "", actions }) {
  return new Promise((resolve) => {
    const isDangerous = actions.some((action) => action.style === "danger");
    const dialog = makeDialog(
      title,
      message,
      html`${actions.map(
        (action, index) =>
          html`<button class="button ${action.style === "outline" ? "outline" : action.style === "danger" ? "danger" : action.style === "flag" ? "flag" : ""}" value="${index}">${action.label}</button>`,
      )}
        <button class="button outline" value="cancel" ${isDangerous ? "autofocus" : ""}>Abbrechen</button>`,
    );
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      // Esc oder die Zurück-Geste schließen ohne Antwort: `returnValue` bleibt
      // leer, und `Number("")` wäre 0, also der erste Knopf, z. B. „Alles löschen“.
      // Deshalb zählen nur Ziffern als Antwort.
      const value = dialog.returnValue;
      const index = /^\d+$/.test(value) ? Number(value) : -1;
      dialog.remove();
      resolve(index >= 0 && actions[index] ? actions[index].value : null);
    });
    dialog.showModal();
  });
}

/** Hinweis mit einem Knopf „OK“. */
export function inform(title, message) {
  return new Promise((resolve) => {
    const dialog = makeDialog(title, message, html`<button class="button" value="ok">OK</button>`);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });
    dialog.showModal();
  });
}

// MARK: - Dateien

/** Datei auf dem Gerät speichern. Nichts geht an einen Server. */
export function download(fileName, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Über das Teilen-Menü des Handys, z. B. in Google Drive oder an den Kalender.
 * Gibt false zurück, wenn der Browser keine Dateien teilen kann.
 */
export async function shareFile(fileName, text, type) {
  if (typeof File === "undefined" || !navigator.canShare) return false;
  const file = new File([text], fileName, { type });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: fileName });
  } catch (error) {
    // Abgebrochen ist kein Fehler.
    if (error?.name !== "AbortError") return false;
  }
  return true;
}

/** Text einer gewählten Datei. */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// MARK: - Zeichen

/** Linien-Symbole für die Tab-Leiste, im Stil der SF Symbols der App. */
export const ICONS = {
  calendar: `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><rect x="3.5" y="5.5" width="19" height="17"/><path d="M3.5 10.5h19M8.5 3v4M17.5 3v4"/><path d="M8 14.5h2M12 14.5h2M16 14.5h2M8 18h2M12 18h2"/></svg>`,
  list: `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M9 7h13M9 13h13M9 19h13"/><path d="M4 7h1.5M4 13h1.5M4 19h1.5"/></svg>`,
  swing: `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><rect x="2.5" y="6.5" width="15" height="13"/><path d="M17.5 11l6-3.5v11l-6-3.5"/></svg>`,
  trophy: `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M8 4h10v6a5 5 0 0 1-10 0z"/><path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M18 6h3.5v1.5A3.5 3.5 0 0 1 18 11"/><path d="M13 15v4M9 22h8M10 19h6"/></svg>`,
  more: `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="13" cy="13" r="2.6"/><path d="M13 3.5v3M13 19.5v3M3.5 13h3M19.5 13h3M6.3 6.3l2.1 2.1M17.6 17.6l2.1 2.1M6.3 19.7l2.1-2.1M17.6 8.4l2.1-2.1"/></svg>`,
};
