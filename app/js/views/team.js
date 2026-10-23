// Das Team in der Web-App, wie TeamView, PlayerViews, EventViews und BoardViews
// in der App: Beitritt über den Einladungslink, Profil, Termine mit Zu- und
// Absagen, Pinnwand, Challenges, Ranglisten, Schwerpunkte, Einheiten und
// Nachrichten der Trainer, „Was die Trainer sehen“, Code einlösen. Trainer
// und Funktionäre sehen hier nur, was auch Spieler sehen; verwalten geht in
// der App.
import { AREA_NAMES } from "../core/categories.js";
import { addDays, formatShortDate, formatTime, fromStored, startOfDay, toStored } from "../core/dates.js";
import { LIMITS } from "../core/model.js";
import { REASON_NAMES, REPORT_REASONS, SUBJECT_NAMES, allows, allowsName } from "../core/moderation.js";
import {
  ANSWERS, ANSWER_NAMES, EVENT_KIND_NAMES, ROLE_NAMES, ageClassLabel, appJoinLink, dateOf, displayCode, extractCode, isCode, joinLink, normalizeCode, parseRecordName, sameID, stamp, uid,
} from "../core/team.js";
import { attendanceSummary, responses, teamCalendar } from "../core/teamcoach.js";
import { SESSION_STATE_NAMES, leaderboard, leaderboardUnit, monthKey, sessionState, sessionTotalMinutes } from "../core/teamshare.js";
import { ask, chapter, check, download, durationText, empty, headline, html, inform, labeled, markField, scoreLabel, toast } from "../ui.js";

export const TEAM_HOME = "#/team";

export const weekdayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
export const dayNumber = new Intl.DateTimeFormat("de-DE", { day: "numeric" });
export const dayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
export const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
export const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" });
export const monthLong = new Intl.DateTimeFormat("de-DE", { month: "long" });

/** „heute“, „gestern“, „vor 5 Tagen“. */
export function relativeDay(date, now = new Date()) {
  if (!date) return "noch nie";
  const days = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86400000);
  if (days < 0) return dayMonth.format(date);
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}

export function note(message) {
  if (!message) return "";
  return message.isProblem ? html`<p class="hint problem" role="alert">${message.text}</p>` : html`<p class="hint" role="status">${message.text}</p>`;
}

/** Die Meldung des Teams, einmal, als Hinweis oben auf der Seite. */
export function takeMessage(team) {
  const message = team.takeMessage();
  return message ? html`<p class="hint problem" role="alert">${message}</p>` : "";
}

export function syncText(team) {
  if (team.isSyncing) return "Abgleich läuft …";
  if (team.lastSync) return `Zuletzt abgeglichen ${formatTime(team.lastSync)} Uhr.`;
  return "Noch nicht abgeglichen.";
}

export function refreshAction(team) {
  return html`<button type="button" class="action" data-action="refresh" ${team.isSyncing ? "disabled" : ""}>Jetzt abgleichen<span class="mark" aria-hidden="true">↻</span></button>`;
}

/** Klicks auf [data-action], gemeinsam für alle Seiten des Teams. */
export function mountActions(root, app, handlers) {
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const handler = handlers[button.dataset.action];
    if (!handler) return;
    event.preventDefault();
    await handler(button);
  });
}

export function intro(title, text) {
  return html`<div class="headline-block"><span class="flagmark" aria-hidden="true"></span><h1 class="headline">${title}</h1></div><p class="lead">${text}</p>`;
}

// MARK: - Einstieg

/** #/team: je nach Stand Einstieg, Konto, Profil, Warten auf Freigabe oder die Startseite im Team. */
export function teamPage(app) {
  const team = app.team;
  return {
    title: team.isInTeam ? team.teamName : "Team",
    tab: "mehr",
    parent: "#/mehr",
    render() {
      if (!team.isInTeam) {
        if (!team.isSignedIn) return html`${takeMessage(team)}${needsAccount(team)}`;
        if (team.pendingJoin) return html`${takeMessage(team)}${profileSetup(team)}`;
        return html`${takeMessage(team)}${setup(team)}`;
      }
      if (team.isRemoved) return html`${takeMessage(team)}${removed(team)}`;
      if (!team.hasLoaded) return html`${takeMessage(team)}${loading(team)}`;
      if (team.isPending) return html`${takeMessage(team)}${pendingApproval(team)}`;
      return html`${takeMessage(team)}${home(app)}`;
    },
    mount(root) {
      const form = root.querySelector("form[data-profile]");
      if (form) mountProfileSetup(form, root, app);
      mountActions(root, app, {
        refresh: () => team.refresh(),
        paste: () => acceptPasted(root, app),
        search: async () => {
          await team.findExistingTeam({ force: true });
          app.render({ keepScroll: true });
        },
        discard: () => {
          team.discardPendingJoin();
          app.render();
        },
        remove: async () => {
          const problem = await team.leaveTeam(false);
          if (problem) toast(problem);
          app.render();
        },
        redeem: () => redeem(root, app),
        answer: (button) => {
          const event = team.data.event(button.dataset.event);
          if (event) team.respond(event, button.dataset.answer);
        },
        regenerate: () => {
          app.store.regeneratePlan();
          toast("Vorschläge neu erstellt.");
        },
        share: () => {
          team.shareFromThisDevice();
          toast("Dieser Browser teilt jetzt dein Training.");
        },
      });
      root.querySelector("form[data-paste]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        acceptPasted(root, app);
      });
      root.querySelector("form[data-redeem]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        redeem(root, app);
      });
    },
  };
}

function needsAccount(team) {
  return html`${intro(
    "Für das Team brauchst du ein Konto",
    team.pendingJoin
      ? "Dein Einladungslink ist gespeichert. Melde dich an oder lege ein Konto an, dann geht es mit dem Beitritt weiter."
      : "Mit dem Konto weiß der Server, wer du bist, und zeigt dir nur, was deine Rolle sehen darf. Das Konto ist kostenlos: E-Mail-Adresse und Passwort.",
  )}
  ${chapter("", html`<a class="action" href="#/mehr/konto">Konto anlegen oder anmelden<span class="mark" aria-hidden="true">→</span></a>`, {
    footer: "Unter 16 geht das Konto nur mit dem Einverständnis eines Elternteils.",
  })}
  ${team.pendingJoin ? openInApp(team.pendingJoin) : ""}
  ${diaryChapter()}`;
}

export function diaryChapter() {
  return chapter("Tagebuch", html`<a class="action" href="#/tagebuch">Mein Trainingstagebuch<span class="mark" aria-hidden="true">›</span></a>`, {
    footer: "Das Tagebuch funktioniert auch ohne Team.",
  });
}

/** Der wartende Link: in der App öffnen oder zum Kopieren. */
export function openInApp(pending) {
  const link = joinLink(pending.teamID, pending.secret);
  return chapter(
    "App auf dem iPhone?",
    html`<a class="action" href="${appJoinLink(pending.teamID, pending.secret)}">In der App „Golf Trainer“ öffnen<span class="mark" aria-hidden="true">↗</span></a>
      <p class="note">Der Link zum Kopieren, z. B. für ein anderes Gerät:</p>
      <p class="small"><code>${link}</code></p>`,
    { footer: "Öffnet sich die App nicht, ist sie auf diesem Gerät nicht installiert. Im Browser geht der Beitritt genauso." },
  );
}

function setup(team) {
  return html`${intro(
    "Training mit dem Verein",
    "Die Jugendabteilung in der App: Termine mit Zu- und Absagen, Pinnwand, Challenges und Ranglisten, Schwerpunkte und Einheiten von den Trainern. Die Daten liegen auf dem Server des Kontos, jedes Mitglied sieht nur, was seine Rolle darf.",
  )}
  ${chapter(
    "Eingeladen?",
    html`<form class="editor" novalidate data-paste>
        <label class="field"><span>Einladungslink oder die ganze Nachricht</span><input type="text" name="link" autocapitalize="none" autocorrect="off" spellcheck="false" data-key="link"></label>
        <div class="buttons"><button type="submit" class="button flag wide" data-action="paste">Einladung annehmen</button></div>
        <p class="hint problem" role="alert" data-paste-error hidden>Darin steckt kein Einladungslink. Er sieht so aus: https://golftrainer-app.github.io/app/#/team/beitreten/…</p>
      </form>
      <button type="button" class="action" data-action="search" ${team.isSearching ? "disabled" : ""}>${team.isSearching ? "Suche …" : "Mein Team über das Konto suchen"}<span class="mark" aria-hidden="true">↻</span></button>`,
    { footer: "Öffne den Einladungslink, z. B. aus WhatsApp. Er führt hierher. Oder füge die ganze Einladung ein. Schon dabei, z. B. auf dem iPhone? Mit demselben Konto findet die Suche dein Team." },
  )}
  ${chapter("", html`<p class="note">Eine Jugendabteilung eröffnen, Mitglieder freigeben und Termine anlegen geht in der App auf dem iPhone oder iPad.</p>`)}
  ${diaryChapter()}`;
}

function acceptPasted(root, app) {
  const field = root.querySelector("input[name='link']");
  const error = root.querySelector("[data-paste-error]");
  const text = field?.value.trim() ?? "";
  if (!text) return;
  if (app.team.receiveLink(text)) {
    field.value = "";
    app.render();
  } else if (error) {
    error.hidden = false;
    markField(field, true, error);
  }
}

