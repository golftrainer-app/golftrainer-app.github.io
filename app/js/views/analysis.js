// Schwunganalyse: Analysen aus der App ansehen. Mit dem Konto kommen Angaben,
// Kurzfassung der Erkennung, Phasen, Kennzahlen und die Rückmeldung in den
// Browser, ohne Video und Skelett: Beide bleiben auf dem Gerät, das gefilmt
// hat. Die Texte und Werte rechnet js/core/analysis.js wie der Kern der App.
import {
  CAMERA_ANGLE_NAMES, EVENT_FULL_NAMES, GROUP_NAMES, GROUPS, IMPACT_SOURCE_TEXTS, METRICS, NOTE_ADVICE, NOTE_TITLES, PHASE_NAMES, SWING_TYPES, SWING_TYPE_NAMES,
  analysisStatusText, analysisSubtitle, angleText, chartValue, detectedText, duration, durationOf, evaluateFeedback, formatMetric, handednessMismatch, handednessText,
  hiddenCount, hintLimitText, historyKinds, historyPoints, historySwingTypes, isChecked, isReliable, markTimeText, marks, metricDetail, metricsAdvice, missingReason,
  phaseMissingReason, recentShare, samplingCount, scaleText, secondsText, skillArea, suggestedFocus, sureOnly, targetFor, unsureEvents, valuesInGroup, warningAdvice,
  warningTitle,
} from "../core/analysis.js";
import { formatShortDate } from "../core/dates.js";
import { ask, chapter, empty, headline, html, labeled, toast } from "../ui.js";
import { proposeFocus } from "./more.js";

const BASE = "#/schwung/analysen";
const dateTime = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

/** Hinweis mit rotem Strich: was gestört hat und was beim nächsten Mal hilft. */
const hintRow = (title, advice) => html`<div class="hint"><strong>${title}</strong><p>${advice}</p></div>`;

/** Ein Wert oder Zeitpunkt ohne Zahl: Name, darunter der Grund, rechts „zu unsicher“. */
const missingRow = (name, reason) =>
  html`<li class="row metric unsure"><span class="row-main"><span class="row-title">${name}</span><span class="row-sub">${reason}</span></span><span class="row-value small">zu unsicher</span></li>`;

const valueRow = (name, value, detail = null) =>
  html`<li class="row metric"><span class="row-main"><span class="row-title">${name}</span>${detail ? html`<span class="row-sub">${detail}</span>` : ""}</span><span class="row-value">${value}</span></li>`;

// MARK: - Liste

export function analysesPage(app) {
  const { store } = app;
  return {
    title: "Schwunganalyse",
    tab: "schwung",
    parent: "#/schwung",
    render() {
      const analyses = store.analyses();
      const types = historySwingTypes(analyses);
      return html`
        ${analyses.length === 0
          ? html`<div class="headline-block">
              <span class="flagmark" aria-hidden="true"></span>
              <h1 class="headline">Noch keine Analysen.</h1>
              <p class="lead">Filme einen Schwung in der App für iPhone und iPad, von vorne oder von hinten. Sie schätzt daraus ein 3D-Skelett und berechnet Drehung, Haltung und Tempo. Mit dem Konto stehen die Werte auch hier.</p>
            </div>`
          : html`<ul class="rows">
              ${analyses.map(
                (analysis) => html`<li>
                  <a class="row log" href="${BASE}/${encodeURIComponent(analysis.id)}">
                    <span class="row-main">
                      <span class="row-title">${dateTime.format(analysis.date)}</span>
                      <span class="row-sub">${analysisSubtitle(analysis)}</span>
                      <span class="kicker${analysis.status === "failed" ? " flag" : ""}">${analysisStatusText(analysis)}</span>
                    </span>
                    <span class="mark" aria-hidden="true">›</span>
                  </a>
                </li>`,
              )}
            </ul>`}
        ${types.length > 0 ? html`<a class="action" href="${BASE}/verlauf">Verlauf über alle Analysen<span class="mark" aria-hidden="true">›</span></a>` : ""}
        <p class="note">Analysen entstehen in der App. Hier siehst du Phasen, Kennzahlen und Rückmeldung, ohne Video und Skelett: Beide bleiben auf dem Gerät, das gefilmt hat.</p>
      `;
    },
  };
}

// MARK: - Eine Analyse

/** Kennung der Analyse, deren weitere Hinweise aufgeklappt sind. */
let expanded = null;

