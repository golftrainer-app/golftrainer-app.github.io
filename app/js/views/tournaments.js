// Tab „Turniere“: kommende Turniere mit Vorbereitung und die Runden mit
// Strokes Gained aus bebrassie, wie RoundsView und TournamentViews in der App.
import { SG_CATEGORIES, SG_NAMES } from "../core/categories.js";
import { addDays, formatShortDate, formatTime, fromInputs, toDateInput, toTimeInput } from "../core/dates.js";
import { newID } from "../core/model.js";
import { PHASE_NAMES, phase as tournamentPhase, warmUpSchedule } from "../core/tournament.js";
import { averageStrokesGained } from "../core/weighting.js";
import { ask, chapter, check, countdown, empty, formatDecimal, html, parseDecimal, progress, strokesGainedText, toast } from "../ui.js";

const fullDate = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short" });

function details(tournament) {
  const date = `${formatShortDate(tournament.start)}, ${formatTime(tournament.start)}`;
  return tournament.course ? `${tournament.course} · ${date}` : date;
}

const checklistKey = (phase, section, item) => `${phase}|${section}|${item}`;

function missing(title, parent) {
  return { title, tab: "turniere", parent, render: () => empty("Nicht gefunden. Vielleicht wurde es gelöscht.") };
}

// MARK: - Übersicht

export function tournamentsPage(app) {
  const { store } = app;
  return {
    title: "Turniere & Runden",
    tab: "turniere",
    parent: null,
    render() {
      const now = new Date();
      const upcoming = store.upcomingTournaments(now);
      const past = store.pastTournaments(now);
      const average = averageStrokesGained(store.data.rounds);
      const rounds = [...store.data.rounds].sort((a, b) => b.date - a.date);
      return html`
        ${chapter(
          "Nächste Turniere",
          html`<ul class="rows">
              ${upcoming.length === 0 ? html`<li>${empty("Kein Turnier geplant.")}</li>` : ""}
              ${upcoming.map((tournament, index) => tournamentRow(store, tournament, index === 0, now))}
            </ul>
            <a class="action" href="#/turniere/neu">Turnier hinzufügen<span class="mark">+</span></a>`,
          { footer: "In den 7 Tagen vor einem Turnier stellt die App ihre Vorschläge auf Turniervorbereitung um." },
        )}
        ${past.length > 0 ? chapter("Vergangene Turniere", html`<ul class="rows">${past.map((tournament) => tournamentRow(store, tournament, false, now))}</ul>`) : ""}
        ${average
          ? chapter(
              "Durchschnitt der letzten Runden",
              html`<ul class="rows">${SG_CATEGORIES.map((category) => strokesGainedRow(SG_NAMES[category], average[category]))}</ul>`,
            )
          : ""}
        ${chapter(
          "Runden",
          html`<ul class="rows">
              ${rounds.length === 0 ? html`<li>${empty("Noch keine Runden eingetragen.")}</li>` : ""}
              ${rounds.map((round) => roundRow(round))}
            </ul>
            <a class="action" href="#/runden/neu">Runde eintragen<span class="mark">+</span></a>`,
          {
            footer:
              "Trag nach jeder Runde die vier Strokes-Gained-Werte aus bebrassie ein. Daraus berechnet die App, wie viel Zeit in welchen Bereich fließt.",
          },
        )}
      `;
    },
  };
}

function tournamentRow(store, tournament, isNext, now) {
  const days = store.daysUntil(tournament, now);
  const name = tournament.name || "Turnier";
  if (isNext) {
    return html`<li><a class="row banner" href="#/turniere/${encodeURIComponent(tournament.id)}">
      <span class="row-main">
        <span class="countdown">${countdown(days, tournament.days)}</span>
        <span class="row-title big">${name}</span>
        <span class="row-sub">${details(tournament)}</span>
      </span>
    </a></li>`;
  }
  return html`<li><a class="row" href="#/turniere/${encodeURIComponent(tournament.id)}">
    <span class="row-main">
      <span class="row-title">${name}</span>
      <span class="row-sub">${details(tournament)}</span>
    </span>
    <span class="kicker ink">${countdown(days, tournament.days)}</span>
  </a></li>`;
}

/** Wo Schläge verloren gehen, steht die Zahl in Fahnenrot: Dort lohnt sich das Training jetzt am meisten. */
function strokesGainedRow(title, value) {
  return html`<li class="row"><span class="row-main">${title}</span><span class="row-value big${(value ?? 0) < 0 ? " flag" : ""}">${strokesGainedText(value)}</span></li>`;
}

