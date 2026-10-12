// „Meine Statistik“ wie TrainingStatsView in der App
// (App/Sources/Views/TrainingStatsView.swift): Zeit pro Woche, Serie,
// Bereiche der letzten 28 Tage und Monatstests. Alles aus dem Tagebuch und
// den Ergebnissen auf diesem Gerät.
import { AREAS, AREA_NAMES } from "../core/categories.js";
import { formatShortDate } from "../core/dates.js";
import { normalizedScoring } from "../core/scoring.js";
import { stats as buildStats } from "../core/stats.js";
import { chapter, durationText, headline, html, progress, scoreLabel } from "../ui.js";

const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

export function statsPage(app) {
  const { store } = app;
  return {
    title: "Statistik",
    tab: "woche",
    parent: "#/woche",
    render() {
      const stats = buildStats({ log: store.myTrainingLog(), results: store.data.results, library: store.library, now: new Date() });
      const assigned = Object.values(stats.areaMinutes).reduce((sum, minutes) => sum + minutes, 0);
      const unassigned = stats.minutesLast28Days - assigned;
      return html`
        ${headline("Meine Statistik", "Training")}
        <div class="stats-head">
          <div>
            <p class="kicker">Ø pro Woche</p>
            <p class="figure">${durationText(stats.averageMinutesPerWeek)}</p>
            <p class="small secondary">letzte 4 abgeschlossene Wochen</p>
          </div>
          <div class="stats-side">
            <p class="kicker">Serie</p>
            <p class="side-figure${stats.streakWeeks >= 4 ? " flag" : ""}">${stats.streakWeeks === 1 ? "1 Woche" : `${stats.streakWeeks} Wochen`}</p>
            <p class="small secondary">in Folge mit Training</p>
            <p class="kicker">Trainingstage</p>
            <p class="side-figure">${stats.trainingDaysLast28Days}</p>
            <p class="small secondary">letzte 28 Tage</p>
          </div>
        </div>
        ${chapter("Minuten pro Woche", weekChart(stats.weeks), {
          footer: "Aus deinem Trainingstagebuch: Einheiten mit Stoppuhr oder von Hand und Übungen aus den Vorschlägen. Die laufende Woche in Fahnenrot.",
        })}
        ${Object.keys(stats.areaMinutes).length > 0
          ? chapter(
              "Bereiche, letzte 28 Tage",
              html`<ul class="rows">${AREAS.filter((area) => stats.areaMinutes[area] != null).map((area) => {
                const minutes = stats.areaMinutes[area];
                return html`<li class="area-row">
                  <div class="area-line"><span>${AREA_NAMES[area]}</span><span class="row-value">${durationText(minutes)}</span></div>
                  ${progress(minutes, Math.max(1, assigned), { label: `${AREA_NAMES[area]}: ${durationText(minutes)}` })}
                </li>`;
              })}</ul>`,
              {
                footer:
                  unassigned > 0
                    ? `Dazu ${durationText(unassigned)} ohne Angabe des Bereichs.`
                    : "Vergleiche mit den Anteilen in den Vorschlägen der Woche: Dort steht, was laut Strokes Gained am meisten bringt.",
              },
            )
          : ""}
        ${stats.benchmarks.length > 0
          ? chapter(
              "Monatstests",
              html`<ul class="rows">${stats.benchmarks.map(
                (benchmark) => html`<li class="row">
                  <span class="row-main">
                    <span class="row-title">${benchmark.drill.name}</span>
                    <span class="row-sub">${formatShortDate(benchmark.latest.date)} · ${changeText(benchmark)}</span>
                  </span>
                  <span class="row-value${(benchmark.improvement ?? 0) > 0 ? " flag" : ""}">${scoreLabel(benchmark.latest.score, benchmark.drill.scoring)}</span>
                </li>`,
              )}</ul>`,
              { footer: "Jeweils der letzte Test und der Unterschied zum Test davor. Besser in Fahnenrot." },
            )
          : ""}
      `;
    },
  };
}

/** „3 Schläge weniger als zuvor“, „2 mehr als zuvor“, „erster Test“. */
export function changeText(benchmark) {
  if (benchmark.improvement == null) return "erster Test";
  const amount = Math.abs(benchmark.improvement);
  if (benchmark.improvement === 0) return "gleich wie zuvor";
  if (normalizedScoring(benchmark.drill.scoring).kind === "strokes") {
    const strokes = amount === 1 ? "1 Schlag" : `${amount} Schläge`;
    return benchmark.improvement > 0 ? `${strokes} weniger als zuvor` : `${strokes} mehr als zuvor`;
  }
  return benchmark.improvement > 0 ? `${amount} mehr als zuvor` : `${amount} weniger als zuvor`;
}

/** Balken pro Woche wie das Diagramm in der App, die laufende Woche in Fahnenrot. */
function weekChart(weeks) {
  const width = 320;
  const height = 160;
  const left = 34;
  const right = 6;
  const top = 10;
  const bottom = 24;
  // Obere Linie auf volle Stunden, mindestens eine.
  const ceiling = Math.max(60, Math.ceil(Math.max(...weeks.map((week) => week.minutes)) / 60) * 60);
  const slot = (width - left - right) / weeks.length;
  const bar = slot * 0.5;
  const baseline = height - bottom;
  const y = (minutes) => top + (1 - minutes / ceiling) * (baseline - top);
  const last = weeks.length - 1;
  const label = `Minuten pro Woche: ${weeks.map((week) => `ab ${dayMonth.format(week.weekStart)} ${durationText(week.minutes)}`).join(", ")}.`;
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    <line class="axis" x1="${left}" y1="${baseline}" x2="${width - right}" y2="${baseline}"></line>
    <line class="grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
    <text x="${left - 6}" y="${top + 4}" text-anchor="end">${ceiling / 60} h</text>
    <text x="${left - 6}" y="${baseline + 4}" text-anchor="end">0</text>
    ${weeks.map((week, index) => {
      const x = left + index * slot + (slot - bar) / 2;
      const barHeight = week.minutes > 0 ? Math.max(1, baseline - y(week.minutes)) : 0;
      return html`<rect class="${index === last ? "flag" : ""}" x="${x.toFixed(1)}" y="${(baseline - barHeight).toFixed(1)}" width="${bar.toFixed(1)}" height="${barHeight.toFixed(1)}"></rect>`;
    })}
    <text x="${left}" y="${height - 6}">${dayMonth.format(weeks[0].weekStart)}</text>
    <text x="${width - right}" y="${height - 6}" text-anchor="end">${dayMonth.format(weeks[last].weekStart)}</text>
  </svg>`;
}
