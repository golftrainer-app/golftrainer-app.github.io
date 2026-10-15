// Launch Monitor wie LaunchMonitorViews.swift in der App: CSV-Export der
// Garmin-Golf-App importieren, Sessions mit allen Schlägen, Distanztabelle und
// Verlauf. Ohne die Zeichnung der Flugbahn. Die Datei bleibt auf dem Handy,
// die Werte liegen danach in diesem Browser.
import { formatShortDate } from "../core/dates.js";
import { LaunchImportError, decodeTextFile, emptyMapping, hasEssentials, importSession, mappingKey, prefersDayFirst } from "../core/garmin.js";
import { METRICS, METRIC_INFO, formatted, formattedForDisplay, meaning, metricName, metricUnit, sessionClubs, summaries, trend } from "../core/launch.js";
import { ask, chapter, empty, html, inform, toast } from "../ui.js";

export const BASE = "#/schwung/launch";
const dateTime = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateWithSeconds = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric" });

/** Import, der auf die Zuordnung der Spalten wartet: { text, fileName, result }. Immer nur einer. */
let pending = null;
/** Auswahl in Distanztabelle und Verlauf, bleibt beim Hin und Her. Ohne Wahl 90 Tage, oder alle, wenn die Sessions älter sind. */
let period = null;
let trendChoice = { club: null, metric: "carryDistance" };

const handednessOf = (store) => store.data.handedness ?? "right";

// MARK: - Übersicht

export function launchPage(app) {
  const { store } = app;
  return {
    title: "Launch Monitor",
    tab: "schwung",
    parent: "#/schwung",
    render() {
      const sessions = [...store.data.launchSessions].sort((a, b) => b.date - a.date);
      return html`
        ${chapter(
          "Import",
          html`<label class="action">CSV-Datei importieren<input class="visually-hidden" type="file" accept=".csv,text/csv,text/plain,text/comma-separated-values" multiple data-import><span class="mark" aria-hidden="true">+</span></label>`,
          {
            footer:
              "In Garmin Golf die Session öffnen, auf das Teilen-Symbol neben der Anzahl der Schläge tippen und die Datei speichern, z. B. in „Eigene Dateien“. Dann hier auswählen, auch mehrere auf einmal. Mehrere Sessions: in der Liste oben rechts „Sitzungen bearbeiten“, auswählen, teilen.",
          },
        )}
        ${sessions.length > 0
          ? chapter(
              "Auswertung",
              html`<ul class="rows">
                <li><a class="row" href="${BASE}/tabelle"><span class="row-main row-title">Distanztabelle</span></a></li>
                <li><a class="row" href="${BASE}/verlauf"><span class="row-main row-title">Verlauf</span></a></li>
              </ul>`,
            )
          : ""}
        ${sessions.length > 0
          ? chapter(
              "Sessions",
              html`<ul class="rows">${sessions.map(
                (session) => html`<li><a class="row" href="${BASE}/${encodeURIComponent(session.id)}">
                  <span class="row-main"><span class="row-title">${dateTime.format(session.date)}</span><span class="row-sub">${session.shots.length} Schläge · ${sessionClubs(session).join(", ")}</span></span>
                </a></li>`,
              )}</ul>`,
            )
          : empty("Noch keine Session. Importiere den CSV-Export der Garmin-Golf-App.")}
        <p class="note">Garmin bietet keine offene Schnittstelle für Live-Daten. Deshalb kommen die Daten über den CSV-Export. Die Datei bleibt auf deinem Handy, die Werte liegen danach nur in diesem Browser.</p>
      `;
    },
    mount(root) {
      root.querySelector("[data-import]").addEventListener("change", async (event) => {
        const input = event.target;
        const files = [...(input.files ?? [])];
        input.value = "";
        if (files.length > 0) await importFiles(app, files);
      });
    },
  };
}

/**
 * Importiert Dateien wie importLaunchCSV in der App: erst automatisch, dann
 * mit einer gespeicherten Zuordnung für dieselben Spaltennamen, sonst von Hand.
 */