// MARK: - Profil anlegen

/** Eingaben bleiben beim Neuzeichnen. Nichts ist vorausgewählt. */
const setupForm = { name: "", code: "", birthYear: "", handicap: "", parentName: "", parentAgrees: false, sharing: { trainingLog: false, drillResults: false, rounds: false, distances: false, leaderboards: false }, message: null, working: false };

const SHARING_LABELS = [
  ["trainingLog", "Wann und wie lange ich trainiere"],
  ["drillResults", "Punkte in den Übungen"],
  ["rounds", "Runden mit Strokes Gained"],
  ["distances", "Schlägerweiten vom Launch Monitor"],
  ["leaderboards", "In den Ranglisten erscheinen (sieht das ganze Team)"],
];

export function yearOptions(year, selected, placeholder) {
  const options = [html`<option value="" ${selected === "" ? "selected" : ""}>${placeholder}</option>`];
  for (let value = year - 5; value >= year - 80; value -= 1) {
    options.push(html`<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${value}</option>`);
  }
  return options;
}

function profileSetup(team) {
  const year = team.year;
  const form = setupForm;
  const normalized = normalizeCode(form.code);
  const hasCode = normalized.length > 0;
  const codeIsInvalid = hasCode && !isCode(normalized);
  const birthYear = form.birthYear ? Number(form.birthYear) : null;
  const needsConsent = birthYear != null && year - birthYear <= 16;
  const hasConsent = form.parentAgrees && form.parentName.trim().length > 0 && allowsName(form.parentName);
  const canShare = !needsConsent || hasConsent;
  const missesBirthYear = !hasCode && birthYear == null;
  const nameOK = form.name.trim().length >= 2 && allowsName(form.name);
  const canSubmit = !form.working && nameOK && !missesBirthYear && !codeIsInvalid;
  return html`${intro("Beitreten", "Leg dein Profil an. Mit Code hast du deine Rolle sofort, sonst gibt dich ein Trainer frei.")}
  <form class="editor" novalidate data-profile>
    ${chapter(
      "Einladungscode",
      html`<label class="field"><span>Code, z. B. K7P3-QXMB (nur mit Einladung mit Rolle)</span><input type="text" name="code" value="${form.code}" autocapitalize="characters" autocorrect="off" spellcheck="false" data-key="code"></label>
        ${codeIsInvalid ? html`<p class="hint problem" role="alert">Ein Code hat acht Zeichen, z. B. K7P3-QXMB. Code prüfen oder das Feld leeren, um als Spieler anzufragen.</p>` : ""}`,
      { footer: "Trainer und Funktionäre bekommen einen Code mit ihrer Rolle. Spieler brauchen meist keinen. Auch die ganze Einladung lässt sich einfügen." },
    )}
    ${chapter(
      "Profil",
      html`<label class="field"><span>Vor- und Nachname</span><input type="text" name="name" value="${form.name}" autocomplete="name" data-key="name"></label>
        ${form.name.trim() && !allowsName(form.name) ? html`<p class="hint problem" role="alert">Bitte wähle einen anderen Namen. Den sieht das ganze Team.</p>` : ""}
        <label class="field"><span>Jahrgang</span><select name="birthYear" data-key="birthYear">${yearOptions(year, form.birthYear, hasCode ? "Nur für Spieler" : "Bitte wählen")}</select></label>
        <label class="field"><span>Handicap (freiwillig)</span><input type="text" name="handicap" value="${form.handicap}" inputmode="decimal" data-key="handicap"></label>
        ${birthYear != null ? html`<ul class="rows">${labeled("Altersklasse", ageClassLabel(birthYear, year))}</ul>` : ""}`,
      {
        footer: hasCode
          ? "Deinen Namen sieht das ganze Team. Jahrgang und Handicap gelten nur für Spieler, Trainer und Funktionäre lassen sie leer."
          : "Deinen Namen sieht das ganze Team. Jahrgang und Handicap sehen nur Trainer und Funktionäre. Der Jahrgang zeigt, ob deine Eltern zustimmen müssen.",
      },
    )}
    ${needsConsent
      ? chapter(
          "Einverständnis der Eltern",
          html`<label class="field"><span>Name eines Elternteils</span><input type="text" name="parentName" value="${form.parentName}" autocomplete="off" data-key="parentName"></label>
            <label class="toggle"><span>Ich bin erziehungsberechtigt und willige ein</span><input type="checkbox" name="parentAgrees" ${form.parentAgrees ? "checked" : ""} data-key="parentAgrees"></label>`,
          {
            footer:
              "Unter 16 dürfen Trainingsdaten nur mit Einverständnis der Eltern geteilt werden (Art. 8 DSGVO). Es gilt für das, was ihr unten auswählt, und lässt sich jederzeit unter „Profil“ zurückziehen. Ohne Einverständnis kann dein Kind trotzdem beitreten, die Web-App teilt dann nur Namen, Jahrgang und Zu- und Absagen.",
          },
        )
      : ""}
    ${chapter(
      hasCode ? "Was die Trainer sehen (nur für Spieler)" : "Was die Trainer sehen",
      SHARING_LABELS.map(
        ([key, label]) =>
          html`<label class="toggle"><span>${label}</span><input type="checkbox" name="sharing-${key}" ${form.sharing[key] ? "checked" : ""} ${!canShare || (key === "drillResults" && !form.sharing.trainingLog) ? "disabled" : ""} data-key="sharing-${key}"></label>`,
      ),
      {
        footer: canShare
          ? "Freiwillig, nichts ist vorausgewählt. Ändern geht jederzeit unter „Was die Trainer sehen“, Ausgeschaltetes wird aus dem Team gelöscht. Punkte gibt es nur zusammen mit dem Training."
          : "Erst mit dem Einverständnis der Eltern.",
      },
    )}
    ${chapter(
      "",
      html`<div class="buttons"><button type="submit" class="button flag wide" data-submit ${canSubmit ? "" : "disabled"}>${form.working ? "Bitte warten …" : hasCode ? "Code einlösen und beitreten" : "Profil anlegen und anfragen"}</button></div>
        ${missesBirthYear && form.name.trim() ? html`<p class="note">Bitte wähle deinen Jahrgang.</p>` : ""}
        ${note(form.message)}`,
      { footer: "Verantwortlich für die Daten im Team ist dein Verein. Austreten und deine Daten im Team löschen kannst du jederzeit unter „Profil“. Siehe Datenschutzerklärung unter Mehr." },
    )}
  </form>
  ${chapter("", html`<button type="button" class="action danger" data-action="discard">Doch nicht beitreten</button>`, { footer: "Der Link wird verworfen. Bis zum Beitritt liegt nichts von dir im Team." })}
  ${openInApp(team.pendingJoin)}`;
}

function mountProfileSetup(form, root, app) {
  const team = app.team;
  const read = () => {
    const fields = form.elements;
    const code = fields.code.value;
    // Auch die ganze Einladung aus WhatsApp lässt sich einfügen, der Code wird herausgesucht.
    if (code.length > 9) {
      const extracted = extractCode(code);
      if (extracted) fields.code.value = displayCode(extracted);
    }
    setupForm.code = fields.code.value;
    setupForm.name = fields.name.value;
    setupForm.birthYear = fields.birthYear.value;
    setupForm.handicap = fields.handicap.value;
    setupForm.parentName = fields.parentName?.value ?? setupForm.parentName;
    setupForm.parentAgrees = fields.parentAgrees?.checked ?? setupForm.parentAgrees;
    for (const [key] of SHARING_LABELS) {
      const box = fields[`sharing-${key}`];
      if (box && !box.disabled) setupForm.sharing[key] = box.checked;
    }
    if (!setupForm.sharing.trainingLog) setupForm.sharing.drillResults = false;
  };
  form.addEventListener("input", (event) => {
    read();
    // Felder, die andere ein- oder ausblenden, zeichnen die Seite neu.
    if (["birthYear", "code", "parentAgrees", "parentName", "sharing-trainingLog", "name"].includes(event.target.name)) app.render({ keepScroll: true });
  });
  form.addEventListener("change", () => {
    read();
    app.render({ keepScroll: true });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    read();
    if (root.querySelector("[data-submit]")?.disabled) return;
    const year = team.year;
    const birthYear = setupForm.birthYear ? Number(setupForm.birthYear) : null;
    const needsConsent = birthYear != null && year - birthYear <= 16;
    const hasConsent = setupForm.parentAgrees && setupForm.parentName.trim().length > 0 && allowsName(setupForm.parentName);
    const consent = needsConsent && hasConsent ? { parentName: setupForm.parentName.trim(), date: toStored(new Date()) } : null;
    const handicap = Number(setupForm.handicap.replace(",", "."));
    setupForm.working = true;
    setupForm.message = null;
    app.render({ keepScroll: true });
    const problem = await team.createProfile({
      name: setupForm.name.trim(),
      birthYear,
      handicap: setupForm.handicap.trim() && Number.isFinite(handicap) ? handicap : null,
      handedness: app.store.data.handedness,
      consent,
      sharing: !needsConsent || hasConsent ? setupForm.sharing : undefined,
      inviteCode: normalizeCode(setupForm.code) || null,
    });
    setupForm.working = false;
    if (problem) {
      setupForm.message = { text: problem, isProblem: true };
    } else {
      setupForm.name = "";
      setupForm.code = "";
      setupForm.birthYear = "";
      setupForm.handicap = "";
      setupForm.parentName = "";
      setupForm.parentAgrees = false;
      setupForm.sharing = { trainingLog: false, drillResults: false, rounds: false, distances: false, leaderboards: false };
      toast("Profil angelegt.");
    }
    app.render({ keepScroll: true });
  });
}

