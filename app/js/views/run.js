// Eine Übung durchführen und das Ergebnis eintragen, wie DrillRunView in der
// App: Beschreibung, Eingabe Ball für Ball mit großen Knöpfen für die Range,
// danach die bisherigen Ergebnisse mit Bestleistungen.
import { AREA_NAMES, MODE_NAMES } from "../core/categories.js";
import { bests, outcome } from "../core/bests.js";
import { formatShortDate } from "../core/dates.js";
import { maxZonePoints } from "../core/scoring.js";
import { chapter, check, empty, headline, html, inform, labeled, scoreLabel, ticks, toast } from "../ui.js";

/** Übungen, die im Takt des Tempo-Trainers laufen. */
const TEMPO_DRILLS = new Set(["drive-tempo"]);

/**
 * Eingaben Ball für Ball, bis sie gespeichert sind. Sie liegen im Speicher des
 * Tabs (sessionStorage), damit sie einen Abstecher zum Tempo-Trainer oder zum
 * Video und ein Neuladen überstehen. Mit dem Tab, beim Speichern und mit
 * „Meine Daten löschen“ verschwinden sie.
 */
export const DRAFT_PREFIX = "golftrainer.eingabe.";

/** Übung aus den Vorschlägen der Woche. Das Ergebnis gehört zu diesem Golftag. */
export function planRunPage(app, slotID, drillID) {
  const session = app.store.session(slotID);
  const planned = session?.drills.find((drill) => drill.drillID === drillID) ?? null;
  const drill = app.store.drill(drillID);
  if (!session || !planned || !drill) return missing("#/woche", "woche");
  // Mit dem Tag: Dieselbe Kennung des Golftags kommt in der nächsten Woche wieder.
  const draftKey = `${DRAFT_PREFIX}woche/${slotID}/${drillID}/${session.date.getTime()}`;
  return drillRun(app, drill, planned, session, "#/woche", "woche", draftKey);
}

/** Übung aus der Bibliothek, außerhalb des Plans. */
export function runPage(app, drillID, parent = "#/uebungen") {
  const drill = app.store.drill(drillID);
  if (!drill) return missing(parent, "uebungen");
  return drillRun(app, drill, app.store.freePlannedDrill(drill), null, parent, "uebungen", `${DRAFT_PREFIX}uebungen/${drillID}`);
}

/** Übung aus einer Einheit vom Trainer. Das Ergebnis gehört zu dieser Einheit. */
export function sessionRunPage(app, sessionID, drillID) {
  const team = app.team;
  const session = team?.data.session(sessionID) ?? null;
  const item = session?.drills?.find?.((drill) => drill.drillID === drillID) ?? null;
  const drill = app.store.drill(drillID);
  const planned = item && drill ? team.plannedDrill(item) : null;
  const parent = `#/team/einheiten/${encodeURIComponent(String(sessionID).toUpperCase())}`;
  if (!session || !planned) return missing(parent, "mehr");
  return drillRun(app, drill, planned, null, parent, "mehr", `${DRAFT_PREFIX}team/${String(sessionID).toUpperCase()}/${drillID}`, { sessionID: String(sessionID).toUpperCase() });
}

function tabStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Gesperrt, z. B. in manchen privaten Fenstern: Dann bleiben die Eingaben nur, solange die Seite offen ist.
    return null;
  }
}

