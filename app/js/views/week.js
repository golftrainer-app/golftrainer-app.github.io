// Tab „Woche“: die Vorschläge dieser Woche wie WeekView in der App. Beim
// ersten Öffnen fragt die Seite nach der Golfwoche: an welchen Tagen
// Teamtraining ist und an welchen du sonst golfen kannst. Danach oben die
// vorgeschlagene Zeit und wie viel erledigt ist, dann die Bereiche und für
// jeden Golftag ein Vorschlag.
import { totalMinutes } from "../core/calendar.js";
import { AREAS, AREA_NAMES, MODE_NAMES, weekdayName } from "../core/categories.js";
import { addDays, formatTime, sameWeek } from "../core/dates.js";
import { MINUTE_RANGE, MINUTE_STEP, dayCount, emptyGolfWeek, hasOwnMinutes, minutesOn, setMinutes, suggestedMinutes } from "../core/golfweek.js";
import { PHASE_NAMES, phase as tournamentPhase } from "../core/tournament.js";
import { timeText } from "../core/reminders.js";
import { chapter, check, countdown, download, durationText, empty, html, isoWeek, progress, shareFile, toast } from "../ui.js";
import { applyGolfWeekClick, dayButtons, dayList, golfDays, golfWeekSummary, minutesRows } from "./golfweek.js";
import { runningMinutes } from "./diary.js";

const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

/** Antworten auf die Frage beim ersten Öffnen, bis „Weiter“. Die Seite wird bei jeder Änderung neu gezeichnet. */
let draft = null;