// MARK: - Warten, geladen, entfernt

function loading(team) {
  return html`${chapter("", html`<p class="empty">Team wird geladen …</p>${refreshAction(team)}`, {
    footer: "Ohne Netz geht es weiter, sobald die Verbindung zurück ist.",
  })}${diaryChapter()}`;
}

export function codeField() {
  return html`<form class="editor" novalidate data-redeem>
    <label class="field"><span>Code, z. B. K7P3-QXMB</span><input type="text" name="code" autocapitalize="characters" autocorrect="off" spellcheck="false" data-key="redeem-code"></label>
    <div class="buttons"><button type="submit" class="button outline wide" data-action="redeem">Code einlösen</button></div>
    <p class="hint problem" role="alert" data-redeem-error hidden></p>
  </form>`;
}

async function redeem(root, app) {
  const field = root.querySelector("input[name='code']");
  const error = root.querySelector("[data-redeem-error]");
  const code = extractCode(field?.value ?? "") ?? normalizeCode(field?.value ?? "");
  if (!isCode(code)) {
    error.textContent = "Ein Code hat acht Zeichen, z. B. K7P3-QXMB.";
    error.hidden = false;
    markField(field, true, error);
    return;
  }
  const problem = await app.team.redeemInvite(code);
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    markField(field, true, error);
    return;
  }
  toast("Code eingelöst.");
  app.render();
}

function pendingApproval(team) {
  return html`${intro("Warte auf Freigabe", "Ein Trainer oder Admin muss dich noch freigeben. Bis dahin teilt die Web-App keine Trainingsdaten, und du siehst noch keine Termine.")}
  ${chapter("Einladungscode", codeField(), { footer: "Hast du als Trainer oder Funktionär einen Code bekommen? Damit hast du deine Rolle sofort." })}
  ${chapter(
    "Ich",
    html`<a class="action" href="#/tagebuch">Mein Trainingstagebuch<span class="mark" aria-hidden="true">›</span></a>
      <a class="action" href="#/team/profil">Profil und Team verlassen<span class="mark" aria-hidden="true">›</span></a>
      ${refreshAction(team)}`,
    { footer: syncText(team) },
  )}`;
}

function removed(team) {
  return html`${intro("Nicht mehr im Team", "Ein Trainer oder Admin hat dich aus dem Team genommen. Deine Daten in diesem Browser bleiben erhalten.")}
  ${chapter("", html`<button type="button" class="action" data-action="remove">Team von diesem Gerät entfernen<span class="mark" aria-hidden="true">→</span></button>`, {
    footer: "War das ein Versehen? Entferne das Team, öffne den Einladungslink noch einmal und lass dich neu freigeben.",
  })}
  ${syncText(team) ? html`<p class="note">${syncText(team)}</p>` : ""}`;
}

// MARK: - Startseite

function home(app) {
  const team = app.team;
  const data = team.data;
  const now = new Date();
  const me = team.myMemberID;
  const isPlayer = team.isPlayer;
  const events = data.upcomingEvents(now, isPlayer ? me : null).slice(0, 3);
  const announcements = data.announcements(isPlayer ? me : null, team.blocked).slice(0, 2);
  const challenges = data.challenges(isPlayer ? me : null).filter((item) => stamp(item.start) <= toStored(now) && toStored(now) <= stamp(item.end));
  const showsLeaderboards = data.info?.showsLeaderboards !== false || !isPlayer;
  return html`
    ${isPlayer && team.needsParentalConsent
      ? chapter("", html`<a class="action" href="#/team/profil"><span><span class="kicker flag">Einverständnis fehlt</span><br>Einverständnis der Eltern fehlt. Bis dahin gehen keine Trainingsdaten oder Nachrichten an die Trainer.</span><span class="mark" aria-hidden="true">›</span></a>`)
      : ""}
    ${chapter(
      "Nächste Termine",
      html`${events.length === 0 ? empty("Keine Termine geplant.") : ""}
        <ul class="rows">${events.map((event) => eventRow(event, team, { withButtons: isPlayer }))}</ul>
        <a class="action" href="#/team/termine">Alle Termine<span class="mark" aria-hidden="true">›</span></a>`,
    )}
    ${chapter(
      "Pinnwand",
      html`${announcements.length === 0 ? empty("Keine Nachrichten.") : ""}
        ${announcements.map((item) => announcementRow(item, team))}
        <a class="action" href="#/team/pinnwand">Ganze Pinnwand<span class="mark" aria-hidden="true">›</span></a>`,
    )}
    ${isPlayer ? coachChapter(app, me) : ""}
    ${challenges.length > 0 || showsLeaderboards
      ? chapter(
          "Wettbewerb",
          html`<ul class="rows">${challenges.map((item) => html`<li><a class="row" href="#/team/challenges/${encodeURIComponent(uid(item.id))}"><span class="row-main"><span class="row-title">${item.title}</span></span></a></li>`)}</ul>
            <a class="action" href="#/team/challenges">Alle Challenges<span class="mark" aria-hidden="true">›</span></a>
            ${showsLeaderboards ? html`<a class="action" href="#/team/ranglisten">Ranglisten<span class="mark" aria-hidden="true">›</span></a>` : ""}`,
        )
      : ""}
    ${isPlayer
      ? chapter(
          "Mein Training",
          html`<a class="action" href="#/tagebuch">Trainingstagebuch<span class="mark" aria-hidden="true">›</span></a>
            <a class="action" href="#/team/videos"><span>Meine Videos${data.clips(me).length > 0 ? html` <span class="kicker">${data.clips(me).length}</span>` : ""}</span><span class="mark" aria-hidden="true">›</span></a>
            <a class="action" href="#/team/freigaben"><span>Was die Trainer sehen${team.otherSharingDevice ? html`<br><span class="kicker flag">Dein Training teilt gerade ein anderes Gerät (${team.otherSharingDevice.name ?? "Gerät"}).</span>` : ""}</span><span class="mark" aria-hidden="true">›</span></a>`,
        )
      : chapter("", html`<p class="note">Als ${data.roleText(me) ?? ROLE_NAMES[team.myRole] ?? "Mitglied"} verwaltest du das Team in der App auf dem iPhone oder iPad: Mitglieder freigeben, Termine anlegen, Anwesenheit, Pinnwand schreiben. Hier siehst du, was auch die Spieler sehen.</p>`)}
    ${chapter(
      "Team",
      html`<a class="action" href="#/team/mitglieder">Mitglieder<span class="mark" aria-hidden="true">›</span></a>
        <a class="action" href="#/team/profil">Profil und Team verlassen<span class="mark" aria-hidden="true">›</span></a>
        ${refreshAction(team)}`,
      { footer: syncText(team) },
    )}`;
}

function coachChapter(app, me) {
  const team = app.team;
  const data = team.data;
  const now = new Date();
  const focus = data.activeFocus(me);
  const comments = data.comments(me, { hiding: team.blocked });
  const sessions = team.mySessions();
  const open = openSessions(team, sessions, now);
  const missing = team.focusMissingInPlan();
  const last = comments[comments.length - 1] ?? null;
  return chapter(
    "Von deinen Trainern",
    html`<ul class="rows">${open.map((session) => sessionRow(session, team, now))}</ul>
      ${sessions.length > 0 ? html`<a class="action" href="#/team/einheiten">Alle Einheiten vom Trainer<span class="mark" aria-hidden="true">›</span></a>` : ""}
      ${focus.map((item) => html`<p class="serif"><strong>${item.text}</strong><br><span class="kicker">${AREA_NAMES[item.area] ?? item.area} · von ${data.name(item.authorID)}</span></p>`)}
      ${missing.length > 0 ? html`<button type="button" class="action" data-action="regenerate">Vorschläge mit den neuen Schwerpunkten neu erstellen<span class="mark" aria-hidden="true">↻</span></button>` : ""}
      <a class="action" href="#/team/nachrichten"><span>Nachrichten mit den Trainern${last ? html`<br><span class="kicker">${data.name(last.authorID)}: ${String(last.text ?? "").slice(0, 80)}</span>` : ""}</span><span class="mark" aria-hidden="true">›</span></a>`,
    { footer: focus.length === 0 ? "Schwerpunkte, die dir ein Trainer gibt, fließen automatisch in deine Vorschläge ein." : null },
  );
}

/** Begonnen und noch nicht fertig; Überfälliges verschwindet eine Woche nach der Frist von der Startseite. */
export function openSessions(team, sessions, now) {
  const weekAgo = addDays(startOfDay(now), -7);
  return sessions.filter((session) => {
    switch (sessionState(session, team.doneDrillIDs(session), now)) {
      case "open":
        return true;
      case "overdue": {
        const due = dateOf(session.due);
        return due ? startOfDay(due) >= weekAgo : true;
      }
      default:
        return false;
    }
  });
}

// MARK: - Termine

