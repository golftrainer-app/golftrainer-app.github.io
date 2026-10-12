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
import { runPage, planRunPage } from "./views/run.js";
import { libraryPage, bestsPage } from "./views/drills.js";
import { tournamentsPage, tournamentPage, tournamentEditor, phasePage, warmUpPage, roundEditor } from "./views/tournaments.js";
import { swingPage, tempoPage } from "./views/swing.js";
import { morePage, focusEditor, deletePage } from "./views/more.js";
import { accountPage, passwordPage } from "./views/account.js";

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
];

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
  constructor(store, account) {
    this.store = store;
    this.account = account;
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
    account.subscribe(() => {
      if (!this.page?.keepOnChange) this.render({ keepScroll: true });
    });
    // Geändert in einem anderen Tab: dort Gespeichertes übernehmen.
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === RUNNING_KEY) store.reload();
      if (event.key === null || event.key?.startsWith("golftrainer.konto.")) account.reload();
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
        if (result?.type === "signup") toast("E-Mail bestätigt. Du bist angemeldet.");
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
  const app = new App(store, account);
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
  // Zu Beginn einer neuen Woche, wenn die Seite die ganze Zeit offen war.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      plan();
      account.syncIfSignedIn();
    }
  });
  app.render();
  if (link?.type === "signup") toast("E-Mail bestätigt. Du bist angemeldet.");
  account.syncIfSignedIn();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Ohne Service Worker läuft die Seite trotzdem, nur nicht ohne Netz.
    });
  }
}

start();
