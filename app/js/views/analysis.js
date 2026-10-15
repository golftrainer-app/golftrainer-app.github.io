// Schwunganalyse: Analysen aus der App ansehen. Mit dem Konto kommen Angaben,
// Kurzfassung der Erkennung, Phasen, Kennzahlen und die Rückmeldung in den
// Browser, ohne Video und Skelett: Beide bleiben auf dem Gerät, das gefilmt
// hat. Die Texte und Werte rechnet js/core/analysis.js wie der Kern der App.
import {
  CAMERA_ANGLES, CAMERA_ANGLE_NAMES, EVENT_FULL_NAMES, EVENT_NAMES, GROUP_NAMES, GROUPS, IMPACT_SOURCE_TEXTS, METRICS, NOTE_ADVICE, NOTE_TITLES, PHASE_NAMES, SWING_TYPES,
  SWING_TYPE_NAMES, analysisStatusText, analysisSubtitle, angleText, chartValue, detectedText, duration, durationOf, encodeAnalysis, evaluateFeedback, formatMetric,
  frameRateRating, handednessMismatch, handednessText, hiddenCount, hintLimitText, historyKinds, historyPoints, historySwingTypes, isChecked, isReliable, lengthHint,
  makeAnalysis, markTimeText, marks, metricDetail, metricsAdvice, missingReason, movingEnd, movingStart, phaseAt, phaseMissingReason, rangeAround, recentShare,
  samplingCount, scaleText, secondsText, skillArea, suggestedFocus, suggestedRange, sureOnly, targetFor, unsureEvents, valuesInGroup, warningAdvice, warningTitle,
} from "../core/analysis.js";
import { formatShortDate } from "../core/dates.js";
import { newID } from "../core/model.js";
import { decodeFrames, encodeFrames, isDetected, isReliableHandedness, nearestFrame, smoothed } from "../core/pose.js";
import { ORBIT_VIEWS, orbitView, rotatedView, swingSpace } from "../core/swing.js";
import { clipStore } from "../clips.js";
import { SEQUENCE_VERSION, poseStore } from "../poses.js";
import { SOURCE, analyzeClip, loadVideo, measureFrameRate } from "../pose/analyze.js";
import { describePoseError } from "../pose/estimator.js";
import { ask, chapter, empty, headline, html, labeled, progress, toast } from "../ui.js";
import { proposeFocus } from "./more.js";
import { mountClipPlayer, playerMarkup } from "./player.js";
import { drawOverlay, drawScene } from "./skeleton.js";

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
              <p class="lead">Filme einen Schwung von vorne oder von hinten. Die Web-App schätzt daraus ein 3D-Skelett und berechnet Drehung, Haltung und Tempo. Alles bleibt im Browser; mit Konto kommen die Werte auch auf dein iPhone.</p>
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
        <a class="action" href="${BASE}/neu">Neue Analyse<span class="mark" aria-hidden="true">+</span></a>
        ${types.length > 0 ? html`<a class="action" href="${BASE}/verlauf">Verlauf über alle Analysen<span class="mark" aria-hidden="true">›</span></a>` : ""}
        <p class="note">Analysen aus der App kommen mit dem Konto hierher, ohne Video und Skelett: Beide bleiben auf dem Gerät, das gefilmt hat. Analysen aus diesem Browser haben beides hier.</p>
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