function statusLong(analysis) {
  switch (analysis.status) {
    case "failed":
      return "Die Auswertung ist fehlgeschlagen. Filme den Schwung noch einmal mit dem ganzen Körper im Bild und bei gutem Licht.";
    case "analyzed":
      return "Ausgewertet.";
    default:
      return "Noch nicht ausgewertet. Die App schätzt in jedem Bild des Ausschnitts das 3D-Skelett und prüft, wie gut sie dich erkennt. Starte die Auswertung in der App, solange das Video dort ist.";
  }
}

function evaluationChapter(analysis, setting) {
  const pose = analysis.pose;
  const body = pose
    ? html`${analysis.status === "failed" ? html`<p class="note flag">${statusLong(analysis)}</p>` : ""}
        <ul class="rows facts">
          ${labeled("Erkannte Bilder", detectedText(pose))}
          ${labeled("Spielhand (geschätzt)", handednessText(pose.handedness))}
          ${labeled("Maßstab", scaleText(pose))}
        </ul>
        ${handednessMismatch(pose.handedness, setting) ? html`<p class="note flag">${handednessMismatch(pose.handedness, setting)}</p>` : ""}
        ${pose.warnings.map((warning) => hintRow(warningTitle(warning), warningAdvice(warning)))}`
    : html`<p class="lead">${statusLong(analysis)}</p>`;
  return chapter("Auswertung", body, {
    footer: "Alle Werte schätzt die App aus dem Kamerabild. Sie sind Richtwerte, keine Messung wie im Labor. Auswerten und neu auswerten geht in der App, solange das Video dort ist.",
  });
}

/** Der Ausschnitt als Leiste: Rück- und Durchschwung grau, der Abschwung in Tinte, Striche an den Zeitpunkten. */
function timeline(range, phases) {
  const width = 320;
  const height = 32;
  const middle = height / 2;
  const bar = 8;
  const span = Math.max(range[1] - range[0], 0.001);
  const x = (time) => (((Math.min(Math.max(time, range[0]), range[1]) - range[0]) / span) * width).toFixed(1);
  const segments = [{ phase: "backswing", start: phases.address ?? range[0], end: phases.top }];
  if (phases.impact != null) {
    segments.push({ phase: "downswing", start: phases.top, end: phases.impact });
    segments.push({ phase: "followThrough", start: phases.impact, end: phases.finish ?? range[1] });
  } else {
    segments.push({ phase: "downswing", start: phases.top, end: range[1] });
  }
  return html`<svg class="phase-timeline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <line class="base" x1="0" y1="${middle}" x2="${width}" y2="${middle}"></line>
    ${segments.map((segment) => html`<rect class="segment ${segment.phase}" x="${x(segment.start)}" y="${middle - bar / 2}" width="${Math.max(1, x(segment.end) - x(segment.start)).toFixed(1)}" height="${bar}"></rect>`)}
    ${marks(phases).map((mark) => html`<line class="tick${mark.event === "impact" ? " impact" : ""}" x1="${x(mark.time)}" y1="${middle - bar / 2 - 6}" x2="${x(mark.time)}" y2="${middle + bar / 2 + 6}"></line>`)}
  </svg>`;
}

function phasesChapter(analysis) {
  const phases = analysis.phases;
  if (!phases) {
    if (analysis.status !== "analyzed") return "";
    return chapter("Phasen, geschätzt", html`<p class="lead">Die Phasen kommen mit einer neuen Auswertung in der App dazu. Dafür braucht es das Video.</p>`);
  }
  const shown = sureOnly(phases);
  return chapter(
    "Phasen, geschätzt",
    html`${shown.top != null ? timeline(analysis.range, shown) : ""}
      <ul class="rows">
        ${["backswing", "downswing", "followThrough"].map((phase) => {
          const seconds = durationOf(shown, phase);
          return seconds == null ? "" : valueRow(html`<span class="swatch ${phase}" aria-hidden="true"></span>${PHASE_NAMES[phase]}`, secondsText(seconds));
        })}
        ${marks(shown).map((mark) =>
          valueRow(EVENT_FULL_NAMES[mark.event], markTimeText(shown, analysis.range, mark.time), mark.event === "impact" && shown.impactSource ? IMPACT_SOURCE_TEXTS[shown.impactSource] : null),
        )}
        ${unsureEvents(phases).map((event) => missingRow(EVENT_FULL_NAMES[event], phaseMissingReason(phases, event) ?? "Zu unsicher"))}
      </ul>
      ${phases.notes.map((note) => hintRow(NOTE_TITLES[note.kind], NOTE_ADVICE[note.kind]))}`,
    {
      footer:
        "Die Zeitpunkte schätzt die App aus der Bewegung der Hände und des Führungsarms. Den Schläger sieht die Erkennung nicht. Ist ein Zeitpunkt zu unsicher, steht er ohne Zeit da. Die Zeiten sind der Abstand zum Treffmoment, ohne Treffmoment ab Beginn des Ausschnitts.",
    },
  );
}