function roundRow(round) {
  const values = Object.keys(round.strokesGained).length
    ? SG_CATEGORIES.map((category) => `${SG_NAMES[category]} ${strokesGainedText(round.strokesGained[category])}`).join(" · ")
    : "";
  return html`<li><a class="row" href="#/runden/${encodeURIComponent(round.id)}">
    <span class="row-main">
      <span class="row-title">${round.course || "Runde"}</span>
      <span class="row-sub">${formatShortDate(round.date)}</span>
      ${values ? html`<span class="row-sub">${values}</span>` : ""}
    </span>
    ${round.score != null ? html`<span class="minutes"><span class="row-value big">${round.score}</span><span class="kicker">Schläge</span></span>` : ""}
  </a></li>`;
}

// MARK: - Turnier

export function tournamentPage(app, id) {
  const { store } = app;
  const base = `#/turniere/${encodeURIComponent(id)}`;
  if (!store.tournament(id)) return missing("Turnier", "#/turniere");
  return {
    title: store.tournament(id).name || "Turnier",
    tab: "turniere",
    parent: "#/turniere",
    render() {
      const tournament = store.tournament(id);
      if (!tournament) return empty("Turnier nicht gefunden.");
      const now = new Date();
      const days = store.daysUntil(tournament, now);
      const current = tournamentPhase(days, tournament.days);
      // Bis zum letzten Turniertag zählt es als kommend.
      const isAhead = days > -Math.max(1, tournament.days);
      return html`
        <p class="countdown huge${isAhead ? "" : " past"}">${countdown(days, tournament.days)}</p>
        <ul class="rows facts">
          <li class="row labeled"><span class="row-main">Start</span><span class="row-value">${fullDate.format(tournament.start)}</span></li>
          ${tournament.course ? html`<li class="row labeled"><span class="row-main">Platz</span><span class="row-value">${tournament.course}</span></li>` : ""}
          ${tournament.days > 1 ? html`<li class="row labeled"><span class="row-main">Turniertage</span><span class="row-value">${tournament.days}</span></li>` : ""}
        </ul>
        ${chapter(
          "Vorbereitung",
          html`<ul class="rows">
              ${store.guide.phases.map((guide) => {
                const keys = guide.sections.flatMap((section) => section.items.map((item) => checklistKey(guide.phase, section.title, item)));
                const done = keys.filter((key) => tournament.checkedItems.includes(key)).length;
                const isCurrent = guide.phase === current;
                return html`<li><a class="row phase" href="${base}/phase/${guide.phase}">
                  <span class="row-main">
                    <span class="phase-head"><span class="row-title">${guide.title}</span>${isCurrent ? html`<span class="kicker flag">Jetzt</span>` : ""}<span class="row-value">${done}/${keys.length}</span></span>
                    <span class="row-sub">${guide.timing}</span>
                    <span class="phase-goal">${guide.goal}</span>
                    ${progress(done, Math.max(keys.length, 1), { flag: isCurrent, label: `${done} von ${keys.length} erledigt` })}
                  </span>
                </a></li>`;
              })}
              <li><a class="row" href="${base}/einspielen"><span class="row-main row-title">Einspielen am Turniertag</span></a></li>
            </ul>`,
          { footer: "Tippe einen Punkt an, wenn du ihn erledigt hast. Was du an diesen Tagen trainierst, steht automatisch in den Vorschlägen der Woche." },
        )}
        ${chapter(
          "Quellen",
          store.guide.sources.map(
            (source) => html`<a class="action source" href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title}<span class="mark">↗</span></a>`,
          ),
        )}
        ${chapter(
          null,
          html`<a class="action" href="${base}/bearbeiten">Bearbeiten<span class="mark">›</span></a>
            <button type="button" class="action danger" data-action="delete">Turnier löschen</button>`,
        )}
      `;
    },
    mount(root) {
      root.querySelector("[data-action='delete']")?.addEventListener("click", async () => {
        const tournament = store.tournament(id);
        if (!tournament) return;
        const choice = await ask({
          title: `„${tournament.name || "Turnier"}“ löschen?`,
          message: "Die Vorbereitung in den Vorschlägen fällt dann weg.",
          actions: [{ label: "Löschen", value: "delete", style: "danger" }],
        });
        if (choice !== "delete") return;
        // Die Seite verschwindet gleich, nicht mehr neu zeichnen.
        app.page.keepOnChange = true;
        store.deleteTournament(id);
        toast("Turnier gelöscht.");
        app.back("#/turniere");
      });
    },
  };
}