function evaluationChapter(analysis, setting, { clip = null, running = null, message = null } = {}) {
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
    : html`<p class="lead">${clip && !running ? "Noch nicht ausgewertet. Die Web-App schätzt in jedem Bild des Ausschnitts das 3D-Skelett und prüft, wie gut sie dich erkennt." : statusLong(analysis)}</p>`;
  let actions = "";
  if (running) {
    const percent = running.total > 0 ? Math.round((running.done / running.total) * 100) : 0;
    actions = html`<p class="evaluation-stage" data-evaluation-stage>${running.stage}</p>
      <div data-evaluation-progress>${progress(running.done, Math.max(running.total, 1), { label: "Fortschritt der Auswertung" })}</div>
      <p class="kicker evaluation-percent" data-evaluation-percent>${percent} %</p>
      <button type="button" class="action" data-evaluate="cancel">Abbrechen<span class="mark" aria-hidden="true">×</span></button>`;
  } else if (clip) {
    actions = pose
      ? html`<button type="button" class="action" data-evaluate="start">Neu auswerten<span class="mark" aria-hidden="true">›</span></button>`
      : html`<div class="buttons"><button type="button" class="button flag" data-evaluate="start">Jetzt auswerten</button></div>`;
  }
  return chapter("Auswertung", html`${message ? html`<p class="note flag">${message}</p>` : ""}${body}${actions}`, {
    footer: clip
      ? "Alle Werte schätzt die Web-App aus dem Kamerabild. Sie sind Richtwerte, keine Messung wie im Labor. Die Erkennung läuft nur in diesem Browser und braucht etwas Zeit. Lass die Seite so lange offen."
      : "Alle Werte schätzt die App aus dem Kamerabild. Sie sind Richtwerte, keine Messung wie im Labor. Auswerten und neu auswerten geht dort, wo das Video liegt.",
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

function phasesChapter(analysis, canJump = false) {
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
        ${marks(shown).map((mark) => {
          const detail = mark.event === "impact" && shown.impactSource ? IMPACT_SOURCE_TEXTS[shown.impactSource] : null;
          if (!canJump) return valueRow(EVENT_FULL_NAMES[mark.event], markTimeText(shown, analysis.range, mark.time), detail);
          return html`<li>
            <button type="button" class="row metric jump" data-jump="${mark.time}" aria-label="${EVENT_FULL_NAMES[mark.event]} im Video und im Skelett zeigen">
              <span class="row-main"><span class="row-title">${EVENT_FULL_NAMES[mark.event]}</span>${detail ? html`<span class="row-sub">${detail}</span>` : ""}</span>
              <span class="row-value">${markTimeText(shown, analysis.range, mark.time)}</span>
              <span class="mark" aria-hidden="true">→</span>
            </button>
          </li>`;
        })}
        ${unsureEvents(phases).map((event) => missingRow(EVENT_FULL_NAMES[event], phaseMissingReason(phases, event) ?? "Zu unsicher"))}
      </ul>
      ${phases.notes.map((note) => hintRow(NOTE_TITLES[note.kind], NOTE_ADVICE[note.kind]))}`,
    {
      footer:
        `Die Zeitpunkte schätzt die App aus der Bewegung der Hände und des Führungsarms. Den Schläger sieht die Erkennung nicht. Ist ein Zeitpunkt zu unsicher, steht er ohne Zeit da. Die Zeiten sind der Abstand zum Treffmoment, ohne Treffmoment ab Beginn des Ausschnitts.${canJump ? " Tippe auf einen Zeitpunkt, dann springen Video und Skelett dorthin." : ""}`,
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

// Geladenes zur offenen Analyse: Clip und Video-Adresse aus dem Speicher der
// Kamera, geglättete Bildfolge und Raum aus dem Speicher der Posen.
let loaded = { id: null, checked: false, pending: false, clip: null, url: null, frames: null, detected: null, space: null };
/** Laufende Auswertungen je Analyse: Schritt, Fortschritt, Abbruch. Laufen weiter, wenn du die Seite verlässt. */
const evaluations = new Map();
/** Letzte Meldung je Analyse, z. B. warum die Auswertung scheiterte. */
const messages = new Map();
/** Analyse, die nach dem Zuschneiden gleich ausgewertet wird. */
let autoEvaluate = null;
/** Ansicht des Skeletts: Blickrichtung, Bild, Handweg; bleibt beim Neuzeichnen. */
let scene = { id: null, view: { ...ORBIT_VIEWS.front }, index: 0, showsHandPath: true, overlaySkeleton: true, overlayPath: true };
const PRESETS = [
  ["front", "Vorne", ORBIT_VIEWS.front],
  ["behind", "Hinten", ORBIT_VIEWS.behind],
  ["above", "Oben", ORBIT_VIEWS.above],
  ["angled", "Schräg", orbitView(35, 25)],
];
const sameView = (a, b) => Math.abs(a.azimuth - b.azimuth) < 1e-9 && Math.abs(a.elevation - b.elevation) < 1e-9;

function releaseLoaded() {
  if (loaded.url) URL.revokeObjectURL(loaded.url);
  loaded = { id: null, checked: false, pending: false, clip: null, url: null, frames: null, detected: null, space: null };
}

/** Spielhand wie bei den Kennzahlen: die erkannte, wenn sie sicher ist, sonst die Einstellung. */
function playingHand(analysis, store) {
  if (analysis.metrics?.handedness) return analysis.metrics.handedness;
  const estimate = analysis.pose?.handedness;
  if (estimate && isReliableHandedness(estimate) && estimate.handedness) return estimate.handedness;
  return store.data.handedness ?? "right";
}

/** Clip und Bildfolge aus dem Speicher des Browsers, einmal je Analyse. */
async function loadResources(analysis, store) {
  const id = analysis.id;
  // Clip und Video-Adresse bleiben, wenn nur die Bildfolge neu ist, z. B. nach dem Auswerten.
  let clip = loaded.id === id && loaded.clip?.id === analysis.clipID ? loaded.clip : null;
  let url = clip ? loaded.url : null;
  if (loaded.id === id && loaded.url && !url) URL.revokeObjectURL(loaded.url);
  loaded = { ...loaded, id, pending: true, clip, url };
  if (analysis.clipID && !clip) {
    try {
      clip = (await clipStore().list()).find((item) => item.id === analysis.clipID) ?? null;
      const blob = clip ? await clipStore().blob(clip.id) : null;
      if (blob) url = URL.createObjectURL(blob);
      else clip = null;
    } catch {
      clip = null;
    }
  }
  let frames = null;
  let detected = null;
  let space = null;
  try {
    const sequence = await poseStore().get(id);
    if (sequence?.frames) {
      const raw = decodeFrames(sequence.frames);
      frames = smoothed(raw);
      detected = frames.filter(isDetected);
      space = swingSpace(raw, analysis.phases, playingHand(analysis, store));
    }
  } catch {
    frames = null;
  }
  if (loaded.id !== id) {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
  loaded = { id, checked: true, pending: false, clip, url, frames, detected, space };
  return true;
}

function sceneCaption(phases, frame, position, count) {
  const place = `Bild ${position} von ${count}`;
  const phase = phaseAt(phases, frame.time);
  return phase ? `${PHASE_NAMES[phase]} · ${place}` : place;
}

function nearestIndex(frames, time) {
  let best = 0;
  for (let index = 1; index < frames.length; index += 1) if (Math.abs(frames[index].time - time) < Math.abs(frames[best].time - time)) best = index;
  return best;
}

function skeletonChapter(analysis, state) {
  const title = "3D-Skelett, geschätzt";
  if (!state.detected) {
    return chapter(title, html`<p class="lead">${state.pending || !state.checked ? "Die Skelettdaten laden …" : "Die Skelettdaten liegen nicht in diesem Browser, z. B. weil die Analyse auf einem anderen Gerät entstand. Werte neu aus, solange das Video da ist."}</p>`);
  }
  if (state.detected.length === 0) return chapter(title, html`<p class="lead">In keinem Bild wurde eine Person erkannt.</p>`);
  if (scene.id !== analysis.id) scene = { ...scene, id: analysis.id, index: 0, view: { ...(analysis.cameraAngle === "downTheLine" ? ORBIT_VIEWS.behind : ORBIT_VIEWS.front) } };
  const position = Math.min(scene.index, state.detected.length - 1);
  const current = state.detected[position];
  const sure = analysis.phases ? sureOnly(analysis.phases) : null;
  const jumps = sure ? marks(sure).filter((mark) => ["address", "top", "impact", "finish"].includes(mark.event)) : [];
  return chapter(
    title,
    html`<div class="choice" role="group" aria-label="Ansicht">
        ${PRESETS.map(([key, name, view]) => html`<button type="button" data-preset="${key}" aria-pressed="${String(sameView(scene.view, view))}">${name}</button>`)}
      </div>
      <div class="skeleton-scene"><canvas data-scene role="img" aria-label="Geschätztes 3D-Skelett. Waagerecht ziehen dreht es."></canvas></div>
      <p class="skeleton-caption"><strong data-scene-time>${secondsText(current.time)}</strong><span class="kicker" data-scene-caption>${sceneCaption(sure, current, position + 1, state.detected.length)}</span></p>
      <input type="range" min="0" max="${state.detected.length - 1}" step="1" value="${position}" data-scene-index aria-label="Bild">
      ${jumps.length > 0 ? html`<div class="jump-grid">${jumps.map((mark) => html`<button type="button" class="button outline" data-jump="${mark.time}">${EVENT_NAMES[mark.event]}</button>`)}</div>` : ""}
      <div class="choice" role="group" aria-label="Handweg"><button type="button" data-scene-path aria-pressed="${String(scene.showsHandPath)}">Handweg</button></div>`,
    {
      footer:
        "Zieh waagerecht über das Skelett, um es zu drehen. „Hinten“ zeigt den Schwung entlang der Ziellinie, auch wenn du von vorne gefilmt hast. Von hinten und von oben siehst du die geschätzte Tiefe. Sie ist unsicherer als alles, was quer zur Kamera passiert. Die Hände in Fahnenrot, die linke Körperseite heller.",
    },
  );
}

/** Wertet eine Analyse im Browser aus und speichert Bildfolge und Werte wie die App. */
async function startEvaluation(app, store, id) {
  const analysis = store.analysis(id);
  const clip = loaded.id === id ? loaded.clip : null;
  if (!analysis || !clip || evaluations.has(id)) return;
  const blob = await clipStore().blob(clip.id);
  if (!blob) {
    messages.set(id, "Das Video ist nicht mehr da.");
    app.render({ keepScroll: true });
    return;
  }
  const controller = new AbortController();
  const state = { stage: "Die Erkennung lädt …", done: 0, total: 0, controller };
  evaluations.set(id, state);
  messages.delete(id);
  app.render({ keepScroll: true });
  const paint = () => {
    const stage = document.querySelector("[data-evaluation-stage]");
    if (stage) stage.textContent = state.stage;
    const rect = document.querySelector("[data-evaluation-progress] rect");
    if (rect) rect.setAttribute("width", (state.total > 0 ? (100 * state.done) / state.total : 0).toFixed(1));
    const percent = document.querySelector("[data-evaluation-percent]");
    if (percent) percent.textContent = `${state.total > 0 ? Math.round((100 * state.done) / state.total) : 0} %`;
  };
  let lock = null;
  try {
    lock = (await navigator.wakeLock?.request?.("screen")) ?? null;
  } catch {
    lock = null;
  }
  try {
    const result = await analyzeClip({
      blob,
      range: analysis.range,
      frameRate: analysis.frameRate,
      cameraAngle: analysis.cameraAngle,
      handedness: store.data.handedness ?? "right",
      clipImpact: clip.impactOffset ?? null,
      onProgress: (done, total) => {
        state.done = done;
        state.total = total;
        paint();
      },
      onStage: (text) => {
        state.stage = text;
        paint();
      },
      signal: controller.signal,
    });
    await poseStore().put({ analysisID: id, version: SEQUENCE_VERSION, createdAt: Date.now(), source: SOURCE, bodyHeight: null, heightIsMeasured: false, frames: encodeFrames(result.frames) });
    const current = store.analysis(id);
    if (current) {
      store.upsertAnalysis(encodeAnalysis({ ...current, pose: result.summary, phases: result.phases, metrics: result.metrics, status: result.isUsable ? "analyzed" : "failed" }));
    }
    if (!result.isUsable) messages.set(id, "In zu wenigen Bildern war eine Person zu erkennen.");
    // Die Bildfolge neu laden, der Clip bleibt.
    if (loaded.id === id) loaded = { ...loaded, checked: false, frames: null, detected: null, space: null };
  } catch (error) {
    if (error?.name !== "AbortError") messages.set(id, describePoseError(error));
  } finally {
    evaluations.delete(id);
    lock?.release?.().catch(() => {});
    if (window.location.hash.endsWith(`/${id}`)) app.render({ keepScroll: true });
  }
}

export function swingAnalysisPage(app, id) {
  const { store } = app;
  return {
    title: "Analyse",
    tab: "schwung",
    parent: BASE,
    keepOnChange: true,
    render() {
      const analysis = store.analysis(id);
      if (!analysis) return empty("Analyse nicht gefunden.");
      if (loaded.id !== id) releaseLoaded();
      const state = loaded.id === id ? loaded : { checked: false, pending: false, clip: null, url: null, frames: null, detected: null, space: null };
      const canJump = Boolean(state.clip || state.detected);
      return html`
        ${headline(dateTime.format(analysis.date), "Schwunganalyse")}
        ${state.clip
          ? html`${playerMarkup(html, { impact: state.clip.impactOffset != null })}
              ${state.frames
                ? html`<div class="choice" role="group" aria-label="Über dem Video">
                    <button type="button" data-overlay="skeleton" aria-pressed="${String(scene.overlaySkeleton)}">Skelett</button>
                    <button type="button" data-overlay="path" aria-pressed="${String(scene.overlayPath)}">Handweg</button>
                  </div>`
                : ""}`
          : state.checked || !analysis.clipID
            ? html`<p class="note">${analysis.clipID ? "Das Video liegt nicht in diesem Browser. Hier stehen die Werte." : "Das Video ist gelöscht. Die Werte der Analyse bleiben erhalten."}</p>`
            : ""}
        ${evaluationChapter(analysis, store.data.handedness ?? "right", { clip: state.clip, running: evaluations.get(id) ?? null, message: messages.get(id) ?? null })}
        ${phasesChapter(analysis, canJump)}
        ${metricsChapter(analysis)}
        ${feedbackChapter(analysis, store)}
        ${analysis.pose ? skeletonChapter(analysis, state) : ""}
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
      const analysis = store.analysis(id);
      if (!analysis) return undefined;
      // Clip und Skelett laden, dann einmal neu zeichnen.
      if (loaded.id !== id || (!loaded.checked && !loaded.pending)) {
        loadResources(analysis, store).then((fresh) => {
          if (!fresh || !window.location.hash.endsWith(`/${id}`)) return;
          app.render({ keepScroll: true });
          if (autoEvaluate === id) {
            autoEvaluate = null;
            startEvaluation(app, store, id);
          }
        });
      }
      const state = loaded.id === id ? loaded : null;
      const cleanups = [];

      // Video mit dem Skelett darüber.
      const area = root.querySelector("[data-clip-player]");
      let video = null;
      let overlay = null;
      if (area && state?.clip && state.url) {
        cleanups.push(mountClipPlayer(area, state.url, state.clip));
        video = area.querySelector("[data-video]");
        if (state.frames) {
          overlay = document.createElement("canvas");
          overlay.setAttribute("aria-hidden", "true");
          area.querySelector(".video-frame")?.appendChild(overlay);
        }
      }
      const sceneCanvas = root.querySelector("[data-scene]");
      const detected = state?.detected ?? null;
      const sure = analysis.phases ? sureOnly(analysis.phases) : null;
      const paintScene = () => {
        if (!sceneCanvas || !detected || detected.length === 0) return;
        const position = Math.min(scene.index, detected.length - 1);
        drawScene(sceneCanvas, { frames: detected, current: position, space: state.space, view: scene.view, phases: sure, showsHandPath: scene.showsHandPath });
        const time = root.querySelector("[data-scene-time]");
        if (time) time.textContent = secondsText(detected[position].time);
        const caption = root.querySelector("[data-scene-caption]");
        if (caption) caption.textContent = sceneCaption(sure, detected[position], position + 1, detected.length);
        const slider = root.querySelector("[data-scene-index]");
        if (slider && Number(slider.value) !== position) slider.value = String(position);
        for (const button of root.querySelectorAll("[data-preset]")) {
          const preset = PRESETS.find(([key]) => key === button.dataset.preset);
          button.setAttribute("aria-pressed", String(preset ? sameView(scene.view, preset[2]) : false));
        }
      };
      const paintOverlay = () => {
        if (!overlay || !video || !state?.frames) return;
        drawOverlay(overlay, { frames: state.frames, time: video.currentTime, video, showsSkeleton: scene.overlaySkeleton, showsHandPath: scene.overlayPath });
      };
      const seekVideo = (time) => {
        if (!video) return;
        video.pause();
        video.currentTime = Math.min(Math.max(time, 0), video.duration || time);
      };
      const showTime = (time) => {
        if (detected && detected.length > 0) {
          scene.index = nearestIndex(detected, time);
          paintScene();
        }
      };
      paintScene();

      // Läuft das Video, laufen Skelett und Überlagerung mit.
      let lastTime = null;
      let frameHandle = null;
      const tick = () => {
        if (video && video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          paintOverlay();
          showTime(lastTime);
        }
        frameHandle = requestAnimationFrame(tick);
      };
      if (video) frameHandle = requestAnimationFrame(tick);
      const onResize = () => {
        paintScene();
        paintOverlay();
      };
      window.addEventListener("resize", onResize);
      cleanups.push(() => {
        window.removeEventListener("resize", onResize);
        if (frameHandle != null) cancelAnimationFrame(frameHandle);
      });

      // Drehen mit dem Finger: waagerecht ziehen, senkrecht bleibt fürs Blättern.
      if (sceneCanvas) {
        let drag = null;
        sceneCanvas.addEventListener("pointerdown", (event) => {
          drag = { x: event.clientX, y: event.clientY, view: scene.view, active: false, id: event.pointerId };
        });
        sceneCanvas.addEventListener("pointermove", (event) => {
          if (!drag || event.pointerId !== drag.id) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (!drag.active) {
            if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy)) return;
            drag.active = true;
            sceneCanvas.setPointerCapture?.(event.pointerId);
          }
          scene.view = rotatedView(drag.view, -dx * 0.5, 0);
          paintScene();
        });
        const endDrag = () => {
          drag = null;
        };
        sceneCanvas.addEventListener("pointerup", endDrag);
        sceneCanvas.addEventListener("pointercancel", endDrag);
      }
      root.querySelector("[data-scene-index]")?.addEventListener("input", (event) => {
        if (!detected) return;
        scene.index = Math.min(Math.max(Number(event.target.value), 0), detected.length - 1);
        paintScene();
        seekVideo(detected[scene.index].time);
      });

      root.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.dataset.preset) {
          const preset = PRESETS.find(([key]) => key === button.dataset.preset);
          if (preset) scene.view = { ...preset[2] };
          paintScene();
          return;
        }
        if (button.hasAttribute("data-scene-path")) {
          scene.showsHandPath = !scene.showsHandPath;
          button.setAttribute("aria-pressed", String(scene.showsHandPath));
          paintScene();
          return;
        }
        if (button.dataset.overlay) {
          if (button.dataset.overlay === "skeleton") scene.overlaySkeleton = !scene.overlaySkeleton;
          else scene.overlayPath = !scene.overlayPath;
          button.setAttribute("aria-pressed", String(button.dataset.overlay === "skeleton" ? scene.overlaySkeleton : scene.overlayPath));
          paintOverlay();
          return;
        }
        if (button.dataset.jump != null) {
          const time = Number(button.dataset.jump);
          seekVideo(time);
          showTime(time);
          return;
        }
        if (button.dataset.evaluate === "start") {
          startEvaluation(app, store, id);
          return;
        }
        if (button.dataset.evaluate === "cancel") {
          evaluations.get(id)?.controller.abort();
          return;
        }
        if (button.hasAttribute("data-delete")) {
          const choice = await ask({
            title: "Analyse löschen?",
            message: "Mit dem Konto verschwindet sie auch in der App. Das Video bleibt als Clip erhalten.",
            actions: [{ label: "Löschen", value: "delete", style: "danger" }],
          });
          if (choice !== "delete") return;
          evaluations.get(id)?.controller.abort();
          store.deleteAnalysis(id);
          poseStore()
            .remove(id)
            .catch(() => {});
          if (loaded.id === id) releaseLoaded();
          toast("Analyse gelöscht.");
          app.back(BASE);
          return;
        }
        if (button.hasAttribute("data-more")) {
          expanded = id;
          app.render({ keepScroll: true });
          return;
        }
        if (button.dataset.adopt) {
          const current = store.analysis(id);
          const feedback = current ? feedbackFor(current, store) : null;
          const hint = feedback ? [...feedback.hints, ...feedback.moreHints].find((item) => item.id === button.dataset.adopt) : null;
          if (!hint) return;
          proposeFocus(suggestedFocus(hint, skillArea(current), store.library));
          app.navigate("#/mehr/schwerpunkte/neu");
        }
      });
      return () => {
        for (const cleanup of cleanups) cleanup?.();
      };
    },
  };
}

