// Golf Trainer im Browser: Navigation, Leisten und das Neuzeichnen der Seiten.
// Jede Seite ist eine Funktion, die Titel, HTML und ihre Knöpfe liefert
// (js/views). Adressen stehen hinter dem #, z. B. #/uebungen/putt-gate, damit
// die Seite ohne Server-Einstellungen und ohne Netz läuft.
import { Account } from "./account.js";
import { ICONS, escape, html, toast } from "./ui.js";
import { RUNNING_KEY, STORAGE_KEY, Store } from "./store.js";
import { weekPage } from "./views/week.js";
import { diaryEditor, diaryPage } from "./views/diary.js";
import { statsPage } from "./views/stats.js";
import { distanceTablePage, launchPage, mappingPage, sessionPage, shotPage, trendPage } from "./views/launch.js";
import { runPage, planRunPage, sessionRunPage } from "./views/run.js";
import { libraryPage, bestsPage } from "./views/drills.js";
import { tournamentsPage, tournamentPage, tournamentEditor, phasePage, warmUpPage, roundEditor } from "./views/tournaments.js";
import { swingPage, tempoPage } from "./views/swing.js";
import { cameraPage } from "./views/camera.js";
import { screenPage } from "./views/screen.js";
import { morePage, focusEditor, deletePage } from "./views/more.js";
import { accountPage, passwordPage } from "./views/account.js";
import { TEAM_KEY, TeamStore } from "./team.js";
import {
  teamBoardPage, teamChallengePage, teamChallengesPage, teamEventPage, teamEventsPage, teamJoinPage, teamLeaderboardPage, teamMembersPage, teamMessagesPage, teamPage,
  teamProfilePage, teamReportPage, teamSessionPage, teamSessionsPage, teamSharingPage,
} from "./views/team.js";
import {
  analysisPage, announcementEditorPage, approveMemberPage, assignmentPage, assignmentsPage, attendancePage, challengeEditorPage, coachMembersPage, eventEditorPage, exportPage,
  focusEditorPage, inviteEditorPage, inviteSharePage, invitesPage, memberDetailPage, memberSessionsPage, reportPage, reportsPage, sessionEditorPage, sessionProgressPage,
  settingsPage, staffHomePage, trainingCalendarPage,
} from "./views/coach.js";
import { teamClipPage, teamClipsPage } from "./views/clips.js";
import { analysesPage, analysisHistoryPage, feedbackTargetsPage, newAnalysisPage, swingAnalysisPage, trimAnalysisPage } from "./views/analysis.js";