export function eventSubtitle(event) {
  const start = dateOf(event.start);
  if (!start) return "";
  const end = new Date(start.getTime() + (Number(event.minutes) || 0) * 60000);
  const parts = [`${formatTime(start)}–${formatTime(end)}`];
  if (event.place) parts.push(event.place);
  if (event.group) parts.push(event.group);
  return parts.join(" · ");
}

export function eventRow(event, team, { withButtons = false } = {}) {
  const start = dateOf(event.start);
  const me = team.myMemberID;
  const answer = me ? team.data.response(me, event.id)?.answer : null;
  const id = encodeURIComponent(uid(event.id));
  return html`<li>
    <a class="row event" href="#/team/termine/${id}">
      <span class="event-day" aria-hidden="true"><span class="kicker">${start ? weekdayShort.format(start) : ""}</span><span class="figure">${start ? dayNumber.format(start) : "?"}</span></span>
      <span class="row-main">
        <span class="row-title${event.isCancelled ? " cancelled" : ""}">${event.isCancelled ? `Abgesagt: ${event.title}` : event.title}</span>
        <span class="row-sub">${eventSubtitle(event)}</span>
        <span class="kicker">${EVENT_KIND_NAMES[event.kind] ?? "Termin"}${answer ? ` · ${ANSWER_NAMES[answer] ?? answer}` : ""}${team.isStaff && event.asksForResponse !== false && !event.isCancelled ? ` · ${responses(event, team.data).yes.length} Zusagen` : ""}</span>
      </span>
    </a>
    ${withButtons && event.asksForResponse !== false && !event.isCancelled ? responseButtons(event, team) : ""}
  </li>`;
}

export function responseButtons(event, team) {
  const me = team.myMemberID;
  const current = me ? team.data.response(me, event.id)?.answer : null;
  return html`<div class="choice answers" role="group" aria-label="Antwort auf ${event.title}">${ANSWERS.map(
    (answer) => html`<button type="button" data-action="answer" data-event="${uid(event.id)}" data-answer="${answer}" aria-pressed="${String(current === answer)}" data-key="answer-${uid(event.id)}-${answer}">${ANSWER_NAMES[answer]}</button>`,
  )}</div>`;
}

export function teamEventsPage(app) {
  const team = app.team;
  let showsPast = false;
  return {
    title: "Termine",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      const now = new Date();
      const viewer = team.isPlayer ? team.myMemberID : null;
      const upcoming = team.data.upcomingEvents(now, viewer);
      const past = team.data.pastEvents(now, viewer);
      return html`${takeMessage(team)}
        ${team.isStaff ? chapter("", html`<a class="action" href="#/team/termine/neu">Termin anlegen<span class="mark" aria-hidden="true">+</span></a>`) : ""}
        ${chapter("Kommende", html`${upcoming.length === 0 ? empty("Keine Termine geplant.") : ""}<ul class="rows">${upcoming.map((event) => eventRow(event, team))}</ul>`)}
        ${past.length > 0
          ? chapter(
              "Vergangen",
              showsPast
                ? html`<ul class="rows">${past.slice(0, 40).map((event) => eventRow(event, team))}</ul>`
                : html`<button type="button" class="action" data-action="past">Vergangene Termine zeigen (${past.length})<span class="mark" aria-hidden="true">↓</span></button>`,
            )
          : ""}
        ${chapter("", html`${upcoming.length > 0 ? html`<button type="button" class="action" data-action="calendar">In den Kalender (.ics)<span class="mark" aria-hidden="true">↗</span></button>` : ""}${refreshAction(team)}`, { footer: syncText(team) })}`;
    },
    mount(root) {
      mountActions(root, app, {
        refresh: () => team.refresh(),
        past: () => {
          showsPast = true;
          app.render({ keepScroll: true });
        },
        calendar: () => {
          const viewer = team.isPlayer ? team.myMemberID : null;
          download(`Termine ${team.teamName}.ics`, teamCalendar(team.data.upcomingEvents(new Date(), viewer), team.teamName, new Date()), "text/calendar");
        },
      });
    },
  };
}

export function teamEventPage(app, eventID) {
  const team = app.team;
  let noteMessage = null;
  return {
    title: team.data.event(eventID)?.title ?? "Termin",
    tab: "mehr",
    parent: "#/team/termine",
    render() {
      const event = team.data.event(eventID);
      if (!event) return empty("Termin nicht gefunden.");
      const data = team.data;
      const me = team.myMemberID;
      const now = new Date();
      const start = dateOf(event.start);
      const end = start ? new Date(start.getTime() + (Number(event.minutes) || 0) * 60000) : null;
      const canAnswer = team.isPlayer && event.asksForResponse !== false && !event.isCancelled && stamp(event.start) + (Number(event.minutes) || 0) * 60 >= toStored(now);
      const mine = me ? data.response(me, event.id) : null;
      const summary = responses(event, data);
      const attendance = team.isStaff ? attendanceSummary(event, data) : null;
      const drills = (event.drillIDs ?? []).map((id) => app.store.drill(id)).filter(Boolean);
      return html`${takeMessage(team)}
        ${headline(event.isCancelled ? `Abgesagt: ${event.title}` : event.title, EVENT_KIND_NAMES[event.kind] ?? "Termin")}
        <ul class="rows facts">
          ${labeled("Wann", start ? `${dayLong.format(start)}, ${formatTime(start)} – ${formatTime(end)}` : "?")}
          ${event.place ? labeled("Wo", event.place) : ""}
          ${labeled("Für", event.group ?? "Ganzes Team")}
        </ul>
        ${event.note ? html`<p class="serif">${event.note}</p>` : ""}
        ${canAnswer
          ? chapter(
              "Deine Antwort",
              html`${responseButtons(event, team)}
                <label class="field"><span>${mine ? "Notiz, z. B. „komme 15 Minuten später“" : "Erst zu- oder absagen, dann Notiz"}</span><input type="text" name="note" value="${mine?.note ?? ""}" maxlength="${LIMITS.textLength}" ${mine ? "" : "disabled"} data-key="note"></label>
                ${note(noteMessage)}`,
              { footer: "Antwort und Notiz sehen alle im Team." },
            )
          : ""}
        ${drills.length > 0
          ? chapter(
              "Übungen",
              html`<ul class="rows">${drills.map((drill) => html`<li><a class="row" href="#/uebungen/${encodeURIComponent(drill.id)}"><span class="row-main"><span class="row-title">${drill.name}</span><span class="row-sub">${AREA_NAMES[drill.area]} · ${drill.minutes} Min.</span></span></a></li>`)}</ul>`,
            )
          : ""}
        ${event.asksForResponse !== false
          ? chapter(
              "Wer kommt",
              html`<ul class="rows">${["yes", "maybe", "no"].map((answer) => responseGroup(ANSWER_NAMES[answer], summary[answer], event, team))}${team.isStaff ? responseGroup("Ohne Antwort", summary.open, event, team) : ""}</ul>`,
            )
          : ""}
        ${team.isStaff
          ? chapter(
              "Anwesenheit",
              html`<ul class="rows"><li><a class="row labeled" href="#/team/termine/${encodeURIComponent(uid(event.id))}/anwesenheit"><span class="row-main">Liste</span><span class="row-value">${attendance.open === 0 ? `${attendance.present} da` : `${attendance.open} offen`}</span></a></li></ul>`,
            )
          : ""}
        ${chapter(
          "",
          html`<button type="button" class="action" data-action="calendar">In den Kalender (.ics)<span class="mark" aria-hidden="true">↗</span></button>
            <a class="action" href="#/team/melden/event/${encodeURIComponent(uid(event.id))}">Termin melden<span class="mark" aria-hidden="true">›</span></a>
            ${team.isStaff
              ? html`<a class="action" href="#/team/termine/${encodeURIComponent(uid(event.id))}/bearbeiten">Bearbeiten<span class="mark" aria-hidden="true">›</span></a>
                  <button type="button" class="action" data-action="cancel">${event.isCancelled ? "Wieder ansetzen" : "Absagen"}</button>
                  <button type="button" class="action danger" data-action="delete-event">Termin löschen</button>`
              : ""}`,
        )}`;
    },
    mount(root) {
      const field = root.querySelector("input[name='note']");
      let timer = null;
      const save = () => {
        const event = team.data.event(eventID);
        if (!event || !field) return;
        const problem = team.setResponseNote(event, field.value);
        noteMessage = problem ? { text: problem, isProblem: true } : null;
        if (problem) app.render({ keepScroll: true });
      };
      field?.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(save, 1000);
      });
      mountActions(root, app, {
        answer: (button) => {
          const event = team.data.event(button.dataset.event);
          if (event) team.respond(event, button.dataset.answer);
        },
        calendar: () => {
          const event = team.data.event(eventID);
          if (event) download(`${event.title}.ics`, teamCalendar([event], team.teamName, new Date()), "text/calendar");
        },
        cancel: () => {
          const event = team.data.event(eventID);
          if (event) team.setCancelled(event.id, !event.isCancelled);
        },
        "delete-event": async () => {
          const choice = await ask({ title: "Termin löschen?", message: "Zu- und Absagen und die Anwesenheit dieses Termins werden mitgelöscht. Absagen ist meist besser, dann sehen alle, dass er ausfällt.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice !== "delete") return;
          team.deleteEvent(eventID);
          app.navigate("#/team/termine", { replace: true });
        },
      });
      return () => {
        clearTimeout(timer);
        if (field && !field.disabled) save();
      };
    },
  };
}

