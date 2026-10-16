// Tab „Mehr“: Spielhand, Golfwoche, Schwerpunkte, Datensicherung, Installieren,
// Datenschutz und „Meine Daten löschen“, wie SettingsView in der App.
import { deleteAllClips } from "../clips.js";
import { deleteAllPoses } from "../poses.js";
import { readBackup, fileName, summary, BackupError } from "../core/backup.js";
import { AREAS, AREA_NAMES, FACILITIES, FACILITY_NAMES } from "../core/categories.js";
import { formatShortDate, formatTime } from "../core/dates.js";
import { emptyGolfWeek } from "../core/golfweek.js";
import { LIMITS, newID } from "../core/model.js";
import { timeText } from "../core/reminders.js";
import { ask, chapter, check, download, empty, headline, html, inform, markField, readFile, shareFile, toast } from "../ui.js";
import { accountFooter, accountStatusText } from "./account.js";
import { teamStatusText } from "./team.js";
import { applyGolfWeekClick, copyGolfWeek, dayButtons, golfDays, minutesRows } from "./golfweek.js";

const PRIORITY_NAMES = ["Normal", "Wichtig", "Sehr wichtig"];

/** Vorschlag aus der Schwunganalyse für den nächsten neuen Schwerpunkt, bis der Editor ihn liest. */
let proposedFocus = null;
export function proposeFocus(point) {
  proposedFocus = point;
}
function takeProposedFocus() {
  const point = proposedFocus;
  proposedFocus = null;
  return point;
}
const priorityName = (priority) => PRIORITY_NAMES[Math.min(3, Math.max(1, priority)) - 1];

/** Spielhand wie Handedness im Kern der App. */
const HANDS = [
  ["right", "Rechtshänder"],
  ["left", "Linkshänder"],
];

function isStandalone() {
  return globalThis.matchMedia?.("(display-mode: standalone)").matches || globalThis.navigator?.standalone === true;
}