const ROUTES = [
  [/^\/woche$/, () => weekPage],
  [/^\/woche\/([^/]+)\/([^/]+)$/, ([slotID, drillID]) => (app) => planRunPage(app, slotID, drillID)],
  [/^\/tagebuch$/, () => diaryPage],
  [/^\/tagebuch\/([^/]+)$/, ([id]) => (app) => diaryEditor(app, id)],
  [/^\/statistik$/, () => statsPage],
  [/^\/uebungen$/, () => libraryPage],
  [/^\/uebungen\/bestleistungen$/, () => bestsPage],
  [/^\/uebungen\/bestleistungen\/([^/]+)$/, ([drillID]) => (app) => runPage(app, drillID, "#/uebungen/bestleistungen")],
  [/^\/uebungen\/([^/]+)$/, ([drillID]) => (app) => runPage(app, drillID)],
  [/^\/schwung$/, () => swingPage],
  [/^\/schwung\/tempo$/, () => tempoPage],
  [/^\/schwung\/analysen$/, () => analysesPage],
  [/^\/schwung\/analysen\/neu$/, () => newAnalysisPage],
  [/^\/schwung\/analysen\/neu\/([^/]+)$/, ([clipID]) => (app) => trimAnalysisPage(app, clipID)],
  [/^\/schwung\/analysen\/verlauf$/, () => analysisHistoryPage],
  [/^\/schwung\/analysen\/verlauf\/([^/]+)\/([^/]+)$/, ([swingType, metric]) => (app) => analysisHistoryPage(app, swingType, metric)],
  [/^\/schwung\/analysen\/richtwerte\/([^/]+)$/, ([swingType]) => (app) => feedbackTargetsPage(app, swingType)],
  [/^\/schwung\/analysen\/richtwerte\/([^/]+)\/([^/]+)$/, ([swingType, angle]) => (app) => feedbackTargetsPage(app, swingType, angle)],
  [/^\/schwung\/analysen\/([^/]+)$/, ([id]) => (app) => swingAnalysisPage(app, id)],
  [/^\/schwung\/kamera$/, () => cameraPage],
  [/^\/schwung\/bildschirm$/, () => screenPage],
  [/^\/schwung\/launch$/, () => launchPage],
  [/^\/schwung\/launch\/zuordnen$/, () => mappingPage],
  [/^\/schwung\/launch\/tabelle$/, () => distanceTablePage],
  [/^\/schwung\/launch\/verlauf$/, () => trendPage],
  [/^\/schwung\/launch\/([^/]+)$/, ([id]) => (app) => sessionPage(app, id)],
  [/^\/schwung\/launch\/([^/]+)\/([^/]+)$/, ([id, shotID]) => (app) => shotPage(app, id, shotID)],
  [/^\/turniere$/, () => tournamentsPage],
  [/^\/turniere\/neu$/, () => (app) => tournamentEditor(app, null)],
  [/^\/turniere\/([^/]+)$/, ([id]) => (app) => tournamentPage(app, id)],
  [/^\/turniere\/([^/]+)\/bearbeiten$/, ([id]) => (app) => tournamentEditor(app, id)],
  [/^\/turniere\/([^/]+)\/einspielen$/, ([id]) => (app) => warmUpPage(app, id)],
  [/^\/turniere\/([^/]+)\/phase\/([^/]+)$/, ([id, phase]) => (app) => phasePage(app, id, phase)],
  [/^\/runden\/neu$/, () => (app) => roundEditor(app, null)],
  [/^\/runden\/([^/]+)$/, ([id]) => (app) => roundEditor(app, id)],
  [/^\/mehr$/, () => morePage],
  [/^\/mehr\/konto$/, () => accountPage],
  [/^\/mehr\/konto\/passwort$/, () => passwordPage],
  [/^\/mehr\/schwerpunkte\/neu$/, () => (app) => focusEditor(app, null)],
  [/^\/mehr\/schwerpunkte\/([^/]+)$/, ([id]) => (app) => focusEditor(app, id)],
  [/^\/mehr\/loeschen$/, () => deletePage],
  // Team: Trainer und Funktionäre bekommen unter denselben Adressen ihre eigenen Seiten.
  [/^\/team$/, () => (app) => (isStaffView(app) ? staffHomePage(app) : teamPage(app))],
  [/^\/team\/beitreten\/([^/]+)\/([^/]+)$/, ([teamID, secret]) => (app) => teamJoinPage(app, teamID, secret)],
  [/^\/team\/profil$/, () => teamProfilePage],
  [/^\/team\/freigaben$/, () => teamSharingPage],
  [/^\/team\/termine$/, () => teamEventsPage],
  [/^\/team\/termine\/neu$/, () => (app) => eventEditorPage(app, null)],
  [/^\/team\/termine\/([^/]+)$/, ([id]) => (app) => teamEventPage(app, id)],
  [/^\/team\/termine\/([^/]+)\/bearbeiten$/, ([id]) => (app) => eventEditorPage(app, id)],
  [/^\/team\/termine\/([^/]+)\/anwesenheit$/, ([id]) => (app) => attendancePage(app, id)],
  [/^\/team\/pinnwand$/, () => teamBoardPage],
  [/^\/team\/pinnwand\/neu$/, () => (app) => announcementEditorPage(app, null)],
  [/^\/team\/pinnwand\/([^/]+)\/bearbeiten$/, ([id]) => (app) => announcementEditorPage(app, id)],
  [/^\/team\/challenges$/, () => teamChallengesPage],
  [/^\/team\/challenges\/neu$/, () => (app) => challengeEditorPage(app, null)],
  [/^\/team\/challenges\/([^/]+)$/, ([id]) => (app) => teamChallengePage(app, id)],
  [/^\/team\/challenges\/([^/]+)\/bearbeiten$/, ([id]) => (app) => challengeEditorPage(app, id)],
  [/^\/team\/ranglisten$/, () => teamLeaderboardPage],
  [/^\/team\/einheiten$/, () => teamSessionsPage],
  [/^\/team\/einheiten\/([^/]+)$/, ([id]) => (app) => teamSessionPage(app, id)],
  [/^\/team\/einheiten\/([^/]+)\/([^/]+)$/, ([id, drillID]) => (app) => sessionRunPage(app, id, drillID)],
  [/^\/team\/mitglieder$/, () => (app) => (isStaffView(app) ? coachMembersPage(app) : teamMembersPage(app))],
  [/^\/team\/mitglieder\/([^/]+)$/, ([id]) => (app) => memberDetailPage(app, id)],
  [/^\/team\/mitglieder\/([^/]+)\/freigeben$/, ([id]) => (app) => approveMemberPage(app, id)],
  [/^\/team\/mitglieder\/([^/]+)\/einheiten$/, ([id]) => (app) => memberSessionsPage(app, id)],
  [/^\/team\/mitglieder\/([^/]+)\/nachrichten$/, ([id]) => (app) => teamMessagesPage(app, id)],
  [/^\/team\/mitglieder\/([^/]+)\/videos$/, ([id]) => (app) => teamClipsPage(app, id)],
  [/^\/team\/mitglieder\/([^/]+)\/schwerpunkt\/([^/]+)$/, ([id, focusID]) => (app) => focusEditorPage(app, id, focusID)],
  [/^\/team\/nachrichten$/, () => teamMessagesPage],
  [/^\/team\/videos$/, () => (app) => teamClipsPage(app, null)],
  [/^\/team\/videos\/([^/]+)$/, ([id]) => (app) => teamClipPage(app, id)],
  [/^\/team\/melden\/([^/]+)\/([^/]+)$/, ([kind, key]) => (app) => teamReportPage(app, kind, key)],
  [/^\/team\/zuweisungen$/, () => assignmentsPage],
  // Die Abfrage hinter dem „?“ nennt eine Vorlage, eine Kopie oder einen Spieler.
  [/^\/team\/zuweisungen\/neu\??([^/]*)$/, ([query]) => (app) => sessionEditorPage(app, null, editorOptions(query))],
  [/^\/team\/zuweisungen\/([^/?]+)$/, ([planID]) => (app) => assignmentPage(app, planID)],
  [/^\/team\/zuweisungen\/([^/?]+)\/bearbeiten$/, ([planID]) => (app) => sessionEditorPage(app, planID)],
  [/^\/team\/zuweisungen\/([^/?]+)\/spieler\/([^/]+)$/, ([planID, sessionID]) => (app) => sessionProgressPage(app, planID, sessionID)],
  [/^\/team\/einladungen$/, () => invitesPage],
  [/^\/team\/einladungen\/neu$/, () => inviteEditorPage],
  [/^\/team\/einladungen\/([^/]+)$/, ([id]) => (app) => inviteSharePage(app, id)],
  [/^\/team\/einstellungen$/, () => settingsPage],
  [/^\/team\/meldungen$/, () => reportsPage],
  [/^\/team\/meldungen\/([^/]+)$/, ([id]) => (app) => reportPage(app, id)],
  [/^\/team\/kalender$/, () => trainingCalendarPage],
  [/^\/team\/analyse$/, () => analysisPage],
  [/^\/team\/export$/, () => exportPage],
];

