// Deine Daten in der Web-App. Sie liegen im Speicher des Browsers
// (localStorage) auf diesem Gerät, im selben JSON-Format wie in der App
// (AppData in App/Sources/AppModel.swift). An einen Server geht nur etwas,
// wenn du dich mit deinem Konto anmeldest (account.js).
// Was nur die App kennt, z. B. Launch-Monitor-Sessions aus einer Sicherung vom
// iPhone, bleibt unverändert erhalten.
import { decodeAnalyses, sortAnalyses } from "./core/analysis.js";
import { KEPT_LISTS, comparableText, createBackup, extraFields, merge, mergeResults } from "./core/backup.js";
import { planCalendar } from "./core/calendar.js";
import { seed, stations } from "./core/challenge.js";
import { addDays, daysBetween, formatShortDate, formatTime, fromStored, planCovers, startOfDay, startOfWeek, toStored } from "./core/dates.js";
import { level as difficultyLevel } from "./core/difficulty.js";
import { emptyGolfWeek, golfWeekSlots, sanitizeGolfWeek } from "./core/golfweek.js";
import { LIMITS, decodeData, decodeLibrary, encodeData, newID } from "./core/model.js";
import { Planner } from "./core/planner.js";
import { DELETION_KINDS, mergedData, mergedDeletions, noting, restoring } from "./core/sync.js";
import { fingerprint } from "./core/launch.js";
import { LOCAL_MEMBER, PLACES, entries as logEntries } from "./core/traininglog.js";

export const STORAGE_KEY = "golftrainer.data";
/** Gespeicherte Daten, die sich nicht lesen ließen. Sie bleiben, bis du alles löschst. */
export const DAMAGED_KEY = "golftrainer.data.unlesbar";
/** Laufende Stoppuhr. Wie in der App nicht Teil der Sicherung. */
export const RUNNING_KEY = "golftrainer.stoppuhr";

function sameReference(a, b) {
  return Boolean(a && b) && a.slotID === b.slotID && a.weekStart.getTime() === b.weekStart.getTime();
}

function findLastIndex(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (predicate(list[index])) return index;
  }
  return -1;
}

function upsert(list, item) {
  const index = list.findIndex((other) => other.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Gesperrt, z. B. wenn der Browser keine Website-Daten erlaubt.
    return null;
  }
}

export class Store {
  constructor(library, guide, feedbackRules = null) {
    this.library = library;
    this.guide = guide;
    /** Richtwerte und Hinweise der Schwunganalyse aus data/swing_feedback.json, wie in der App. */
    this.feedbackRules = feedbackRules;
    this.planner = new Planner(library);
    this.byID = new Map(library.map((drill) => [drill.id, drill]));
    this.listeners = new Set();
    /** Meldung, wenn Speichern oder Laden nicht geklappt hat. */
    this.problem = null;
    this.data = this.read();
    /** Training mit Stoppuhr, das gerade läuft: { start, place, entryID }, sonst null. */
    this.running = this.readRunning();
  }