// MARK: - Neue Analyse: Ansicht und Video wählen

/** Ansicht für die nächste Analyse, bleibt bis zum Neuladen. */
let draft = { cameraAngle: "faceOn" };
const SETUP_STEPS = [
  ["Stativ", "Das Handy muss ruhig stehen. Aus der Hand gefilmt wackelt das Bild, und die Werte stimmen nicht."],
  ["Ganzer Körper", "Hochkant filmen. Über dem Kopf und unter den Füßen etwas Platz lassen, du stehst in der Bildmitte."],
  ["Gerade", "Nicht nach oben oder unten kippen. Die Kamera auf Hüfthöhe."],
  ["Licht", "Viele Bilder pro Sekunde brauchen viel Licht, draußen geht es am besten. Eng anliegende Kleidung hilft der Erkennung."],
  ["Zeitlupe", "In der Kamera-App deines Handys den Zeitlupen-Modus wählen: 120 oder 240 Bilder pro Sekunde machen Tempo und Treffmoment genauer. Die Kamera dieser Web-App nimmt mit 30 bis 60 auf."],
];
const clipTime = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Ein gewähltes Video kommt zu den Clips, damit es später wieder da ist. */
async function importVideo(file) {
  const { video, url } = await loadVideo(file);
  const clipDuration = Number.isFinite(video.duration) ? video.duration : 0;
  URL.revokeObjectURL(url);
  video.removeAttribute("src");
  const clip = { id: newID(), date: file.lastModified || Date.now(), duration: clipDuration, impactOffset: null, swingType: "full", trigger: "import", mimeType: file.type, size: file.size, name: file.name };
  await clipStore().add(clip, file);
  return clip;
}

