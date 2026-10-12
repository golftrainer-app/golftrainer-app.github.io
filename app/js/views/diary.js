// Trainingstagebuch wie TrainingDiaryView in der App
// (App/Sources/Views/Team/DiaryViews.swift): Einheiten mit Stoppuhr oder von
// Hand, dazu automatisch die Übungen aus den Vorschlägen. Eigene Einträge
// lassen sich bearbeiten, die automatischen nicht.
import { AREAS, AREA_NAMES } from "../core/categories.js";
import { formatTime, fromInputs, startOfWeek, toDateInput, toTimeInput } from "../core/dates.js";
import { KINDS, KIND_NAMES, PLACES, PLACE_NAMES, scoreText, sortedAreas } from "../core/traininglog.js";
import { ask, chapter, durationText, empty, html, toast } from "../ui.js";

const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const whenFormat = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const EFFORT_NAMES = { 1: "1 – locker", 2: "2 – leicht", 3: "3 – mittel", 4: "4 – anstrengend", 5: "5 – sehr anstrengend" };

/** Schritte wie die Stepper in der App. */
const STEP = 5;
const DURATION_RANGE = [5, 600];
const AREA_RANGE = [0, 600];

/** Volle Minuten seit dem Start der Stoppuhr. */
export function runningMinutes(running, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - running.start.getTime()) / 60000));
}

export function diaryPage(app) {
  const { store } = app;
  return {
    title: "Tagebuch",
    tab: "woche",
    parent: "#/woche",
    render() {
      const now = new Date();
      const entries = store.myTrainingLog();
      const manualIDs = new Set(store.data.trainingLog.map((entry) => entry.id));
      const byWeek = new Map();
      for (const entry of entries) {
        const key = startOfWeek(entry.start).getTime();
        if (!byWeek.has(key)) byWeek.set(key, []);
        byWeek.get(key).push(entry);
      }
      const weeks = [...byWeek.keys()].sort((a, b) => b - a);
      return html`
        ${store.running ? runningChapter(store.running, now) : ""}
        ${chapter(
          null,
          html`${store.running ? "" : html`<button type="button" class="action" data-action="start" data-key="start">Stoppuhr starten<span class="mark">▶</span></button>`}
            <a class="action" href="#/tagebuch/neu">Training eintragen<span class="mark">+</span></a>`,
          {
            footer:
              "Übungen, die du während einer laufenden Einheit einträgst, gehören zu ihr. Alle anderen stehen als „Übungen aus dem Plan“ an ihrem Tag. Im Team sehen das Tagebuch nur die Trainer, und nur aus der App.",
          },
        )}
        ${entries.length === 0 ? empty("Noch kein Training eingetragen. Starte die Stoppuhr, trag eine Einheit von Hand ein oder mach Übungen aus den Vorschlägen der Woche.") : ""}
        ${weeks.map((key) => {
          const list = byWeek.get(key);
          const total = list.reduce((sum, entry) => sum + entry.minutes, 0);
          return chapter(
            `Woche ab ${dayMonth.format(new Date(key))}`,
            html`<ul class="rows">${list.map((entry) =>
              manualIDs.has(entry.id)
                ? html`<li><a class="row log" href="#/tagebuch/${encodeURIComponent(entry.id)}" aria-label="${KIND_NAMES[entry.kind] ?? entry.kind}, ${durationText(entry.minutes)}, bearbeiten">${logBody(entry)}</a></li>`
                : html`<li><div class="row log">${logBody(entry)}</div></li>`,
            )}</ul>`,
            { side: html`<span class="duration">${durationText(total)}</span>` },
          );
        })}
      `;
    },
    mount(root) {
      root.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
          case "start":
            store.startTraining();
            toast("Die Stoppuhr läuft.");
            break;
          case "finish":
            app.navigate("#/tagebuch/stoppuhr");
            break;
          case "discard": {
            const choice = await ask({
              title: "Laufendes Training verwerfen?",
              message: "Die gestoppte Zeit wird nicht eingetragen.",
              actions: [{ label: "Verwerfen", value: "discard", style: "danger" }],
            });
            if (choice === "discard") store.cancelTraining();
            break;
          }
          default:
            break;
        }
      });
      // Die laufende Zeit nachführen, ohne die Seite neu zu zeichnen.
      const figure = root.querySelector("[data-running-minutes]");
      if (!figure) return null;
      const interval = setInterval(() => {
        if (store.running) figure.textContent = durationText(runningMinutes(store.running));
      }, 15000);
      return () => clearInterval(interval);
    },
  };
}