function responseGroup(title, ids, event, team) {
  const data = team.data;
  return html`<li class="row labeled"><span class="row-main"><span class="row-title">${title}</span>${ids.length > 0
    ? html`<span class="row-sub">${ids
        .map((id) => {
          const response = data.response(id, event.id);
          const text = response?.note && !team.isBlocked(id) ? ` (${response.note})` : "";
          return `${data.name(id)}${text}`;
        })
        .join(", ")}</span>`
    : ""}</span><span class="row-value">${ids.length}</span></li>`;
}

// MARK: - Pinnwand

export function announcementRow(item, team, { editable = false } = {}) {
  const date = dateOf(item.date);
  const id = encodeURIComponent(uid(item.id));
  return html`<div class="announcement">
    ${item.isPinned ? html`<p class="kicker flag">Angeheftet</p>` : ""}
    <p class="row-title">${item.title}</p>
    <p class="serif">${item.text}</p>
    <p class="kicker">${team.data.name(item.authorID)}${date ? ` · ${formatShortDate(date)}, ${formatTime(date)} Uhr` : ""}${item.group ? ` · ${item.group}` : ""}${sameID(item.authorID, team.myMemberID) ? "" : html` · <a href="#/team/melden/announcement/${id}">Melden</a>`}${editable && team.isStaff ? html` · <a href="#/team/pinnwand/${id}/bearbeiten">Bearbeiten</a> · <button type="button" class="text-button" data-action="delete-announcement" data-id="${uid(item.id)}">Löschen</button>` : ""}</p>
  </div>`;
}

export function teamBoardPage(app) {
  const team = app.team;
  return {
    title: "Pinnwand",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      const items = team.data.announcements(team.isPlayer ? team.myMemberID : null, team.blocked);
      return html`${takeMessage(team)}
        ${team.isStaff ? chapter("", html`<a class="action" href="#/team/pinnwand/neu">Nachricht schreiben<span class="mark" aria-hidden="true">+</span></a>`) : ""}
        ${items.length === 0 ? empty("Noch keine Nachrichten.") : ""}${items.map((item) => announcementRow(item, team, { editable: true }))}
        ${chapter("", refreshAction(team), { footer: syncText(team) })}`;
    },
    mount(root) {
      mountActions(root, app, {
        refresh: () => team.refresh(),
        "delete-announcement": async (button) => {
          const choice = await ask({ title: "Beitrag löschen?", message: "Der Beitrag verschwindet für alle im Team.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice === "delete") team.deleteAnnouncement(button.dataset.id);
        },
      });
    },
  };
}

// MARK: - Challenges und Ranglisten

export function teamChallengesPage(app) {
  const team = app.team;
  return {
    title: "Challenges",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      const now = toStored(new Date());
      const all = team.data.challenges(team.isPlayer ? team.myMemberID : null);
      const section = (title, items) =>
        items.length === 0
          ? ""
          : chapter(
              title,
              html`<ul class="rows">${items.map(
                (item) => html`<li><a class="row" href="#/team/challenges/${encodeURIComponent(uid(item.id))}"><span class="row-main"><span class="row-title">${item.title}</span><span class="row-sub">${app.store.drill(item.drillID)?.name ?? "Übung"} · bis ${dateOf(item.end) ? dayMonth.format(dateOf(item.end)) : "?"}</span></span></a></li>`,
              )}</ul>`,
            );
      return html`${takeMessage(team)}
        ${team.isCoach ? chapter("", html`<a class="action" href="#/team/challenges/neu">Challenge anlegen<span class="mark" aria-hidden="true">+</span></a>`) : ""}
        ${all.length === 0 ? empty(team.isCoach ? "Leg eine Challenge an, z. B. „Wer schafft im Oktober die meisten Punkte beim Putt-Test?“" : "Gerade läuft keine Challenge.") : ""}
        ${section("Läuft", all.filter((item) => stamp(item.start) <= now && now <= stamp(item.end)))}
        ${section("Demnächst", all.filter((item) => stamp(item.start) > now))}
        ${section("Beendet", all.filter((item) => stamp(item.end) < now))}`;
    },
  };
}

export function leaderboardRows(rows, unit, team) {
  if (rows.length === 0) return empty("Noch keine Werte.");
  return html`<ul class="rows">${rows.map((row) => {
    const isMe = sameID(row.memberID, team.myMemberID);
    return html`<li class="row rank-row"><span class="rank${row.rank === 1 ? " flag" : ""}">${row.rank}</span><span class="row-main"><span class="row-title${isMe ? " me" : ""}">${row.name}${isMe ? html`<span class="visually-hidden"> (du)</span>` : ""}</span></span><span class="row-value">${row.value} <span class="kicker">${unit}</span></span></li>`;
  })}</ul>`;
}

export function teamChallengePage(app, challengeID) {
  const team = app.team;
  return {
    title: team.data.challenge(challengeID)?.title ?? "Challenge",
    tab: "mehr",
    parent: "#/team/challenges",
    render() {
      const challenge = team.data.challenge(challengeID);
      if (!challenge) return empty("Challenge nicht gefunden.");
      const drill = app.store.drill(challenge.drillID);
      const lowerIsBetter = drill?.scoring?.kind === "strokes";
      const kind = { type: "challenge", id: uid(challenge.id), lowerIsBetter };
      const start = dateOf(challenge.start);
      const end = dateOf(challenge.end);
      return html`${takeMessage(team)}
        ${headline(challenge.title, "Challenge")}
        ${challenge.text ? html`<p class="serif">${challenge.text}</p>` : ""}
        <ul class="rows facts">
          ${labeled("Zeitraum", `${start ? formatShortDate(start) : "?"} – ${end ? formatShortDate(end) : "?"}`)}
          ${labeled("Es zählt", lowerIsBetter ? "das Ergebnis mit den wenigsten Schlägen" : "das beste Ergebnis")}
        </ul>
        ${drill ? html`<a class="action" href="#/uebungen/${encodeURIComponent(drill.id)}">Jetzt üben: ${drill.name}<span class="mark" aria-hidden="true">›</span></a>` : ""}
        ${chapter("Stand", leaderboardRows(leaderboard(kind, team.data, new Date()), leaderboardUnit(kind), team), {
          footer: "Es zählen Ergebnisse, die im Zeitraum eingetragen wurden. Wer die eigenen Werte nicht teilt, erscheint nicht.",
        })}
        ${chapter(
          "",
          html`${sameID(challenge.createdBy, team.myMemberID) ? "" : html`<a class="action" href="#/team/melden/challenge/${encodeURIComponent(uid(challenge.id))}">Challenge melden<span class="mark" aria-hidden="true">›</span></a>`}
            ${team.isCoach
              ? html`<a class="action" href="#/team/challenges/${encodeURIComponent(uid(challenge.id))}/bearbeiten">Bearbeiten<span class="mark" aria-hidden="true">›</span></a>
                  <button type="button" class="action danger" data-action="delete-challenge">Löschen</button>`
              : ""}`,
        )}`;
    },
    mount(root) {
      mountActions(root, app, {
        "delete-challenge": async () => {
          const choice = await ask({ title: "Challenge löschen?", message: "Die Challenge verschwindet für alle im Team.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice !== "delete") return;
          team.deleteChallenge(challengeID);
          app.navigate("#/team/challenges", { replace: true });
        },
      });
    },
  };
}

const boardChoice = { kind: "minutes", lastMonth: false, benchmarkID: "" };

export function teamLeaderboardPage(app) {
  const team = app.team;
  return {
    title: "Ranglisten",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      if (team.isPlayer && team.data.info?.showsLeaderboards === false) return empty("Die Trainer haben die Ranglisten ausgeschaltet.");
      const now = new Date();
      const month = new Date(now.getFullYear(), now.getMonth() + (boardChoice.lastMonth ? -1 : 0), 1);
      const key = monthKey(month);
      const benchmarks = app.store.library.filter((drill) => drill.isBenchmark);
      const test = benchmarks.find((drill) => drill.id === boardChoice.benchmarkID) ?? benchmarks[0] ?? null;
      let kind;
      switch (boardChoice.kind) {
        case "days":
          kind = { type: "trainingDays", month: key };
          break;
        case "streak":
          kind = { type: "streak" };
          break;
        case "benchmark":
          kind = test ? { type: "benchmark", drillID: test.id, month: key, lowerIsBetter: test.scoring.kind === "strokes" } : null;
          break;
        default:
          kind = { type: "minutes", month: key };
      }
      const kinds = [
        ["minutes", "Minuten"],
        ["days", "Tage"],
        ["streak", "Serie"],
        ["benchmark", "Tests"],
      ];
      return html`${takeMessage(team)}
        <div class="choice" role="group" aria-label="Rangliste">${kinds.map(([value, label]) => html`<button type="button" data-action="kind" data-kind="${value}" aria-pressed="${String(boardChoice.kind === value)}" data-key="kind-${value}">${label}</button>`)}</div>
        ${boardChoice.kind !== "streak"
          ? html`<div class="choice" role="group" aria-label="Monat">${[false, true].map(
              (last) => html`<button type="button" data-action="month" data-last="${String(last)}" aria-pressed="${String(boardChoice.lastMonth === last)}" data-key="month-${last}">${monthLong.format(new Date(now.getFullYear(), now.getMonth() - (last ? 1 : 0), 1))}</button>`,
            )}</div>`
          : ""}
        ${boardChoice.kind === "benchmark" && benchmarks.length > 0
          ? html`<label class="field"><span>Test</span><select name="benchmark" data-key="benchmark">${benchmarks.map((drill) => html`<option value="${drill.id}" ${drill.id === test?.id ? "selected" : ""}>${drill.name}</option>`)}</select></label>`
          : ""}
        ${chapter("", kind ? leaderboardRows(leaderboard(kind, team.data, now), leaderboardUnit(kind), team) : empty("Keine Tests."), {
          footer: "Es erscheinen nur Spieler, die ihre Werte teilen. Ausschalten geht unter „Was die Trainer sehen“.",
        })}`;
    },
    mount(root) {
      mountActions(root, app, {
        kind: (button) => {
          boardChoice.kind = button.dataset.kind;
          app.render({ keepScroll: true });
        },
        month: (button) => {
          boardChoice.lastMonth = button.dataset.last === "true";
          app.render({ keepScroll: true });
        },
      });
      root.querySelector("select[name='benchmark']")?.addEventListener("change", (event) => {
        boardChoice.benchmarkID = event.target.value;
        app.render({ keepScroll: true });
      });
    },
  };
}

// MARK: - Einheiten vom Trainer

export function periodText(session) {
  const start = dateOf(session.start ?? session.createdAt);
  const due = dateOf(session.due);
  if (!due) return `ab ${start ? dayShort.format(start) : "?"}, ohne Frist`;
  return `${start ? dayShort.format(start) : "?"} bis ${dayShort.format(due)}`;
}

export function sessionRow(session, team, now) {
  const drills = Array.isArray(session.drills) ? session.drills : [];
  const done = [...team.doneDrillIDs(session)].filter((id) => drills.some((item) => item.drillID === id)).length;
  const state = sessionState(session, team.doneDrillIDs(session), now);
  const due = dateOf(session.due);
  return html`<li><a class="row" href="#/team/einheiten/${encodeURIComponent(uid(session.id))}">
    <span class="row-main">
      <span class="row-title">${session.title}</span>
      <span class="row-sub">${done} von ${drills.length} Übungen · ${durationText(sessionTotalMinutes(session))}${due ? ` · bis ${dayShort.format(due)}` : ""}</span>
    </span>
    <span class="kicker${state === "overdue" ? " flag" : state === "done" ? " ink" : ""}">${SESSION_STATE_NAMES[state]}</span>
  </a></li>`;
}

export function teamSessionsPage(app) {
  const team = app.team;
  return {
    title: "Einheiten vom Trainer",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      const now = new Date();
      const sessions = team.mySessions();
      const states = new Map(sessions.map((session) => [uid(session.id), sessionState(session, team.doneDrillIDs(session), now)]));
      const section = (title, items) => (items.length === 0 ? "" : chapter(title, html`<ul class="rows">${items.map((session) => sessionRow(session, team, now))}</ul>`));
      return html`${takeMessage(team)}
        ${team.otherSharingDevice ? otherDeviceChapter(team) : ""}
        ${sessions.length === 0 ? empty("Noch keine Einheiten. Gibt dir ein Trainer eine, steht sie hier und in deiner Woche.") : ""}
        ${section("Offen", sessions.filter((session) => ["open", "overdue"].includes(states.get(uid(session.id)))))}
        ${section("Kommt noch", sessions.filter((session) => states.get(uid(session.id)) === "upcoming"))}
        ${section("Erledigt", sessions.filter((session) => states.get(uid(session.id)) === "done").sort((a, b) => stamp(b.start) - stamp(a.start)))}`;
    },
    mount(root) {
      mountActions(root, app, {
        share: () => {
          team.shareFromThisDevice();
          toast("Dieser Browser teilt jetzt dein Training.");
        },
      });
    },
  };
}