async function importFiles(app, files) {
  const { store } = app;
  const messages = [];
  const dayFirst = prefersDayFirst();
  for (const file of files) {
    let text = null;
    try {
      text = decodeTextFile(await file.arrayBuffer());
    } catch {
      text = null;
    }
    if (text == null) {
      messages.push(`${file.name}: Die Datei ließ sich nicht lesen.`);
      continue;
    }
    const attempt = (mapping) => importSession(text, file.name, { preferDayFirst: dayFirst, mapping });
    let automatic = null;
    try {
      automatic = attempt(null);
    } catch {
      automatic = null;
    }
    let base;
    try {
      // Keine bekannte Spalte: die erste Zeile als Kopfzeile, alle Spalten zur Auswahl.
      base = automatic ?? attempt(emptyMapping());
    } catch (error) {
      messages.push(`${file.name}: Import fehlgeschlagen. ${error instanceof LaunchImportError ? error.message : "Die Datei ließ sich nicht lesen."}`);
      continue;
    }
    const saved = store.data.csvMappings[mappingKey(base.headers)];
    if (saved) {
      const result = attempt(saved);
      if (hasEssentials(result.mapping)) {
        messages.push(finishImport(store, result));
        continue;
      }
    }
    if (automatic && hasEssentials(automatic.mapping)) {
      messages.push(finishImport(store, automatic));
    } else if (pending) {
      // Von Hand zuordnen lässt sich immer nur eine Datei auf einmal.
      messages.push(`${file.name}: Spalten nicht erkannt. Öffne die Datei danach noch einmal.`);
    } else {
      pending = { text, fileName: file.name, result: base };
    }
  }
  if (messages.length > 0) await inform("Launch Monitor", messages.join("\n\n"));
  if (pending) app.navigate(`${BASE}/zuordnen`);
}

function finishImport(store, result) {
  const { session } = result;
  if (session.shots.length === 0) return `${session.fileName}: In der Datei wurden keine Schläge gefunden.`;
  // Garmin exportiert jede Session als eigene Datei. Dieselbe Datei zweimal soll nicht doppelt zählen.
  if (store.hasLaunchSession(session)) return `Die Session vom ${dateTime.format(session.date)} ist schon importiert.`;
  store.addLaunchSession(session);
  let message = `${session.shots.length} Schläge vom ${dateTime.format(session.date)} importiert.`;
  if (result.warnings.length > 0) message += `\n${result.warnings.join("\n")}`;
  return message;
}

// MARK: - Spalten zuordnen