/** Gespeicherte Eingaben, wenn sie zur Wertung passen, sonst null. */
export function readDraft(key, scoring, storage = tabStorage()) {
  let json;
  try {
    json = JSON.parse(storage?.getItem(key) ?? "null");
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const attempts = scoring.attempts ?? 0;
  const entries = Array.isArray(json.entries) ? json.entries : [];
  const allowed = new Set(ballOptions(scoring).map((option) => option.points));
  if (entries.length > attempts || !entries.every((value) => allowed.has(value))) return null;
  const count = (value) => (Number.isInteger(value) && value >= 0 && value <= attempts ? value : null);
  const streak = count(json.streak ?? 0);
  const bestStreak = count(json.bestStreak ?? 0);
  if (streak == null || bestStreak == null || streak > bestStreak) return null;
  return { entries, streak, bestStreak };
}

/** Eingaben merken, leere vergessen. */
export function writeDraft(key, { entries, streak, bestStreak }, storage = tabStorage()) {
  try {
    if (entries.length === 0 && streak === 0 && bestStreak === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify({ entries, streak, bestStreak }));
  } catch {
    // Kein Platz oder gesperrt: Die Eingaben bleiben, solange die Seite offen ist.
  }
}

function missing(parent, tab) {
  return {
    title: "Übung",
    tab,
    parent,
    render: () => empty("Diese Übung steht nicht mehr in den Vorschlägen, z. B. weil sie neu erstellt wurden."),
  };
}

function recordMessage(score, previous, drill, level) {
  const onLevel = drill.levels.length > 1 ? ` auf Stufe ${level + 1}` : "";
  return `${scoreLabel(score, drill.scoring)}${onLevel}. Bisher: ${scoreLabel(previous, drill.scoring)}.`;
}

function drillRun(app, drill, planned, session, parent, tab, draftKey, { sessionID = null } = {}) {
  const { store } = app;
  // Eingaben bleiben, auch wenn sich Daten ändern oder du kurz woandershin wechselst.
  const state = { entries: [], streak: 0, bestStreak: 0, ...readDraft(draftKey, drill.scoring), saving: false };
  const existing = () => (sessionID ? store.resultInSession(drill.id, sessionID) : session ? store.resultFor(planned, session) : null);

  async function save(score) {
    if (state.saving) return;
    state.saving = true;
    // Vor dem Speichern bewerten: Ein korrigiertes Ergebnis zählt nicht gegen sich selbst.
    const before = existing();
    const result = outcome(score, planned.level, drill, store.data.results, before?.id ?? null);
    store.record(score, planned, session, { sessionID });
    writeDraft(draftKey, { entries: [], streak: 0, bestStreak: 0 });
    if (result.kind === "record") {
      await inform("Neue Bestleistung", recordMessage(score, result.previous, drill, planned.level));
    } else {
      toast(drill.scoring.kind === "none" ? "Als erledigt eingetragen." : `Eingetragen: ${scoreLabel(score, drill.scoring)}`);
    }
    app.back(parent);
  }

  return {
    title: drill.name,
    tab,
    parent,
    keepOnChange: true,
    render() {
      const done = existing();
      return html`
        ${info(drill, planned.level, planned.focusNotes)}
        <button type="button" class="action jump" data-jump>${done ? "Erledigt, Ergebnis ansehen" : "Ergebnis eintragen"}<span class="mark" aria-hidden="true">↓</span></button>
        ${chapter(
          "Ergebnis",
          html`${done ? html`<p class="done-line">${check(true)} Erledigt: ${scoreLabel(done.score, drill.scoring)}</p>` : ""}
            <div data-entry></div>`,
          { footer: done ? "Neu eintragen ersetzt das Ergebnis, z. B. nach einem Tippfehler." : null },
        )}
        ${TEMPO_DRILLS.has(drill.id)
          ? chapter("Takt", html`<a class="action" href="#/schwung/tempo">Tempo-Trainer öffnen<span class="mark" aria-hidden="true">›</span></a>`, {
              footer: "Drei Töne geben den Takt vor: ausholen, oben umkehren, treffen.",
            })
          : ""}
        ${chapter(
          "Video",
          html`<a class="action" href="#/schwung">${drill.suggestsVideo ? "Video aufnehmen (empfohlen)" : "Video aufnehmen"}<span class="mark" aria-hidden="true">›</span></a>`,
          { footer: "In der Zeitlupe siehst du deinen Schwung Bild für Bild. Das Video bleibt auf deinem Handy." },
        )}
        ${history(store, drill)}
      `;
    },
    mount(root) {
      const entry = root.querySelector("[data-entry]");
      // Auf der Range direkt zur Eingabe, ohne an der Beschreibung vorbeizuwischen.
      root.querySelector("[data-jump]").addEventListener("click", () => {
        entry.closest(".chapter").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      const draw = () => {
        entry.innerHTML = String(scoreEntry(drill.scoring, planned.stations, state));
      };
      draw();
      entry.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button || button.disabled) return;
        switch (button.dataset.action) {
          case "point":
            state.entries.push(Number(button.dataset.points));
            break;
          case "undo":
            state.entries.pop();
            break;
          case "hit":
            state.streak += 1;
            state.bestStreak = Math.max(state.bestStreak, state.streak);
            break;
          case "miss":
            state.streak = 0;
            break;
          case "save":
            save(Number(button.dataset.score));
            return;
          default:
            return;
        }
        writeDraft(draftKey, state);
        const key = button.dataset.key;
        draw();
        // Mit dem Finger auf demselben Knopf bleiben, auch für Bildschirmleser.
        const again = entry.querySelector(`[data-key="${key}"]:not(:disabled)`) ?? entry.querySelector("[data-key='save']:not(:disabled)");
        again?.focus({ preventScroll: true });
      });
    },
  };
}

// MARK: - Beschreibung