export function phasePage(app, id, phase) {
  const { store } = app;
  const guide = store.guide.phases.find((item) => item.phase === phase);
  if (!store.tournament(id) || !guide) return missing("Vorbereitung", "#/turniere");
  return {
    title: guide.title,
    tab: "turniere",
    parent: `#/turniere/${encodeURIComponent(id)}`,
    keepOnChange: true,
    render() {
      const tournament = store.tournament(id);
      return html`
        <p class="goal">${guide.goal}</p>
        <p class="note">${guide.timing}</p>
        ${guide.sections.map((section) =>
          chapter(
            section.title,
            html`<ul class="rows">${section.items.map((item) => {
              const key = checklistKey(guide.phase, section.title, item);
              const isDone = tournament?.checkedItems.includes(key) ?? false;
              return html`<li><button type="button" class="row checklist${isDone ? " done" : ""}" aria-pressed="${String(isDone)}" data-item="${key}">
                ${check(isDone)}<span class="row-main row-title">${item}</span>
              </button></li>`;
            })}</ul>`,
          ),
        )}
      `;
    },
    mount(root) {
      root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-item]");
        if (!button) return;
        store.toggleChecklistItem(id, button.dataset.item);
        const isDone = store.tournament(id)?.checkedItems.includes(button.dataset.item) ?? false;
        // An Ort und Stelle umschalten, damit Liste und Fokus bleiben.
        button.classList.toggle("done", isDone);
        button.setAttribute("aria-pressed", String(isDone));
        const box = button.querySelector(".check");
        box.classList.toggle("on", isDone);
        box.textContent = isDone ? "✓" : "";
      });
    },
  };
}

/** Einspielplan als Fahrplan: Uhrzeiten links, der Start in Fahnenrot. */
export function warmUpPage(app, id) {
  const { store } = app;
  if (!store.tournament(id)) return missing("Einspielen", "#/turniere");
  return {
    title: "Einspielen",
    tab: "turniere",
    parent: `#/turniere/${encodeURIComponent(id)}`,
    render() {
      const tournament = store.tournament(id);
      return chapter(
        null,
        html`<ul class="rows timetable">
          ${warmUpSchedule(store.guide, tournament.start).map(
            ({ start, step }) => html`<li class="row">
              <span class="time">${formatTime(start)}</span>
              <span class="row-main">
                <span class="row-title">${step.title}</span>
                <span class="kicker">${step.minutes} Min.</span>
                <span class="row-sub">${step.details}</span>
              </span>
            </li>`,
          )}
          <li class="row start"><span class="time">${formatTime(tournament.start)}</span><span class="row-main row-title">Start</span></li>
        </ul>`,
        {
          footer:
            "Auf Turnieren wärmen sich gute Spieler im Schnitt deutlich länger auf als vor einer normalen Trainingseinheit. Die Range kommt bewusst zuletzt, damit Rhythmus und Gefühl beim ersten Abschlag frisch sind.",
        },
      );
    },
  };
}

/** Vorschlag für ein neues Turnier: in einer Woche um 9 Uhr. */
function defaultStart() {
  const inAWeek = addDays(new Date(), 7);
  return new Date(inAWeek.getFullYear(), inAWeek.getMonth(), inAWeek.getDate(), 9, 0, 0, 0);
}

