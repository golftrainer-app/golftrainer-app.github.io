// Tab „Start“, wie HomeView in der App: oben der Überblick der Saison mit
// Handicap, Golftagen, Runden, Training und Serie, darunter der Kalender mit
// allem, was war und was ansteht, der gewählte Tag und „Demnächst“. Auf
// breiten Bildschirmen stehen Kalender und Tag nebeneinander. Dazu die Seiten
// Golftag, Handicap und eigener Termin. Gerechnet wird in core/agenda.js und
// core/season.js wie im Kern der App.
import {
  ATTENTION_DAYS, SHORT_WEEKDAYS, dayMonthText, dayTitle, isoWeekday, longDateText, marksFor, monthGrid, monthTitle, rangeTitle, shortDayText, weekLine, weekNumber, weekOf,
} from "../core/agenda.js";
import { APPOINTMENT_KINDS, APPOINTMENT_KIND_NAMES, APPOINTMENT_MINUTES, appointmentTitle } from "../core/appointments.js";
import { totalMinutes } from "../core/calendar.js";
import { weekdayName } from "../core/categories.js";
import { addDays, formatTime, fromInputs, startOfDay, toDateInput, toTimeInput } from "../core/dates.js";
import { bestHandicap, handicapChange, handicapChangeText, handicapText, parseHandicap, sortedHandicaps } from "../core/handicap.js";
import { handicapDetail, hoursText, weeksText } from "../core/season.js";
import { ANSWERS, ANSWER_NAMES, dateOf, uid } from "../core/team.js";
import { PHASE_NAMES } from "../core/tournament.js";
import { ask, chapter, countText, countdown, durationText, empty, html, markField, progress, toast } from "../ui.js";
import { runningMinutes } from "./diary.js";
import { drillRows, golfWeekQuestion, golfWeekQuestionClick, listenForMinutes, minutesChoice } from "./week.js";

/** Woche oder Monat, der gezeigte und der gewählte Tag. Bleibt, bis die Seite neu lädt. */
const view = { mode: "week", today: null, shown: null, selected: null };

/** Ältere Einträge im Handicap zeigen. */
let showsAllHandicaps = false;

/** Heute neu setzen, z. B. wenn die Seite über Nacht offen war. Gezeigter und gewählter Tag gehen mit, wenn sie auf heute standen. */
function syncToday(today) {
  if (view.today && view.today.getTime() === today.getTime()) return;
  if (!view.selected || (view.today && view.selected.getTime() === view.today.getTime())) view.selected = today;
  if (!view.shown || (view.today && view.shown.getTime() === view.today.getTime())) view.shown = today;
  view.today = today;
}

const dayKeyOf = (day) => toDateInput(day);

/** Tag aus einer Adresse oder einem Knopf, z. B. „2026-10-16“. Null, wenn er nicht stimmen kann. */
function dayFromKey(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text ?? ""))) return null;
  const day = fromInputs(text);
  return Number.isFinite(day.getTime()) ? startOfDay(day) : null;
}