/** Clips der Kamera für die Seite „Neue Analyse“, geladen beim Öffnen; bleibt beim Neuzeichnen. */
let clipsForAnalysis = { items: null, key: "" };

export function newAnalysisPage(app) {
  const clips = clipsForAnalysis.items;
  return {
    title: "Schwung analysieren",
    tab: "schwung",
    parent: BASE,
    keepOnChange: true,
    render() {
      return html`
        ${headline("Schwung analysieren", "Schwunganalyse")}
        <p class="lead">Aus einem Video schätzt die Web-App dein Skelett in 3D und berechnet daraus Drehung, Haltung und Tempo. Video und Skelett bleiben im Browser. Mit Konto gleicht sie nur die Kennzahlen ab.</p>
        ${chapter(
          "Ansicht",
          html`<div class="choice" role="group" aria-label="Ansicht">
            ${CAMERA_ANGLES.map((angle) => html`<button type="button" data-angle="${angle}" aria-pressed="${String(angle === draft.cameraAngle)}">${CAMERA_ANGLE_NAMES[angle]}</button>`)}
          </div>`,
          { footer: "Von vorne (Face-on): Kamera gegenüber, rechtwinklig zur Ziellinie. Das zeigt Kopf, Hüfte seitlich und die Uhr des Führungsarms am besten. Von hinten (Down-the-Line): Kamera hinter dir entlang der Ziellinie, auf Höhe der Hände. Das zeigt Vorneigung und Hüfte zum Ball. Die Ansicht lässt sich beim Zuschneiden noch ändern." },
        )}
        ${chapter("So filmst du", html`<ol class="setup-steps">${SETUP_STEPS.map(([title, text]) => html`<li><strong>${title}:</strong> ${text}</li>`)}</ol>`)}
        ${chapter(
          "Video",
          html`<div class="buttons">
              <label class="button flag">Video aus der Galerie wählen<input class="visually-hidden" type="file" accept="video/*" data-file></label>
              <a class="button outline" href="#/schwung/kamera">Mit der Kamera filmen</a>
            </div>
            <p class="hint" data-import hidden></p>
            ${clips == null
              ? html`<p class="note">Clips laden …</p>`
              : clips.length === 0
                ? html`<p class="note">Noch keine Clips. Filme einen Schwung mit der Kamera oder wähle ein Video aus deiner Galerie.</p>`
                : html`<p class="kicker">Deine Clips</p>
                    <ul class="rows">
                      ${clips.map(
                        (clip) => html`<li>
                          <a class="row log" href="${BASE}/neu/${encodeURIComponent(clip.id)}">
                            <span class="row-main"><span class="row-title">${clipTime.format(new Date(clip.date))} Uhr</span><span class="row-sub">${SWING_TYPE_NAMES[clip.swingType] ?? "Voller Schwung"} · ${secondsText(clip.duration ?? 0)}${clip.impactOffset != null ? " · mit Treffmoment" : ""}</span></span>
                            <span class="mark" aria-hidden="true">›</span>
                          </a>
                        </li>`,
                      )}
                    </ul>`}`,
          { footer: "Die Kamera mit automatischem Auslöser speichert jeden Schwung als Clip. Ein gewähltes Video kommt zu den Clips dazu, damit es später wieder da ist. Danach schneidest du es auf Ansprechen bis Finish zu." },
        )}
      `;
    },
    mount(root) {
      // Jedes Öffnen lädt die Clips neu, zeichnet aber nur, wenn sich etwas geändert hat.
      clipStore()
        .list()
        .then((items) => {
          const key = items.map((clip) => `${clip.id}:${clip.impactOffset ?? ""}`).join(",");
          if (clipsForAnalysis.items && clipsForAnalysis.key === key) return;
          clipsForAnalysis = { items, key };
          if (window.location.hash.endsWith("/analysen/neu")) app.render({ keepScroll: true });
        })
        .catch(() => {
          if (clipsForAnalysis.items) return;
          clipsForAnalysis = { items: [], key: "" };
          if (window.location.hash.endsWith("/analysen/neu")) app.render({ keepScroll: true });
        });
      root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-angle]");
        if (!button) return;
        draft = { ...draft, cameraAngle: button.dataset.angle };
        for (const other of root.querySelectorAll("[data-angle]")) other.setAttribute("aria-pressed", String(other === button));
      });
      root.querySelector("[data-file]")?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const note = root.querySelector("[data-import]");
        note.hidden = false;
        note.textContent = "Das Video wird übernommen …";
        try {
          const clip = await importVideo(file);
          app.navigate(`${BASE}/neu/${encodeURIComponent(clip.id)}`);
        } catch (error) {
          note.textContent = `Das Video ließ sich nicht übernehmen: ${error?.message ?? error}`;
        }
      });
    },
  };
}