export function tournamentEditor(app, id) {
  const { store } = app;
  const existing = id ? store.tournament(id) : null;
  if (id && !existing) return missing("Turnier", "#/turniere");
  const tournament = existing
    ? { ...existing, checkedItems: [...existing.checkedItems] }
    : { id: newID(), name: "", course: "", start: defaultStart(), days: 1, checkedItems: [] };
  const parent = existing ? `#/turniere/${encodeURIComponent(id)}` : "#/turniere";
  return {
    title: existing ? existing.name || "Turnier" : "Neues Turnier",
    tab: "turniere",
    parent,
    keepOnChange: true,
    render() {
      return html`<form class="editor" novalidate>
        <label class="field"><span>Name</span><input name="name" value="${tournament.name}" placeholder="z. B. Jugendmeisterschaft" autocomplete="off" required></label>
        <label class="field"><span>Platz</span><input name="course" value="${tournament.course}" autocomplete="off"></label>
        <div class="field-row">
          <label class="field"><span>Erster Tag</span><input type="date" name="date" value="${toDateInput(tournament.start)}" required></label>
          <label class="field"><span>Erste Startzeit</span><input type="time" name="time" value="${toTimeInput(tournament.start)}" required></label>
        </div>
        <label class="field"><span>Turniertage</span>
          <select name="days">${[1, 2, 3, 4].map((value) => html`<option value="${value}" ${value === tournament.days ? "selected" : ""}>${value}</option>`)}</select>
        </label>
        <p class="note">Aus der Startzeit berechnet die App den Einspielplan.</p>
        <div class="buttons">
          <button type="submit" class="button flag" data-save>Sichern</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      const saveButton = root.querySelector("[data-save]");
      const update = () => {
        saveButton.disabled = form.elements.name.value.trim() === "" || !form.elements.date.value;
      };
      update();
      form.addEventListener("input", update);
      root.querySelector("[data-cancel]").addEventListener("click", () => app.back(parent));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        update();
        if (saveButton.disabled) return;
        const saved = {
          ...tournament,
          name: form.elements.name.value.trim(),
          course: form.elements.course.value.trim(),
          start: fromInputs(form.elements.date.value, form.elements.time.value || "09:00"),
          days: Number(form.elements.days.value) || 1,
        };
        store.upsertTournament(saved);
        toast(existing ? "Turnier gesichert." : "Turnier hinzugefügt. Die Vorschläge sind angepasst.");
        app.back(parent);
      });
    },
  };
}

// MARK: - Runden

/** Werte außerhalb sind Tippfehler, z. B. „125“ statt „1,25“. */
const STROKES_GAINED_LIMIT = 30;

export function roundEditor(app, id) {
  const { store } = app;
  const existing = id ? store.data.rounds.find((round) => round.id === id) : null;
  if (id && !existing) return missing("Runde", "#/turniere");
  const round = existing ? { ...existing, strokesGained: { ...existing.strokesGained } } : { id: newID(), date: new Date(), course: "", score: null, strokesGained: {} };
  return {
    title: existing ? existing.course || "Runde" : "Neue Runde",
    tab: "turniere",
    parent: "#/turniere",
    keepOnChange: true,
    render() {
      return html`<form class="editor" novalidate>
        <label class="field"><span>Datum</span><input type="date" name="date" value="${toDateInput(round.date)}" required></label>
        <label class="field"><span>Platz</span><input name="course" value="${round.course}" autocomplete="off"></label>
        <label class="field"><span>Schläge</span><input name="score" inputmode="numeric" value="${round.score ?? ""}" autocomplete="off"></label>
        ${chapter(
          "Strokes Gained aus bebrassie",
          html`${SG_CATEGORIES.map(
            (category) => html`<label class="field"><span>${SG_NAMES[category]}</span><input name="${category}" inputmode="decimal" placeholder="z. B. -1,2" value="${round.strokesGained[category] != null ? formatDecimal(round.strokesGained[category]) : ""}" autocomplete="off"></label>`,
          )}`,
        )}
        <p class="note" data-hint>Negativ heißt: In diesem Bereich hast du Schläge verloren. Die App nutzt nur Runden, bei denen alle vier Werte eingetragen sind.</p>
        <div class="buttons">
          <button type="submit" class="button flag" data-save>Sichern</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
        ${existing ? html`<button type="button" class="action danger" data-delete>Runde löschen</button>` : ""}
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      const saveButton = root.querySelector("[data-save]");
      const hint = root.querySelector("[data-hint]");
      const defaultHint = hint.textContent;
      /** Felder mit Text, der keine gültige Zahl ist. */
      const invalidFields = () => {
        const fields = [];
        const score = form.elements.score.value.trim();
        if (score && !(/^\d+$/.test(score) && Number(score) >= 1 && Number(score) <= 300)) fields.push("Schläge");
        for (const category of SG_CATEGORIES) {
          const text = form.elements[category].value.trim();
          if (!text) continue;
          const value = parseDecimal(text);
          if (value == null || Math.abs(value) > STROKES_GAINED_LIMIT) fields.push(SG_NAMES[category]);
        }
        if (!form.elements.date.value) fields.push("Datum");
        return fields;
      };
      const update = () => {
        const invalid = invalidFields();
        saveButton.disabled = invalid.length > 0;
        hint.textContent = invalid.length ? `Bitte prüfen: ${invalid.join(", ")}. Zahlen mit Komma oder Punkt, z. B. -1,25.` : defaultHint;
        hint.classList.toggle("flag", invalid.length > 0);
        for (const name of ["score", ...SG_CATEGORIES]) {
          const label = name === "score" ? "Schläge" : SG_NAMES[name];
          form.elements[name].setAttribute("aria-invalid", String(invalid.includes(label)));
        }
      };
      update();
      form.addEventListener("input", update);
      root.querySelector("[data-cancel]").addEventListener("click", () => app.back("#/turniere"));
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({ title: "Runde löschen?", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
        if (choice !== "delete") return;
        store.deleteRound(round.id);
        toast("Runde gelöscht.");
        app.back("#/turniere");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        update();
        if (saveButton.disabled) return;
        const strokesGained = {};
        for (const category of SG_CATEGORIES) {
          const value = parseDecimal(form.elements[category].value);
          if (value != null) strokesGained[category] = value;
        }
        const score = form.elements.score.value.trim();
        store.upsertRound({
          ...round,
          // Nur der Tag ändert sich, die Uhrzeit bleibt.
          date: fromInputs(form.elements.date.value, toTimeInput(round.date)),
          course: form.elements.course.value.trim(),
          score: score ? Number(score) : null,
          strokesGained,
        });
        toast(existing ? "Runde gesichert." : "Runde eingetragen.");
        app.back("#/turniere");
      });
    },
  };
}