export function mappingPage(app) {
  const { store } = app;
  const missing = { title: "Spalten zuordnen", tab: "schwung", parent: BASE, render: () => empty("Gerade wartet keine Datei auf die Zuordnung ihrer Spalten.") };
  if (!pending) return missing;
  const { headers, sampleRow } = pending.result;
  const mapping = { ...pending.result.mapping, metrics: { ...pending.result.mapping.metrics } };
  const columnTitle = (index) => {
    const sample = sampleRow[index] ?? "";
    const name = headers[index] || `Spalte ${index + 1}`;
    return sample ? `${name} (z. B. ${sample})` : name;
  };
  const picker = (label, key, value) =>
    html`<label class="field"><span>${label}</span>
      <select data-column="${key}"><option value="">—</option>${headers.map((header, index) => html`<option value="${index}" ${index === value ? "selected" : ""}>${columnTitle(index)}</option>`)}</select>
    </label>`;
  return {
    title: "Spalten zuordnen",
    tab: "schwung",
    parent: BASE,
    keepOnChange: true,
    render() {
      return html`<form class="editor" novalidate>
        <p class="lead">${pending.fileName}</p>
        <p class="note">Nicht alle Spalten wurden erkannt. Wähle aus, welche Spalte welchen Wert enthält. Die Zuordnung wird für Dateien mit denselben Spaltennamen gespeichert.</p>
        ${chapter("Pflicht", html`${picker("Schlägerart", "clubType", mapping.clubType)}${picker(metricName("carryDistance"), "metric:carryDistance", mapping.metrics.carryDistance ?? null)}`, {
          footer: "Schlägerart heißt bei Garmin z. B. „Eisen 7“. Gibt es keine, reicht der Schlägername.",
        })}
        ${chapter(
          "Optional",
          html`${picker("Schlägername", "club", mapping.club)}${picker("Datum und Uhrzeit", "date", mapping.date)}${METRICS.filter((metric) => metric !== "carryDistance").map((metric) => picker(metricName(metric), `metric:${metric}`, mapping.metrics[metric] ?? null))}`,
        )}
        <div class="buttons">
          <button type="submit" class="button flag" data-save ${hasEssentials(mapping) ? "" : "disabled"}>Importieren</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      const save = root.querySelector("[data-save]");
      form.addEventListener("change", (event) => {
        const select = event.target.closest("[data-column]");
        if (!select) return;
        const value = select.value === "" ? null : Number(select.value);
        const key = select.dataset.column;
        if (key.startsWith("metric:")) {
          const metric = key.slice("metric:".length);
          if (value == null) delete mapping.metrics[metric];
          else mapping.metrics[metric] = value;
        } else {
          mapping[key] = value;
        }
        save.disabled = !hasEssentials(mapping);
      });
      root.querySelector("[data-cancel]").addEventListener("click", () => {
        pending = null;
        app.back(BASE);
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!pending || !hasEssentials(mapping)) return;
        let message;
        try {
          const result = importSession(pending.text, pending.fileName, { preferDayFirst: prefersDayFirst(), mapping });
          store.saveColumnMapping(mappingKey(headers), mapping);
          message = finishImport(store, result);
        } catch (error) {
          message = `${pending.fileName}: Import fehlgeschlagen. ${error instanceof LaunchImportError ? error.message : "Die Datei ließ sich nicht lesen."}`;
        }
        pending = null;
        await inform("Launch Monitor", message);
        app.back(BASE);
      });
    },
  };
}

// MARK: - Zeilen

/** Ein Schläger als Zeile: Carry groß, Streuung und die übrigen Mittelwerte klein darunter. */
function summaryRow(summary) {
  const details = [];
  if (summary.averages.totalDistance != null) details.push(`Gesamt ${formatted("totalDistance", summary.averages.totalDistance)}`);
  if (summary.averages.clubSpeed != null) details.push(`Kopf ${formatted("clubSpeed", summary.averages.clubSpeed)}`);
  if (summary.lateralSpread != null) details.push(`Seite ± ${Math.round(summary.lateralSpread)} m`);
  details.push(`${summary.usedShotCount}/${summary.shotCount} Schläge`);
  return html`<span class="row-main">
    <span class="log-head">
      <span class="row-title">${summary.club}</span>
      <span class="row-value">${summary.averages.carryDistance != null ? formatted("carryDistance", summary.averages.carryDistance) : "–"}${summary.carrySpread != null ? html` <span class="small secondary">± ${Math.round(summary.carrySpread)} m</span>` : ""}</span>
    </span>
    <span class="row-sub">${details.join(" · ")}</span>
  </span>`;
}

const ROW_METRICS = ["clubSpeed", "ballSpeed", "smashFactor", "launchAngle", "spinRate", "clubPath", "faceAngle"];

function shotRow(shot) {
  const details = ROW_METRICS.filter((metric) => shot.values[metric] != null)
    .map((metric) => `${metricName(metric)} ${METRIC_INFO[metric].isSideways ? formattedForDisplay(metric, shot.values[metric]) : formatted(metric, shot.values[metric])}`)
    .join(" · ");
  return html`<span class="row-main">
    <span class="log-head"><span class="row-title">${shot.index + 1}. ${shot.club}</span><span class="row-value">${shot.values.carryDistance != null ? formatted("carryDistance", shot.values.carryDistance) : ""}</span></span>
    <span class="row-sub">${details}</span>
  </span>`;
}

// MARK: - Distanztabelle

const PERIODS = [
  [30, "30 Tage"],
  [90, "90 Tage"],
  [0, "Alle"],
];

export function distanceTablePage(app) {
  const { store } = app;
  return {
    title: "Distanztabelle",
    tab: "schwung",
    parent: BASE,
    render() {
      const shotsSince = (days) => store.data.launchSessions.filter((session) => days === 0 || session.date.getTime() >= Date.now() - days * 86400000).flatMap((session) => session.shots);
      if (period == null) period = shotsSince(90).length > 0 ? 90 : 0;
      const shots = shotsSince(period);
      const rows = summaries(shots);
      return html`
        <div class="choice" role="group" aria-label="Zeitraum">${PERIODS.map(([days, label]) => html`<button type="button" data-period="${days}" aria-pressed="${String(days === period)}">${label}</button>`)}</div>
        <p class="note">Grobe Fehlschläge (Carry unter 60 % des Medians) zählen nicht. ± ist die typische Streuung.</p>
        ${rows.length === 0 ? empty("In diesem Zeitraum gibt es keine Schläge.") : html`<ul class="rows">${rows.map((summary) => html`<li class="row log">${summaryRow(summary)}</li>`)}</ul>`}
      `;
    },
    mount(root) {
      root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-period]");
        if (!button) return;
        period = Number(button.dataset.period);
        app.render({ keepScroll: true });
      });
    },
  };
}

// MARK: - Verlauf

export function trendPage(app) {
  const { store } = app;
  return {
    title: "Verlauf",
    tab: "schwung",
    parent: BASE,
    render() {
      const clubs = [...new Set(store.data.launchSessions.flatMap((session) => session.shots.map((shot) => shot.club)))].sort((a, b) => a.localeCompare(b, "de"));
      if (!clubs.includes(trendChoice.club)) trendChoice.club = clubs[0] ?? null;
      const points = trendChoice.club ? trend(trendChoice.metric, trendChoice.club, store.data.launchSessions) : [];
      return html`
        <label class="field"><span>Schläger</span><select data-trend="club">${clubs.map((club) => html`<option value="${club}" ${club === trendChoice.club ? "selected" : ""}>${club}</option>`)}</select></label>
        <label class="field"><span>Messwert</span><select data-trend="metric">${METRICS.map((metric) => html`<option value="${metric}" ${metric === trendChoice.metric ? "selected" : ""}>${metricName(metric)}</option>`)}</select></label>
        ${chapter(
          metricName(trendChoice.metric),
          points.length < 2 ? empty("Für einen Verlauf braucht es mindestens zwei Sessions mit diesem Schläger.") : trendChart(points, trendChoice.metric),
          { footer: "Jeder Punkt ist der Mittelwert einer Session ohne grobe Fehlschläge." },
        )}
        ${points.length > 0
          ? html`<ul class="rows">${points.map((point) => html`<li class="row"><span class="row-main"><span class="row-title">${formatShortDate(point.date)}</span><span class="row-sub">${point.shotCount} ${point.shotCount === 1 ? "Schlag" : "Schläge"}</span></span><span class="row-value">${formattedForDisplay(trendChoice.metric, point.value)}</span></li>`)}</ul>`
          : ""}
      `;
    },
    mount(root) {
      root.addEventListener("change", (event) => {
        const select = event.target.closest("[data-trend]");
        if (!select) return;
        trendChoice = { ...trendChoice, [select.dataset.trend]: select.value };
        app.render({ keepScroll: true });
      });
    },
  };
}

/** Linie mit Quadraten über die Sessions, wie das Diagramm in der App. */
function trendChart(points, metric) {
  const width = 320;
  const height = 170;
  const left = 44;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const times = points.map((point) => point.date.getTime());
  const values = points.map((point) => point.value);
  let minX = Math.min(...times);
  let maxX = Math.max(...times);
  if (minX === maxX) {
    minX -= 86400000;
    maxX += 86400000;
  }
  let minY = Math.min(0, ...values);
  let maxY = Math.max(0, ...values);
  if (maxY === minY) maxY = minY + 1;
  const x = (time) => left + ((time - minX) / (maxX - minX)) * (width - left - right);
  const y = (value) => top + (1 - (value - minY) / (maxY - minY)) * (height - top - bottom);
  const path = points.map((point) => `${x(point.date.getTime()).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const unit = metricUnit(metric);
  const label = `${metricName(metric)}: ${points.map((point) => `${formatShortDate(point.date)} ${formattedForDisplay(metric, point.value)}`).join(", ")}.`;
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    <line class="axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
    <line class="grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
    <text x="${left - 6}" y="${top + 4}" text-anchor="end">${Math.round(maxY)}${unit ? ` ${unit}` : ""}</text>
    <text x="${left - 6}" y="${height - bottom + 4}" text-anchor="end">${Math.round(minY)}</text>
    <text x="${left}" y="${height - 6}">${dayMonth.format(points[0].date)}</text>
    <text x="${width - right}" y="${height - 6}" text-anchor="end">${dayMonth.format(points[points.length - 1].date)}</text>
    <polyline points="${path}"></polyline>
    ${points.map((point) => html`<rect x="${(x(point.date.getTime()) - 3).toFixed(1)}" y="${(y(point.value) - 3).toFixed(1)}" width="6" height="6"></rect>`)}
  </svg>`;
}

// MARK: - Session

export function sessionPage(app, sessionID) {
  const { store } = app;
  return {
    title: "Session",
    tab: "schwung",
    parent: BASE,
    render() {
      const session = store.launchSession(sessionID);
      if (!session) return empty("Session nicht gefunden.");
      return html`
        <p class="kicker">${session.fileName}</p>
        <p class="lead">${dateTime.format(session.date)} · ${session.shots.length} Schläge</p>
        ${chapter("Pro Schläger", html`<ul class="rows">${summaries(session.shots).map((summary) => html`<li class="row log">${summaryRow(summary)}</li>`)}</ul>`, {
          footer: "Grobe Fehlschläge (Carry unter 60 % des Medians) zählen nicht. ± ist die typische Streuung.",
        })}
        ${chapter(
          "Schläge",
          html`<ul class="rows">${session.shots.map((shot) => html`<li><a class="row log" href="${BASE}/${encodeURIComponent(session.id)}/${encodeURIComponent(shot.id)}">${shotRow(shot)}</a></li>`)}</ul>`,
        )}
        <button type="button" class="action danger" data-delete>Session löschen</button>
      `;
    },
    mount(root) {
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({ title: "Session löschen?", message: "Die Schläge dieser Session verschwinden aus Distanztabelle und Verlauf.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
        if (choice !== "delete") return;
        store.deleteLaunchSession(sessionID);
        toast("Session gelöscht.");
        app.back(BASE);
      });
    },
  };
}

// MARK: - Schlag

export function shotPage(app, sessionID, shotID) {
  const { store } = app;
  return {
    title: "Schlag",
    tab: "schwung",
    parent: `${BASE}/${encodeURIComponent(sessionID)}`,
    render() {
      const session = store.launchSession(sessionID);
      const position = session?.shots.findIndex((shot) => shot.id === shotID) ?? -1;
      if (!session || position < 0) return empty("Schlag nicht gefunden.");
      const shot = session.shots[position];
      const handedness = handednessOf(store);
      const link = (offset, label) => {
        const other = session.shots[position + offset];
        return other
          ? html`<a class="button outline" href="${BASE}/${encodeURIComponent(session.id)}/${encodeURIComponent(other.id)}" data-shot-step>${label}</a>`
          : html`<span class="button outline disabled" aria-disabled="true">${label}</span>`;
      };
      return html`
        <p class="kicker">Schlag ${position + 1} von ${session.shots.length}${shot.date ? ` · ${dateWithSeconds.format(shot.date)}` : ""}</p>
        <h1 class="headline">${shot.club}</h1>
        <div class="buttons two">${link(-1, html`<span aria-hidden="true">‹</span> Vorheriger`)}${link(1, html`Nächster <span aria-hidden="true">›</span>`)}</div>
        ${chapter(
          "Messwerte",
          html`<ul class="rows">${METRICS.filter((metric) => shot.values[metric] != null).map((metric) => {
            const value = shot.values[metric];
            const sense = meaning(metric, value, handedness);
            return html`<li class="row"><span class="row-main"><span class="row-title">${metricName(metric)}</span>${sense ? html`<span class="row-sub">${sense}</span>` : ""}</span><span class="row-value">${formattedForDisplay(metric, value)}</span></li>`;
          })}</ul>`,
          { footer: "Richtungen mit L und R, wie bei TrackMan. Was ein Wert für den Schwung bedeutet, hängt von deiner Spielhand ab (Mehr → Spielhand)." },
        )}
      `;
    },
    mount(root) {
      // Blättern ersetzt den Schlag im Verlauf, statt für jeden einen Eintrag anzulegen.
      // So führt „Zurück“ gleich zur Session. Mit gedrückter Taste, z. B. für einen neuen Tab, bleibt der Link, wie er ist.
      root.addEventListener("click", (event) => {
        const step = event.target.closest("a[data-shot-step]");
        if (!step || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        app.navigate(step.getAttribute("href"), { replace: true });
      });
    },
  };
}