/** Trainer und Funktionäre sehen das Team aus ihrer Sicht, Spieler und Wartende aus ihrer. */
function isStaffView(app) {
  const team = app.team;
  return team != null && team.isInTeam && team.hasLoaded && !team.isRemoved && team.isStaff;
}

/** `vorlage=…`, `kopie=…` oder `fuer=…` hinter dem „?“ der Adresse. */
function editorOptions(query) {
  const params = new URLSearchParams(query ?? "");
  return { template: params.get("vorlage"), copyOf: params.get("kopie"), memberID: params.get("fuer") };
}

const HOME = "#/woche";

function currentPath() {
  const hash = location.hash || HOME;
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

function resolve(path) {
  for (const [pattern, make] of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    try {
      return make(match.slice(1).map(decodeURIComponent));
    } catch {
      // Kaputte Adresse, z. B. „%E0“: Seite gibt es nicht.
      return null;
    }
  }
  return null;
}

/** Statt einer leeren Seite: was passiert ist und der Weg zurück. */
function brokenPage(error) {
  return html`<p class="hint problem">Diese Seite ließ sich nicht anzeigen: ${error?.message ?? "unbekannter Fehler"}</p>
    <p class="note">Passiert das nach dem Übernehmen einer Sicherung, war darin etwas, das die Web-App nicht lesen kann. Unter „Mehr“ kannst du eine eigene Sicherung zurückspielen oder die Web-App mit „Meine Daten löschen“ zurücksetzen.</p>
    <p><a class="button outline" href="#/mehr">Zu „Mehr“</a></p>`;
}

function notFound() {
  return {
    title: "Nicht gefunden",
    tab: null,
    parent: HOME,
    render: () => html`<p class="empty">Diese Seite gibt es nicht.</p><p><a class="button outline" href="${HOME}">Zur Woche</a></p>`,
  };
}

class App {
  constructor(store, account, team) {
    this.store = store;
    this.account = account;
    this.team = team;
    this.view = document.getElementById("view");
    this.titleElement = document.getElementById("bar-title");
    this.backLink = document.getElementById("back");
    this.tabs = [...document.querySelectorAll(".tabs a")];
    /** Besuchte Adressen in diesem Tab, für „Zurück“ ohne doppelte Einträge. */
    this.stack = [location.hash || HOME];
    this.replacing = false;
    this.page = null;
    this.cleanup = null;
    this.scroll = new Map();
    /** Angebot des Browsers, die Seite als App zu installieren (Chrome, Samsung Internet). */
    this.installPrompt = null;

    for (const icon of document.querySelectorAll("[data-icon]")) {
      icon.innerHTML = ICONS[icon.dataset.icon] ?? "";
    }
    this.backLink.addEventListener("click", (event) => {
      event.preventDefault();
      if (this.page?.parent) this.back(this.page.parent);
    });
    window.addEventListener("hashchange", () => this.route());
    store.subscribe(() => {
      if (!this.page?.keepOnChange) this.render({ keepScroll: true });
    });
    // Nur Seiten unter „Mehr“ zeigen den Stand des Kontos. Die anderen bleiben,
    // wie sie sind, sonst verlöre z. B. die Suche in den Übungen nach jedem
    // Abgleich ihren Text.
    account.subscribe(() => {
      if (this.page?.keepOnChange || !currentPath().startsWith("/mehr")) return;
      this.render({ keepScroll: true });
    });
    // Das Team zeigt nur auf seinen Seiten und unter „Mehr“ jeden Abgleich.
    team.subscribe(() => {
      const path = currentPath();
      if (this.page?.keepOnChange || !(path.startsWith("/team") || path === "/mehr")) return;
      this.render({ keepScroll: true });
    });
    // Geändert in einem anderen Tab: dort Gespeichertes übernehmen.
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === RUNNING_KEY) store.reload();
      if (event.key === null || event.key?.startsWith("golftrainer.konto.")) account.reload();
      if (event.key === null || event.key === TEAM_KEY) team.reload();
    });
  }

  /** Neue Seite öffnen. `replace`: ohne neuen Eintrag im Verlauf, z. B. nach dem Sichern. */
  navigate(hash, { replace = false } = {}) {
    if (replace) {
      this.replacing = true;
      location.replace(hash);
    } else {
      location.hash = hash;
    }
  }

  /** Zurück zur übergeordneten Seite: im Verlauf, wenn sie davor kam, sonst direkt. */
  back(parent) {
    const previous = this.stack[this.stack.length - 2];
    if (previous && previous === parent) history.back();
    else this.navigate(parent, { replace: true });
  }

  route() {
    // Ein Link aus einer E-Mail, während die Seite schon offen ist: erst die Sitzung übernehmen.
    if (isAccountLink()) {
      handleAccountLink(this.account).then((result) => {
        this.route();
        announceLink(result);
      });
      return;
    }
    const hash = location.hash || HOME;
    let isBack = false;
    if (this.replacing) {
      this.replacing = false;
      this.stack[this.stack.length - 1] = hash;
      isBack = true;
    } else if (this.stack.length >= 2 && this.stack[this.stack.length - 2] === hash) {
      this.stack.pop();
      isBack = true;
    } else {
      this.stack.push(hash);
    }
    // Zurück an die Stelle, an der du warst. Neue Seiten beginnen oben.
    this.render({ restoreScroll: isBack });
  }

  /** Zeichnet die aktuelle Seite. Bei Änderungen der Daten bleibt die Stelle, an der du bist. */
  render({ keepScroll = false, restoreScroll = false } = {}) {
    // Sichert eine Seite beim Verlassen noch etwas, melden sich die Daten mitten im Zeichnen: dann gleich danach noch einmal.
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    this.rendering = true;
    try {
      this.draw({ keepScroll, restoreScroll });
    } finally {
      this.rendering = false;
    }
    if (this.renderAgain) {
      this.renderAgain = false;
      queueMicrotask(() => this.render({ keepScroll: true }));
    }
  }

  draw({ keepScroll, restoreScroll }) {
    const path = currentPath();
    if (this.page && this.renderedPath && !keepScroll) this.scroll.set(this.renderedPath, window.scrollY);
    const focusKey = keepScroll ? document.activeElement?.dataset?.key : null;
    this.cleanup?.();
    this.cleanup = null;

    const make = resolve(path) ?? notFound;
    let page;
    try {
      page = make(this);
    } catch (error) {
      console.error(error);
      page = { title: "Fehler", tab: null, parent: HOME, render: () => html`<p class="empty">Die Seite ließ sich nicht öffnen: ${error.message}</p>` };
    }
    this.page = page;
    this.renderedPath = path;

    this.titleElement.textContent = page.title;
    document.title = page.title === "Golf Trainer" ? "Golf Trainer" : `${page.title} · Golf Trainer`;
    this.backLink.hidden = !page.parent;
    if (page.parent) this.backLink.setAttribute("href", page.parent);
    const tab = page.tab ?? path.split("/")[1];
    for (const link of this.tabs) {
      if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }

    // Jede Seite in einem eigenen Element: Ihre Knöpfe verschwinden mit ihr.
    const container = document.createElement("div");
    container.className = "page";
    let rendered = true;
    try {
      container.innerHTML = String(page.render());
    } catch (error) {
      console.error(error);
      container.innerHTML = String(brokenPage(error));
      rendered = false;
    }
    if (this.store.problem) {
      container.insertAdjacentHTML("afterbegin", `<p class="hint problem">${escape(this.store.problem)}</p>`);
    }
    this.view.replaceChildren(container);
    this.cleanup = rendered ? (page.mount?.(container, this) ?? null) : null;

    if (keepScroll) {
      if (focusKey) container.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
      return;
    }
    const saved = restoreScroll ? this.scroll.get(path) : null;
    window.scrollTo(0, saved ?? 0);
    // Für Bildschirmleser: Die neue Seite beginnt hier.
    this.view.focus({ preventScroll: true });
  }
}