function timeText(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// MARK: - Startseite

export function homePage(app) {
  const { store } = app;
  return {
    title: "Start",
    tab: "start",
    parent: null,
    render() {
      if (!store.data.golfWeek) return golfWeekQuestion();
      const now = new Date();
      const today = startOfDay(now);
      syncToday(today);
      const team = app.team?.agendaTeam(now) ?? null;
      const weeks = view.mode === "week" ? [weekOf(view.shown)] : monthGrid(view.shown);
      const first = weeks[0][0];
      const last = weeks[weeks.length - 1][6];
      const gridItems = store.agenda(first, addDays(last, 1), { team, now });
      const nearItems = store.agenda(today, addDays(today, 8), { team, now });
      const overview = store.seasonOverview({ team, now });
      const byDay = new Map();
      for (const item of [...gridItems, ...nearItems]) {
        const key = item.day.getTime();
        const list = byDay.get(key) ?? [];
        if (!list.some((other) => other.id === item.id)) list.push(item);
        byDay.set(key, list);
      }
      const context = { app, now, today, team };
      return html`<div class="home">
        <div class="home-main">
          <div class="home-head">
            <h1 class="headline">${dayTitle(now)}</h1>
            <p class="kicker">${weekLine(nearItems, now)}</p>
          </div>
          ${runningRow(store, now)}
          ${focusNotice(app)}
          ${seasonChapter(store, overview, now)}
          ${calendarChapter(store, weeks, marksFor(gridItems), today)}
        </div>
        <div class="home-side">
          ${dayChapter(context, byDay.get(view.selected.getTime()) ?? [])}
          ${chapter("Demnächst", agendaList(context, nearItems.filter((item) => item.day > today).slice(0, 10), true, "In den nächsten 7 Tagen steht nichts an."))}
          ${trainingChapter(store)}
        </div>
      </div>`;
    },
    mount(root) {
      root.addEventListener("click", (event) => {
        if (golfWeekQuestionClick(app, event.target)) return;
        const dayButton = event.target.closest("[data-select-day]");
        if (dayButton) {
          const day = dayFromKey(dayButton.dataset.selectDay);
          if (day) {
            view.selected = day;
            app.render({ keepScroll: true });
          }
          return;
        }
        const answer = event.target.closest("[data-answer]");
        if (answer) {
          const item = app.team?.data.event(answer.dataset.event);
          if (item) app.team.respond(item, answer.dataset.answer);
          return;
        }
        const button = event.target.closest("[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
          case "mode":
            view.mode = button.dataset.mode === "month" ? "month" : "week";
            // Zurück zur Woche: die Woche des gewählten Tags.
            if (view.mode === "week") view.shown = view.selected;
            break;
          case "step":
            step(Number(button.dataset.step));
            break;
          case "today":
            view.shown = view.today;
            view.selected = view.today;
            break;
          case "regenerate":
            store.regeneratePlan();
            toast("Die Vorschläge sind neu erstellt.");
            return;
          case "start-training":
            store.startTraining();
            toast("Die Stoppuhr läuft. Beenden kannst du sie im Tagebuch.");
            return;
          default:
            return;
        }
        app.render({ keepScroll: true });
      });
      // Die Team-Seiten zeichnen nur bei Änderungen am Team neu, die Startseite zeigt sie auch.
      return app.team?.subscribe(() => app.render({ keepScroll: true })) ?? null;
    },
  };
}

/** Eine Woche oder einen Monat weiter. In der Woche wandert der gewählte Tag mit, im Monat steht er auf heute oder dem Ersten. */
function step(direction) {
  if (!Number.isFinite(direction) || direction === 0) return;
  if (view.mode === "week") {
    view.shown = addDays(view.shown, 7 * direction);
    view.selected = addDays(view.selected, 7 * direction);
    return;
  }
  const month = new Date(view.shown.getFullYear(), view.shown.getMonth() + direction, 1);
  view.shown = month;
  const sameMonth = view.today.getFullYear() === month.getFullYear() && view.today.getMonth() === month.getMonth();
  view.selected = sameMonth ? view.today : month;
}

function runningRow(store, now) {
  const running = store.running;
  if (!running) return "";
  return html`<ul class="rows home-running"><li><a class="row" href="#/tagebuch">
    <span class="row-main"><span class="row-title flag">Training läuft</span><span class="row-sub">seit ${formatTime(running.start)} Uhr · Beenden im Tagebuch</span></span>
    <span class="row-value flag">${durationText(runningMinutes(running, now))}</span>
  </a></li></ul>`;
}

/** Neuer Schwerpunkt vom Trainer, den die Vorschläge noch nicht kennen. */
function focusNotice(app) {
  const missing = app.team?.isInTeam ? app.team.focusMissingInPlan() : [];
  if (missing.length === 0) return "";
  return chapter(
    null,
    html`<p class="kicker flag">Neuer Schwerpunkt vom Trainer</p>
    <button class="action" type="button" data-action="regenerate" data-key="regenerate">${missing.map((point) => point.text).join(", ")}. Vorschläge neu erstellen<span class="mark" aria-hidden="true">→</span></button>`,
  );
}

/** Kleine Kurve des Handicaps im Jahr: Stufen in Tinte, der Wert heute als Punkt in Fahnenrot. */
function sparkline(points, start, end) {
  if (points.length < 2) return "";
  const width = 150;
  const height = 34;
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const middle = (low + high) / 2;
  const span = Math.max(high - low, 1);
  const duration = Math.max(end.getTime() - start.getTime(), 1);
  const x = (date) => 3 + (width - 6) * Math.min(Math.max((date.getTime() - start.getTime()) / duration, 0), 1);
  const y = (value) => 3 + (height - 8) * (0.5 - (value - middle) / span);
  const coordinates = [[x(points[0].date), y(points[0].value)]];
  for (const point of points.slice(1)) {
    coordinates.push([x(point.date), coordinates[coordinates.length - 1][1]]);
    coordinates.push([x(point.date), y(point.value)]);
  }
  const lastY = y(points[points.length - 1].value);
  coordinates.push([x(end), lastY]);
  const text = coordinates.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  return html`<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <line x1="0" y1="${height - 0.5}" x2="${width}" y2="${height - 0.5}"></line>
    <polyline points="${text}"></polyline>
    <circle cx="${x(end).toFixed(1)}" cy="${lastY.toFixed(1)}" r="3"></circle>
  </svg>`;
}

function seasonChapter(store, overview, now) {
  const yearStart = new Date(overview.year, 0, 1);
  const handicap = overview.handicap;
  const tournament = overview.nextTournamentID ? store.tournament(overview.nextTournamentID) : null;
  const daysUntil = overview.daysUntilNextTournament;
  const soon = daysUntil != null && daysUntil <= ATTENTION_DAYS;
  return chapter(
    `Saison ${overview.year}`,
    html`<div class="figures season">
      <a class="season-handicap" href="${handicap ? "#/start/handicap" : "#/start/handicap/neu"}">
        <p class="figure huge">${handicap ? handicapText(handicap.value) : "–"}</p>
        <p class="kicker ink">Handicap</p>
        <p class="small ${handicap ? "secondary" : "strong"}">${handicap ? handicapDetail(overview, now) : "Eintragen +"}</p>
        ${sparkline(overview.handicapPoints, yearStart, now)}
      </a>
      <a class="season-side" href="#/statistik" aria-label="Golftage ${overview.golfDays}, Runden ${overview.rounds}, Training ${hoursText(overview.trainingMinutes)}, Serie ${weeksText(overview.streakWeeks)}. Zur Statistik">
        <ul class="side-figures">
          <li><span class="kicker">Golftage</span><span class="side-figure">${overview.golfDays}</span></li>
          <li><span class="kicker">Runden</span><span class="side-figure">${overview.rounds}</span></li>
          <li><span class="kicker">Training</span><span class="side-figure">${hoursText(overview.trainingMinutes)}</span></li>
          <li><span class="kicker">Serie</span><span class="side-figure">${weeksText(overview.streakWeeks)}</span></li>
        </ul>
      </a>
    </div>
    ${tournament
      ? html`<a class="row season-tournament" href="#/turniere/${encodeURIComponent(tournament.id)}">
          <span class="kicker${soon ? " flag" : ""}">Turnier</span>
          <span class="season-countdown${soon ? " flag" : ""}">${countdown(daysUntil, tournament.days)}</span>
          <span class="row-main row-sub">${tournament.name || "Turnier"} · ${shortDayText(tournament.start)}</span>
        </a>`
      : ""}`,
  );
}

function calendarChapter(store, weeks, marks, today) {
  const first = weeks[0][0];
  const last = weeks[weeks.length - 1][6];
  const isWeek = view.mode === "week";
  const showsToday = isWeek ? today >= first && today <= last : today.getFullYear() === view.shown.getFullYear() && today.getMonth() === view.shown.getMonth();
  const plan = store.data.weekPlan;
  let summary = "";
  if (isWeek && plan && plan.sessions.length > 0 && startOfDay(plan.weekStart).getTime() === first.getTime()) {
    const progressBySession = [...store.planProgress().values()];
    const done = progressBySession.reduce((sum, item) => sum + item.done, 0);
    const total = progressBySession.reduce((sum, item) => sum + item.total, 0);
    const minutes = plan.sessions.reduce((sum, session) => sum + totalMinutes(session), 0);
    summary = html`<div class="home-week">
      <p class="figure">${durationText(minutes)}<span class="unit">vorgeschlagen</span></p>
      ${progress(done, Math.max(total, 1), { label: `${done} von ${total} Übungen erledigt` })}
      <p class="small secondary">${done} von ${countText(total, "Übung", "Übungen")} erledigt</p>
    </div>`;
  }
  const hasGolfDays = (store.data.golfWeek?.golfDays ?? []).some((day) => !(store.data.golfWeek?.teamDays ?? []).includes(day.weekday));
  return chapter(
    "Kalender",
    html`<div class="choice" role="group" aria-label="Ansicht des Kalenders">
        <button type="button" data-action="mode" data-mode="week" data-key="mode-week" aria-pressed="${isWeek}">Woche</button>
        <button type="button" data-action="mode" data-mode="month" data-key="mode-month" aria-pressed="${!isWeek}">Monat</button>
      </div>
      <div class="calendar-nav">
        <button type="button" class="calendar-step" data-action="step" data-step="-1" data-key="step-back" aria-label="${isWeek ? "Woche davor" : "Monat davor"}">‹</button>
        <span class="calendar-title">${isWeek ? rangeTitle(first, last) : monthTitle(view.shown)}${showsToday ? "" : html` <button type="button" class="calendar-today" data-action="today" data-key="today">Heute</button>`}</span>
        <button type="button" class="calendar-step" data-action="step" data-step="1" data-key="step-next" aria-label="${isWeek ? "Woche danach" : "Monat danach"}">›</button>
      </div>
      <div class="calendar">
        <div class="calendar-head" aria-hidden="true">${SHORT_WEEKDAYS.map((name) => html`<span>${name}</span>`)}</div>
        ${weeks.map((week) => html`<div class="calendar-week">${week.map((day) => dayCell(day, marks.get(day.getTime()), today, isWeek))}</div>`)}
      </div>
      <p class="calendar-legend" aria-hidden="true">
        <span><span class="day-mark done"></span>erledigt</span>
        <span><span class="day-mark planned"></span>geplant</span>
        <span><span class="legend-bar"></span>Turnier</span>
      </p>
      ${summary}
      ${hasGolfDays
        ? html`<a class="action" href="#/woche">Wochenplan<span class="mark" aria-hidden="true">→</span></a>`
        : html`<a class="action" href="#/mehr">Golftage wählen<span class="mark" aria-hidden="true">→</span></a>`}`,
  );
}

function dayCell(day, marks, today, isWeek) {
  const inMonth = isWeek || (day.getFullYear() === view.shown.getFullYear() && day.getMonth() === view.shown.getMonth());
  const isToday = day.getTime() === today.getTime();
  const isSelected = day.getTime() === view.selected.getTime();
  const label = [dayTitle(day)];
  if (isToday) label.push("heute");
  if (inMonth && marks?.count) {
    label.push(countText(marks.count, "Eintrag", "Einträge"));
    if (marks.isTournamentDay) label.push("Turniertag");
  } else if (inMonth) {
    label.push("nichts eingetragen");
  }
  const classes = ["day", isToday ? "today" : "", inMonth ? "" : "outside", isSelected ? "selected" : ""].filter(Boolean).join(" ");
  return html`<button type="button" class="${classes}" data-select-day="${dayKeyOf(day)}" data-key="day-${dayKeyOf(day)}" aria-pressed="${isSelected}" aria-label="${label.join(", ")}" ${inMonth ? "" : "disabled"}>
    <span class="day-number">${day.getDate()}</span>
    <span class="day-marks" aria-hidden="true">${inMonth ? (marks?.marks ?? []).map((mark) => html`<span class="day-mark ${mark}"></span>`) : ""}</span>
    ${inMonth && marks?.isTournamentDay ? html`<span class="day-bar" aria-hidden="true"></span>` : ""}
  </button>`;
}

function dayChapter(context, items) {
  const day = view.selected;
  const isToday = day.getTime() === context.today.getTime();
  return chapter(
    html`${dayTitle(day)}${isToday ? html` <span class="flag">· Heute</span>` : ""}`,
    html`${agendaList(context, items, false, "Nichts eingetragen.")}
      <a class="action" href="#/start/termine/neu/${dayKeyOf(day)}">Termin eintragen<span class="mark" aria-hidden="true">+</span></a>
      ${day <= context.today ? html`<a class="action" href="#/start/training/${dayKeyOf(day)}">Training eintragen<span class="mark" aria-hidden="true">+</span></a>` : ""}`,
  );
}

/** Wohin ein Eintrag führt. Null, wenn es dort nichts zu sehen gibt, z. B. bei einem Platzhalter aus der Golfwoche. */
function linkOf(store, item) {
  const id = encodeURIComponent(item.reference);
  switch (item.kind) {
    case "tournament":
      return `#/turniere/${id}`;
    case "golfDay":
      return store.session(item.reference) ? `#/start/golftag/${id}` : null;
    case "coachSession":
      return `#/team/einheiten/${id}`;
    case "teamEvent":
      return `#/team/termine/${id}`;
    case "appointment":
      return `#/start/termine/${id}`;
    case "round":
      return `#/runden/${id}`;
    case "training":
      // Übungen aus dem Plan entstehen von selbst, sie stehen im Tagebuch.
      return store.data.trainingLog.some((entry) => entry.id === item.reference) ? `#/tagebuch/${id}` : "#/tagebuch";
    default:
      return null;
  }
}

/** Ein Termin des Teams, der nach einer Antwort fragt und noch keine hat. */
function unansweredEvent(context, item) {
  const team = context.app.team;
  if (item.kind !== "teamEvent" || !context.team?.answersEvents || !team?.myMemberID) return null;
  const event = team.data.event(item.reference);
  const start = dateOf(event?.start);
  if (!event || !start || event.asksForResponse !== true || event.isCancelled === true) return null;
  const end = new Date(start.getTime() + (Number(event.minutes) || 0) * 60000);
  if (end <= context.now || team.data.response(team.myMemberID, uid(event.id))) return null;
  return event;
}

function agendaList(context, items, showsDate, emptyText) {
  if (items.length === 0) return empty(emptyText);
  const { store } = context.app;
  return html`<ul class="rows agenda">${items.map((item) => {
    const href = linkOf(store, item);
    const time = item.time ? timeText(item.time) : "";
    const detail = showsDate && time ? [time, item.detail].filter(Boolean).join(" · ") : item.detail;
    const leading = showsDate
      ? html`<span class="agenda-date"><span class="kicker">${SHORT_WEEKDAYS[isoWeekday(item.day) - 1]}</span><span class="agenda-day">${item.day.getDate()}</span></span>`
      : html`<span class="agenda-time">${time}</span>`;
    const body = html`${leading}
      <span class="row-main">
        <span class="row-title${item.mark ? "" : " secondary"}">${item.title}</span>
        ${detail ? html`<span class="row-sub">${detail}</span>` : ""}
      </span>
      ${item.status ? html`<span class="agenda-status ${item.tone}">${item.status}</span>` : ""}`;
    const event = unansweredEvent(context, item);
    return html`<li>
      ${href ? html`<a class="row agenda-row" href="${href}">${body}</a>` : html`<div class="row agenda-row">${body}</div>`}
      ${event
        ? html`<div class="buttons compact answers" role="group" aria-label="Antwort zu ${item.title}">${ANSWERS.map(
            (answer) => html`<button type="button" class="button outline" data-answer="${answer}" data-event="${uid(event.id)}" data-key="answer-${uid(event.id)}-${answer}">${ANSWER_NAMES[answer]}</button>`,
          )}</div>`
        : ""}
    </li>`;
  })}</ul>`;
}

/** Tagebuch, Statistik und Stoppuhr, wie die Knöpfe in der Leiste der App. */
function trainingChapter(store) {
  return chapter(
    "Training",
    html`<ul class="rows">
        <li><a class="row" href="#/tagebuch">
          <span class="row-main"><span class="row-title">Trainingstagebuch</span><span class="row-sub">Stoppuhr, eigene Einheiten und die Übungen aus den Vorschlägen</span></span>
        </a></li>
        <li><a class="row" href="#/statistik">
          <span class="row-main"><span class="row-title">Meine Statistik</span><span class="row-sub">Zeit pro Woche, Serie, Bereiche und Monatstests</span></span>
        </a></li>
      </ul>
      ${store.running ? "" : html`<button class="action" type="button" data-action="start-training" data-key="start-training">Stoppuhr starten<span class="mark" aria-hidden="true">▶</span></button>`}`,
  );
}

// MARK: - Golftag

/** Ein Golftag aus dem Wochenplan: die geplante Zeit groß, die Übungen und die Zeit an diesem Tag. */
export function golfDayPage(app, slotID) {
  const { store } = app;
  const session = store.session(slotID);
  if (!session) {
    return { title: "Golftag", tab: "start", parent: "#/start", render: () => empty("Nicht mehr im Plan. Die Vorschläge der Woche sind neu, den Golftag findest du wieder im Kalender.") };
  }
  const base = `#/start/golftag`;
  return {
    title: weekdayName(session.slot.weekday),
    tab: "start",
    parent: "#/start",
    render() {
      const current = store.session(slotID) ?? session;
      const now = new Date();
      const isToday = startOfDay(current.date).getTime() === startOfDay(now).getTime();
      const progressOf = store.planProgress().get(current.slot.id) ?? { done: 0, total: current.drills.length };
      return html`<div class="headline-block">
          <p class="kicker">${dayMonthText(current.date)} · KW ${weekNumber(current.date)}${isToday ? html` <span class="flag-text">· Heute</span>` : ""}</p>
          <h1 class="headline">${weekdayName(current.slot.weekday)}</h1>
        </div>
        <div class="week-summary">
          <p class="figure big">${durationText(totalMinutes(current))}<span class="unit">geplant</span></p>
          ${progress(progressOf.done, Math.max(progressOf.total, 1), { label: `${progressOf.done} von ${progressOf.total} Übungen erledigt` })}
          <p class="small secondary">${progressOf.done} von ${countText(progressOf.total, "Übung", "Übungen")} erledigt</p>
          ${current.tournament ? html`<p class="small secondary">${PHASE_NAMES[current.tournament.phase] ?? ""}: Die Vorschläge sind auf Turniervorbereitung umgestellt.</p>` : ""}
        </div>
        ${chapter(
          "Übungen",
          html`<ul class="rows">${drillRows(store, current, base)}</ul>
            ${minutesChoice(store, current.slot.weekday)}
            ${isToday && !store.running ? html`<button class="action" type="button" data-action="start-training" data-key="start-training">Stoppuhr starten<span class="mark" aria-hidden="true">▶</span></button>` : ""}`,
          { footer: "Die Vorschläge kommen aus deiner Golfwoche. Was an einem Tag zu kurz kommt, holen die nächsten Golftage nach." },
        )}`;
    },
    mount(root) {
      root.addEventListener("click", (event) => {
        if (!event.target.closest("[data-action='start-training']")) return;
        store.startTraining();
        toast("Die Stoppuhr läuft. Beenden kannst du sie im Tagebuch.");
      });
      listenForMinutes(root, store);
    },
  };
}

// MARK: - Handicap

/** Verlauf im Jahr als Stufen mit den Monaten darunter. */
function handicapChart(points, start, end) {
  if (points.length < 2) return "";
  const width = 340;
  const height = 150;
  const left = 30;
  const right = 6;
  const top = 10;
  const bottom = 24;
  const values = points.map((point) => point.value);
  const low = Math.floor(Math.min(...values));
  const high = Math.max(low + 1, Math.ceil(Math.max(...values)));
  const duration = Math.max(end.getTime() - start.getTime(), 1);
  const x = (date) => left + (width - left - right) * Math.min(Math.max((date.getTime() - start.getTime()) / duration, 0), 1);
  const y = (value) => top + (height - top - bottom) * (1 - (value - low) / (high - low));
  const coordinates = [[x(points[0].date), y(points[0].value)]];
  for (const point of points.slice(1)) {
    coordinates.push([x(point.date), coordinates[coordinates.length - 1][1]]);
    coordinates.push([x(point.date), y(point.value)]);
  }
  const lastY = y(points[points.length - 1].value);
  coordinates.push([x(end), lastY]);
  const steps = high - low > 6 ? Math.ceil((high - low) / 4) : 1;
  const levels = [];
  for (let value = low; value <= high; value += steps) levels.push(value);
  const months = [];
  for (let month = new Date(start.getFullYear(), start.getMonth(), 1); month <= end; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) months.push(month);
  const label = `Handicap ${start.getFullYear()}: ${points.map((point) => `${dayMonthText(point.date)} ${handicapText(point.value)}`).join(", ")}`;
  return html`<svg class="handicap-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    ${levels.map((value) => html`<line class="grid" x1="${left}" y1="${y(value).toFixed(1)}" x2="${width - right}" y2="${y(value).toFixed(1)}"></line><text class="axis" x="0" y="${(y(value) + 3).toFixed(1)}">${handicapText(value).replace(",0", "")}</text>`)}
    <polyline points="${coordinates.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ")}"></polyline>
    ${points.slice(1).map((point) => html`<rect x="${(x(point.date) - 2.5).toFixed(1)}" y="${(y(point.value) - 2.5).toFixed(1)}" width="5" height="5"></rect>`)}
    <circle cx="${x(end).toFixed(1)}" cy="${lastY.toFixed(1)}" r="4"></circle>
    ${months.map((month) => html`<text class="axis" x="${x(month).toFixed(1)}" y="${height - 6}">${["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][month.getMonth()]}</text>`)}
  </svg>`;
}

export function handicapPage(app) {
  const { store } = app;
  return {
    title: "Handicap",
    tab: "start",
    parent: "#/start",
    render() {
      const now = new Date();
      const year = now.getFullYear();
      const yearStart = new Date(year, 0, 1);
      const overview = store.seasonOverview({ team: app.team?.agendaTeam(now) ?? null, now });
      const entries = sortedHandicaps(store.data.handicaps);
      const newestFirst = [...entries].reverse();
      const shown = showsAllHandicaps ? newestFirst : newestFirst.slice(0, 5);
      const current = overview.handicap;
      const change = handicapChange(yearStart, entries, now);
      const best = bestHandicap(yearStart, entries, now);
      const since = overview.handicapChangeSince;
      return html`<div class="headline-block">
          <p class="kicker">Saison ${year}</p>
          <h1 class="headline">Handicap</h1>
        </div>
        ${current
          ? html`<div class="figures">
              <div>
                <p class="figure huge">${handicapText(current.value)}</p>
                <p class="small secondary">seit ${longDateText(current.date)}</p>
              </div>
              <ul class="side-figures">
                ${change && since ? html`<li><span class="kicker">${since.getMonth() === 0 && since.getDate() === 1 ? "Seit Januar" : `Seit ${dayMonthText(since)}`}</span><span class="side-figure">${handicapChangeText(change.delta)}</span></li>` : ""}
                ${best ? html`<li><span class="kicker">Bestes</span><span class="side-figure">${handicapText(best.value)}</span></li>` : ""}
              </ul>
            </div>
            ${overview.handicapPoints.length > 1 ? chapter(`Verlauf ${year}`, handicapChart(overview.handicapPoints, yearStart, now)) : ""}`
          : empty("Noch kein Handicap eingetragen.")}
        ${chapter(
          "Einträge",
          html`<ul class="rows">${shown.map((entry) => {
              const index = entries.findIndex((other) => other.id === entry.id);
              const previous = index > 0 ? entries[index - 1] : null;
              const details = [previous ? handicapChangeText(entry.value - previous.value) : "erster Eintrag", entry.note].filter(Boolean).join(" · ");
              return html`<li><a class="row" href="#/start/handicap/${encodeURIComponent(entry.id)}">
                <span class="row-main"><span class="row-title">${longDateText(entry.date)}</span><span class="row-sub">${details}</span></span>
                <span class="row-value">${handicapText(entry.value)}</span>
              </a></li>`;
            })}</ul>
            ${!showsAllHandicaps && newestFirst.length > 5 ? html`<button class="action" type="button" data-action="all" data-key="all">Ältere Einträge<span class="mark" aria-hidden="true">▾</span></button>` : ""}
            <a class="action" href="#/start/handicap/neu">Handicap eintragen<span class="mark" aria-hidden="true">+</span></a>`,
          { footer: "Trag dein Handicap ein, wenn es sich ändert, z. B. nach einem Turnier. Es bleibt auf dem Gerät, mit Konto auch auf dem Server." },
        )}`;
    },
    mount(root) {
      root.addEventListener("click", (event) => {
        if (!event.target.closest("[data-action='all']")) return;
        showsAllHandicaps = true;
        app.render({ keepScroll: true });
      });
    },
  };
}

/** Eintragen oder ändern: der Wert, ab wann er gilt, und eine Notiz. `id`: „neu“ oder die Kennung. */
export function handicapEditor(app, id) {
  const { store } = app;
  const existing = id === "neu" ? null : store.handicap(id);
  if (id !== "neu" && !existing) return { title: "Handicap", tab: "start", parent: "#/start/handicap", render: () => empty("Diesen Eintrag gibt es nicht mehr.") };
  const entry = existing ? { ...existing } : store.newHandicapEntry();
  // Neu von der Startseite: danach zurück dorthin.
  const parent = existing || app.cameFrom("#/start/handicap") ? "#/start/handicap" : "#/start";
  const defaultHint = "Dein Handicap-Index, wie ihn dein Club nennt. Ein Plus-Handicap mit „+“ davor, z. B. +1,2.";
  return {
    title: existing ? "Handicap" : "Handicap eintragen",
    tab: "start",
    parent,
    keepOnChange: true,
    render() {
      return html`<form class="editor" novalidate>
        <label class="field"><span>Handicap</span><input name="value" value="${handicapText(entry.value)}" autocomplete="off" placeholder="z. B. 18,4" aria-describedby="handicap-hint"></label>
        <label class="field"><span>Gilt ab</span><input type="date" name="date" value="${toDateInput(entry.date)}" max="${toDateInput(new Date())}" required></label>
        <label class="field"><span>Notiz</span><input name="note" value="${entry.note}" maxlength="200" autocomplete="off" placeholder="z. B. nach dem Herbstpreis"></label>
        <p class="note" id="handicap-hint" aria-live="polite">${defaultHint}</p>
        <div class="buttons">
          <button type="submit" class="button flag" data-save>Sichern</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
        ${existing ? html`<button type="button" class="action danger" data-delete>Eintrag löschen</button>` : ""}
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      const hint = root.querySelector("#handicap-hint");
      const save = root.querySelector("[data-save]");
      const update = () => {
        const text = form.elements.value.value;
        const invalid = text.trim() !== "" && parseHandicap(text) == null;
        const missing = text.trim() === "" || !form.elements.date.value;
        const message = invalid ? "Bitte prüfen: ein Wert von +10 bis 54 mit Komma, z. B. 18,4. Ein Plus-Handicap mit „+“ davor, z. B. +1,2." : defaultHint;
        if (hint.textContent !== message) hint.textContent = message;
        hint.classList.toggle("flag", invalid);
        markField(form.elements.value, invalid, hint);
        save.disabled = invalid || missing;
      };
      update();
      form.addEventListener("input", update);
      root.querySelector("[data-cancel]").addEventListener("click", () => app.back(parent));
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({ title: "Eintrag löschen?", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
        if (choice !== "delete") return;
        store.deleteHandicap(entry.id);
        toast("Eintrag gelöscht.");
        app.back(parent);
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        update();
        const value = parseHandicap(form.elements.value.value);
        if (save.disabled || value == null) return;
        const day = fromInputs(form.elements.date.value);
        // 12 Uhr: So bleibt es in jeder Zeitzone derselbe Tag.
        store.saveHandicap({ ...entry, value, date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0), note: form.elements.note.value.trim() });
        toast(existing ? "Handicap gesichert." : "Handicap eingetragen.");
        app.back(parent);
      });
    },
  };
}