  /** Übungen, Turnierleitfaden und Richtwerte der Schwunganalyse laden, dann die gespeicherten Daten. */
  static async open() {
    const [drills, guide, feedbackRules] = await Promise.all(
      ["data/drills.json", "data/tournament.json", "data/swing_feedback.json"].map(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${path} fehlt (${response.status}).`);
        return response.json();
      }),
    );
    return new Store(decodeLibrary(drills), guide, feedbackRules);
  }

  // MARK: - Lesen und Schreiben

  read() {
    const text = storage()?.getItem(STORAGE_KEY);
    if (!text) {
      const data = decodeData({});
      data.extra = {};
      return data;
    }
    try {
      const json = JSON.parse(text);
      const data = decodeData(json);
      data.extra = extraFields(json);
      return data;
    } catch {
      // Nicht überschreiben, was sich nicht lesen ließ: Es bleibt daneben liegen.
      // Ist kein Platz für die Kopie, startet die Seite trotzdem; sonst käme
      // niemand mehr bis zu „Meine Daten löschen“.
      try {
        storage()?.setItem(DAMAGED_KEY, text);
      } catch {
        // Kein Platz, der Hinweis unten bleibt.
      }
      this.problem = "Die gespeicherten Daten ließen sich nicht lesen. Die App startet neu, die alten Daten bleiben im Browser, bis du alles löschst.";
      const data = decodeData({});
      data.extra = {};
      return data;
    }
  }

  /** Nach Änderungen in einem anderen Tab. */
  reload() {
    this.data = this.read();
    this.running = this.readRunning();
    this.notify();
  }

  /** Die laufende Stoppuhr aus dem Browser. Ein unmöglicher Beginn gilt als keine. */
  readRunning() {
    const text = storage()?.getItem(RUNNING_KEY);
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      const start = fromStored(json.start);
      const time = start.getTime();
      if (!Number.isFinite(time) || time < LIMITS.earliest || time > LIMITS.latest) return null;
      return {
        start,
        place: PLACES.includes(json.place) ? json.place : null,
        entryID: typeof json.entryID === "string" && json.entryID ? json.entryID : newID(),
      };
    } catch {
      return null;
    }
  }

  saveRunning() {
    const store = storage();
    if (!store) return;
    try {
      if (this.running) {
        store.setItem(RUNNING_KEY, JSON.stringify({ start: toStored(this.running.start), place: this.running.place, entryID: this.running.entryID }));
      } else {
        store.removeItem(RUNNING_KEY);
      }
    } catch {
      this.problem = "Speichern fehlgeschlagen, z. B. weil der Speicher voll ist. Erstelle am besten gleich eine Sicherung.";
    }
  }

  save() {
    const store = storage();
    if (!store) {
      this.problem = "Der Browser erlaubt dieser Seite nicht, Daten zu speichern. Prüfe die Einstellungen für Website-Daten.";
      return;
    }
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ ...this.data.extra, ...encodeData(this.data) }));
      this.problem = null;
      // Einmal darum bitten, dass der Browser die Daten nicht von selbst aufräumt.
      if (!this.askedForPersistence) {
        this.askedForPersistence = true;
        globalThis.navigator?.storage?.persist?.().catch(() => {});
      }
    } catch {
      this.problem = "Speichern fehlgeschlagen, z. B. weil der Speicher voll ist. Erstelle am besten gleich eine Sicherung.";
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  /**
   * Ändert die Daten, speichert und zeichnet die Seite neu. `persist: false`
   * rechnet nur im Speicher, z. B. den ersten Plan: Die Seite legt erst etwas
   * im Browser ab, wenn du selbst etwas einträgst oder änderst.
   */
  change(mutate, { persist = true, stamp = true } = {}) {
    const result = mutate(this.data);
    if (persist) {
      this.save();
      // Mit Konto: bald abgleichen. account.js hängt sich hier ein. `stamp:
      // false` für Änderungen, die nicht von dir kommen, z. B. neue Vorschläge
      // zu Wochenbeginn: Sie zählen beim Abgleich nicht als eigene Änderung.
      this.changed?.({ stamp });
    }
    this.notify();
    return result;
  }

  /**
   * Löschmarke setzen, damit ein gelöschter Eintrag nach dem Abgleich über das
   * Konto nicht von einem anderen Gerät zurückkommt. Innerhalb von `change`.
   */
  noteDeletion(kind, id) {
    this.data.deletions = noting({ kind, id, at: new Date() }, this.data.deletions);
  }

  get hasStoredData() {
    return Boolean(storage()?.getItem(STORAGE_KEY));
  }

  // MARK: - Schwunganalysen

  /** Analysen aus der App, wie in `extra.analyses` gespeichert, gelesen und der neueste Schwung zuerst. */
  analyses() {
    return sortAnalyses(decodeAnalyses(this.data.extra?.analyses));
  }

  analysis(id) {
    return this.analyses().find((analysis) => analysis.id === id) ?? null;
  }

  /** Löscht eine Analyse mit Löschmarke, damit sie über das Konto auch in der App verschwindet. Das Video bleibt dort als Clip. */
  deleteAnalysis(id) {
    this.change((data) => {
      const list = Array.isArray(data.extra?.analyses) ? data.extra.analyses : [];
      data.extra = { ...data.extra, analyses: list.filter((item) => String(item?.id) !== String(id)) };
      this.noteDeletion("analyses", String(id));
    });
  }

  // MARK: - Übungen

  drill(id) {
    return this.byID.get(id) ?? null;
  }

  drills(area) {
    return this.library.filter((drill) => drill.area === area && !drill.isWarmUp);
  }

  results(drillID) {
    return this.data.results.filter((result) => result.drillID === drillID).sort((a, b) => b.date - a.date);
  }

  /** Übung außerhalb des Plans, z. B. aus der Bibliothek gestartet. */
  freePlannedDrill(drill, now = new Date()) {
    const level = difficultyLevel(drill, this.data.results);
    return {
      drillID: drill.id,
      minutes: drill.minutes,
      level,
      focusNotes: [],
      stations: drill.generator ? stations(drill.generator, drill.scoring.attempts, level, seed(drill.id, now)) : [],
    };
  }

  // MARK: - Vorschläge der Woche

  /** Beginn der aktuellen Woche. Gilt der Plan noch, sein Beginn, damit die Häkchen passen. */
  currentWeekStart(now = new Date()) {
    const plan = this.data.weekPlan;
    if (plan && planCovers(plan.weekStart, now)) return plan.weekStart;
    return startOfWeek(now);
  }

  /** Neue Woche, neue Vorschläge. Gibt true zurück, wenn neu geplant wurde. */
  ensureCurrentWeekPlan(now = new Date()) {
    const plan = this.data.weekPlan;
    if (plan && planCovers(plan.weekStart, now)) return false;
    this.change(() => this.plan(now), { persist: this.hasStoredData, stamp: false });
    return true;
  }

  regeneratePlan(now = new Date()) {
    this.change(() => this.plan(now));
  }

  /**
   * Erstellt die Vorschläge der Woche neu, für jeden Golftag einen. Vergangene
   * Golftage und solche mit eingetragenen Übungen bleiben, wie sie waren,
   * sonst verschwänden ihre Häkchen.
   */
  plan(now) {
    const weekStart = this.currentWeekStart(now);
    const today = startOfDay(now);
    const plan = this.data.weekPlan;
    let kept = [];
    if (plan && plan.weekStart.getTime() === weekStart.getTime()) {
      kept = plan.sessions.filter((session) => {
        const reference = { weekStart: plan.weekStart, slotID: session.slot.id };
        return session.date < today || this.data.results.some((result) => sameReference(result.planReference, reference));
      });
    }
    this.data.weekPlan = this.planner.planWeek({
      weekStart,
      slots: golfWeekSlots(this.data.golfWeek),
      rounds: this.data.rounds,
      focus: this.allFocusPoints(),
      results: this.data.results,
      tournaments: this.data.tournaments,
      kept,
      now,
    });
  }

  session(slotID) {
    return this.data.weekPlan?.sessions.find((session) => session.slot.id === slotID) ?? null;
  }

  /** Schwerpunkte für den Wochenplan: eigene und die vom Trainer im Team (`teamFocus` setzt team.js). */
  allFocusPoints() {
    const team = this.teamFocus?.() ?? [];
    const ids = new Set(team.map((point) => point.id));
    return [...this.data.focusPoints.filter((point) => !ids.has(point.id)), ...team];
  }

  /**
   * Woche und Einheit, zu der ein Ergebnis gehört. Aus der Einheit selbst,
   * nicht aus dem gerade aktuellen Plan: Wer eine Übung über Mitternacht am
   * Sonntag offen lässt, trägt sie sonst in der neuen Woche ein.
   */
  reference(session) {
    const plan = this.data.weekPlan;
    if (plan && plan.sessions.some((other) => other.slot.id === session.slot.id && other.date.getTime() === session.date.getTime())) {
      return { weekStart: plan.weekStart, slotID: session.slot.id };
    }
    return { weekStart: startOfWeek(session.date), slotID: session.slot.id };
  }

  /** Ergebnis einer Übung in einer Einheit vom Trainer. */
  resultInSession(drillID, sessionID) {
    const index = findLastIndex(this.data.results, (result) => result.drillID === drillID && result.sessionID != null && result.sessionID.toUpperCase() === sessionID.toUpperCase());
    return index >= 0 ? this.data.results[index] : null;
  }

  resultFor(planned, session) {
    const reference = this.reference(session);
    const index = findLastIndex(this.data.results, (result) => result.drillID === planned.drillID && sameReference(result.planReference, reference));
    return index >= 0 ? this.data.results[index] : null;
  }

  /**
   * Ergebnis eintragen. Im Plan gibt es pro Übung und Einheit eins: Erneut
   * eintragen korrigiert es, statt ein zweites anzulegen, das doppelt zählen
   * und die Stufe zu früh steigen lassen würde.
   */
  record(score, planned, session, { sessionID = null } = {}) {
    this.change((data) => {
      // In einer Einheit vom Trainer: pro Übung und Einheit ein Ergebnis, wie im Wochenplan.
      if (sessionID) {
        const index = findLastIndex(data.results, (result) => result.drillID === planned.drillID && result.sessionID != null && result.sessionID.toUpperCase() === sessionID.toUpperCase());
        if (index >= 0) {
          data.results[index].score = score;
          return;
        }
        data.results.push({ id: newID(), drillID: planned.drillID, date: new Date(), level: planned.level, score, planReference: null, sessionID: sessionID.toUpperCase(), note: null });
        return;
      }
      const reference = session ? this.reference(session) : null;
      if (reference) {
        const index = findLastIndex(data.results, (result) => result.drillID === planned.drillID && sameReference(result.planReference, reference));
        if (index >= 0) {
          data.results[index].score = score;
          return;
        }
      }
      data.results.push({
        id: newID(),
        drillID: planned.drillID,
        date: new Date(),
        level: planned.level,
        score,
        planReference: reference,
        sessionID: null,
        note: null,
      });
    });
  }

  // MARK: - Trainingstagebuch

  /** Das eigene Tagebuch: eigene Einheiten plus Übungen aus dem Plan, neueste zuerst. */
  myTrainingLog() {
    return logEntries({ manual: this.data.trainingLog, results: this.data.results, library: this.library });
  }

  startTraining(place = null) {
    this.running = { start: new Date(), place, entryID: newID() };
    this.saveRunning();
    this.notify();
  }

  cancelTraining() {
    this.running = null;
    this.saveRunning();
    this.notify();
  }

  /** Neuer Eintrag von Hand: die letzte Stunde, wie in der App. */
  newTrainingEntry(now = new Date()) {
    return {
      id: newID(),
      memberID: LOCAL_MEMBER,
      start: new Date(now.getTime() - 3600000),
      minutes: 60,
      kind: "free",
      place: null,
      areaMinutes: {},
      drills: [],
      note: "",
      effort: null,
      updatedAt: now,
    };
  }

  /** Eintrag aus der laufenden Stoppuhr, zum Bestätigen im Editor. */
  entryForRunningTraining(now = new Date()) {
    const running = this.running;
    if (!running) return null;
    const minutes = Math.max(1, Math.round((now.getTime() - running.start.getTime()) / 60000));
    return { ...this.newTrainingEntry(now), id: running.entryID, start: new Date(running.start.getTime()), minutes, place: running.place };
  }

  saveTrainingEntry(entry) {
    const saved = { ...entry, minutes: Math.max(1, entry.minutes), updatedAt: new Date() };
    this.change((data) => upsert(data.trainingLog, saved));
    // Nur der Eintrag aus der Stoppuhr beendet sie. Wer nebenbei die Stunde
    // von gestern nachträgt, hält die laufende Zeit nicht an.
    if (this.running && this.running.entryID === saved.id) this.cancelTraining();
  }

  deleteTrainingEntry(id) {
    this.change((data) => {
      data.trainingLog = data.trainingLog.filter((entry) => entry.id !== id);
      this.noteDeletion("trainingLog", id);
    });
  }

  // MARK: - Launch Monitor

  launchSession(id) {
    return this.data.launchSessions.find((session) => session.id === id) ?? null;
  }

  /** Dieselbe Session schon importiert, auch unter anderem Dateinamen oder in anderer Zeitzone. */
  hasLaunchSession(session) {
    const key = fingerprint(session);
    return this.data.launchSessions.some((other) => fingerprint(other) === key);
  }

  addLaunchSession(session) {
    this.change((data) => {
      data.launchSessions.push(session);
    });
  }

  deleteLaunchSession(id) {
    this.change((data) => {
      data.launchSessions = data.launchSessions.filter((session) => session.id !== id);
      this.noteDeletion("launchSessions", id);
    });
  }

  /** Zuordnung der Spalten für Dateien mit denselben Spaltennamen, höchstens 100, die ältesten fallen weg. */
  saveColumnMapping(key, mapping) {
    this.change((data) => {
      const entries = Object.entries(data.csvMappings).filter(([other]) => other !== key);
      entries.push([key, { ...mapping, metrics: { ...mapping.metrics } }]);
      data.csvMappings = Object.fromEntries(entries.slice(-100));
    });
  }

  // MARK: - Turniere

  /** Kommende und laufende Turniere, das nächste zuerst. */
  upcomingTournaments(now = new Date()) {
    const today = startOfDay(now);
    return this.data.tournaments
      .filter((tournament) => startOfDay(addDays(tournament.start, Math.max(1, tournament.days) - 1)) >= today)
      .sort((a, b) => a.start - b.start);
  }

  pastTournaments(now = new Date()) {
    const upcoming = new Set(this.upcomingTournaments(now).map((tournament) => tournament.id));
    return this.data.tournaments.filter((tournament) => !upcoming.has(tournament.id)).sort((a, b) => b.start - a.start);
  }

  tournament(id) {
    return this.data.tournaments.find((tournament) => tournament.id === id) ?? null;
  }

  daysUntil(tournament, now = new Date()) {
    return daysBetween(now, tournament.start);
  }

  upsertTournament(tournament) {
    this.change((data) => {
      upsert(data.tournaments, tournament);
      this.plan(new Date());
    });
  }

  deleteTournament(id) {
    this.change((data) => {
      data.tournaments = data.tournaments.filter((tournament) => tournament.id !== id);
      this.noteDeletion("tournaments", id);
      this.plan(new Date());
    });
  }

  toggleChecklistItem(tournamentID, key) {
    this.change(() => {
      const tournament = this.tournament(tournamentID);
      if (!tournament) return;
      tournament.checkedItems = tournament.checkedItems.includes(key)
        ? tournament.checkedItems.filter((item) => item !== key)
        : [...tournament.checkedItems, key];
    });
  }

  // MARK: - Einstellungen und Runden

  setHandedness(handedness) {
    this.change((data) => {
      data.handedness = handedness;
    });
  }

  /** Antwort auf die Frage beim ersten Öffnen. Gilt gleich für die Vorschläge dieser Woche. */
  setGolfWeek(week) {
    this.change((data) => {
      data.golfWeek = sanitizeGolfWeek(week);
      this.plan(new Date());
    });
  }

  /** Änderung an Tagen, Zeiten oder Anlagen, z. B. unter „Mehr“. `mutate` ändert eine Kopie. */
  updateGolfWeek(mutate) {
    const current = this.data.golfWeek ?? emptyGolfWeek();
    const week = { teamDays: [...current.teamDays], golfDays: current.golfDays.map((day) => ({ ...day })), facilities: [...current.facilities] };
    mutate(week);
    this.setGolfWeek(week);
  }

  /** Erinnerung an Golftagen: an oder aus und die Uhrzeit, wie in der App. */
  setReminders({ isEnabled, hour, minute }) {
    this.change((data) => {
      data.reminders = {
        isEnabled: Boolean(isEnabled),
        hour: Number.isInteger(hour) ? Math.min(23, Math.max(0, hour)) : data.reminders.hour,
        minute: Number.isInteger(minute) ? Math.min(59, Math.max(0, minute)) : data.reminders.minute,
      };
    });
  }

  /** Die Kalenderdatei der Woche, mit Erinnerungen, wenn sie an sind. Ohne Plan null. */
  calendarText(now = new Date()) {
    const plan = this.data.weekPlan;
    if (!plan) return null;
    return planCalendar(plan, this.library, now, {
      reminders: this.data.reminders,
      slots: golfWeekSlots(this.data.golfWeek),
      tournaments: this.data.tournaments,
    });
  }

  upsertFocus(point) {
    this.change((data) => upsert(data.focusPoints, point));
  }

  deleteFocus(id) {
    this.change((data) => {
      data.focusPoints = data.focusPoints.filter((point) => point.id !== id);
      this.noteDeletion("focusPoints", id);
    });
  }

  upsertRound(round) {
    this.change((data) => upsert(data.rounds, round));
  }

  deleteRound(id) {
    this.change((data) => {
      data.rounds = data.rounds.filter((round) => round.id !== id);
      this.noteDeletion("rounds", id);
    });
  }

  // MARK: - Datensicherung

  backupText(now = new Date()) {
    return createBackup(this.data, now);
  }

  /** Übernimmt eine gelesene Sicherung und sagt, was passiert ist. Wie restore in der App. */
  restore(backup, mode, now = new Date()) {
    const imported = backup.data;
    // Was aus der Sicherung zurückkommt, darf der Abgleich über das Konto nicht
    // wieder löschen: Löschmarken dieser Kennungen aufheben.
    const lifting = (deletions) => {
      let result = deletions;
      for (const kind of DELETION_KINDS) {
        const ids = (imported[kind] ?? imported.extra?.[kind] ?? []).map((item) => item?.id).filter((id) => id != null).map(String);
        result = restoring(ids, kind, now, result);
      }
      return result;
    };
    if (mode === "merge") {
      let added = 0;
      this.change((data) => {
        for (const key of ["results", "rounds", "tournaments", "focusPoints", "trainingLog", "launchSessions"]) {
          // Ergebnisse derselben geplanten Übung nur einmal, wie in der App.
          const result = key === "results" ? mergeResults(data[key], imported[key]) : merge(data[key], imported[key]);
          data[key] = result.items;
          added += result.added;
        }
        data.deletions = lifting(data.deletions ?? []);
        // Gespeicherte Spaltenzuordnungen: Was es hier noch nicht gibt, kommt dazu.
        for (const [key, mapping] of Object.entries(imported.csvMappings ?? {})) {
          if (!data.csvMappings[key]) data.csvMappings = { ...data.csvMappings, [key]: mapping };
        }
        for (const key of KEPT_LISTS) {
          const incoming = imported.extra?.[key];
          if (!Array.isArray(incoming)) continue;
          const local = Array.isArray(data.extra[key]) ? data.extra[key] : [];
          const result = merge(local, incoming);
          data.extra = { ...data.extra, [key]: result.items };
          added += result.added;
        }
      });
      // Neue Turniere und Schwerpunkte wirken gleich auf die Woche, wie beim Eintragen von Hand und wie in der App.
      if (added > 0) this.plan(now);
      if (added === 0) return "Nichts Neues: Alles aus der Sicherung ist schon auf diesem Gerät.";
      return added === 1 ? "1 Eintrag aus der Sicherung übernommen." : `${added} Einträge aus der Sicherung übernommen.`;
    }
    const current = this.data;
    this.change(() => {
      this.data = imported;
      this.data.extra = { ...(imported.extra ?? {}) };
      // Die Erinnerung gehört zu diesem Gerät, wie in der App.
      this.data.reminders = current.reminders;
      this.data.deletions = lifting(mergedDeletions(current.deletions ?? [], imported.deletions ?? [], now));
    });
    this.ensureCurrentWeekPlan(now);
    return `Stand vom ${formatShortDate(backup.createdAt)}, ${formatTime(backup.createdAt)} Uhr wiederhergestellt.`;
  }

  // MARK: - Konto

  /**
   * Den Stand vom Server übernehmen: zusammenführen, nicht ersetzen, nach den
   * Regeln in core/sync.js. Gibt zurück, ob sich hier etwas geändert hat
   * (`changed`) und ob der eigene Stand danach derselbe ist wie der vom Server
   * (`sameAsRemote`): Dann gibt es nichts hochzuladen.
   */
  applyRemote(backup, { localSavedAt, now = new Date(), preferRemoteSettings = false }) {
    const merged = mergedData(this.data, backup.data, { localSavedAt, remoteSavedAt: backup.createdAt, now, preferRemoteSettings });
    const before = comparableText(this.data);
    const after = comparableText(merged);
    if (before !== after) {
      this.change(() => {
        this.data = merged;
      }, { stamp: false });
    }
    this.ensureCurrentWeekPlan(now);
    return { changed: before !== after, sameAsRemote: comparableText(this.data) === comparableText(backup.data) };
  }

  // MARK: - Löschen

  /** Löscht alles, was die Web-App in diesem Browser gespeichert hat, auch die Anmeldung mit dem Konto. */
  deleteAll() {
    const store = storage();
    if (store) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index);
        if (key?.startsWith("golftrainer.")) store.removeItem(key);
      }
    }
    try {
      globalThis.sessionStorage?.clear();
    } catch {
      // Nicht erlaubt: Dort liegt ohnehin nichts.
    }
    const data = decodeData({});
    data.extra = {};
    this.data = data;
    this.running = null;
    this.problem = null;
  }
}