function metricsChapter(analysis) {
  const metrics = analysis.metrics;
  if (!metrics) {
    if (analysis.phases?.address != null && analysis.phases?.top != null) {
      return chapter("Kennzahlen, geschätzt", html`<p class="lead">Die Kennzahlen kommen mit einer neuen Auswertung in der App dazu. Dafür braucht es das Video.</p>`);
    }
    return "";
  }
  const view = analysis.cameraAngle;
  const hidden = hiddenCount(metrics, view);
  let footer =
    "Alle Werte schätzt die App aus dem 3D-Skelett. Jeden Wert prüft sie: Sind die Gelenke dafür schlecht erkannt, zittert die Erkennung zu stark oder ist der Wert unmöglich, steht statt einer Zahl der Grund. Von vorne passen Kopf, Hüfte seitlich und die Uhr am besten, von hinten die Vorneigung und die Hüfte zum Ball.";
  if (!isChecked(metrics)) footer += " Diese Analyse ist älter und noch ohne Prüfung der einzelnen Werte. „Neu auswerten“ in der App holt sie nach, solange das Video da ist.";
  if (!metrics.scaleIsMeasured) footer += " Zentimeter sind grob, weil die App deine Körpergröße nicht kennt.";
  return chapter(
    "Kennzahlen, geschätzt",
    html`${hidden > 0
        ? html`<p class="lead">${hidden === 1 ? `1 von ${metrics.values.length} Werten fehlt` : `${hidden} von ${metrics.values.length} Werten fehlen`}</p>
            <p class="note">${metricsAdvice(metrics, view) ?? "Sie lassen sich aus dieser Ansicht nicht verlässlich schätzen."}</p>`
        : ""}
      ${GROUPS.map((group) => {
        const values = valuesInGroup(metrics, group);
        if (values.length === 0) return "";
        return html`<p class="kicker ink">${GROUP_NAMES[group]}</p>
          <ul class="rows">
            ${values.map((metric) => {
              const reason = missingReason(metric, view);
              return reason ? missingRow(METRICS[metric.kind].name, reason) : valueRow(METRICS[metric.kind].name, formatMetric(metric.kind, metric.value), metricDetail(metric.kind, analysis.swingType));
            })}
          </ul>`;
      })}`,
    { footer },
  );
}

function feedbackFor(analysis, store) {
  if (!analysis.metrics || !store.feedbackRules) return null;
  return evaluateFeedback(analysis.metrics, analysis.swingType, analysis.cameraAngle, analysis.frameRate, store.feedbackRules);
}

/** Ein Hinweis: Titel mit Wert, was die App sieht, was hilft, die Übungen dazu und die Übernahme als Schwerpunkt. */
function hintBlock(hint, isFirst, store) {
  const drills = hint.drillIDs.map((id) => store.drill(id)).filter(Boolean);
  return html`<div class="feedback-hint">
    <p class="kicker ${isFirst ? "flag" : ""}">${isFirst ? "Zuerst" : "Danach"}</p>
    <p class="feedback-title"><strong>${hint.title}</strong><span class="row-value">${hint.formattedValue}</span></p>
    <p class="feedback-text">${hint.text}</p>
    <p class="feedback-advice">${hint.advice}</p>
    ${drills.length > 0
      ? html`<ul class="rows">
          ${drills.map(
            (drill) => html`<li>
              <a class="row" href="#/uebungen/${encodeURIComponent(drill.id)}">
                <span class="row-main"><span class="row-title">${drill.name}${drill.isCorrective ? html` <span class="kicker ink">Korrektur</span>` : ""}</span><span class="row-sub">${drill.purpose}</span></span>
                <span class="mark" aria-hidden="true">›</span>
              </a>
            </li>`,
          )}
        </ul>`
      : ""}
    <button type="button" class="action" data-adopt="${hint.id}">Als Schwerpunkt übernehmen<span class="mark" aria-hidden="true">+</span></button>
  </div>`;
}