function info(drill, level, focusNotes) {
  const facts = [labeled("Dauer", `ca. ${drill.minutes} Min.`), labeled("Art", drill.isBenchmark ? "Monatstest" : MODE_NAMES[drill.mode])];
  if (drill.levels.length > 1 && drill.levels[level]) facts.push(labeled(`Stufe ${level + 1} von ${drill.levels.length}`, drill.levels[level]));
  const remarks = [
    drill.isCorrective ? ["Korrektur", "Gegen einen bestimmten Fehler. Vorgeschlagen wird sie nur über einen Schwerpunkt."] : null,
    drill.isTournamentPrep ? ["Turnier", "Gut für die Turniervorbereitung."] : null,
    drill.suggestsVideo ? ["Video", "Gut geeignet für Schwungvideos."] : null,
    drill.isIndoor ? ["Zuhause", "Geht auch in der Halle oder zuhause, mit Matte, Netz oder Teppich."] : null,
  ].filter(Boolean);
  return html`
    ${headline(drill.name, AREA_NAMES[drill.area])}
    <p class="lead">${drill.summary}</p>
    <ul class="rows facts">
      ${facts}
      ${remarks.map(([label, text]) => html`<li class="row remark"><span class="kicker ink">${label}</span><span>${text}</span></li>`)}
    </ul>
    ${drill.purpose ? chapter("Wofür", html`<p class="serif">${drill.purpose}</p>`) : ""}
    ${focusNotes.length ? chapter("Trainer-Fokus", focusNotes.map((note) => html`<p class="hint serif"><em>${note}</em></p>`)) : ""}
    ${drill.equipment.length ? chapter("Material", html`<ul class="bullets">${drill.equipment.map((item) => html`<li>${item}</li>`)}</ul>`) : ""}
    ${chapter(
      "Ablauf",
      html`<ol class="numbered">${drill.steps.map((step, index) => html`<li><span class="step-number">${index + 1}</span><span>${step}</span></li>`)}</ol>`,
    )}
    ${drill.tips.length ? chapter("So nutzt du sie am besten", html`<ul class="bullets">${drill.tips.map((tip) => html`<li>${tip}</li>`)}</ul>`) : ""}
    ${drill.sources.length
      ? chapter(
          "Quellen",
          drill.sources.map(
            (source) => html`<a class="action source" href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title}<span class="mark" aria-hidden="true">↗</span></a>`,
          ),
        )
      : ""}
  `;
}

// MARK: - Eingabe

/** Knöpfe für einen Ball oder ein Loch, leer ohne Eingabe Ball für Ball. */
function ballOptions(scoring) {
  switch (scoring.kind) {
    case "count":
      return [
        { label: "Treffer", points: 1 },
        { label: "Daneben", points: 0 },
      ];
    case "zones":
      return scoring.zones ?? [];
    case "strokes": {
      // Auch ein schlechtes Loch muss sich eintragen lassen, sonst sähe das Ergebnis besser aus, als es war.
      const highest = Math.max(scoring.par + 4, 6);
      return Array.from({ length: highest }, (_, index) => ({ label: String(index + 1), points: index + 1 }));
    }
    default:
      return [];
  }
}

function scoreEntry(scoring, stations, state) {
  switch (scoring.kind) {
    case "none":
      return html`<button type="button" class="button flag wide" data-action="save" data-score="0" data-key="save">Als erledigt markieren</button>`;
    case "count":
    case "zones":
    case "strokes":
      return ballByBall(scoring, stations, state, ballOptions(scoring));
    case "streak":
      return streakEntry(scoring, state);
    default:
      return "";
  }
}

function ballByBall(scoring, stations, state, options) {
  const { entries } = state;
  const finished = entries.length >= scoring.attempts;
  const unit = scoring.kind === "strokes" ? "Loch" : "Ball";
  const total = entries.reduce((sum, value) => sum + value, 0);
  const totalText =
    scoring.kind === "strokes"
      ? `${total} Schläge (Par ${entries.length * scoring.par})`
      : `${total} / ${entries.length * (scoring.kind === "count" ? 1 : maxZonePoints(scoring))} Punkte`;
  const station = !finished ? stations[entries.length] : null;
  return html`<div class="entry">
    <div class="entry-head" aria-live="polite">
      <span class="kicker ink">${finished ? "Fertig" : `${unit} ${entries.length + 1} von ${scoring.attempts}`}</span>
      <span class="row-value">${totalText}</span>
    </div>
    ${ticks(entries.length, scoring.attempts)}
    ${station ? html`<p class="station">${station}</p>` : ""}
    ${!finished
      ? html`<div class="zones${scoring.kind === "strokes" ? " strokes" : ""}">${options.map(
          (option, index) =>
            html`<button type="button" data-action="point" data-points="${option.points}" data-key="option-${index}"><strong>${option.label}</strong>${scoring.kind === "zones" ? html`<span>${option.points} ${option.points === 1 ? "Punkt" : "Punkte"}</span>` : ""}</button>`,
        )}</div>`
      : ""}
    <div class="entry-actions">
      <button type="button" class="button outline" data-action="undo" data-key="undo" ${entries.length === 0 ? "disabled" : ""}>Rückgängig</button>
      <button type="button" class="button flag" data-action="save" data-score="${total}" data-key="save" ${finished ? "" : "disabled"}>Speichern</button>
    </div>
  </div>`;
}