function isToday(date, now) {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function weekPage(app) {
  const { store } = app;
  return {
    title: "Diese Woche",
    tab: "woche",
    parent: null,
    render() {
      const now = new Date();
      const week = store.data.golfWeek;
      if (!week) return golfWeekQuestion();

      const plan = store.data.weekPlan;
      const sessions = plan?.sessions ?? [];
      const parts = [];

      if (sessions.length > 0) parts.push(summary(store, plan, week));

      const next = store.upcomingTournaments(now)[0];
      if (next && store.daysUntil(next, now) <= 7) parts.push(tournamentBanner(store, next, now));

      if (sessions.length > 0) {
        parts.push(
          chapter("Bereiche dieser Woche", weights(plan), {
            footer: "Ziel: der Anteil laut Strokes Gained und Schwerpunkten. Was in einer Woche zu kurz kommt, holen die Vorschläge in den nächsten Wochen nach.",
          }),
        );
        for (const session of sessions) parts.push(sessionChapter(store, session, now));
      } else {
        parts.push(
          chapter(
            null,
            empty(
              golfDays(week).length === 0
                ? withoutGolfDaysText(week)
                : "Diese Woche gibt es keine Vorschläge, z. B. weil an deinen Golftagen ein Turnier ist.",
            ),
          ),
        );
      }

      parts.push(trainingChapter(store, now));
      parts.push(
        chapter(
          "Vorschläge",
          html`<button class="action" type="button" data-action="regenerate" data-key="regenerate">Neue Vorschläge<span class="mark" aria-hidden="true">↻</span></button>
          ${sessions.length > 0 ? html`<button class="action" type="button" data-action="calendar" data-key="calendar">In den Kalender<span class="mark" aria-hidden="true">↓</span></button>` : ""}`,
          {
            footer: store.data.reminders.isEnabled
              ? `Neue Vorschläge behält Golftage, die vorbei sind oder schon Ergebnisse haben. „In den Kalender“ speichert die Golftage als Kalenderdatei, mit einer Erinnerung um ${timeText(store.data.reminders.hour, store.data.reminders.minute)} an jedem Golftag, auch für die nächsten zwei Wochen.`
              : "Neue Vorschläge behält Golftage, die vorbei sind oder schon Ergebnisse haben. „In den Kalender“ speichert die Golftage als Kalenderdatei, z. B. für den Samsung Kalender.",
          },
        ),
      );
      return html`${parts}`;
    },
    mount(root) {
      root.addEventListener("click", async (event) => {
        if (draft && applyGolfWeekClick(draft, event.target)) {
          app.render({ keepScroll: true });
          return;
        }
        const button = event.target.closest("[data-action]");
        if (!button) return;
        if (button.dataset.action === "golfweek-done") {
          const week = draft ?? emptyGolfWeek();
          draft = null;
          store.setGolfWeek(week);
          toast(golfDays(week).length > 0 ? "Gesichert. Für jeden Golftag steht jetzt ein Vorschlag da." : "Gesichert. Golftage legst du unter „Mehr“ fest.");
        } else if (button.dataset.action === "regenerate") {
          store.regeneratePlan();
          toast("Die Vorschläge sind neu erstellt.");
        } else if (button.dataset.action === "start-training") {
          store.startTraining();
          toast("Die Stoppuhr läuft. Beenden kannst du sie im Tagebuch.");
        } else if (button.dataset.action === "calendar") {
          const text = store.calendarText(new Date());
          if (!text) return;
          const shared = await shareFile("Golftage.ics", text, "text/calendar");
          if (!shared) {
            download("Golftage.ics", text, "text/calendar");
            toast("Golftage.ics ist in deinen Downloads. Tippe die Datei an, dann übernimmt der Kalender die Golftage.");
          }
        }
      });
      // Zeit für einen Golftag direkt beim Vorschlag ändern.
      root.addEventListener("change", (event) => {
        const select = event.target.closest("[data-session-minutes]");
        if (!select) return;
        const day = Number(select.dataset.sessionMinutes);
        const value = Number(select.value);
        store.updateGolfWeek((week) => setMinutes(week, day, value === 0 ? null : value));
        toast("Die Vorschläge sind angepasst.");
      });
    },
  };
}

/**
 * Erster Besuch: an welchen Tagen Teamtraining ist und an welchen du sonst
 * golfen kannst. Nichts ist vorausgewählt. Die Zeit pro Golftag trägt die App
 * als Vorschlag ein, du kannst sie gleich hier ändern.
 */
function golfWeekQuestion() {
  draft ??= emptyGolfWeek();
  const days = golfDays(draft);
  return html`<div class="question">
    <p class="kicker ink">Golf Trainer</p>
    <span class="flagmark" aria-hidden="true"></span>
    <h1 class="headline">Deine Golfwoche</h1>
    <p class="lead">Für jeden Golftag schlägt die App vor, was du trainierst. Das Teamtraining plant dein Trainer, dort schlägt sie nichts vor.</p>
    ${chapter("An welchen Tagen hast du festes Teamtraining?", dayButtons("team", draft.teamDays))}
    ${chapter("An welchen Tagen kannst du voraussichtlich öfter golfen?", dayButtons("golf", days, draft.teamDays))}
    ${days.length > 0
      ? chapter("Wie viel Zeit hast du an diesen Tagen?", html`<p class="note">Die App schlägt eine Zeit vor, je nachdem, wie oft du golfst. Du kannst sie für jeden Tag ändern.</p>${minutesRows(draft)}`)
      : ""}
    ${chapter(
      null,
      html`<button class="action" type="button" data-action="golfweek-done" data-key="golfweek-done">
        <span class="row-main"><span class="row-title">Weiter</span><span class="row-sub">${golfWeekSummary(draft)}</span></span>
        <span class="mark" aria-hidden="true">→</span>
      </button>`,
      { footer: "Du kannst das jederzeit unter „Mehr“ ändern. Alles, was du einträgst, bleibt in diesem Browser auf deinem Gerät." },
    )}
  </div>`;
}

/** Tagebuch und Stoppuhr, wie die Knöpfe in der Leiste der App. */
function trainingChapter(store, now) {
  const running = store.running;
  return chapter(
    "Training",
    html`<ul class="rows">
        ${running
          ? html`<li><a class="row" href="#/tagebuch">
              <span class="row-main"><span class="row-title flag">Training läuft</span><span class="row-sub">seit ${formatTime(running.start)} Uhr · Beenden im Tagebuch</span></span>
              <span class="row-value flag">${durationText(runningMinutes(running, now))}</span>
            </a></li>`
          : ""}
        <li><a class="row" href="#/tagebuch">
          <span class="row-main"><span class="row-title">Trainingstagebuch</span><span class="row-sub">Stoppuhr, eigene Einheiten und die Übungen aus den Vorschlägen</span></span>
        </a></li>
        <li><a class="row" href="#/statistik">
          <span class="row-main"><span class="row-title">Meine Statistik</span><span class="row-sub">Zeit pro Woche, Serie, Bereiche und Monatstests</span></span>
        </a></li>
      </ul>
      ${running ? "" : html`<button class="action" type="button" data-action="start-training" data-key="start-training">Stoppuhr starten<span class="mark" aria-hidden="true">▶</span></button>`}`,
  );
}

/** Ohne Golftage: was die App dann tut und wo man sie festlegt. */
function withoutGolfDaysText(week) {
  if (week.teamDays.length === 0) return "Wähle unter „Mehr“ die Tage, an denen du golfen kannst. Dann schlägt die App vor, was du trainierst.";
  return `Das Teamtraining am ${dayList(week.teamDays)} plant dein Trainer. Wähle unter „Mehr“ weitere Golftage, dann schlägt die App vor, was du dort trainierst.`;
}

/** Kopf der Woche: Kalenderwoche, die vorgeschlagene Zeit groß, wie viel erledigt ist und die Tage mit Teamtraining. */
function summary(store, plan, week) {
  const planned = plan.sessions.flatMap((session) => session.drills.filter((drill) => store.drill(drill.drillID)).map((drill) => [session, drill]));
  const done = planned.filter(([session, drill]) => store.resultFor(drill, session)).length;
  const minutes = plan.sessions.reduce((total, session) => total + totalMinutes(session), 0);
  const end = addDays(plan.weekStart, 6);
  return html`<div class="week-summary">
    <p class="kicker">KW ${isoWeek(plan.weekStart)} · ${dayMonth.format(plan.weekStart)} – ${dayMonth.format(end)}</p>
    <p class="figure big">${durationText(minutes)}<span class="unit">vorgeschlagen</span></p>
    ${progress(done, Math.max(planned.length, 1), { label: `${done} von ${planned.length} Übungen erledigt` })}
    <p class="small secondary">${done} von ${planned.length} Übungen erledigt</p>
    ${week.teamDays.length > 0 ? html`<p class="small secondary">Teamtraining am ${dayList(week.teamDays)}: Das plant dein Trainer.</p>` : ""}
  </div>`;
}

function tournamentBanner(store, tournament, now) {
  const days = store.daysUntil(tournament, now);
  const current = tournamentPhase(days, tournament.days);
  return chapter(
    "Turnier",
    html`<a class="row banner" href="#/turniere/${encodeURIComponent(tournament.id)}">
      <span class="row-main">
        <span class="countdown">${countdown(days, tournament.days)}</span>
        <span class="row-title big">${tournament.name || "Turnier"}</span>
        ${current && current !== "tournamentDay" ? html`<span class="row-sub">${PHASE_NAMES[current]}: Die Vorschläge sind auf Turniervorbereitung umgestellt.</span>` : ""}
      </span>
    </a>`,
    { flag: true },
  );
}

/** Was diese Woche in welchem Bereich vorgeschlagen ist, als Linien, dazu das Ziel. */
function weights(plan) {
  const minutes = {};
  for (const session of plan.sessions) {
    for (const [area, value] of Object.entries(session.areaMinutes)) minutes[area] = (minutes[area] ?? 0) + value;
  }
  const total = Math.max(1, Object.values(minutes).reduce((sum, value) => sum + value, 0));
  const areas = AREAS.filter((area) => (minutes[area] ?? 0) > 0 || (plan.weights[area] ?? 0) > 0);
  return html`<ul class="rows">${areas.map((area) => {
    const planned = minutes[area] ?? 0;
    const target = Math.round((plan.weights[area] ?? 0) * 100);
    return html`<li class="area-row">
      <div class="area-line"><span>${AREA_NAMES[area]}</span><span class="row-value">${durationText(planned)}</span></div>
      ${progress(planned, total, { label: `${AREA_NAMES[area]}: ${durationText(planned)}` })}
      <span class="row-sub">Ziel ${target} %</span>
    </li>`;
  })}</ul>`;
}

/** Zeit für einen Golftag: Vorschlag der App oder eine eigene Zeit. Leer, wenn der Tag kein Golftag mehr ist. */
function minutesChoice(store, weekday) {
  const week = store.data.golfWeek;
  const minutes = week ? minutesOn(week, weekday) : null;
  if (minutes == null) return "";
  const own = hasOwnMinutes(week, weekday);
  const suggested = suggestedMinutes(dayCount(week));
  const values = [];
  for (let value = MINUTE_RANGE[0]; value <= MINUTE_RANGE[1]; value += MINUTE_STEP) values.push(value);
  return html`<label class="field">
    <span>Zeit am ${weekdayName(weekday)}</span>
    <select data-session-minutes="${weekday}" data-key="minutes-${weekday}">
      <option value="0" ${own ? "" : "selected"}>Vorschlag der App: ${durationText(suggested)}</option>
      ${values.map((value) => html`<option value="${value}" ${own && value === minutes ? "selected" : ""}>${durationText(value)}</option>`)}
      ${own && !values.includes(minutes) ? html`<option value="${minutes}" selected>${durationText(minutes)}</option>` : ""}
    </select>
  </label>`;
}

function sessionChapter(store, session, now) {
  const today = isToday(session.date, now);
  const side = session.tournament ? PHASE_NAMES[session.tournament.phase] ?? "" : "";
  const rows = session.drills
    .map((planned) => {
      const drill = store.drill(planned.drillID);
      if (!drill) return null;
      const isDone = Boolean(store.resultFor(planned, session));
      const subtitle = [AREA_NAMES[drill.area], drill.isBenchmark ? "Monatstest" : MODE_NAMES[drill.mode]];
      if (drill.levels.length > 1) subtitle.push(`Stufe ${planned.level + 1}`);
      return html`<li>
        <a class="row drill${isDone ? " done" : ""}" href="#/woche/${encodeURIComponent(session.slot.id)}/${encodeURIComponent(drill.id)}" aria-label="${drill.name}, ${planned.minutes} Minuten, ${isDone ? "erledigt" : "offen"}">
          ${check(isDone)}
          <span class="row-main">
            <span class="row-title">${drill.name}</span>
            <span class="row-sub">${subtitle.join(" · ")}</span>
            ${planned.focusNotes.length ? html`<span class="row-focus">Fokus: ${planned.focusNotes.join(", ")}</span>` : ""}
          </span>
          <span class="minutes"><span class="row-value">${planned.minutes}</span><span class="kicker">Min.</span></span>
        </a>
      </li>`;
    })
    .filter(Boolean);
  const isPast = session.date < now && !today && sameWeek(session.date, now);
  return html`<section class="session${today ? " today" : ""}${isPast ? " past" : ""}">
    <div class="session-head">
      <span><span class="session-day">${weekdayName(session.slot.weekday)}</span> <span class="session-date">${dayMonth.format(session.date)}</span>${today ? html` <span class="kicker flag">Heute</span>` : ""}</span>
      <span class="level-badge">${side ? html`${side} · ` : ""}<span class="duration">${durationText(totalMinutes(session))}</span></span>
    </div>
    <ul class="rows">${rows}</ul>
    ${minutesChoice(store, session.slot.weekday)}
  </section>`;
}