/**
 * Der Link aus einer E-Mail von Supabase („E-Mail bestätigen“, „Passwort
 * zurücksetzen“) bringt die Sitzung hinter dem # mit, z. B.
 * „#access_token=…&type=recovery“, statt einer Seite. Erst übernehmen, dann
 * die Adresse auf die passende Seite setzen, bevor sie im Verlauf landet.
 */
function isAccountLink() {
  return /^#(access_token|refresh_token|error|error_code|error_description|type)=/.test(location.hash);
}

async function handleAccountLink(account) {
  if (!isAccountLink()) return null;
  const result = await account.handleLink(new URLSearchParams(location.hash.slice(1)));
  const target = result?.type === "recovery" ? "#/mehr/konto/passwort" : "#/mehr/konto";
  history.replaceState(null, "", `${location.pathname}${location.search}${target}`);
  return result;
}

/** Was der Link ergeben hat, kurz als Hinweis. Die Rückfrage zu einem fremden Link steht auf der Seite Konto. */
function announceLink(result) {
  if (result?.type === "signup") toast("E-Mail bestätigt. Du bist angemeldet.");
  else if (result?.type === "confirm") toast("E-Mail bestätigt. Anmelden? Siehe oben.");
}

/**
 * Eine neue Version der Seite: Der Service Worker holt sie beim Öffnen und
 * höchstens einmal pro Stunde beim Zurückkehren. Übernimmt er sie, während die
 * Seite offen ist, läuft hier noch der alte Code: ein Hinweis zum Neuladen,
 * nicht mitten in einer Eingabe.
 */