export function otherDeviceChapter(team) {
  return chapter(
    "",
    html`<p class="hint">Dein Training teilt gerade ein anderes Gerät (${team.otherSharingDevice?.name ?? "Gerät"}). Ergebnisse von hier sieht dein Trainer erst, wenn dieser Browser teilt.</p>
      <button type="button" class="action" data-action="share">Ab jetzt von diesem Browser teilen<span class="mark" aria-hidden="true">→</span></button>`,
    { footer: "Es teilt immer nur ein Gerät, sonst löschen sich zwei Geräte gegenseitig die Einträge." },
  );
}

export function teamSessionPage(app, sessionID) {
  const team = app.team;
  return {
    title: team.data.session(sessionID)?.title ?? "Einheit",
    tab: "mehr",
    parent: "#/team/einheiten",
    render() {
      const session = team.data.session(sessionID);
      if (!session) return empty("Einheit nicht gefunden. Vielleicht hat der Trainer sie gelöscht.");
      const now = new Date();
      const done = team.doneDrillIDs(session);
      const state = sessionState(session, done, now);
      const drills = Array.isArray(session.drills) ? session.drills : [];
      const doneCount = drills.filter((item) => done.has(item.drillID)).length;
      const start = dateOf(session.start ?? session.createdAt);
      return html`${takeMessage(team)}
        ${team.otherSharingDevice ? otherDeviceChapter(team) : ""}
        ${headline(session.title, `Einheit von ${team.data.name(session.authorID)}`)}
        ${session.text ? html`<p class="serif">${session.text}</p>` : ""}
        <ul class="rows facts">${labeled("Dauer", durationText(sessionTotalMinutes(session)))}${labeled("Zeitraum", periodText(session))}</ul>
        ${state === "upcoming" ? html`<p class="note">Beginnt am ${start ? dayShort.format(start) : "?"}. Du kannst trotzdem schon anfangen.</p>` : ""}
        ${chapter(
          `Übungen · ${doneCount} von ${drills.length} erledigt`,
          html`<ul class="rows">${drills.map((item) => {
            const drill = app.store.drill(item.drillID);
            const planned = drill ? team.plannedDrill(item, now) : null;
            if (!drill || !planned) return html`<li class="row"><span class="row-main"><span class="row-sub flag">Diese Übung kennt die Web-App noch nicht. Bitte die Seite neu laden.</span></span></li>`;
            const result = app.store.resultInSession(drill.id, session.id);
            const details = [`${planned.minutes} Min.`];
            if (drill.levels.length > 1) details.push(`Stufe ${planned.level + 1}`);
            if (result) details.push(scoreLabel(result.score, drill.scoring));
            return html`<li><a class="row" href="#/team/einheiten/${encodeURIComponent(uid(session.id))}/${encodeURIComponent(drill.id)}">
              ${check(done.has(item.drillID))}
              <span class="row-main"><span class="row-title">${drill.name}</span><span class="row-sub">${details.join(" · ")}</span>${item.note ? html`<span class="row-focus">${item.note}</span>` : ""}</span>
            </a></li>`;
          })}</ul>`,
          { footer: "Die Ergebnisse zählen auch für deine Stufen und dein Tagebuch. Teilst du dein Training, sieht dein Trainer, was erledigt ist." },
        )}`;
    },
    mount(root) {
      mountActions(root, app, {
        share: () => {
          team.shareFromThisDevice();
          toast("Dieser Browser teilt jetzt dein Training.");
        },
      });
    },
  };
}

// MARK: - Mitglieder und Nachrichten

export function teamMembersPage(app) {
  const team = app.team;
  return {
    title: "Mitglieder",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      const data = team.data;
      const section = (title, members) =>
        members.length === 0
          ? ""
          : chapter(
              title,
              html`<ul class="rows">${members.map((member) => {
                const id = uid(member.id);
                const isMe = sameID(id, team.myMemberID);
                const role = data.role(id) !== "player" ? data.roleText(id) : null;
                return html`<li class="row"><span class="row-main"><span class="row-title">${member.name}${isMe ? " (du)" : ""}</span>${role ? html`<span class="row-sub">${role}</span>` : ""}${team.isBlocked(id) ? html`<span class="kicker">Blockiert</span>` : ""}</span>
                  ${isMe
                    ? ""
                    : html`<span class="row-value"><button type="button" class="text-button" data-action="${team.isBlocked(id) ? "unblock" : "block"}" data-member="${id}" data-key="block-${id}">${team.isBlocked(id) ? "Freigeben" : "Blockieren"}</button> <a href="#/team/melden/member/${encodeURIComponent(id)}">Melden</a></span>`}</li>`;
              })}</ul>`,
            );
      return html`${takeMessage(team)}${section("Trainer", data.coaches)}${section("Funktionäre", data.officials)}${section("Spieler", data.players)}
        ${chapter("", "", { footer: "Blockierte Mitglieder siehst du weiter in Listen, ihre Nachrichten, Beiträge und Notizen blendet dieser Browser aus. Melden geht an die Admins des Teams." })}`;
    },
    mount(root) {
      mountActions(root, app, {
        block: (button) => {
          team.block(button.dataset.member);
          app.render({ keepScroll: true });
        },
        unblock: (button) => {
          team.unblock(button.dataset.member);
          app.render({ keepScroll: true });
        },
      });
    },
  };
}

const messageForm = { text: "", message: null };