/** iPhone oder iPad. iPadOS meldet sich im Browser wie ein Mac, hat aber einen Touchscreen. */
export function isAppleMobile({ userAgent = "", maxTouchPoints = 0 } = globalThis.navigator ?? {}) {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function morePage(app) {
  const { store, account } = app;
  return {
    title: "Mehr",
    tab: "mehr",
    parent: null,
    wantsInstallPrompt: true,
    render() {
      const week = store.data.golfWeek ?? emptyGolfWeek();
      // Ohne Antwort gilt Rechtshänder, wie in der App.
      const handedness = store.data.handedness ?? "right";
      return html`
        ${chapter(
          "Konto",
          html`<ul class="rows"><li><a class="row labeled" href="#/mehr/konto"><span class="row-main">Konto</span><span class="row-value">${accountStatusText(account)}</span></a></li></ul>`,
          { footer: accountFooter(account) },
        )}
        ${chapter(
          "Team",
          html`<ul class="rows"><li><a class="row labeled" href="#/team"><span class="row-main">Team</span><span class="row-value">${app.team ? teamStatusText(app.team) : "Nicht im Team"}</span></a></li></ul>`,
          { footer: "Die Jugendabteilung deines Vereins: Termine mit Zu- und Absagen, Pinnwand, Challenges, Schwerpunkte und Einheiten von den Trainern. Braucht ein Konto und einen Einladungslink." },
        )}
        ${chapter(
          "Spielhand",
          html`<div class="choice" role="group" aria-label="Spielhand">${HANDS.map(
            ([value, name]) => html`<button type="button" data-hand="${value}" data-key="hand-${value}" aria-pressed="${String(value === handedness)}">${name}</button>`,
          )}</div>`,
          {
            footer:
              "Danach richten sich im Launch Monitor die Namen der Flugkurven wie Draw und Fade und die Bedeutung von Schwungbahn und Schlagfläche. Die Messwerte selbst bleiben gleich: Rechts ist für beide rechts. Beim Rechtshänder zeigt die linke Schulter zum Ziel, beim Linkshänder die rechte.",
          },
        )}
        ${chapter(
          "Golfwoche",
          html`<p class="kicker">Teamtraining</p>
            ${dayButtons("team", week.teamDays)}
            <p class="kicker">Golftage</p>
            ${dayButtons("golf", golfDays(week), week.teamDays)}
            ${minutesRows(week)}`,
          {
            footer:
              "Beim Teamtraining plant dein Trainer, die App schlägt dort nichts vor. Für jeden Golftag schlägt sie vor, was du trainierst. Die Zeit schlägt sie nach der Zahl deiner Golftage mit Teamtraining vor: bei 1 bis 2 Tagen 3 Stunden, bei 3 bis 4 Tagen 2½ Stunden, ab 5 Tagen 2 Stunden. Du kannst sie für jeden Tag ändern, bis 12 Stunden.",
          },
        )}
        ${chapter(
          "Vor Ort vorhanden",
          FACILITIES.map((facility) => {
            const isOn = week.facilities.includes(facility);
            // Ohne jede Anlage gäbe es keine Übung mehr.
            const isLast = isOn && week.facilities.length === 1;
            return html`<label class="toggle"><span>${FACILITY_NAMES[facility]}</span><input type="checkbox" data-facility="${facility}" data-key="facility-${facility}" ${isOn ? "checked" : ""} ${isLast ? "disabled" : ""}></label>`;
          }),
          { footer: "Gilt für alle Golftage. Die App schlägt nur Übungen vor, die dort gehen. „Halle oder zuhause“ steht für Matte, Netz oder Teppich ohne Ballflug, z. B. im Winter. Ist nur das an, kommen Putts auf dem Teppich, Chips ins Netz und Technik-Übungen ohne Ball." },
        )}
        ${chapter(
          "Schwerpunkte vom Trainer",
          html`<ul class="rows">${store.data.focusPoints.map((point) => focusRow(point))}</ul>
            <a class="action" href="#/mehr/schwerpunkte/neu">Schwerpunkt hinzufügen<span class="mark" aria-hidden="true">+</span></a>`,
          { footer: "Aktive Schwerpunkte bekommen mehr Zeit und stehen bei den Technik-Übungen dabei." },
        )}
        ${chapter("Vorschläge der Woche", html`<button type="button" class="action" data-action="regenerate" data-key="regenerate">Vorschläge neu erstellen<span class="mark" aria-hidden="true">↻</span></button>`, {
          footer: "Änderungen an der Golfwoche und an Turnieren gelten sofort. Schwerpunkte und Runden zählen ab den nächsten Vorschlägen, also ab der nächsten Woche oder wenn du sie hier neu erstellst.",
        })}
        ${chapter(
          "Erinnerung",
          html`<label class="toggle"><span>Am Golftag erinnern</span><input type="checkbox" data-reminder-enabled data-key="reminder-enabled" ${store.data.reminders.isEnabled ? "checked" : ""}></label>
            ${store.data.reminders.isEnabled
              ? html`<label class="field"><span>Uhrzeit</span><input type="time" data-reminder-time data-key="reminder-time" value="${timeText(store.data.reminders.hour, store.data.reminders.minute).slice(0, 5)}"></label>`
              : ""}`,
          {
            footer:
              "Im Browser kann dein Handy keine Mitteilungen zu einer Uhrzeit planen. Darum bekommt jeder Golftag in der Kalenderdatei einen Wecker zur gewählten Uhrzeit, mit dem Vorschlag des Tages, dazu die Golftage der nächsten zwei Wochen. Unter Woche → „In den Kalender“ holst du die Datei jede Woche neu. An Tagen mit Teamtraining und an Turniertagen ohne Training kommt keine Erinnerung.",
          },
        )}
        ${chapter(
          "Training",
          html`<ul class="rows">
            <li><a class="row" href="#/tagebuch"><span class="row-main"><span class="row-title">Trainingstagebuch</span><span class="row-sub">Stoppuhr, eigene Einheiten und die Übungen aus den Vorschlägen</span></span></a></li>
            <li><a class="row" href="#/statistik"><span class="row-main"><span class="row-title">Meine Statistik</span><span class="row-sub">Zeit pro Woche, Serie, Bereiche und Monatstests</span></span></a></li>
          </ul>`,
        )}
        ${chapter(
          "Datensicherung",
          html`<button type="button" class="action" data-action="backup" data-key="backup">Sicherung erstellen<span class="mark" aria-hidden="true">↓</span></button>
            <label class="action">Sicherung zurückspielen<input class="visually-hidden" type="file" accept=".json,application/json" data-restore></label>`,
          {
            footer:
              "Eine Datei mit Golfwoche, Vorschlägen, Ergebnissen, Tagebuch, Launch-Monitor-Sessions, Runden, Turnieren, Schwerpunkten, Handicap und eigenen Terminen, z. B. für ein neues Handy. Sie passt auch zur App auf dem iPhone, in beide Richtungen. Browser löschen ihre Daten manchmal, z. B. mit dem Verlauf. Sichere deshalb ab und zu. Die Datei ist nicht verschlüsselt: Bewahre sie so sorgfältig auf wie deine Fotos.",
          },
        )}
        ${isStandalone() ? "" : installChapter(app)}
        ${chapter(
          "Datenschutz und Rechtliches",
          html`<ul class="rows">
              <li><a class="row" href="../datenschutz.html">Datenschutzerklärung</a></li>
              <li><a class="row" href="../nutzungsbedingungen.html">Nutzungsbedingungen</a></li>
              <li><a class="row" href="../anbieter.html">Anbieter</a></li>
              <li><a class="row" href="../lizenzen.html">Lizenzen</a></li>
              <li><a class="row" href="../support.html">Hilfe und Kontakt</a></li>
              <li><a class="row" href="#/mehr/loeschen">Meine Daten löschen</a></li>
            </ul>`,
          { footer: "Ein Konto ist freiwillig. Keine Werbung, keine Cookies, keine Analyse- oder Tracking-Dienste. Ohne Konto bleiben deine Daten in diesem Browser auf deinem Gerät." },
        )}
        ${chapter(
          "Nur in der App für iPhone und iPad",
          html`<ul class="bullets">
            <li>Team mit Jugendabteilung, Trainern, Terminen und Einheiten vom Trainer</li>
            <li>Kamera mit automatischem Auslöser und zweites Gerät als Bildschirm</li>
            <li>Schwunganalyse und Mitteilungen auf dem Gerät</li>
          </ul>`,
          { footer: "Was du hier einträgst, nimmst du mit einer Sicherung oder über dein Konto in die App mit." },
        )}
      `;
    },
    mount(root) {
      root.addEventListener("click", async (event) => {
        // Golfwoche: jede Änderung gilt gleich für die Vorschläge dieser Woche.
        const week = copyGolfWeek(store.data.golfWeek ?? emptyGolfWeek());
        if (applyGolfWeekClick(week, event.target)) {
          store.setGolfWeek(week);
          return;
        }
        const hand = event.target.closest("[data-hand]");
        if (hand) {
          if (store.data.handedness !== hand.dataset.hand) store.setHandedness(hand.dataset.hand);
          return;
        }
        const button = event.target.closest("[data-action]");
        if (!button) return;
        switch (button.dataset.action) {
          case "regenerate":
            store.regeneratePlan();
            toast("Die Vorschläge sind neu erstellt.");
            break;
          case "backup": {
            const now = new Date();
            const name = fileName(now);
            const text = store.backupText(now);
            if (!(await shareFile(name, text, "application/json"))) {
              download(name, text, "application/json");
              toast(`Die Sicherung ist in deinen Downloads: ${name}`);
            }
            break;
          }
          case "install":
            if (app.installPrompt) {
              const prompt = app.installPrompt;
              app.installPrompt = null;
              prompt.prompt();
              await prompt.userChoice.catch(() => null);
              app.render({ keepScroll: true });
            }
            break;
          default:
            break;
        }
      });
      root.addEventListener("change", (event) => {
        const enabled = event.target.closest("[data-reminder-enabled]");
        if (enabled) {
          store.setReminders({ ...store.data.reminders, isEnabled: enabled.checked });
          toast(enabled.checked ? `Erinnerung um ${timeText(store.data.reminders.hour, store.data.reminders.minute)} in der nächsten Kalenderdatei.` : "Erinnerung aus.");
          return;
        }
        const time = event.target.closest("[data-reminder-time]");
        if (time) {
          const [hour, minute] = time.value.split(":").map(Number);
          if (Number.isInteger(hour) && Number.isInteger(minute)) store.setReminders({ ...store.data.reminders, hour, minute });
          return;
        }
        const input = event.target.closest("[data-facility]");
        if (!input) return;
        const facility = input.dataset.facility;
        store.updateGolfWeek((week) => {
          week.facilities = input.checked ? [...new Set([...week.facilities, facility])] : week.facilities.filter((other) => other !== facility);
        });
      });
      root.querySelector("[data-restore]").addEventListener("change", async (event) => {
        const input = event.target;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        let backup;
        try {
          backup = readBackup(await readFile(file));
        } catch (error) {
          await inform("Datensicherung", error instanceof BackupError ? error.message : "Die Datei ließ sich nicht lesen.");
          return;
        }
        const when = `${formatShortDate(backup.createdAt)}, ${formatTime(backup.createdAt)} Uhr`;
        const mode = await ask({
          title: `Sicherung vom ${when} übernehmen?`,
          message: `${summary(backup.data)} Zusammenführen fügt hinzu, was auf diesem Gerät fehlt. Ersetzen stellt den Stand der Sicherung her, auch Golfwoche, Vorschläge und Einstellungen.`,
          actions: [
            { label: "Zusammenführen", value: "merge", style: "flag" },
            { label: "Ersetzen", value: "replace", style: "danger" },
          ],
        });
        if (!mode) return;
        let message;
        try {
          message = store.restore(backup, mode);
        } catch (error) {
          message = `Die Sicherung ließ sich nicht vollständig übernehmen: ${error.message}`;
        }
        await inform("Datensicherung", message);
      });
    },
  };
}

function installChapter(app) {
  // Auf iPhone und iPad löscht Safari die Daten einer Seite nach sieben Tagen
  // ohne Besuch, außer sie liegt auf dem Home-Bildschirm.
  if (!app.installPrompt && isAppleMobile()) {
    return chapter(
      "Auf den Home-Bildschirm",
      html`<p class="serif">In Safari auf „Teilen“ und dann auf „Zum Home-Bildschirm“ tippen.</p>
        <p class="hint">Sonst kann Safari deine Daten nach sieben Tagen ohne Besuch löschen. Ein Konto oder eine Sicherung schützt davor.</p>`,
      {
        footer:
          "Dann öffnet sich Golf Trainer wie eine App, ohne Adressleiste, und läuft auch ohne Netz, z. B. auf der Range. Fehlen dort deine Einträge, hol sie mit deinem Konto oder einer Sicherung nach.",
      },
    );
  }
  return chapter(
    "Auf den Startbildschirm",
    app.installPrompt
      ? html`<button type="button" class="action" data-action="install">Golf Trainer installieren<span class="mark" aria-hidden="true">+</span></button>`
      : html`<p class="serif">Im Menü deines Browsers „Zum Startbildschirm hinzufügen“ oder „App installieren“ wählen. In Samsung Internet heißt es „Seite hinzufügen zu“ und dann „Startbildschirm“.</p>`,
    { footer: "Dann öffnet sich Golf Trainer wie eine App, ohne Adressleiste, und läuft auch ohne Netz, z. B. auf der Range." },
  );
}

function focusRow(point) {
  return html`<li><a class="row${point.isActive ? "" : " paused"}" href="#/mehr/schwerpunkte/${encodeURIComponent(point.id)}">
    <span class="row-main">
      <span class="row-title">${point.text || "Ohne Text"}</span>
      <span class="row-sub">${AREA_NAMES[point.area] ?? point.area} · ${priorityName(point.priority)}${point.isActive ? "" : " · pausiert"}</span>
    </span>
  </a></li>`;
}

// MARK: - Schwerpunkt

export function focusEditor(app, id) {
  const { store } = app;
  const existing = id ? store.data.focusPoints.find((point) => point.id === id) : null;
  if (id && !existing) return { title: "Schwerpunkt", tab: "mehr", parent: "#/mehr", render: () => empty("Diesen Schwerpunkt gibt es nicht mehr.") };
  const proposal = existing ? null : takeProposedFocus();
  const point = existing
    ? { ...existing, drillIDs: [...existing.drillIDs] }
    : { id: newID(), text: "", area: "approach", priority: 2, isActive: true, drillIDs: [], ...(proposal ?? {}) };

  /** Technik-Übungen des gewählten Bereichs und alle Korrektur-Übungen. */
  const techniqueDrills = () => store.library.filter((drill) => drill.mode === "block" && !drill.isWarmUp && (drill.area === point.area || drill.isCorrective));

  function drillList() {
    return html`${techniqueDrills().map((drill) => {
      const isOn = point.drillIDs.includes(drill.id);
      return html`<li><button type="button" class="row checklist" aria-pressed="${String(isOn)}" data-drill="${drill.id}">
        <span class="row-main">
          <span class="row-title">${drill.name}${drill.isCorrective ? html` <span class="kicker ink">Korrektur</span>` : ""}</span>
          <span class="row-purpose">${drill.purpose}</span>
        </span>
        ${check(isOn)}
      </button></li>`;
    })}`;
  }

  return {
    title: "Trainer-Schwerpunkt",
    tab: "mehr",
    parent: "#/mehr",
    keepOnChange: true,
    render() {
      return html`<form class="editor" novalidate>
        <label class="field"><span>Schwerpunkt</span><textarea name="text" rows="2" maxlength="${LIMITS.textLength}" placeholder="z. B. Ruhiger Übergang">${point.text}</textarea></label>
        <p class="note" id="focus-hint" data-hint aria-live="polite">${proposal ? "Vorschlag aus der Schwunganalyse. Passe den Text an und besprich ihn mit deinem Trainer." : "Trag hier ein, woran du gerade mit deinem Trainer arbeitest."}</p>
        <label class="field"><span>Bereich</span>
          <select name="area">${AREAS.map((area) => html`<option value="${area}" ${area === point.area ? "selected" : ""}>${AREA_NAMES[area]}</option>`)}</select>
        </label>
        <div class="choice-block"><p class="kicker">Wichtigkeit</p>
          <div class="choice" role="group" aria-label="Wichtigkeit">${[1, 2, 3].map((value) => html`<button type="button" data-priority="${value}" aria-pressed="${String(value === point.priority)}">${priorityName(value)}</button>`)}</div>
        </div>
        <label class="toggle"><span>Aktiv</span><input type="checkbox" name="active" ${point.isActive ? "checked" : ""}></label>
        ${chapter("Passende Technik-Übungen", html`<ul class="rows" data-drills>${drillList()}</ul>`, {
          footer:
            "Was dein Trainer vorschlägt, hier abhaken. Diese Übungen schlägt die App dann bevorzugt im Technik-Teil vor. Korrektur-Übungen (mit „Korrektur“ markiert) schlägt sie nur vor, wenn sie hier ausgewählt sind.",
        })}
        <div class="buttons">
          <button type="submit" class="button flag" data-save>Sichern</button>
          <button type="button" class="button outline" data-cancel>Abbrechen</button>
        </div>
        ${existing ? html`<button type="button" class="action danger" data-delete>Schwerpunkt löschen</button>` : ""}
      </form>`;
    },
    mount(root) {
      const form = root.querySelector("form");
      const saveButton = root.querySelector("[data-save]");
      const list = root.querySelector("[data-drills]");
      const hint = root.querySelector("[data-hint]");
      const defaultHint = hint.textContent;
      // Ein neuer Schwerpunkt ist noch leer. Als Fehler zählt das erst, wenn du hineingetippt hast.
      let textTouched = Boolean(existing);
      const update = () => {
        const missing = form.elements.text.value.trim() === "";
        saveButton.disabled = missing;
        const showMissing = missing && textTouched;
        const text = showMissing ? "Ohne Text lässt sich der Schwerpunkt nicht sichern." : defaultHint;
        // Nur bei einer Änderung neu setzen, sonst liest ein Bildschirmleser bei jedem Tippen vor.
        if (hint.textContent !== text) hint.textContent = text;
        hint.classList.toggle("flag", showMissing);
        markField(form.elements.text, showMissing, hint);
      };
      update();
      form.elements.text.addEventListener("input", () => {
        textTouched = true;
        update();
      });
      form.elements.area.addEventListener("change", () => {
        point.area = form.elements.area.value;
        // Übungen aus dem alten Bereich wären nicht mehr zu sehen und ließen sich nicht abwählen.
        const visible = new Set(techniqueDrills().map((drill) => drill.id));
        point.drillIDs = point.drillIDs.filter((drillID) => visible.has(drillID));
        list.innerHTML = String(drillList());
      });
      form.addEventListener("click", (event) => {
        const priority = event.target.closest("[data-priority]");
        if (priority) {
          point.priority = Number(priority.dataset.priority);
          for (const button of form.querySelectorAll("[data-priority]")) button.setAttribute("aria-pressed", String(button === priority));
          return;
        }
        const drillButton = event.target.closest("[data-drill]");
        if (drillButton) {
          const drillID = drillButton.dataset.drill;
          point.drillIDs = point.drillIDs.includes(drillID) ? point.drillIDs.filter((other) => other !== drillID) : [...point.drillIDs, drillID];
          const isOn = point.drillIDs.includes(drillID);
          drillButton.setAttribute("aria-pressed", String(isOn));
          const box = drillButton.querySelector(".check");
          box.classList.toggle("on", isOn);
          box.textContent = isOn ? "✓" : "";
        }
      });
      root.querySelector("[data-cancel]").addEventListener("click", () => app.back("#/mehr"));
      root.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const choice = await ask({ title: "Schwerpunkt löschen?", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
        if (choice !== "delete") return;
        store.deleteFocus(point.id);
        toast("Schwerpunkt gelöscht.");
        app.back("#/mehr");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        update();
        if (saveButton.disabled) return;
        store.upsertFocus({ ...point, text: form.elements.text.value.trim(), isActive: form.elements.active.checked });
        toast("Gesichert. Er gilt ab den nächsten Vorschlägen.");
        app.back("#/mehr");
      });
    },
  };
}

// MARK: - Löschen

export function deletePage(app) {
  const { store } = app;
  return {
    title: "Meine Daten löschen",
    tab: "mehr",
    parent: "#/mehr",
    render() {
      return html`
        ${headline("Meine Daten löschen")}
        <p class="lead">Löscht alles, was Golf Trainer in diesem Browser auf deinem Gerät gespeichert hat.</p>
        ${chapter(
          "Das wird gelöscht",
          html`<ul class="bullets">
            <li>Golfwoche, Vorschläge und Schwerpunkte</li>
            <li>Ergebnisse, Bestleistungen, Runden und Turniere</li>
            <li>Handicap und eigene Termine</li>
            <li>Trainingstagebuch und eine laufende Stoppuhr</li>
            <li>Sessions vom Launch Monitor und gespeicherte Spaltenzuordnungen</li>
            <li>Alles, was aus einer zurückgespielten Sicherung oder vom Abgleich über das Konto stammt</li>
            <li>Die Anmeldung mit deinem Konto in diesem Browser</li>
            <li>Die Dateien der Seite für die Nutzung ohne Netz; die Seite legt sie beim nächsten Öffnen neu ab</li>
          </ul>`,
        )}
        ${chapter(
          "Das bleibt",
          html`<ul class="bullets">
            <li>Sicherungen und Kalenderdateien, die du gespeichert hast, z. B. in „Downloads“</li>
            <li>Videos in deiner Galerie</li>
            <li>Die Daten der App auf einem iPhone oder iPad, dort löschst du sie in der App</li>
            <li>Dein Konto und die Daten auf dem Server; die löschst du unter Konto → Konto löschen</li>
          </ul>`,
          { footer: "Danach startet die Seite wie beim ersten Besuch. Erstelle vorher eine Sicherung, wenn du die Daten noch brauchst." },
        )}
        <button type="button" class="button danger wide" data-delete>Alles löschen</button>
      `;
    },
    mount(root) {
      root.querySelector("[data-delete]").addEventListener("click", async () => {
        const choice = await ask({
          title: "Wirklich alles löschen?",
          message: "Das lässt sich nicht rückgängig machen.",
          actions: [{ label: "Alles löschen", value: "delete", style: "danger" }],
        });
        if (choice !== "delete") return;
        // Was noch nicht beim Server ist, geht vorher noch raus, dann verschwindet das Team vom Gerät.
        await app.team?.sendPendingChanges();
        app.team?.forgetLocalData();
        app.account.forgetSession();
        store.deleteAll();
        await deleteAllClips();
        await deleteAllPoses();
        try {
          const keys = (await globalThis.caches?.keys()) ?? [];
          await Promise.all(keys.filter((key) => key.startsWith("golftrainer-")).map((key) => caches.delete(key)));
          const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
          await Promise.all(registrations.map((registration) => registration.unregister()));
        } catch {
          // Ohne Zwischenspeicher gibt es dort nichts zu löschen.
        }
        location.replace("#/start");
        location.reload();
      });
    },
  };
}