function watchForUpdates(app) {
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastCheck = Date.now();
  navigator.serviceWorker
    .register("sw.js")
    .then((registration) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - lastCheck < 60 * 60 * 1000) return;
        lastCheck = Date.now();
        registration.update().catch(() => {});
      });
    })
    .catch(() => {
      // Ohne Service Worker läuft die Seite trotzdem, nur nicht ohne Netz.
    });
  if (!hadController) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const show = () => {
      if (app.page?.keepOnChange) {
        setTimeout(show, 30 * 1000);
        return;
      }
      const element = document.getElementById("toast");
      if (!element) return;
      element.textContent = "Neue Version geladen. Tippe hier, um sie zu starten.";
      element.classList.add("show");
      element.addEventListener("click", () => location.reload(), { once: true });
    };
    show();
  });
}

async function start() {
  const view = document.getElementById("view");
  // „Zum Inhalt springen“ darf die Adresse nicht ändern: „#view“ wäre eine
  // Seite, die es nicht gibt. Stattdessen den Inhalt in den Fokus holen.
  document.querySelector("a.skip")?.addEventListener("click", (event) => {
    event.preventDefault();
    view.focus();
  });
  let store;
  try {
    store = await Store.open();
  } catch (error) {
    view.innerHTML = String(html`<p class="hint problem">Golf Trainer ließ sich nicht laden. Prüfe die Internetverbindung und lade die Seite neu.</p>
      <p class="note">${error.message}</p>`);
    return;
  }
  const account = new Account(store);
  const link = await handleAccountLink(account);
  // Neues vom Team, z. B. ein Termin oder eine Nachricht, kurz als Hinweis.
  const team = new TeamStore(store, account, {
    onNotice: (notices) => {
      const [first] = notices;
      const more = notices.length > 1 ? ` (+${notices.length - 1})` : "";
      toast(`${first.title}${first.body ? `: ${first.body}` : ""}${more}`);
    },
  });
  const app = new App(store, account, team);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.installPrompt = event;
    if (app.page?.wantsInstallPrompt) app.render({ keepScroll: true });
  });
  window.addEventListener("appinstalled", () => {
    app.installPrompt = null;
    toast("Golf Trainer ist jetzt auf deinem Startbildschirm.");
  });

  // Lässt sich nicht planen, zeigt die Seite trotzdem etwas an, statt bei „Lädt …“ zu bleiben.
  const plan = () => {
    try {
      store.ensureCurrentWeekPlan();
    } catch (error) {
      console.error(error);
      store.problem = `Die Vorschläge der Woche ließen sich nicht erstellen: ${error.message}`;
    }
  };
  plan();
  // Zu Beginn einer neuen Woche, wenn die Seite die ganze Zeit offen war. Beim
  // Verlassen sofort abgleichen: Im Hintergrund frieren Browser auf dem Handy
  // die Zeitgeber ein.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      plan();
      account.syncIfSignedIn();
      team.syncIfSignedIn();
    } else {
      account.syncBeforeLeaving();
    }
  });
  window.addEventListener("pagehide", () => account.syncBeforeLeaving());
  // Nach dem Training ohne Netz: nachholen, sobald es wieder da ist.
  window.addEventListener("online", () => {
    account.syncIfSignedIn();
    team.syncIfSignedIn();
  });
  app.render();
  announceLink(link);
  account.syncIfSignedIn();
  team.syncIfSignedIn();
  team.findExistingTeam();
  watchForUpdates(app);
  document.documentElement.dataset.started = "1";
}

start();