function streakEntry(scoring, state) {
  return html`<div class="entry">
    <div class="entry-head" aria-live="polite">
      <span><span class="kicker">Aktuelle Serie</span><span class="figure">${state.streak}</span></span>
      <span class="right"><span class="kicker">Beste</span><span class="row-value">${state.bestStreak} von ${scoring.attempts}</span></span>
    </div>
    <div class="buttons two">
      <button type="button" class="button" data-action="hit" data-key="hit" ${state.streak >= scoring.attempts ? "disabled" : ""}>Geschafft</button>
      <button type="button" class="button outline" data-action="miss" data-key="miss">Fehler, neu starten</button>
    </div>
    <button type="button" class="button flag wide" data-action="save" data-score="${state.bestStreak}" data-key="save">Beste Serie speichern</button>
  </div>`;
}

// MARK: - Verlauf

function history(store, drill) {
  const list = store.results(drill.id);
  if (list.length === 0) return "";
  const levelBests = bests(drill, store.data.results).sort((a, b) => b.level - a.level);
  const bestIDs = new Set(levelBests.map((entry) => entry.result.id));
  const showLevel = drill.levels.length > 1;
  return chapter(
    "Bisherige Ergebnisse",
    html`
      <ul class="rows">
        ${levelBests.map(
          ({ level, result }) => html`<li class="row">
            <span class="row-main"><span class="kicker flag">${showLevel ? `Bestleistung Stufe ${level + 1}` : "Bestleistung"}</span><span class="row-sub">${formatShortDate(result.date)}</span></span>
            <span class="row-value">${scoreLabel(result.score, drill.scoring)}</span>
          </li>`,
        )}
      </ul>
      ${list.length >= 2 ? chart([...list].reverse(), drill) : ""}
      <ul class="rows">
        ${list.slice(0, 10).map(
          (result) => html`<li class="row">
            <span class="row-main">${formatShortDate(result.date)}</span>
            <span class="row-value${bestIDs.has(result.id) ? " flag" : ""}">${scoreLabel(result.score, drill.scoring)}${bestIDs.has(result.id) ? html`<span class="visually-hidden">, Bestleistung</span>` : ""}</span>
            ${showLevel ? html`<span class="kicker">Stufe ${result.level + 1}</span>` : ""}
          </li>`,
        )}
      </ul>`,
  );
}

const chartDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric" });

/** Ergebnisse über die Zeit als Linie mit Quadraten, wie das Diagramm in der App. */
function chart(results, drill) {
  const width = 320;
  const height = 150;
  const left = 30;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const times = results.map((result) => result.date.getTime());
  const scores = results.map((result) => result.score);
  let minX = Math.min(...times);
  let maxX = Math.max(...times);
  if (minX === maxX) {
    minX -= 86400000;
    maxX += 86400000;
  }
  const minY = Math.min(0, ...scores);
  let maxY = Math.max(...scores);
  if (maxY === minY) maxY = minY + 1;
  const x = (time) => left + ((time - minX) / (maxX - minX)) * (width - left - right);
  const y = (score) => top + (1 - (score - minY) / (maxY - minY)) * (height - top - bottom);
  const points = results.map((result) => `${x(result.date.getTime()).toFixed(1)},${y(result.score).toFixed(1)}`).join(" ");
  const label = `Verlauf: ${results.length} Ergebnisse vom ${formatShortDate(results[0].date)} bis ${formatShortDate(results[results.length - 1].date)}, zuletzt ${scoreLabel(scores[scores.length - 1], drill.scoring)}.`;
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    <line class="axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
    <line class="grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
    <text x="${left - 6}" y="${top + 4}" text-anchor="end">${maxY}</text>
    <text x="${left - 6}" y="${height - bottom + 4}" text-anchor="end">${minY}</text>
    <text x="${left}" y="${height - 6}">${chartDate.format(results[0].date)}</text>
    <text x="${width - right}" y="${height - 6}" text-anchor="end">${chartDate.format(results[results.length - 1].date)}</text>
    <polyline points="${points}"></polyline>
    ${results.map((result) => html`<rect x="${(x(result.date.getTime()) - 3).toFixed(1)}" y="${(y(result.score) - 3).toFixed(1)}" width="6" height="6"></rect>`)}
  </svg>`;
}