function feedbackChapter(analysis, store) {
  const feedback = feedbackFor(analysis, store);
  if (!feedback) return "";
  const unsureText = (count) => (count === 1 ? "Einen zu unsicheren Wert" : `${count} zu unsichere Werte`);
  let intro = null;
  if (feedback.hints.length === 0 && feedback.strengths.length === 0 && feedback.moreHints.length === 0 && feedback.tooFewFrames.length === 0) {
    intro = feedback.unsure.length === 0 ? "Für diese Schlagart und Ansicht gibt es noch keine Richtwerte." : "Die Werte aus diesem Video sind zu unsicher für eine Rückmeldung.";
  } else if (feedback.hints.length === 0) {
    // Was zu unsicher war, hat die App nicht bewertet. Dann darf sie nicht sagen, alles passe.
    intro = feedback.unsure.length === 0 ? "Aus diesem Video fällt nichts auf, woran du arbeiten müsstest." : `Aus den sicheren Werten fällt nichts auf. ${unsureText(feedback.unsure.length)} bewertet die App nicht.`;
  } else if (feedback.unsure.length > 0) {
    intro = `${unsureText(feedback.unsure.length)} bewertet die App nicht.`;
  }
  const more = expanded === analysis.id ? feedback.moreHints : [];
  return chapter(
    "Rückmeldung, geschätzt",
    html`${intro ? html`<p class="lead">${intro}</p>` : ""}
      ${feedback.hints.map((hint, index) => hintBlock(hint, index === 0, store))}
      ${more.map((hint) => hintBlock(hint, false, store))}
      ${feedback.moreHints.length > 0 && expanded !== analysis.id
        ? html`<button type="button" class="action" data-more>${feedback.moreHints.length === 1 ? "Noch ein Hinweis" : `Noch ${feedback.moreHints.length} Hinweise`}<span class="mark" aria-hidden="true">+</span></button>`
        : ""}
      ${feedback.tooFewFrames.length > 0 ? html`<p class="note">Tempo und Dauer bewertet die App erst ab 60 Bildern pro Sekunde. Das Video hat ${Math.round(analysis.frameRate)}. Stell die Kamera auf Zeitlupe.</p>` : ""}
      ${feedback.strengths.length > 0
        ? html`<p class="kicker ink">Das passt schon</p>
            <ul class="rows">${feedback.strengths.map((item) => valueRow(item.title, item.formattedValue, item.text))}</ul>`
        : ""}
      <a class="action" href="${BASE}/verlauf/${analysis.swingType}/${feedback.hints[0]?.metric ?? "tempoRatio"}">Verlauf über alle Analysen<span class="mark" aria-hidden="true">›</span></a>
      <a class="action" href="${BASE}/richtwerte/${analysis.swingType}/${analysis.cameraAngle}">Richtwerte und Quellen<span class="mark" aria-hidden="true">›</span></a>`,
    {
      footer:
        "Die Richtwerte kommen aus Messungen guter Spieler. Sie passen nicht für jeden Körper, und die Werte aus dem Video sind Schätzungen. Nimm dir eine Sache vor und sprich mit deinem Trainer, bevor du etwas umstellst.",
    },
  );
}

export function swingAnalysisPage(app, id) {
  const { store } = app;
  return {
    title: "Analyse",
    tab: "schwung",
    parent: BASE,
    render() {
      const analysis = store.analysis(id);
      if (!analysis) return empty("Analyse nicht gefunden.");
      return html`
        ${headline(dateTime.format(analysis.date), "Schwunganalyse")}
        <p class="note">Das Video und das Skelett liegen auf dem Gerät, das gefilmt hat. Hier stehen die Werte.</p>
        ${evaluationChapter(analysis, store.data.handedness ?? "right")}
        ${phasesChapter(analysis)}
        ${metricsChapter(analysis)}
        ${feedbackChapter(analysis, store)}
        ${chapter(
          "Ausschnitt",
          html`<ul class="rows facts">
            ${labeled("Ansicht", angleText(analysis))}
            ${labeled("Länge", secondsText(duration(analysis)))}
            ${labeled("Bildrate", `${Math.round(analysis.frameRate)} B/s`)}
            ${labeled("Ausgewertete Bilder", `etwa ${samplingCount(analysis.range, analysis.frameRate)}`)}
            ${analysis.club !== "" ? labeled("Schläger", analysis.club) : ""}
            ${analysis.note !== "" ? labeled("Notiz", analysis.note) : ""}
          </ul>`,
        )}
        <button type="button" class="action danger" data-delete>Analyse löschen</button>
      `;
    },
    mount(root) {
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({
          title: "Analyse löschen?",
          message: "Mit dem Konto verschwindet sie auch in der App. Das Video bleibt dort als Clip erhalten.",
          actions: [{ label: "Löschen", value: "delete", style: "danger" }],
        });
        if (choice !== "delete") return;
        store.deleteAnalysis(id);
        toast("Analyse gelöscht.");
        app.back(BASE);
      });
      root.querySelector("[data-more]")?.addEventListener("click", () => {
        expanded = id;
        app.render({ keepScroll: true });
      });
      root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-adopt]");
        if (!button) return;
        const analysis = store.analysis(id);
        const feedback = analysis ? feedbackFor(analysis, store) : null;
        const hint = feedback ? [...feedback.hints, ...feedback.moreHints].find((item) => item.id === button.dataset.adopt) : null;
        if (!hint) return;
        proposeFocus(suggestedFocus(hint, skillArea(analysis), store.library));
        app.navigate("#/mehr/schwerpunkte/neu");
      });
    },
  };
}