/** Die laufende Zeit groß in Fahnenrot: Das ist, was gerade passiert. */
function runningChapter(running, now) {
  return chapter(
    "Training läuft",
    html`<p class="figure flag"><span data-running-minutes>${durationText(runningMinutes(running, now))}</span></p>
      <p class="note">seit ${formatTime(running.start)} Uhr${running.place ? ` · ${PLACE_NAMES[running.place]}` : ""}</p>
      <div class="buttons">
        <button type="button" class="button flag" data-action="finish" data-key="finish">Beenden und eintragen</button>
        <button type="button" class="button outline" data-action="discard" data-key="discard">Verwerfen</button>
      </div>`,
    { flag: true, footer: "Übungen, die du währenddessen einträgst, gehören zu dieser Einheit." },
  );
}

/** Eine Einheit als Zeile: Art und Dauer, dann Zeit, Ort, Bereiche, Übungen, Anstrengung und Notiz. */
function logBody(entry) {
  const when = [whenFormat.format(entry.start), entry.place ? PLACE_NAMES[entry.place] : null].filter(Boolean).join(" · ");
  const areas = sortedAreas(entry)
    .map(({ area, minutes }) => `${AREA_NAMES[area] ?? area} ${minutes}`)
    .join(", ");
  return html`<span class="row-main">
    <span class="log-head"><span class="row-title">${KIND_NAMES[entry.kind] ?? entry.kind}</span><span class="row-value">${durationText(entry.minutes)}</span></span>
    <span class="row-sub">${when}</span>
    ${areas ? html`<span class="row-sub">${areas}</span>` : ""}
    ${entry.drills.map((drill) => {
      const score = scoreText(drill);
      return html`<span class="log-drill"><span>${drill.name}</span>${score ? html`<span class="num">${score}</span>` : ""}</span>`;
    })}
    ${entry.effort != null ? html`<span class="row-sub">Anstrengung ${entry.effort} von 5</span>` : ""}
    ${entry.note ? html`<span class="log-note">${entry.note}</span>` : ""}
  </span>`;
}

// MARK: - Eintrag

function stepper(key, value, [min, max], label) {
  return html`<span class="small-stepper" data-stepper="${key}" data-min="${min}" data-max="${max}" data-value="${value}">
    <button type="button" data-step="${-STEP}" data-key="${key}-less" aria-label="${label}: ${STEP} Minuten weniger" ${value - STEP < min ? "disabled" : ""}>−</button>
    <output aria-live="polite">${durationText(value)}</output>
    <button type="button" data-step="${STEP}" data-key="${key}-more" aria-label="${label}: ${STEP} Minuten mehr" ${value + STEP > max ? "disabled" : ""}>+</button>
  </span>`;
}

function areasNote(assigned, minutes) {
  return assigned === minutes || assigned === 0 ? "Optional. So siehst du später, was du geübt hast." : `Verteilt: ${assigned} von ${minutes} Minuten.`;
}

/**
 * Eintrag bearbeiten. `id`: „neu“ für einen neuen Eintrag, „stoppuhr“ für die
 * laufende Stoppuhr, sonst die Kennung eines eigenen Eintrags.
 */