export function teamMessagesPage(app, memberID = null) {
  const team = app.team;
  const target = memberID ? uid(memberID) : team.myMemberID;
  const isOwn = !memberID || sameID(memberID, team.myMemberID);
  return {
    title: "Nachrichten",
    tab: "mehr",
    parent: isOwn ? TEAM_HOME : `#/team/mitglieder/${encodeURIComponent(target ?? "")}`,
    render() {
      const me = team.myMemberID;
      if (!me || !target) return empty("Du bist in keinem Team.");
      if (!isOwn && !team.isCoach) return empty("Nachrichten mit Spielern sehen nur die Trainer.");
      const comments = team.data.comments(target, { hiding: team.blocked });
      const blocked = team.needsParentalConsent;
      return html`${takeMessage(team)}
        ${chapter(
          "Nachrichten",
          html`${comments.length === 0 ? empty("Noch keine Nachrichten.") : ""}
            ${comments.map((comment) => {
              const isMine = sameID(comment.authorID, me);
              const date = dateOf(comment.date);
              return html`<div class="bubble${isMine ? " mine" : ""}">
                <p class="kicker">${isMine ? "Du" : team.data.name(comment.authorID)}${date ? ` · ${formatShortDate(date)}, ${formatTime(date)} Uhr` : ""}${comment.clipID && team.data.get(`clip.${uid(comment.clipID)}`) ? html` · <a href="#/team/videos/${encodeURIComponent(uid(comment.clipID))}">Zum Video</a>` : ""}${isMine ? "" : html` · <a href="#/team/melden/comment/${encodeURIComponent(uid(comment.id))}">Melden</a>`}</p>
                <p class="serif">${comment.text}</p>
              </div>`;
            })}
            <form class="editor" novalidate data-message>
              <label class="field"><span>Nachricht</span><textarea name="text" rows="3" maxlength="${LIMITS.textLength}" ${blocked ? "disabled" : ""} data-key="text">${messageForm.text}</textarea></label>
              <div class="buttons"><button type="submit" class="button flag wide" ${blocked ? "disabled" : ""} data-key="send">Senden</button></div>
              ${note(messageForm.message)}
            </form>`,
          {
            footer: blocked
              ? "Antworten kannst du, sobald deine Eltern einverstanden sind. Trag es unter „Profil“ ein."
              : isOwn
                ? "Sehen nur du und die Trainer. Beleidigungen fängt ein Wortfilter ab, Melden geht an die Admins."
                : `Sehen nur ${team.data.name(target)} und die Trainer. Beleidigungen fängt ein Wortfilter ab.`,
          },
        )}`;
    },
    mount(root) {
      const form = root.querySelector("form[data-message]");
      if (!form) return;
      form.addEventListener("input", () => {
        messageForm.text = form.elements.text.value;
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const problem = team.sendComment(form.elements.text.value, target);
        if (problem) {
          messageForm.message = { text: problem, isProblem: true };
        } else {
          messageForm.text = "";
          messageForm.message = null;
        }
        app.render({ keepScroll: true });
      });
    },
  };
}

// MARK: - Profil, Freigaben, Verlassen

const profileForm = { loaded: false, name: "", birthYear: "", handicap: "", parentName: "", parentAgrees: false, message: null };