// MARK: - Verlauf

let historyChoice = { swingType: "full", metric: "tempoRatio" };

/** Linie mit Quadraten über die Analysen, mit dem Bereich guter Spieler als grauem Band. */
function historyChart(points, kind, target) {
  const width = 320;
  const height = 170;
  const left = 52;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const times = points.map((point) => point.date.getTime());
  const values = points.map((point) => chartValue(kind, point.value));
  let minX = Math.min(...times);
  let maxX = Math.max(...times);
  if (minX === maxX) {
    minX -= 86400000;
    maxX += 86400000;
  }
  const low = target?.low != null ? chartValue(kind, target.low) : null;
  const high = target?.high != null ? chartValue(kind, target.high) : null;
  let minY = Math.min(...values, ...(low != null ? [low] : []), ...(high != null ? [high] : []));
  let maxY = Math.max(...values, ...(low != null ? [low] : []), ...(high != null ? [high] : []));
  const padding = Math.max((maxY - minY) * 0.15, Math.abs(maxY) * 0.05, 0.5);
  minY -= padding;
  maxY += padding;
  const x = (time) => left + ((time - minX) / (maxX - minX)) * (width - left - right);
  const y = (value) => top + (1 - (value - minY) / (maxY - minY)) * (height - top - bottom);
  const path = points.map((point, index) => `${x(point.date.getTime()).toFixed(1)},${y(values[index]).toFixed(1)}`).join(" ");
  const tick = (value) => String(Math.round(value * 10) / 10).replace(".", ",");
  const label = `${METRICS[kind].name}: ${points.map((point) => `${formatShortDate(point.date)} ${formatMetric(kind, point.value)}`).join(", ")}.`;
  const bandTop = high != null ? y(high) : top;
  const bandBottom = low != null ? y(low) : height - bottom;
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    ${target ? html`<rect class="band" x="${left}" y="${bandTop.toFixed(1)}" width="${width - left - right}" height="${Math.max(1, bandBottom - bandTop).toFixed(1)}"></rect>` : ""}
    <line class="axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
    <line class="grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
    <text x="${left - 6}" y="${top + 4}" text-anchor="end">${tick(maxY)}</text>
    <text x="${left - 6}" y="${height - bottom + 4}" text-anchor="end">${tick(minY)}</text>
    <text x="${left}" y="${height - 6}">${dayMonth.format(points[0].date)}</text>
    <text x="${width - right}" y="${height - 6}" text-anchor="end">${dayMonth.format(points[points.length - 1].date)}</text>
    ${points.length > 1 ? html`<polyline points="${path}"></polyline>` : ""}
    ${points.map((point, index) => html`<rect x="${(x(point.date.getTime()) - 3).toFixed(1)}" y="${(y(values[index]) - 3).toFixed(1)}" width="6" height="6"></rect>`)}
  </svg>`;
}

export function analysisHistoryPage(app, swingType = null, metric = null) {
  const { store } = app;
  if (swingType) historyChoice = { swingType, metric: metric ?? historyChoice.metric };
  return {
    title: "Verlauf",
    tab: "schwung",
    parent: BASE,
    render() {
      const analyses = store.analyses();
      const types = historySwingTypes(analyses);
      if (types.length === 0) {
        return html`${headline("Verlauf", "Schwunganalyse")}
          <p class="note">Noch keine ausgewerteten Analysen. Der Verlauf zeigt, wie sich deine Werte von Schwung zu Schwung ändern.</p>`;
      }
      if (!types.includes(historyChoice.swingType)) historyChoice = { ...historyChoice, swingType: types[0] };
      const kinds = historyKinds(historyChoice.swingType, analyses);
      if (!kinds.includes(historyChoice.metric)) historyChoice = { ...historyChoice, metric: kinds[0] };
      const { swingType: type, metric: kind } = historyChoice;
      const points = historyPoints(kind, type, analyses);
      const target = targetFor(store.feedbackRules, kind, type);
      const share = target ? recentShare(points, target) : null;
      return html`
        ${headline("Verlauf", "Schwunganalyse")}
        <label class="field"><span>Schlagart</span><select data-history="swingType">${types.map((option) => html`<option value="${option}" ${option === type ? "selected" : ""}>${SWING_TYPE_NAMES[option]}</option>`)}</select></label>
        <label class="field"><span>Kennzahl</span><select data-history="metric">${kinds.map((option) => html`<option value="${option}" ${option === kind ? "selected" : ""}>${METRICS[option].name}</option>`)}</select></label>
        ${chapter(
          METRICS[kind].name,
          html`${historyChart(points, kind, target)}
            ${target ? html`<p class="note">${target.note}</p>` : ""}
            ${share && share.total > 0 ? html`<p class="lead">${share.inside} der letzten ${share.total} im Bereich guter Spieler.</p>` : ""}`,
          { footer: `${METRICS[kind].unit}. Jeder Punkt ist eine Analyse. ${target ? "Das graue Band ist der Bereich guter Spieler." : "Für diese Kennzahl gibt es keinen Richtwert."}` },
        )}
        <ul class="rows">
          ${[...points].reverse().map(
            (point) => html`<li>
              <a class="row" href="${BASE}/${encodeURIComponent(point.analysisID)}">
                <span class="row-main"><span class="row-title">${formatShortDate(point.date)}</span><span class="row-sub">${CAMERA_ANGLE_NAMES[point.cameraAngle]}</span></span>
                <span class="row-value">${formatMetric(kind, point.value)}</span>
              </a>
            </li>`,
          )}
        </ul>
      `;
    },
    mount(root) {
      root.addEventListener("change", (event) => {
        const select = event.target.closest("[data-history]");
        if (!select) return;
        // Die Wahl steht in der Adresse, sonst setzt die Route sie beim nächsten Zeichnen zurück.
        historyChoice = { ...historyChoice, [select.dataset.history]: select.value };
        app.navigate(`${BASE}/verlauf/${encodeURIComponent(historyChoice.swingType)}/${encodeURIComponent(historyChoice.metric)}`, { replace: true });
      });
    },
  };
}

// MARK: - Richtwerte

export function feedbackTargetsPage(app, swingType, cameraAngle = null) {
  const { store } = app;
  return {
    title: "Richtwerte",
    tab: "schwung",
    parent: BASE,
    render() {
      const type = SWING_TYPES.includes(swingType) ? swingType : "full";
      const targets = (store.feedbackRules?.targets ?? []).filter((target) => target.swingTypes.includes(type));
      return html`
        ${headline("Richtwerte", SWING_TYPE_NAMES[type])}
        ${targets.length === 0 ? html`<p class="note">Für diese Schlagart gibt es noch keine Richtwerte.</p>` : ""}
        ${targets.map((target) =>
          chapter(
            METRICS[target.metric].name,
            html`<p class="lead">${target.note}</p>
              ${cameraAngle && CAMERA_ANGLE_NAMES[cameraAngle] && !isReliable(target.metric, cameraAngle) ? html`<p class="note">Aus der Ansicht „${CAMERA_ANGLE_NAMES[cameraAngle]}“ unsicher, deshalb ohne Bewertung.</p>` : ""}
              ${target.hints.length > 0
                ? html`<ul class="rows">${target.hints.map((hint) => html`<li class="row"><span class="row-main"><span class="row-title">${hint.title}</span><span class="row-sub">${hintLimitText(hint, target.metric)}</span></span></li>`)}</ul>`
                : ""}
              ${target.sources.map((source) => html`<a class="action" href="${source.url}" target="_blank" rel="noopener">${source.title}<span class="mark" aria-hidden="true">↗</span></a>`)}`,
          ),
        )}
      `;
    },
  };
}