// MARK: - Eigene Termine

/** Eigener Termin, z. B. eine Trainerstunde. `id`: „neu“ mit `dayText` (JJJJ-MM-TT) oder die Kennung. */
export function appointmentEditor(app, id, dayText = null) {
  const { store } = app;
  const existing = id === "neu" ? null : store.appointment(id);
  if (id !== "neu" && !existing) return { title: "Termin", tab: "start", parent: "#/start", render: () => empty("Diesen Termin gibt es nicht mehr.") };
  const appointment = existing ? { ...existing } : store.newAppointment(dayFromKey(dayText) ?? startOfDay(new Date()));
  const minuteSteps = [];
  for (let value = 15; value <= 720; value += 15) minuteSteps.push(value);
  if (!minuteSteps.includes(appointment.minutes)) minuteSteps.push(appointment.minutes);
  minuteSteps.sort((a, b) => a - b);
  return {
    title: existing ? appointmentTitle(existing) : "Neuer Termin",
    tab: "start",
    parent: "#/start",
    keepOnChange: true,
    render() {
      const isPast = appointment.start <= new Date();
      return html`<form class="editor" novalidate>
        <label class="field"><span>Titel</span><input name="title" value="${appointment.title}" maxlength="100" autocomplete="off" placeholder="z. B. Trainerstunde"></label>
        <label class="field"><span>Art</span>
          <select name="kind">${APPOINTMENT_KINDS.map((kind) => html`<option value="${kind}" ${kind === appointment.kind ? "selected" : ""}>${APPOINTMENT_KIND_NAMES[kind]}</option>`)}</select>
        </label>
        <div class="field-row" data-when>
          <label class="field"><span>Datum</span><input type="date" name="date" value="${toDateInput(appointment.start)}" min="1970-01-01" max="2199-12-31" required></label>
          <label class="field"><span>Beginn</span><input type="time" name="time" value="${toTimeInput(appointment.start)}" required></label>
        </div>
        <label class="field"><span>Dauer</span>
          <select name="minutes">${minuteSteps.map((value) => html`<option value="${value}" ${value === appointment.minutes ? "selected" : ""}>${durationText(value)}</option>`)}</select>
        </label>
        <label class="field"><span>Ort</span><input name="place" value="${appointment.place}" maxlength="100" autocomplete="off" placeholder="z. B. Kurzplatz"></label>
        <label class="field"><span>Notiz</span><textarea name="note" rows="2" maxlength="1000">${appointment.note}</textarea></label>
        <p class="note">Eigene Termine siehst nur du. Nach dem Termin kannst du ihn mit einem Tipp ins Trainingstagebuch übernehmen.</p>
        ${appointment.trainingEntryID != null
          ? html`<p class="note">Steht im Trainingstagebuch.</p>`
          : isPast
            ? html`<button type="button" class="action" data-log>Ins Tagebuch übernehmen<span class="mark" aria-hidden="true">→</span></button>
              <p class="note">Legt einen Eintrag mit derselben Zeit und Dauer an. Bereiche und Anstrengung kannst du im Tagebuch ergänzen.</p>`
            : ""}
        <div class="buttons">
          <button type="submit" class="button flag" data-save>Sichern</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
        ${existing ? html`<button type="button" class="action danger" data-delete>Termin löschen</button>` : ""}
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      /** Was im Formular steht, oder null, wenn Datum oder Beginn fehlen. */
      const read = () => {
        const dateField = form.elements.date;
        const timeField = form.elements.time;
        const dateInvalid = !dateField.value || !Number.isFinite(fromInputs(dateField.value).getTime());
        const timeInvalid = !timeField.value;
        root.querySelector("[data-when-error]")?.remove();
        if (dateInvalid || timeInvalid) {
          const text = dateInvalid && timeInvalid ? "Bitte gib Datum und Beginn an." : dateInvalid ? "Bitte gib das Datum an." : "Bitte gib den Beginn an.";
          root.querySelector("[data-when]").insertAdjacentHTML("afterend", String(html`<p class="note flag" id="appointment-when-error" role="alert" data-when-error>${text}</p>`));
        }
        const message = root.querySelector("[data-when-error]");
        markField(dateField, dateInvalid, message);
        markField(timeField, timeInvalid, message);
        if (dateInvalid || timeInvalid) {
          (dateInvalid ? dateField : timeField).focus();
          return null;
        }
        const minutes = Number(form.elements.minutes.value);
        return {
          ...appointment,
          title: form.elements.title.value.trim(),
          kind: APPOINTMENT_KINDS.includes(form.elements.kind.value) ? form.elements.kind.value : "other",
          start: fromInputs(dateField.value, timeField.value),
          minutes: Number.isInteger(minutes) ? Math.min(APPOINTMENT_MINUTES[1], Math.max(APPOINTMENT_MINUTES[0], minutes)) : 60,
          place: form.elements.place.value.trim(),
          note: form.elements.note.value.trim(),
        };
      };
      root.querySelector("[data-cancel]").addEventListener("click", () => app.back("#/start"));
      root.querySelector("[data-log]")?.addEventListener("click", () => {
        const current = read();
        if (!current) return;
        if (current.start > new Date()) {
          toast("Der Termin liegt noch in der Zukunft.");
          return;
        }
        store.logAppointment(current);
        toast("Im Tagebuch eingetragen.");
        app.back("#/start");
      });
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({
          title: "Termin löschen?",
          message: appointment.trainingEntryID != null ? "Der Eintrag im Trainingstagebuch bleibt." : "",
          actions: [{ label: "Löschen", value: "delete", style: "danger" }],
        });
        if (choice !== "delete") return;
        store.deleteAppointment(appointment.id);
        toast("Termin gelöscht.");
        app.back("#/start");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const current = read();
        if (!current) return;
        store.saveAppointment(current);
        toast(existing ? "Termin gesichert." : "Termin eingetragen.");
        app.back("#/start");
      });
    },
  };
}