export function teamProfilePage(app) {
  const team = app.team;
  return {
    title: "Profil",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!team.isInTeam) return empty("Du bist in keinem Team.");
      const form = profileForm;
      if (!form.loaded) {
        form.loaded = true;
        form.name = team.me?.name ?? "";
        form.birthYear = team.myDetails?.birthYear != null ? String(team.myDetails.birthYear) : "";
        form.handicap = team.myDetails?.handicap != null ? String(team.myDetails.handicap).replace(".", ",") : "";
      }
      const year = team.year;
      const birthYear = form.birthYear ? Number(form.birthYear) : null;
      const isChild = birthYear == null || year - birthYear <= 16;
      const consent = team.myDetails?.consent ?? null;
      const blocked = isChild && consent == null;
      const nameOK = form.name.trim().length >= 2 && allowsName(form.name);
      const consentDate = consent ? dateOf(consent.date) : null;
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-profile-edit>
          ${chapter(
            "Profil",
            html`<label class="field"><span>Name</span><input type="text" name="name" value="${form.name}" autocomplete="name" data-key="name"></label>
              ${form.name.trim() && !allowsName(form.name) ? html`<p class="hint problem" role="alert">Bitte wähle einen anderen Namen. Den sieht das ganze Team.</p>` : ""}
              ${team.isStaff
                ? ""
                : html`<label class="field"><span>Jahrgang</span><select name="birthYear" data-key="birthYear">${yearOptions(year, form.birthYear, "Nicht angegeben")}</select></label>
                    ${blocked ? "" : html`<label class="field"><span>Handicap</span><input type="text" name="handicap" value="${form.handicap}" inputmode="decimal" data-key="handicap"></label>`}`}
              <div class="buttons"><button type="submit" class="button wide" ${nameOK ? "" : "disabled"} data-key="save">Profil sichern</button></div>
              ${note(form.message)}`,
            { footer: !team.isStaff && blocked ? "Bis die Eltern einverstanden sind, teilt die Web-App nur Namen, Jahrgang und Zu- und Absagen." : null },
          )}
        </form>
        ${isChild && !team.isStaff
          ? chapter(
              "Einverständnis der Eltern",
              consent
                ? html`<ul class="rows">${labeled("Einverstanden", `${consent.parentName ?? ""}${consentDate ? `, ${formatShortDate(consentDate)}` : ""}`)}</ul>
                    <button type="button" class="action danger" data-action="withdraw">Einverständnis zurückziehen</button>`
                : html`<form class="editor" novalidate data-consent>
                    <label class="field"><span>Name eines Elternteils</span><input type="text" name="parentName" value="${form.parentName}" data-key="parentName"></label>
                    <label class="toggle"><span>Ich bin erziehungsberechtigt und willige ein</span><input type="checkbox" name="parentAgrees" ${form.parentAgrees ? "checked" : ""} data-key="parentAgrees"></label>
                    <div class="buttons"><button type="submit" class="button wide" ${form.parentAgrees && form.parentName.trim() && allowsName(form.parentName) ? "" : "disabled"} data-key="consent">Einverständnis sichern</button></div>
                  </form>`,
              {
                footer:
                  "Unter 16 dürfen Trainingsdaten nur mit Einverständnis der Eltern geteilt werden (Art. 8 DSGVO). Es gilt für das, was unter „Was die Trainer sehen“ ausgewählt ist. Ziehst du es zurück, teilt die Web-App nichts mehr und löscht das Geteilte aus dem Team.",
              },
            )
          : ""}
        ${chapter(
          "Team",
          html`<ul class="rows">${labeled("Team", team.teamName)}${team.data.roleText(team.myMemberID) ? labeled("Rolle", team.data.roleText(team.myMemberID)) : ""}${team.lastSync ? labeled("Letzter Abgleich", `${formatTime(team.lastSync)} Uhr`) : ""}</ul>`,
        )}
        ${team.blocked.size > 0
          ? chapter(
              "Blockiert",
              html`<ul class="rows">${[...team.blocked].map((id) => html`<li class="row"><span class="row-main">${team.data.name(id)}</span><span class="row-value"><button type="button" class="text-button" data-action="unblock" data-member="${id}">Freigeben</button></span></li>`)}</ul>`,
            )
          : ""}
        ${chapter(
          "",
          html`${team.canDeleteTeam ? html`<button type="button" class="action danger" data-action="delete-team">Jugendabteilung löschen</button>` : ""}
            ${team.isOwner
              ? ""
              : html`<label class="toggle"><span>Meine Daten im Team löschen</span><input type="checkbox" name="deletesMyData" checked data-key="deletesMyData"></label>
                <button type="button" class="action danger" data-action="leave">Team verlassen</button>`}`,
          {
            footer: team.isOwner
              ? "Löschst du die Jugendabteilung, sind alle Daten aller Mitglieder auf dem Server weg. Willst du nur gehen, übergib sie vorher unter „Einladen und Einstellungen“ an einen Trainer oder Funktionär."
              : team.canTakeOver
                ? "Die Person, die die Abteilung eröffnet hat, hat ihr Konto gelöscht. Als Admin kannst du die Abteilung unter „Einladen und Einstellungen“ übernehmen oder sie hier mit allen Daten löschen. Deine Daten in diesem Browser bleiben erhalten."
                : "Deine Daten in diesem Browser bleiben erhalten.",
          },
        )}`;
    },
    mount(root) {
      const form = profileForm;
      const edit = root.querySelector("form[data-profile-edit]");
      edit?.addEventListener("input", (event) => {
        form.name = edit.elements.name.value;
        form.birthYear = edit.elements.birthYear?.value ?? "";
        form.handicap = edit.elements.handicap?.value ?? form.handicap;
        if (["birthYear", "name"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      edit?.addEventListener("submit", (event) => {
        event.preventDefault();
        if (root.querySelector("[data-key='save']")?.disabled) return;
        team.rename(form.name);
        const handicap = Number(form.handicap.replace(",", "."));
        team.updateDetails({ birthYear: form.birthYear ? Number(form.birthYear) : null, handicap: form.handicap.trim() && Number.isFinite(handicap) ? handicap : null });
        form.message = { text: "Profil gesichert.", isProblem: false };
        toast("Profil gesichert.");
        app.render({ keepScroll: true });
      });
      const consentForm = root.querySelector("form[data-consent]");
      consentForm?.addEventListener("input", () => {
        form.parentName = consentForm.elements.parentName.value;
        form.parentAgrees = consentForm.elements.parentAgrees.checked;
        app.render({ keepScroll: true });
      });
      consentForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        if (root.querySelector("[data-key='consent']")?.disabled) return;
        team.setConsent({ parentName: form.parentName.trim(), date: toStored(new Date()) }, form.birthYear ? Number(form.birthYear) : null);
        form.parentName = "";
        form.parentAgrees = false;
        toast("Einverständnis gesichert. Was geteilt wird, wählt ihr unter „Was die Trainer sehen“.");
        app.render({ keepScroll: true });
      });
      mountActions(root, app, {
        withdraw: async () => {
          const choice = await ask({ title: "Einverständnis zurückziehen?", message: "Die Web-App teilt dann nichts mehr und löscht das Geteilte aus dem Team.", actions: [{ label: "Zurückziehen", value: "withdraw", style: "danger" }] });
          if (choice !== "withdraw") return;
          team.setConsent(null);
          app.render({ keepScroll: true });
        },
        unblock: (button) => {
          team.unblock(button.dataset.member);
          app.render({ keepScroll: true });
        },
        leave: async () => {
          const deletes = root.querySelector("input[name='deletesMyData']")?.checked ?? true;
          const choice = await ask({ title: "Team verlassen?", message: deletes ? "Deine Daten im Team werden gelöscht. Die Daten in diesem Browser bleiben." : "Deine Daten in diesem Browser bleiben.", actions: [{ label: "Verlassen", value: "leave", style: "danger" }] });
          if (choice !== "leave") return;
          const problem = await team.leaveTeam(deletes);
          if (problem) {
            form.message = { text: problem, isProblem: true };
            app.render({ keepScroll: true });
            return;
          }
          profileForm.loaded = false;
          app.navigate(TEAM_HOME, { replace: true });
        },
        "delete-team": async () => {
          const choice = await ask({ title: "Jugendabteilung mit allen Daten löschen?", message: "Das lässt sich nicht rückgängig machen. Alle Daten aller Mitglieder auf dem Server sind dann weg.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice !== "delete") return;
          const problem = await team.deleteTeam();
          if (problem) {
            form.message = { text: problem, isProblem: true };
            app.render({ keepScroll: true });
            return;
          }
          profileForm.loaded = false;
          app.navigate(TEAM_HOME, { replace: true });
        },
      });
      return () => {
        if (!location.hash.startsWith("#/team/profil")) profileForm.loaded = false;
      };
    },
  };
}

export function teamSharingPage(app) {
  const team = app.team;
  return {
    title: "Was die Trainer sehen",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const details = team.myDetails;
      if (!team.isInTeam || !details) return empty("Kein Profil.");
      const blocked = team.needsParentalConsent;
      const sharing = details.sharing ?? {};
      const toggle = (key, label, disabled = false) =>
        html`<label class="toggle"><span>${label}</span><input type="checkbox" data-sharing="${key}" ${sharing[key] ? "checked" : ""} ${blocked || disabled ? "disabled" : ""} data-key="sharing-${key}"></label>`;
      return html`${takeMessage(team)}
        ${blocked ? html`<p class="hint problem">Ohne Einverständnis der Eltern teilst du nichts. Trag es unter „Profil“ nach.</p>` : ""}
        ${team.otherSharingDevice ? otherDeviceChapter(team) : ""}
        ${chapter(
          "Die Trainer sehen",
          html`${toggle("trainingLog", "Wann und wie lange ich trainiere")}${toggle("drillResults", "Punkte in den Übungen", !sharing.trainingLog)}${toggle("rounds", "Runden mit Strokes Gained")}${toggle("distances", "Schlägerweiten vom Launch Monitor")}`,
          { footer: "Freiwillig. Andere Spieler sehen davon nichts. Gespeichert wird es auf dem Server des Kontos, lesen dürfen es nur deine Trainer. Schaltest du etwas aus, wird es aus dem Team gelöscht." },
        )}
        ${chapter("Das ganze Team sieht", toggle("leaderboards", "In den Ranglisten erscheinen"), {
          footer: "Trainingsminuten und -tage pro Monat, deine Serie und deine besten Ergebnisse in Monatstests und Challenges.",
        })}
        ${chapter("", "", { footer: "Immer sichtbar für alle: dein Name und deine Zu- und Absagen. Geteilt wird aus diesem Browser nur, wenn er das Gerät ist, das dein Training teilt." })}`;
    },
    mount(root) {
      root.addEventListener("change", (event) => {
        const box = event.target.closest("input[data-sharing]");
        if (!box) return;
        team.setSharing(box.dataset.sharing, box.checked);
        app.render({ keepScroll: true });
      });
      mountActions(root, app, {
        share: () => {
          team.shareFromThisDevice();
          toast("Dieser Browser teilt jetzt dein Training.");
          app.render({ keepScroll: true });
        },
      });
    },
  };
}

// MARK: - Melden

export function teamReportPage(app, kind, key) {
  const team = app.team;
  const name = `${kind}.${key}`;
  const parsed = parseRecordName(name);
  const subject = kind === "member" ? "member" : kind;
  return {
    title: "Melden",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!parsed || !SUBJECT_NAMES[subject]) return empty("Das lässt sich nicht melden.");
      const item = team.data.get(name);
      if (!item) return empty("Nicht gefunden.");
      const text = kind === "member" ? item.name : [item.title, item.text, item.note].filter(Boolean).join("\n");
      return html`${intro(`${SUBJECT_NAMES[subject]} melden`, "Die Admins des Teams bekommen die Meldung. Das gemeldete Mitglied sieht sie nicht.")}
        ${text ? html`<p class="serif small">${text.slice(0, 300)}</p>` : ""}
        <form class="editor" novalidate data-report>
          <label class="field"><span>Grund</span><select name="reason" data-key="reason">${REPORT_REASONS.map((reason) => html`<option value="${reason}">${REASON_NAMES[reason]}</option>`)}</select></label>
          <label class="field"><span>Was ist passiert? (freiwillig)</span><textarea name="note" rows="3" maxlength="${LIMITS.textLength}" data-key="note"></textarea></label>
          <div class="buttons"><button type="submit" class="button flag wide" data-key="send">Melden</button></div>
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-report]");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const item = team.data.get(name);
        if (!item) return;
        const reportedMemberID = kind === "member" ? key : (item.authorID ?? item.createdBy ?? item.memberID ?? null);
        const text = kind === "member" ? item.name : [item.title, item.text, item.note].filter(Boolean).join("\n");
        team.report({ subject, recordName: name, reportedMemberID, text, reason: form.elements.reason.value, note: form.elements.note.value });
        await inform("Gemeldet", "Danke. Die Admins des Teams sehen sich das an.");
        app.back(TEAM_HOME);
      });
    },
  };
}

/** #/team/beitreten/<Team>/<Geheimnis>: der Link aus der Einladung. */
export function teamJoinPage(app, teamID, secret) {
  const team = app.team;
  // Nur einmal annehmen: Jede Änderung am Team zeichnet die Seite neu.
  const pending = team.pendingJoin;
  const accepted = (pending && sameID(pending.teamID, teamID) && pending.secret === secret) || team.receiveLink(`/team/beitreten/${teamID}/${secret}`);
  return {
    title: "Einladung",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      if (!accepted) return html`${intro("Kein gültiger Link", "Der Einladungslink ist unvollständig. Bitte den Trainer um einen neuen.")}`;
      if (team.isInTeam) return html`${intro("Schon dabei", `Du bist im Team „${team.teamName}“.`)}${chapter("", html`<a class="action" href="${TEAM_HOME}">Zum Team<span class="mark" aria-hidden="true">›</span></a>`)}`;
      const pending = { teamID: uid(teamID), secret };
      return html`${intro("Einladung in eine Jugendabteilung", "Du kannst hier im Browser beitreten oder in der App auf dem iPhone oder iPad.")}
        ${chapter(
          "",
          html`<a class="action" href="${TEAM_HOME}">${team.isSignedIn ? "Im Browser beitreten" : "Im Browser anmelden und beitreten"}<span class="mark" aria-hidden="true">›</span></a>
            <a class="action" href="${appJoinLink(pending.teamID, pending.secret)}">In der App „Golf Trainer“ öffnen<span class="mark" aria-hidden="true">↗</span></a>`,
          { footer: "Öffnet sich die App nicht, ist sie auf diesem Gerät nicht installiert. Der Link ist gespeichert, der Beitritt geht jederzeit unter Mehr → Team weiter." },
        )}
        ${chapter("Link zum Kopieren", html`<p class="small"><code>${joinLink(pending.teamID, pending.secret)}</code></p>`, { footer: "Zum Beispiel für ein anderes Gerät. Den Link nur an Mitglieder weitergeben." })}`;
    },
  };
}

/** Für die Zeile unter „Mehr“. */
export function teamStatusText(team) {
  if (!team.isInTeam) return team.pendingJoin ? "Einladung wartet" : "Nicht im Team";
  if (team.isPending) return `${team.teamName} · wartet auf Freigabe`;
  return team.teamName;
}