export function diaryEditor(app, id) {
  const { store } = app;
  const missing = (text) => ({ title: "Training", tab: "woche", parent: "#/tagebuch", render: () => empty(text) });
  let entry;
  let existing = false;
  if (id === "neu") {
    entry = store.newTrainingEntry();
  } else if (id === "stoppuhr") {
    entry = store.entryForRunningTraining();
    if (!entry) return missing("Gerade läuft keine Stoppuhr.");
  } else {
    const found = store.data.trainingLog.find((other) => other.id === id);
    if (!found) return missing("Diesen Eintrag gibt es nicht mehr.");
    entry = { ...found, areaMinutes: { ...found.areaMinutes }, drills: found.drills.map((drill) => ({ ...drill })) };
    existing = true;
  }
  /** Werte der Zähler, die Felder liest das Sichern aus dem Formular. */
  const draft = { minutes: entry.minutes, areaMinutes: { ...entry.areaMinutes } };
  const assigned = () => Object.values(draft.areaMinutes).reduce((sum, value) => sum + value, 0);

  return {
    title: id === "stoppuhr" ? "Training eintragen" : "Training",
    tab: "woche",
    parent: "#/tagebuch",
    keepOnChange: true,
    render() {
      return html`<form class="editor" novalidate>
        ${id === "stoppuhr" ? html`<p class="note flag">Die Stoppuhr lief ${durationText(entry.minutes)}, seit ${formatTime(entry.start)} Uhr. Prüfe die Angaben und sichere die Einheit.</p>` : ""}
        <div class="field-row">
          <label class="field"><span>Datum</span><input type="date" name="date" value="${toDateInput(entry.start)}" min="1970-01-01" max="2199-12-31" required></label>
          <label class="field"><span>Beginn</span><input type="time" name="time" value="${toTimeInput(entry.start)}" required></label>
        </div>
        <div class="day-minutes">
          <span class="row-main"><span class="row-title">Dauer</span></span>
          ${stepper("duration", draft.minutes, DURATION_RANGE, "Dauer")}
        </div>
        <label class="field"><span>Art</span>
          <select name="kind">${KINDS.filter((kind) => kind !== "plan").map((kind) => html`<option value="${kind}" ${kind === entry.kind ? "selected" : ""}>${KIND_NAMES[kind]}</option>`)}</select>
        </label>
        <label class="field"><span>Wo</span>
          <select name="place"><option value="">Keine Angabe</option>${PLACES.map((place) => html`<option value="${place}" ${place === entry.place ? "selected" : ""}>${PLACE_NAMES[place]}</option>`)}</select>
        </label>
        ${chapter(
          "Bereiche",
          html`${AREAS.map(
            (area) => html`<div class="day-minutes">
              <span class="row-main"><span class="row-title">${AREA_NAMES[area]}</span></span>
              ${stepper(`area-${area}`, draft.areaMinutes[area] ?? 0, AREA_RANGE, AREA_NAMES[area])}
            </div>`,
          )}
          <p class="note" data-areas-note>${areasNote(assigned(), draft.minutes)}</p>`,
        )}
        <label class="field"><span>Anstrengung</span>
          <select name="effort"><option value="">Keine Angabe</option>${[1, 2, 3, 4, 5].map((value) => html`<option value="${value}" ${value === entry.effort ? "selected" : ""}>${EFFORT_NAMES[value]}</option>`)}</select>
        </label>
        <label class="field"><span>Notiz</span><textarea name="note" rows="2" placeholder="z. B. woran du gearbeitet hast">${entry.note}</textarea></label>
        ${entry.drills.length > 0
          ? chapter("Übungen in dieser Einheit", html`<ul class="rows">${entry.drills.map((drill) => html`<li class="row"><span class="row-main">${drill.name}</span>${scoreText(drill) ? html`<span class="row-value">${scoreText(drill)}</span>` : ""}</li>`)}</ul>`, {
              footer: "Aus den Ergebnissen, die in die Zeit dieser Einheit fallen.",
            })
          : ""}
        <div class="buttons">
          <button type="submit" class="button flag" data-save>Sichern</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
        ${existing ? html`<button type="button" class="action danger" data-delete>Eintrag löschen</button>` : ""}
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      const note = root.querySelector("[data-areas-note]");
      form.addEventListener("click", (event) => {
        const button = event.target.closest("[data-step]");
        if (!button) return;
        const box = button.closest("[data-stepper]");
        const [min, max] = [Number(box.dataset.min), Number(box.dataset.max)];
        const value = Math.min(max, Math.max(min, Number(box.dataset.value) + Number(button.dataset.step)));
        box.dataset.value = String(value);
        box.querySelector("output").textContent = durationText(value);
        const [less, more] = box.querySelectorAll("button");
        less.disabled = value - STEP < min;
        more.disabled = value + STEP > max;
        if (box.dataset.stepper === "duration") draft.minutes = value;
        else {
          const area = box.dataset.stepper.slice("area-".length);
          if (value > 0) draft.areaMinutes[area] = value;
          else delete draft.areaMinutes[area];
        }
        note.textContent = areasNote(assigned(), draft.minutes);
      });
      root.querySelector("[data-cancel]").addEventListener("click", () => app.back("#/tagebuch"));
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({ title: "Eintrag löschen?", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
        if (choice !== "delete") return;
        store.deleteTrainingEntry(entry.id);
        toast("Eintrag gelöscht.");
        app.back("#/tagebuch");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const dateField = form.elements.date;
        const timeField = form.elements.time;
        const start = dateField.value && timeField.value ? fromInputs(dateField.value, timeField.value) : new Date(NaN);
        const valid = Number.isFinite(start.getTime());
        dateField.setAttribute("aria-invalid", String(!valid));
        if (!valid) {
          toast("Bitte Datum und Uhrzeit angeben.");
          dateField.focus();
          return;
        }
        store.saveTrainingEntry({
          ...entry,
          start,
          minutes: draft.minutes,
          kind: form.elements.kind.value,
          place: form.elements.place.value || null,
          areaMinutes: { ...draft.areaMinutes },
          effort: form.elements.effort.value ? Number(form.elements.effort.value) : null,
          note: form.elements.note.value.trim(),
        });
        toast(id === "stoppuhr" ? "Eingetragen. Die Stoppuhr ist beendet." : "Eingetragen.");
        app.back("#/tagebuch");
      });
    },
  };
}