// MARK: - Zuschneiden

/** Stand des Zuschneidens je Clip: bleibt beim Neuzeichnen und beim Wechsel zur Ansicht. */
const trims = new Map();

async function loadTrim(clipID) {
  const state = trims.get(clipID);
  try {
    const clip = (await clipStore().list()).find((item) => item.id === clipID) ?? null;
    const blob = clip ? await clipStore().blob(clip.id) : null;
    if (!clip || !blob) {
      state.error = "Clip nicht gefunden.";
      return;
    }
    const { video, url } = await loadVideo(blob);
    const total = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : clip.duration ?? 0;
    state.clip = clip;
    state.url = url;
    state.duration = total;
    state.impact = clip.impactOffset ?? null;
    state.range = suggestedRange(total, state.impact);
    // Bildrate messen: kurz abspielen, Abstände der Bilder zählen.
    state.frameRate = await measureFrameRate(video);
    video.removeAttribute("src");
    video.load();
  } catch (error) {
    state.error = `Das Video ließ sich nicht laden: ${error?.message ?? error}`;
  }
}

export function trimAnalysisPage(app, clipID) {
  const { store } = app;
  if (!trims.has(clipID)) trims.set(clipID, { clip: null, url: null, duration: 0, frameRate: null, range: [0, 0], impact: null, error: null, loading: false });
  const state = trims.get(clipID);
  const rangeText = () => `Ausschnitt ${secondsText(state.range[0])} bis ${secondsText(state.range[1])}, ${secondsText(state.range[1] - state.range[0])} lang`;
  const hintsMarkup = () => {
    const hints = [];
    if (state.frameRate) {
      hints.push(html`<p class="note">${Math.round(state.frameRate)} B/s · etwa ${samplingCount(state.range, state.frameRate)} Bilder werden ausgewertet</p>`);
      const rating = frameRateRating(state.frameRate);
      if (!rating.isRecommended) hints.push(html`<p class="hint">Nur ${Math.round(state.frameRate)} B/s. ${rating.advice}</p>`);
    } else {
      hints.push(html`<p class="note">Bildrate wird gemessen …</p>`);
    }
    const hint = lengthHint(state.range);
    if (hint) hints.push(html`<p class="hint">${hint}</p>`);
    return html`${hints}`;
  };
  return {
    title: "Zuschneiden",
    tab: "schwung",
    parent: `${BASE}/neu`,
    keepOnChange: true,
    render() {
      if (state.error) return html`${headline("Zuschneiden", "Schwunganalyse")}<p class="note flag">${state.error}</p>`;
      if (!state.clip) return html`${headline("Zuschneiden", "Schwunganalyse")}<p class="lead">Der Clip lädt …</p>`;
      return html`
        ${headline("Zuschneiden", "Schwunganalyse")}
        <div class="player clip-player" data-trim-player>
          <div class="video-frame analysis"><video playsinline muted preload="auto" data-video></video></div>
          <input type="range" min="0" max="${state.duration}" step="0.001" value="${state.range[0]}" data-scrub aria-label="Stelle im Video">
          <p class="video-time"><span data-time>${secondsText(state.range[0])}</span><span> von ${secondsText(state.duration)}</span></p>
          <div class="transport">
            <button type="button" class="button outline" data-play="start">Anfang</button>
            <button type="button" class="button outline" data-play="previous" aria-label="Ein Bild zurück">‹ Bild</button>
            <button type="button" class="button" data-play="toggle">Abspielen</button>
            <button type="button" class="button outline" data-play="next" aria-label="Ein Bild vor">Bild ›</button>
          </div>
        </div>
        <p class="kicker" data-range-text>${rangeText()}</p>
        <div class="trim-range">
          <button type="button" class="button outline" data-trim="start">Anfang hier</button>
          <button type="button" class="button outline" data-trim="end">Ende hier</button>
        </div>
        <button type="button" class="action" data-trim="impact">Treffmoment hier<span class="mark" aria-hidden="true">+</span></button>
        <p class="kicker">Ansicht</p>
        <div class="choice" role="group" aria-label="Ansicht">
          ${CAMERA_ANGLES.map((angle) => html`<button type="button" data-angle="${angle}" aria-pressed="${String(angle === draft.cameraAngle)}">${CAMERA_ANGLE_NAMES[angle]}</button>`)}
        </div>
        <div data-trim-hints>${hintsMarkup()}</div>
        <div class="buttons"><button type="button" class="button flag" data-trim="analyze" ${state.frameRate ? "" : "disabled"}>Ausschnitt analysieren</button></div>
        <p class="note">Vom Ansprechen bis ins Finish, mindestens 1 und höchstens 6 Sekunden. Nur der Ausschnitt wird ausgewertet, der Clip bleibt, wie er ist. „Treffmoment hier“ legt den Ausschnitt um die aktuelle Stelle.</p>
      `;
    },
    mount(root) {
      if (!state.clip && !state.loading && !state.error) {
        state.loading = true;
        loadTrim(clipID).then(() => {
          state.loading = false;
          if (window.location.hash.endsWith(`/neu/${encodeURIComponent(clipID)}`)) app.render({ keepScroll: true });
        });
        return undefined;
      }
      const video = root.querySelector("[data-video]");
      if (!video) return undefined;
      const scrub = root.querySelector("[data-scrub]");
      const timeLabel = root.querySelector("[data-time]");
      const toggle = root.querySelector("[data-play='toggle']");
      const frame = 1 / (state.frameRate || 30);
      video.src = state.url;
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = state.range[0];
      });
      const showTime = () => {
        timeLabel.textContent = secondsText(video.currentTime);
        scrub.value = String(video.currentTime);
        // Abspielen endet am Ende des Ausschnitts.
        if (!video.paused && video.currentTime >= state.range[1]) video.pause();
      };
      video.addEventListener("timeupdate", showTime);
      video.addEventListener("seeked", showTime);
      video.addEventListener("play", () => {
        toggle.textContent = "Pause";
      });
      video.addEventListener("pause", () => {
        toggle.textContent = "Abspielen";
      });
      const seek = (time) => {
        video.pause();
        video.currentTime = Math.min(Math.max(time, 0), state.duration);
      };
      scrub.addEventListener("input", () => seek(Number(scrub.value)));
      const refresh = () => {
        root.querySelector("[data-range-text]").textContent = rangeText();
        root.querySelector("[data-trim-hints]").innerHTML = String(hintsMarkup());
        const analyze = root.querySelector("[data-trim='analyze']");
        if (analyze) analyze.disabled = !state.frameRate || !(state.range[1] > state.range[0]);
      };
      root.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.dataset.play) {
          if (button.dataset.play === "toggle") {
            if (video.paused) {
              if (video.currentTime >= state.range[1] - 1e-3 || video.currentTime < state.range[0]) video.currentTime = state.range[0];
              video.playbackRate = 0.5;
              video.play().catch(() => {});
            } else video.pause();
          } else if (button.dataset.play === "start") seek(state.range[0]);
          else if (button.dataset.play === "previous") seek(video.currentTime - frame);
          else if (button.dataset.play === "next") seek(video.currentTime + frame);
          return;
        }
        if (button.dataset.angle) {
          draft = { ...draft, cameraAngle: button.dataset.angle };
          for (const other of root.querySelectorAll("[data-angle]")) other.setAttribute("aria-pressed", String(other === button));
          return;
        }
        switch (button.dataset.trim) {
          case "start":
            state.range = movingStart(video.currentTime, state.range, state.duration);
            refresh();
            break;
          case "end":
            state.range = movingEnd(video.currentTime, state.range, state.duration);
            refresh();
            break;
          case "impact": {
            video.pause();
            const time = video.currentTime;
            state.range = rangeAround(time, state.duration);
            if (state.impact == null) {
              state.impact = time;
              const updated = { ...state.clip, impactOffset: time };
              state.clip = updated;
              clipStore()
                .update(updated)
                .catch(() => {});
            }
            refresh();
            break;
          }
          case "analyze": {
            video.pause();
            const analysis = makeAnalysis({
              date: new Date(state.clip.date),
              clipID: state.clip.id,
              range: state.range,
              cameraAngle: draft.cameraAngle,
              frameRate: state.frameRate ?? 30,
              swingType: SWING_TYPES.includes(state.clip.swingType) ? state.clip.swingType : "full",
            });
            store.upsertAnalysis(encodeAnalysis(analysis));
            autoEvaluate = analysis.id;
            app.navigate(`${BASE}/${encodeURIComponent(analysis.id)}`);
            break;
          }
          default:
            break;
        }
      });
      return () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
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
