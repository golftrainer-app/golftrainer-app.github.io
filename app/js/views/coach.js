// Die Seiten der Trainer und Funktionäre im Team, wie CoachViews,
// OfficialViews, EventViews, BoardViews, SessionViews, InviteViews und
// ModerationViews in der App: Startseite mit Hinweisen, Mitglieder verwalten,
// Spieler im Detail, Termine und Anwesenheit, Pinnwand, Challenges, Einheiten,
// Einladungen, Einstellungen, Meldungen, Trainingskalender, Analyse, Export.
import { AREAS, AREA_NAMES, SG_CATEGORIES, SG_NAMES } from "../core/categories.js";
import { addDays, formatShortDate, formatTime, fromInputs, startOfDay, toDateInput, toStored, toTimeInput } from "../core/dates.js";
import { decodeLogEntry, newID } from "../core/model.js";
import { allows, allowsName } from "../core/moderation.js";
import { KIND_NAMES, PLACE_NAMES, scoreText, sortedAreas } from "../core/traininglog.js";
import {
  ANSWER_NAMES, ATTENDANCE_NAMES, ATTENDANCE_STATUSES, EVENT_KINDS, EVENT_KIND_NAMES, FOCUS_PRIORITY_NAMES, ROLE_NAMES, SESSION_STATE_NAMES, ageClassLabel, dateOf, displayCode, inviteIsOpen, inviteRoleText,
  sameID, sessionDay, sessionState, sessionTotalMinutes, stamp, uid,
} from "../core/team.js";
import {
  ACTIVITY_NAMES, ORGANIZATIONAL_ALERTS, SESSION_TEMPLATES, TITLE_SUGGESTIONS, alerts, areaMinutes, attendanceCSV, attendanceRate, attendanceSummary, averageStrokesGained, decodedLogs,
  doneCount, feed, fileStamp, groupedOverview, heatmap, overview, recipientsText, rightsText, sortedByTotal, teamCalendar, teamStrokesGained, templateMinutes, trainingLogCSV, weakestCategory, weeklyTotals,
} from "../core/teamcoach.js";
import { ask, chapter, check, download, durationText, empty, headline, html, labeled, progress, toast } from "../ui.js";
import { clipRow } from "./clips.js";
import { TEAM_HOME, dayLong, dayShort, eventRow, mountActions, refreshAction, relativeDay, syncText, takeMessage } from "./team.js";

const monthDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const weekdayNarrow = new Intl.DateTimeFormat("de-DE", { weekday: "narrow" });
const dayMonthShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const numericDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Entwürfe der Editoren überleben das Neuzeichnen, z. B. nach einem Abgleich. */
const drafts = new Map();
function useDraft(key, make) {
  if (!drafts.has(key)) drafts.set(key, make());
  return drafts.get(key);
}
function dropDraft(key) {
  drafts.delete(key);
}

const percent = (value) => `${Math.round(value * 100)} %`;
const link = (href, label, sub = null) => html`<li><a class="row" href="${href}"><span class="row-main"><span class="row-title">${label}</span>${sub ? html`<span class="row-sub">${sub}</span>` : ""}</span><span class="mark" aria-hidden="true">›</span></a></li>`;
const member = (id) => `#/team/mitglieder/${encodeURIComponent(uid(id))}`;
const notFound = (text) => empty(text);

function groupOptions(groups, selected, noneLabel) {
  return html`<option value="" ${!selected ? "selected" : ""}>${noneLabel}</option>${groups.map((group) => html`<option value="${group}" ${group === selected ? "selected" : ""}>${group}</option>`)}`;
}

/** Balken wie ein kleines Diagramm, ohne Inline-Stile: Höhen als Attribute im SVG. */
function barChart(values, { label = "" } = {}) {
  const max = Math.max(1, ...values.map((item) => item.value));
  const width = 100;
  const height = 40;
  const slot = width / Math.max(1, values.length);
  const bar = slot * 0.5;
  return html`<svg class="bars" viewBox="0 0 ${width} ${height + 8}" preserveAspectRatio="none" role="img" aria-label="${label}">
    ${values.map((item, index) => {
      const h = (item.value / max) * height;
      return html`<rect x="${(index * slot + (slot - bar) / 2).toFixed(2)}" y="${(height - h).toFixed(2)}" width="${bar.toFixed(2)}" height="${h.toFixed(2)}"></rect>`;
    })}
    <line x1="0" y1="${height}" x2="${width}" y2="${height}"></line>
  </svg>`;
}

/** Kästchen pro Spieler und Tag, je dunkler, desto länger trainiert. */
function heatGrid(map) {
  const maximum = Math.max(map.maxMinutes, 60);
  const cell = 14;
  const gap = 2;
  const width = map.days.length * (cell + gap);
  return html`<div class="heat">
    <div class="heat-row heat-head" aria-hidden="true"><span class="heat-name"></span><svg viewBox="0 0 ${width} 12" width="${width}" height="12">${map.days.map((day, index) => html`<text x="${index * (cell + gap) + cell / 2}" y="10" text-anchor="middle">${weekdayNarrow.format(day)}</text>`)}</svg></div>
    ${map.rows.map(
      (row) => html`<div class="heat-row" role="img" aria-label="${row.member.name}: ${row.total} Minuten an ${row.minutes.filter((value) => value > 0).length} Tagen">
        <span class="heat-name">${row.member.name}</span>
        <svg viewBox="0 0 ${width} ${cell}" width="${width}" height="${cell}">${row.minutes.map((minutes, index) => html`<rect x="${index * (cell + gap)}" y="0" width="${cell}" height="${cell}" fill-opacity="${minutes > 0 ? (0.3 + 0.7 * Math.min(1, minutes / maximum)).toFixed(2) : "0.07"}"></rect>`)}</svg>
        <span class="heat-total">${row.total}</span>
      </div>`,
    )}
  </div>`;
}

function alertRow(alert) {
  let href = "#/team/mitglieder";
  if (alert.eventID) href = `#/team/termine/${encodeURIComponent(alert.eventID)}`;
  else if (alert.planID) href = `#/team/zuweisungen/${encodeURIComponent(alert.planID)}`;
  else if (alert.memberIDs.length === 1 && alert.kind !== "joinRequests") href = member(alert.memberIDs[0]);
  const flagged = alert.kind === "missingConsent" || alert.kind === "inactive";
  return html`<li><a class="row" href="${href}"><span class="row-main"><span class="row-title${flagged ? " flagged" : ""}">${alert.title}</span><span class="row-sub">${alert.detail}</span></span><span class="mark" aria-hidden="true">›</span></a></li>`;
}

// MARK: - Startseite der Trainer und Funktionäre

export function staffHomePage(app) {
  const team = app.team;
  return {
    title: team.teamName,
    tab: "mehr",
    parent: "#/mehr",
    render() {
      return html`${takeMessage(team)}${team.isCoach ? coachHome(app) : officialHome(app)}`;
    },
    mount(root) {
      mountActions(root, app, { refresh: () => team.refresh() });
    },
  };
}

function teamLinks(team, data) {
  const openReports = team.isAdmin ? data.openReports(team.myMemberID).length : 0;
  const pending = team.canApproveRequests ? data.pendingMembers.length : 0;
  return html`<ul class="rows">
    ${link("#/team/mitglieder", "Mitglieder", pending > 0 ? `${pending} ${pending === 1 ? "Anfrage" : "Anfragen"}` : null)}
    ${team.isAdmin ? link("#/team/meldungen", "Meldungen", openReports > 0 ? `${openReports} offen` : null) : ""}
    ${link("#/team/termine", "Termine und Anwesenheit")}
    ${link("#/team/pinnwand", "Pinnwand")}
    ${team.isCoach ? link("#/team/zuweisungen", "Trainingseinheiten") : ""}
    ${link("#/team/challenges", "Challenges")}
    ${link("#/team/ranglisten", "Ranglisten")}
    ${team.isCoach ? link("#/team/analyse", "Team-Analyse") : ""}
    ${link("#/team/export", "Export für den Verein")}
    ${team.canInvite || team.canEditSettings || team.isOwner ? link("#/team/einstellungen", "Einladen und Einstellungen") : ""}
  </ul>`;
}

function coachHome(app) {
  const team = app.team;
  const data = team.data;
  const now = new Date();
  const hints = alerts(data, now);
  const players = overview(data, now).filter((item) => item.role === "player" && item.state !== "paused");
  const trained = players.filter((item) => item.minutesThisWeek > 0).length;
  const total = players.reduce((sum, item) => sum + item.minutesThisWeek, 0);
  const next = data.upcomingEvents(now).find((event) => event.isCancelled !== true);
  const nextStart = next ? dateOf(next.start) : null;
  const map = sortedByTotal(heatmap(data, players.map((item) => item.id), 14, now));
  return html`
    ${hints.length > 0 ? chapter("Hinweise", html`<ul class="rows">${hints.map(alertRow)}</ul>`) : ""}
    ${chapter(
      "Diese Woche",
      html`<div class="figures">
          <div><p class="figure big">${trained}<span class="unit"> von ${players.length}</span></p><p class="serif small">haben trainiert</p></div>
          <ul class="side-figures">
            <li><span class="kicker">Minuten gesamt</span><span class="figure">${durationText(total)}</span></li>
            <li><span class="kicker">Pro Spieler</span><span class="figure">${players.length === 0 ? "–" : durationText(Math.floor(total / players.length))}</span></li>
          </ul>
        </div>
        <p class="small"><span class="kicker">Nächster Termin</span> ${next && nextStart ? `${dayShort.format(nextStart)} · ${next.title}` : "–"}</p>`,
    )}
    ${chapter(
      "Trainingskalender",
      html`<a class="action" href="#/team/kalender">Wer wann trainiert<span class="mark" aria-hidden="true">›</span></a>
        ${map.rows.length === 0 ? html`<p class="note">Noch keine Spieler freigegeben.</p>` : html`<div class="scroll-x">${heatGrid(map)}</div>`}`,
      { footer: "Letzte 14 Tage. Je dunkler, desto länger trainiert." },
    )}
    ${chapter("Team", teamLinks(team, data))}
    ${chapter(
      "Ich",
      html`<ul class="rows">${link("#/tagebuch", "Mein Trainingstagebuch")}${link("#/team/profil", "Mein Profil")}</ul>${refreshAction(team)}`,
      { footer: syncText(team) },
    )}`;
}

function officialHome(app) {
  const team = app.team;
  const data = team.data;
  const now = new Date();
  const hints = alerts(data, now).filter((item) => ORGANIZATIONAL_ALERTS.has(item.kind) && (item.kind !== "joinRequests" || team.canApproveRequests));
  const events = data.upcomingEvents(now).slice(0, 4);
  const pending = data.pendingMembers.length;
  return html`
    ${hints.length > 0 ? chapter("Hinweise", html`<ul class="rows">${hints.map(alertRow)}</ul>`) : ""}
    ${chapter(
      "Jugendabteilung",
      html`<div class="figures">
        <div><p class="figure big">${data.activePlayers.length}</p><p class="serif small">Spieler</p></div>
        <ul class="side-figures">
          <li><span class="kicker">Trainer</span><span class="figure">${data.coaches.length}</span></li>
          <li><span class="kicker">Funktionäre</span><span class="figure">${data.officials.length}</span></li>
          <li><span class="kicker">Anfragen</span><span class="figure${pending > 0 ? " flag" : ""}">${pending}</span></li>
        </ul>
      </div>`,
    )}
    ${chapter(
      "Nächste Termine",
      html`${events.length === 0 ? empty("Keine Termine geplant.") : ""}<ul class="rows">${events.map((event) => eventRow(event, team))}</ul>
        <a class="action" href="#/team/termine">Alle Termine und Anwesenheit<span class="mark" aria-hidden="true">›</span></a>`,
    )}
    ${chapter("Organisation", teamLinks(team, data))}
    ${chapter("Ich", html`<ul class="rows">${link("#/team/profil", "Mein Profil")}</ul>${refreshAction(team)}`, {
      footer: `Als ${data.roleText(team.myMemberID) ?? "Funktionär"} siehst du Termine, Anwesenheit und die Mitglieder mit Jahrgang und Einverständnis. Trainingsdaten der Spieler sehen nur die Trainer. ${syncText(team)}`,
    })}`;
}

// MARK: - Mitglieder

function memberSubtitle(item, data, showsTraining) {
  if (item.role !== "player") return data.roleText(item.id) ?? ROLE_NAMES[item.role];
  const parts = [];
  if (showsTraining) parts.push(`Zuletzt ${relativeDay(item.lastTraining)}`);
  else if (item.group) parts.push(item.group);
  if (item.ageClass) parts.push(item.ageClass);
  if (item.state === "paused") parts.push("pausiert");
  return parts.join(" · ");
}

export function coachMembersPage(app) {
  const team = app.team;
  return {
    title: "Mitglieder",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      const now = new Date();
      const rows = overview(data, now);
      const groups = groupedOverview(rows, data.info?.groups ?? []);
      const pending = data.pendingMembers;
      return html`${takeMessage(team)}
        ${team.canInvite ? chapter("", html`<a class="action" href="#/team/einladungen">Einladen<span class="mark" aria-hidden="true">›</span></a>`) : ""}
        ${pending.length > 0
          ? chapter(
              "Beitrittsanfragen",
              html`<ul class="rows">${pending.map(
                (profile) => html`<li class="row"><span class="row-main"><span class="row-title">${profile.name}</span><span class="row-sub">Angefragt ${relativeDay(dateOf(profile.joinedAt))}</span></span>${team.canManage(profile.id) ? html`<a class="button outline" href="${member(profile.id)}/freigeben">Prüfen</a>` : ""}</li>`,
              )}</ul>`,
              { footer: "Kennst du jemanden nicht, lehne ab. Bis zur Freigabe sieht niemand Trainingsdaten dieser Person, und sie sieht nur, was alle Spieler sehen. Trainer und Funktionäre lädst du besser mit Rolle ein." },
            )
          : ""}
        ${groups.map((group) =>
          chapter(
            group.name,
            html`<ul class="rows">${group.rows.map(
              (item) => html`<li><a class="row" href="${member(item.id)}">
                <span class="row-main"><span class="row-title">${item.member.name}</span><span class="row-sub">${memberSubtitle(item, data, team.isCoach)}</span></span>
                ${item.role === "player" && team.isCoach ? html`<span class="row-value"><span class="figure">${durationText(item.minutesThisWeek)}</span><br><span class="kicker${item.state === "inactive" ? " flag" : ""}">${ACTIVITY_NAMES[item.state]}</span></span>` : ""}
                <span class="mark" aria-hidden="true">›</span>
              </a></li>`,
            )}</ul>`,
          ),
        )}
        ${chapter("", refreshAction(team), { footer: syncText(team) })}`;
    },
    mount(root) {
      mountActions(root, app, { refresh: () => team.refresh() });
    },
  };
}

/** Beitrittsanfrage prüfen: Rolle, bei Funktionären die Bezeichnung, bei Spielern die Gruppe. */
export function approveMemberPage(app, memberID) {
  const team = app.team;
  const key = `approve:${uid(memberID)}`;
  return {
    title: "Beitrittsanfrage",
    tab: "mehr",
    parent: "#/team/mitglieder",
    render() {
      const data = team.data;
      const profile = data.member(memberID);
      if (!profile || !team.canManage(memberID)) return notFound("Diese Anfrage gibt es nicht mehr.");
      const roles = team.assignableRoles;
      const draft = useDraft(key, () => ({ role: roles.includes("player") ? "player" : roles[0] ?? "player", title: "", group: "", isAdmin: false }));
      if (!roles.includes(draft.role)) draft.role = roles[0] ?? "player";
      const details = data.details(memberID);
      const year = team.year;
      const groups = data.info?.groups ?? [];
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`<ul class="rows facts">${labeled("Name", profile.name)}${details?.birthYear != null ? labeled("Jahrgang", `${details.birthYear} · ${ageClassLabel(details.birthYear, year)}`) : ""}${details?.handicap != null ? labeled("Handicap", String(details.handicap).replace(".", ",")) : ""}</ul>
            ${draft.role === "player" && data.needsConsent(memberID, year) ? html`<p class="hint problem">Einverständnis der Eltern fehlt noch</p>` : ""}`,
        )}
        <form class="editor" novalidate data-approve>
          ${chapter(
            "Rolle",
            html`<label class="field"><span>Rolle</span><select name="role" data-key="role">${roles.map((role) => html`<option value="${role}" ${role === draft.role ? "selected" : ""}>${ROLE_NAMES[role]}</option>`)}</select></label>
              ${draft.role === "official" ? html`<label class="field"><span>Bezeichnung, z. B. Jugendwart</span><input type="text" name="title" value="${draft.title}" list="title-suggestions" data-key="title"><datalist id="title-suggestions">${TITLE_SUGGESTIONS.map((item) => html`<option value="${item}"></option>`)}</datalist></label>` : ""}
              ${draft.role === "player" && groups.length > 0 ? html`<label class="field"><span>Gruppe</span><select name="group" data-key="group">${groupOptions(groups, draft.group, "Keine")}</select></label>` : ""}
              ${team.isAdmin && draft.role !== "player" ? html`<label class="toggle"><span>Admin-Rechte</span><input type="checkbox" name="isAdmin" ${draft.isAdmin ? "checked" : ""} data-key="isAdmin"></label>` : ""}
              <div class="buttons"><button type="submit" class="button flag wide" data-key="approve">Freigeben</button></div>`,
            { footer: rightsText(draft.role, draft.isAdmin && team.isAdmin && draft.role !== "player") },
          )}
        </form>
        ${chapter("", html`<button type="button" class="action danger" data-action="decline">Ablehnen</button>`, { footer: "Die Person sieht dann nichts mehr vom Team. Will sie wiederkommen, öffnet sie den Link noch einmal." })}`;
    },
    mount(root) {
      const form = root.querySelector("form[data-approve]");
      const draft = drafts.get(key);
      const read = () => {
        if (!form || !draft) return;
        draft.role = form.elements.role.value;
        draft.title = form.elements.title?.value ?? draft.title;
        draft.group = form.elements.group?.value ?? draft.group;
        draft.isAdmin = form.elements.isAdmin?.checked ?? false;
      };
      form?.addEventListener("input", (event) => {
        read();
        if (["role", "isAdmin"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const title = draft.title.trim();
        if (draft.role === "official" && title && !allowsName(title)) {
          toast("Bitte wähle eine andere Bezeichnung. Die sieht das ganze Team.");
          return;
        }
        const ok = team.approve(memberID, { role: draft.role, title: draft.role === "official" && title ? title : null, group: draft.role === "player" ? draft.group || null : null, isAdmin: draft.isAdmin && draft.role !== "player" });
        if (!ok) return;
        dropDraft(key);
        toast(`${team.data.name(memberID)} freigegeben.`);
        app.navigate("#/team/mitglieder", { replace: true });
      });
      mountActions(root, app, {
        decline: async () => {
          const name = team.data.name(memberID);
          const choice = await ask({ title: `${name} ablehnen?`, message: "Die Person sieht dann nichts mehr vom Team. Will sie wiederkommen, öffnet sie den Link noch einmal.", actions: [{ label: "Ablehnen", value: "decline", style: "danger" }] });
          if (choice !== "decline") return;
          const problem = await team.removeMember(memberID);
          if (problem) return;
          dropDraft(key);
          app.navigate("#/team/mitglieder", { replace: true });
        },
      });
    },
  };
}

// MARK: - Spieler im Detail

function notShared(sharing) {
  const parts = [];
  if (!sharing?.trainingLog) parts.push("Tagebuch");
  if (!sharing?.drillResults) parts.push("Punkte");
  if (!sharing?.rounds) parts.push("Runden");
  if (!sharing?.distances) parts.push("Weiten");
  if (!sharing?.leaderboards) parts.push("Ranglisten");
  return parts.join(", ");
}

function logRow(entry, data) {
  const areas = sortedAreas(entry).map((item) => `${AREA_NAMES[item.area] ?? item.area} ${item.minutes}`).join(", ");
  return html`<li class="row log-row"><span class="row-main">
    <span class="row-title">${KIND_NAMES[entry.kind] ?? entry.kind}</span>
    <span class="row-sub">${dayShort.format(entry.start)}, ${formatTime(entry.start)}${entry.place ? ` · ${PLACE_NAMES[entry.place] ?? entry.place}` : ""}</span>
    ${areas ? html`<span class="row-sub">${areas}</span>` : ""}
    ${entry.drills.map((drill) => html`<span class="row-sub">${drill.name}${scoreText(drill) ? ` · ${scoreText(drill)}` : ""}</span>`)}
    ${entry.effort != null ? html`<span class="kicker">Anstrengung ${entry.effort} von 5</span>` : ""}
    ${entry.note ? html`<span class="row-focus">${entry.note}</span>` : ""}
  </span><span class="row-value">${durationText(entry.minutes)}</span></li>`;
}

export function memberDetailPage(app, memberID) {
  const team = app.team;
  const id = uid(memberID);
  let noteTimer = null;
  return {
    title: team.data.name(id),
    tab: "mehr",
    parent: "#/team/mitglieder",
    render() {
      const data = team.data;
      const profile = data.member(id);
      if (!profile) return notFound("Nicht gefunden.");
      const now = new Date();
      const year = now.getFullYear();
      const role = data.role(id);
      const showsTraining = team.isCoach && role === "player";
      const details = data.details(id);
      const parts = [];
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`${headline(profile.name, data.roleText(id) ?? (data.status(id) === "removed" ? "Nicht mehr im Team" : "Wartet auf Freigabe"))}
            <ul class="rows facts">
              ${[data.group(id), details?.birthYear != null ? ageClassLabel(details.birthYear, year) : null].filter(Boolean).length > 0 ? labeled("Gruppe und Alter", [data.group(id), details?.birthYear != null ? `${details.birthYear} · ${ageClassLabel(details.birthYear, year)}` : null].filter(Boolean).join(" · ")) : ""}
              ${details?.handicap != null ? labeled("Handicap", String(details.handicap).replace(".", ",")) : ""}
              ${details?.handedness ? labeled("Spielhand", details.handedness === "left" ? "Linkshand" : "Rechtshand") : ""}
              ${details?.consent ? labeled("Einverständnis", `${details.consent.parentName ?? ""}${dateOf(details.consent.date) ? `, ${numericDate.format(dateOf(details.consent.date))}` : ""}`) : ""}
            </ul>
            ${!details?.consent && role === "player" && data.needsConsent(id, year) ? html`<p class="hint problem">Einverständnis der Eltern fehlt. Bis dahin teilt die App keine Trainingsdaten.</p>` : ""}
            ${team.isCoach && details?.sharing && notShared(details.sharing) ? html`<p class="note">Teilt nicht alles: ${notShared(details.sharing)}</p>` : ""}`,
        )}
        ${showsTraining ? trainingSections(app, id, now) : role === "player" ? attendanceSection(data, id, now) : ""}
        ${showsTraining ? clipsSection(team, id) : ""}
        ${team.isCoach
          ? chapter("Notiz", html`<label class="field"><span>Notiz</span><textarea name="note" rows="3" data-key="note">${team.note(id)}</textarea></label>`, { footer: "Nur in diesem Browser. Andere Trainer und der Spieler sehen sie nicht." })
          : ""}
        ${managementSection(app, id)}
        ${sameID(id, team.myMemberID)
          ? ""
          : chapter(
              "",
              html`<a class="action" href="#/team/melden/member/${encodeURIComponent(id)}">Mitglied melden<span class="mark" aria-hidden="true">!</span></a>
                <button type="button" class="action" data-action="${team.isBlocked(id) ? "unblock" : "block"}">${team.isBlocked(id) ? "Nicht mehr blockieren" : "Blockieren"}</button>`,
              { footer: "Meldungen sehen nur die Admins, nie die gemeldete Person. Blockieren blendet Nachrichten und Beiträge nur in diesem Browser aus." },
            )}`;
    },
    mount(root) {
      const noteField = root.querySelector("textarea[name='note']");
      noteField?.addEventListener("input", () => {
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => team.setNote(noteField.value, id), 500);
      });
      const management = root.querySelector("form[data-management]");
      management?.addEventListener("change", (event) => {
        const field = event.target;
        if (field.name === "role") {
          team.updateMembership(id, (membership) => {
            membership.role = field.value;
            if (field.value === "player") membership.isAdmin = false;
            if (field.value !== "official") delete membership.title;
          });
        } else if (field.name === "isAdmin") team.updateMembership(id, (membership) => (membership.isAdmin = field.checked));
        else if (field.name === "group") team.updateMembership(id, (membership) => (membership.group = field.value || null));
        else if (field.name === "paused") team.updateMembership(id, (membership) => (membership.status = field.checked ? "inactive" : "active"));
        else if (field.name === "title") {
          const title = field.value.trim();
          if (!allows(title)) {
            toast("Bitte wähle eine andere Bezeichnung.");
            return;
          }
          team.updateMembership(id, (membership) => (membership.title = title || null));
        }
      });
      mountActions(root, app, {
        remove: async () => {
          const name = team.data.name(id);
          const choice = await ask({ title: `${name} aus dem Team nehmen?`, message: "Tagebuch, Runden, Videos und Nachrichten dieser Person werden aus dem Team gelöscht. Auf ihrem Gerät bleibt alles erhalten.", actions: [{ label: "Entfernen", value: "remove", style: "danger" }] });
          if (choice !== "remove") return;
          const problem = await team.removeMember(id);
          if (!problem) app.navigate("#/team/mitglieder", { replace: true });
        },
        block: async () => {
          const name = team.data.name(id);
          const choice = await ask({ title: `${name} blockieren?`, message: `Du siehst keine Nachrichten, Beiträge und Notizen von ${name} mehr. Termine und Challenges bleiben sichtbar. ${name} erfährt davon nichts.`, actions: [{ label: "Blockieren", value: "block", style: "danger" }] });
          if (choice !== "block") return;
          team.block(id);
          app.render({ keepScroll: true });
        },
        unblock: () => {
          team.unblock(id);
          app.render({ keepScroll: true });
        },
        "delete-focus": async (button) => {
          const choice = await ask({ title: "Schwerpunkt löschen?", message: "", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice === "delete") team.deleteFocus(button.dataset.id);
        },
      });
      return () => {
        clearTimeout(noteTimer);
        if (noteField) team.setNote(noteField.value, id);
      };
    },
  };
}

/** Schwungvideos, die der Spieler an die Trainer geschickt hat. */
function clipsSection(team, id) {
  const data = team.data;
  const clips = data.clips(id);
  return chapter(
    "Videos",
    html`${clips.length === 0 ? empty("Noch kein Video.") : ""}
      <ul class="rows">${clips.slice(0, 3).map((clip) => clipRow(clip, team))}</ul>
      ${clips.length > 3 ? html`<a class="action" href="#/team/mitglieder/${encodeURIComponent(id)}/videos">Alle Videos (${clips.length})<span class="mark" aria-hidden="true">›</span></a>` : ""}`,
    { footer: `Schwungvideos, die ${data.name(id)} an die Trainer geschickt hat, je bis 6 Sekunden. Feedback gibst du beim Video.` },
  );
}

/** Für Funktionäre: Anwesenheit statt Trainingsdaten. */
function attendanceSection(data, id, now) {
  const since = new Date(now.getTime() - 56 * 86400000);
  const records = data
    .values("attendance")
    .filter((record) => sameID(record.memberID, id))
    .map((record) => ({ record, event: data.event(record.eventID) }))
    .filter((item) => item.event)
    .sort((a, b) => stamp(b.event.start) - stamp(a.event.start));
  const rate = attendanceRate(id, data, since, now);
  return chapter(
    "Anwesenheit",
    html`<ul class="rows facts">${labeled("Quote, 8 Wochen", rate == null ? "–" : percent(rate))}${records.slice(0, 8).map((item) => labeled(`${dateOf(item.event.start) ? monthDay.format(dateOf(item.event.start)) : ""} ${item.event.title}`, ATTENDANCE_NAMES[item.record.status] ?? item.record.status))}</ul>`,
    { footer: "Trainingsdaten sehen nur die Trainer." },
  );
}

function trainingSections(app, id, now) {
  const team = app.team;
  const data = team.data;
  const year = now.getFullYear();
  const item = overview(data, now).find((row) => row.id === id);
  const weeks = weeklyTotals(data, [id], 8, now);
  const logs = decodedLogs(data, id);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
  const areas = areaMinutes(logs.filter((entry) => entry.start >= fourWeeksAgo));
  const areaTotal = Math.max(1, Object.values(areas).reduce((sum, value) => sum + value, 0));
  const snapshot = data.get(`snapshot.${id}`);
  const planProgress = snapshot && snapshot.plannedDrills > 0 ? Math.min(1, snapshot.doneDrills / snapshot.plannedDrills) : null;
  const sessions = data.sessionsForCoach(id, now);
  const shares = data.sharesTraining(id, year);
  const focus = data.values("focus").filter((point) => sameID(point.memberID, id)).sort((a, b) => (a.isActive !== b.isActive ? (a.isActive === false ? 1 : -1) : stamp(b.createdAt) - stamp(a.createdAt)));
  const comments = data.comments(id, { hiding: team.blocked });
  const last = comments[comments.length - 1] ?? null;
  const benchmarks = new Map();
  for (const entry of logs) for (const drill of entry.drills) if (drill.isBenchmark && drill.score != null) (benchmarks.get(drill.drillID) ?? benchmarks.set(drill.drillID, []).get(drill.drillID)).push(drill);
  const rounds = data.rounds(id);
  const strokes = averageStrokesGained(rounds.slice(0, 5));
  const distances = Object.entries(snapshot?.distances ?? {}).sort((a, b) => b[1] - a[1]);
  const nextTournament = dateOf(snapshot?.nextTournamentDate);
  return html`
    ${item
      ? chapter(
          "Training",
          html`<div class="figures">
              <div><p class="kicker">Diese Woche</p><p class="figure big">${durationText(item.minutesThisWeek)}</p><p class="small">${item.trainingDaysThisWeek} Tage</p></div>
              <ul class="side-figures">
                <li><span class="kicker">Ø pro Woche</span><span class="figure">${durationText(item.weeklyAverage)}</span><span class="small">letzte 4 Wochen</span></li>
                <li><span class="kicker">Zuletzt</span><span class="figure">${relativeDay(item.lastTraining)}</span><span class="small">${ACTIVITY_NAMES[item.state]}</span></li>
                <li><span class="kicker">Anwesenheit</span><span class="figure">${item.attendanceRate == null ? "–" : percent(item.attendanceRate)}</span>${item.streak > 1 ? html`<span class="small">${item.streak} Tage in Folge</span>` : ""}</li>
              </ul>
            </div>
            ${barChart(weeks.map((week) => ({ value: week.minutes })), { label: `Minuten pro Woche: ${weeks.map((week) => week.minutes).join(", ")}` })}
            <p class="kicker">Minuten pro Woche, letzte 8 Wochen</p>
            ${AREAS.filter((area) => areas[area] != null).map((area) => html`<div class="area-line"><span class="area-head"><span>${AREA_NAMES[area]}</span><span class="serif">${durationText(areas[area])}</span></span>${progress(areas[area], areaTotal, { label: `${AREA_NAMES[area]} ${areas[area]} Minuten` })}</div>`)}`,
        )
      : ""}
    ${snapshot && (snapshot.weekStart != null || snapshot.nextTournament)
      ? chapter(
          "Vorschläge der Woche",
          html`${planProgress != null ? html`<p class="small">${snapshot.doneDrills} von ${snapshot.plannedDrills} Übungen erledigt · ${durationText(snapshot.plannedMinutes ?? 0)} vorgeschlagen</p>${progress(planProgress, 1, { label: "Erledigt" })}` : empty("Diese Woche gibt es keine Vorschläge.")}
            <ul class="rows facts">${snapshot.nextTournament && nextTournament ? labeled("Nächstes Turnier", `${snapshot.nextTournament}, ${monthDay.format(nextTournament)}`) : ""}</ul>
            <p class="kicker">Stand ${relativeDay(dateOf(snapshot.updatedAt))}</p>`,
        )
      : ""}
    ${chapter(
      "Einheiten",
      html`<ul class="rows">${sessions.slice(0, 6).map((entry) => sessionRowForCoach(entry.session, shares ? entry.state : null, data))}</ul>
        ${sessions.length > 6 ? html`<a class="action" href="${member(id)}/einheiten">Alle Einheiten (${sessions.length})<span class="mark" aria-hidden="true">›</span></a>` : ""}
        <a class="action" href="#/team/zuweisungen/neu?fuer=${encodeURIComponent(id)}">Einheit geben<span class="mark" aria-hidden="true">+</span></a>`,
      { footer: "Ganze Trainingseinheiten aus Übungen der Bibliothek, z. B. als Aufgabe bis zum nächsten Training." },
    )}
    ${chapter(
      "Schwerpunkte",
      html`<ul class="rows">${focus.map(
        (point) => html`<li><a class="row" href="${member(id)}/schwerpunkt/${encodeURIComponent(uid(point.id))}"><span class="row-main"><span class="row-title${point.isActive === false ? " muted" : ""}">${point.text}</span><span class="row-sub">${AREA_NAMES[point.area] ?? point.area} · ${FOCUS_PRIORITY_NAMES[point.priority] ?? "Wichtig"}${point.isActive === false ? " · pausiert" : ""}</span></span><span class="row-value"><button type="button" class="text-button" data-action="delete-focus" data-id="${uid(point.id)}">Löschen</button></span></a></li>`,
      )}</ul>
        <a class="action" href="${member(id)}/schwerpunkt/neu">Schwerpunkt setzen<span class="mark" aria-hidden="true">+</span></a>`,
      { footer: "Aktive Schwerpunkte fließen direkt in die Vorschläge des Spielers ein." },
    )}
    ${chapter("Nachrichten", html`<a class="action" href="${member(id)}/nachrichten"><span>Alle Nachrichten (${comments.length})${last ? html`<br><span class="kicker">${data.name(last.authorID)}: ${String(last.text ?? "").slice(0, 80)}</span>` : ""}</span><span class="mark" aria-hidden="true">›</span></a>`)}
    ${chapter("Letzte Einheiten", html`${logs.length === 0 ? empty("Noch nichts eingetragen.") : ""}<ul class="rows">${logs.slice(0, 12).map((entry) => logRow(entry, data))}</ul>`)}
    ${benchmarks.size > 0
      ? chapter(
          "Monatstests",
          html`<ul class="rows">${[...benchmarks.keys()].sort().map((drillID) => {
            const results = benchmarks.get(drillID).sort((a, b) => a.date - b.date);
            const lastResult = results[results.length - 1];
            const scores = results.map((drill) => drill.score);
            const best = lastResult.lowerIsBetter ? Math.min(...scores) : Math.max(...scores);
            return html`<li class="row labeled"><span class="row-main">${lastResult.name}</span><span class="row-value"><span class="serif">${scoreText(lastResult) ?? "–"}</span><br><span class="kicker">Bestes: ${best} · ${results.length}×</span></span></li>`;
          })}</ul>`,
        )
      : ""}
    ${rounds.length > 0
      ? chapter(
          "Strokes Gained",
          html`<ul class="rows">${SG_CATEGORIES.map((category) => labeled(SG_NAMES[category] ?? category, strokes[category] == null ? "–" : `${strokes[category] > 0 ? "+" : ""}${strokes[category].toFixed(1).replace(".", ",")}`))}</ul>`,
          { footer: `Durchschnitt der letzten ${Math.min(5, rounds.length)} Runden. Negativ heißt: Schläge verloren.` },
        )
      : ""}
    ${distances.length > 0 ? chapter("Weiten (Carry)", html`<ul class="rows">${distances.map(([club, value]) => labeled(club, `${Math.round(value)} m`))}</ul>`) : ""}`;
}

function sessionRowForCoach(session, state, data) {
  const done = state == null ? null : [...data.doneDrillIDs(session.id)].filter((drillID) => (session.drills ?? []).some((item) => item.drillID === drillID)).length;
  return html`<li><a class="row" href="#/team/zuweisungen/${encodeURIComponent(uid(session.planID ?? session.id))}">
    <span class="row-main"><span class="row-title">${session.title}</span><span class="row-sub">${state == null ? sessionPeriod(session) : `${done} von ${(session.drills ?? []).length} Übungen · ${sessionPeriod(session)}`}</span></span>
    <span class="kicker${state === "overdue" ? " flag" : state === "done" ? " ink" : ""}">${state == null ? "Ohne Angabe" : SESSION_STATE_NAMES[state]}</span>
  </a></li>`;
}

function sessionPeriod(session) {
  const start = dateOf(session.start ?? session.createdAt);
  const due = dateOf(session.due);
  if (!due) return `ab ${start ? dayShort.format(start) : "?"}, ohne Frist`;
  return `${start ? dayShort.format(start) : "?"} bis ${dayShort.format(due)}`;
}

function managementSection(app, id) {
  const team = app.team;
  const data = team.data;
  const role = data.role(id);
  if (!team.canManage(id) || !role) return "";
  const groups = data.info?.groups ?? [];
  const membership = data.membership(id);
  return chapter(
    "Verwaltung",
    html`<form class="editor" novalidate data-management>
      <label class="field"><span>Rolle</span><select name="role" data-key="role">${team.assignableRoles.map((option) => html`<option value="${option}" ${option === role ? "selected" : ""}>${ROLE_NAMES[option]}</option>`)}</select></label>
      ${role === "official" ? html`<label class="field"><span>Bezeichnung, z. B. Jugendwart</span><input type="text" name="title" value="${data.title(id) ?? ""}" list="title-suggestions" data-key="title"><datalist id="title-suggestions">${TITLE_SUGGESTIONS.map((item) => html`<option value="${item}"></option>`)}</datalist></label>` : ""}
      ${team.isAdmin && role !== "player" ? html`<label class="toggle"><span>Admin-Rechte</span><input type="checkbox" name="isAdmin" ${data.isAdmin(id) ? "checked" : ""} data-key="isAdmin"></label>` : ""}
      ${role === "player" && groups.length > 0 ? html`<label class="field"><span>Gruppe</span><select name="group" data-key="group">${groupOptions(groups, membership?.group ?? "", "Keine")}</select></label>` : ""}
      ${role === "player" ? html`<label class="toggle"><span>Pausiert, z. B. verletzt</span><input type="checkbox" name="paused" ${membership?.status === "inactive" ? "checked" : ""} data-key="paused"></label>` : ""}
    </form>
    <button type="button" class="action danger" data-action="remove">Aus dem Team nehmen</button>`,
    { footer: rightsText(role, data.isAdmin(id)) },
  );
}

/** Alle Einheiten eines Spielers, für die Trainer. */
export function memberSessionsPage(app, memberID) {
  const team = app.team;
  const id = uid(memberID);
  return {
    title: `Einheiten von ${team.data.name(id)}`,
    tab: "mehr",
    parent: member(id),
    render() {
      const data = team.data;
      const now = new Date();
      const shares = data.sharesTraining(id, now.getFullYear());
      const items = data.sessionsForCoach(id, now);
      return html`${takeMessage(team)}
        ${shares ? "" : html`<p class="note">${data.name(id)} teilt das Training nicht. Ob eine Einheit erledigt ist, weiß die Web-App deshalb nicht.</p>`}
        <ul class="rows">${items.map((entry) => sessionRowForCoach(entry.session, shares ? entry.state : null, data))}</ul>`;
    },
  };
}

// MARK: - Schwerpunkt

export function focusEditorPage(app, memberID, focusID) {
  const team = app.team;
  const id = uid(memberID);
  const isNew = focusID === "neu";
  const key = `focus:${id}:${focusID}`;
  return {
    title: isNew ? "Schwerpunkt setzen" : "Schwerpunkt",
    tab: "mehr",
    parent: member(id),
    render() {
      const data = team.data;
      if (!team.isCoach || !data.member(id)) return notFound("Nicht gefunden.");
      const existing = isNew ? null : data.get(`focus.${uid(focusID)}`);
      if (!isNew && !existing) return notFound("Schwerpunkt nicht gefunden. Vielleicht hat ihn ein anderer Trainer gelöscht.");
      const draft = useDraft(key, () => ({
        original: existing ? JSON.parse(JSON.stringify(existing)) : null,
        text: existing?.text ?? "",
        area: existing?.area ?? "putting",
        priority: existing?.priority ?? 2,
        drillIDs: [...(existing?.drillIDs ?? [])],
        isActive: existing ? existing.isActive !== false : true,
        search: "",
      }));
      const query = draft.search.trim().toLowerCase();
      const candidates = app.store.library.filter((drill) => !drill.isWarmUp && (draft.drillIDs.includes(drill.id) || (query && (drill.name.toLowerCase().includes(query) || (drill.summary ?? "").toLowerCase().includes(query)))));
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-focus>
          ${chapter(
            "",
            html`<label class="field"><span>Schwerpunkt, z. B. „Gewicht vorne beim Chip“</span><input type="text" name="text" value="${draft.text}" maxlength="200" data-key="text"></label>
              <label class="field"><span>Bereich</span><select name="area" data-key="area">${AREAS.map((area) => html`<option value="${area}" ${area === draft.area ? "selected" : ""}>${AREA_NAMES[area]}</option>`)}</select></label>
              <label class="field"><span>Gewicht</span><select name="priority" data-key="priority">${[1, 2, 3].map((value) => html`<option value="${value}" ${value === Number(draft.priority) ? "selected" : ""}>${FOCUS_PRIORITY_NAMES[value]}</option>`)}</select></label>
              <label class="toggle"><span>Aktiv</span><input type="checkbox" name="isActive" ${draft.isActive ? "checked" : ""} data-key="isActive"></label>`,
            { footer: `Der Schwerpunkt fließt direkt in die Vorschläge für ${data.name(id)} ein. Die App schlägt dazu passende Technik-Übungen vor.` },
          )}
          ${chapter(
            "Übungen (freiwillig)",
            html`<label class="field"><span>Übung suchen</span><input type="search" name="search" value="${draft.search}" data-key="search"></label>
              ${candidates.map((drill) => html`<label class="toggle"><span>${drill.name}<br><span class="kicker">${AREA_NAMES[drill.area]} · ${drill.minutes} Min.${drill.isCorrective ? " · Korrektur" : ""}</span></span><input type="checkbox" name="drill" value="${drill.id}" ${draft.drillIDs.includes(drill.id) ? "checked" : ""} data-key="drill-${drill.id}"></label>`)}`,
            { footer: "Diese Übungen schlägt die App bevorzugt vor. Korrektur-Übungen schlägt sie nur vor, wenn sie hier ausgewählt sind." },
          )}
          ${chapter("", html`<div class="buttons"><button type="submit" class="button flag wide" ${draft.text.trim() ? "" : "disabled"} data-key="save">Sichern</button></div>`)}
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-focus]");
      const draft = drafts.get(key);
      if (!form || !draft) return;
      const read = () => {
        draft.text = form.elements.text.value;
        draft.area = form.elements.area.value;
        draft.priority = Number(form.elements.priority.value);
        draft.isActive = form.elements.isActive.checked;
        draft.search = form.elements.search.value;
        draft.drillIDs = [...form.querySelectorAll("input[name='drill']:checked")].map((box) => box.value);
      };
      form.addEventListener("input", (event) => {
        read();
        if (["search", "drill", "text"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const text = draft.text.trim();
        if (!text) return;
        if (!allows(text)) {
          toast("Bitte formuliere das freundlicher.");
          return;
        }
        const point = { id: isNew ? newID() : uid(focusID), text, area: draft.area, priority: draft.priority, drillIDs: draft.drillIDs, isActive: draft.isActive };
        const saved = team.saveFocus(id, point, draft.original);
        if (!saved) {
          toast("Der Schwerpunkt ist inzwischen gelöscht.");
          return;
        }
        dropDraft(key);
        toast("Schwerpunkt gesichert.");
        app.navigate(member(id), { replace: true });
      });
      return () => {
        if (!location.hash.includes("/schwerpunkt/")) dropDraft(key);
      };
    },
  };
}

// MARK: - Termine anlegen und Anwesenheit

/** Beginnzeiten aller Termine einer wöchentlichen Wiederholung. */
export function occurrences(start, repeatsWeekly, until) {
  if (!repeatsWeekly) return [start];
  const dates = [];
  let date = new Date(start.getTime());
  const lastDay = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59);
  const end = lastDay > start ? lastDay : start;
  while (date <= end && dates.length < 60) {
    dates.push(date);
    date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7, date.getHours(), date.getMinutes());
  }
  return dates;
}

function nextFullHour(now = new Date()) {
  const next = addDays(startOfDay(now), 1);
  next.setHours(17, 0, 0, 0);
  return next;
}

function drillPicker(draft, library, { includesWarmUp = false, scoredOnly = false } = {}) {
  const query = draft.search.trim().toLowerCase();
  const chosen = new Set(draft.drillIDs);
  const candidates = library.filter(
    (drill) => (includesWarmUp || !drill.isWarmUp) && (!scoredOnly || drill.scoring?.kind !== "none") && (chosen.has(drill.id) || (query && (drill.name.toLowerCase().includes(query) || (drill.summary ?? "").toLowerCase().includes(query)))),
  );
  return html`<label class="field"><span>Übung suchen</span><input type="search" name="search" value="${draft.search}" data-key="search"></label>
    ${candidates.map((drill) => html`<label class="toggle"><span>${drill.name}<br><span class="kicker">${drill.isWarmUp ? "Aufwärmen" : drill.isBenchmark ? "Monatstest" : (AREA_NAMES[drill.area] ?? drill.area)} · ${drill.minutes} Min.${drill.isCorrective ? " · Korrektur" : ""}</span></span><input type="checkbox" name="drill" value="${drill.id}" ${chosen.has(drill.id) ? "checked" : ""} data-key="drill-${drill.id}"></label>`)}
    ${candidates.length === 0 && query ? empty("Keine Übung gefunden.") : ""}`;
}

export function eventEditorPage(app, eventID = null) {
  const team = app.team;
  const isNew = eventID == null;
  const key = `event:${eventID ?? "neu"}`;
  return {
    title: isNew ? "Neuer Termin" : "Termin bearbeiten",
    tab: "mehr",
    parent: isNew ? "#/team/termine" : `#/team/termine/${encodeURIComponent(uid(eventID))}`,
    render() {
      const data = team.data;
      if (!team.isStaff) return notFound("Termine legen Trainer und Funktionäre an.");
      const existing = isNew ? null : data.event(eventID);
      if (!isNew && !existing) return notFound("Termin nicht gefunden.");
      const draft = useDraft(key, () => {
        const start = existing ? dateOf(existing.start) : nextFullHour();
        return {
          original: existing ? JSON.parse(JSON.stringify(existing)) : null,
          kind: existing?.kind ?? "training",
          title: existing?.title ?? "Jugendtraining",
          date: toDateInput(start),
          time: toTimeInput(start),
          minutes: existing?.minutes ?? 90,
          place: existing?.place ?? "",
          group: existing?.group ?? "",
          note: existing?.note ?? "",
          asksForResponse: existing ? existing.asksForResponse !== false : true,
          drillIDs: [...(existing?.drillIDs ?? [])],
          repeatsWeekly: false,
          until: toDateInput(new Date(new Date().getFullYear(), new Date().getMonth() + 2, new Date().getDate())),
          search: "",
        };
      });
      const groups = data.info?.groups ?? [];
      const start = fromInputs(draft.date, draft.time);
      const count = isNew && draft.repeatsWeekly && start ? occurrences(start, true, fromInputs(draft.until) ?? start).length : 1;
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-event>
          ${chapter(
            "",
            html`<label class="field"><span>Art</span><select name="kind" data-key="kind">${EVENT_KINDS.map((kind) => html`<option value="${kind}" ${kind === draft.kind ? "selected" : ""}>${EVENT_KIND_NAMES[kind]}</option>`)}</select></label>
              <label class="field"><span>Titel</span><input type="text" name="title" value="${draft.title}" maxlength="200" data-key="title"></label>
              <div class="field-row">
                <label class="field"><span>Datum</span><input type="date" name="date" value="${draft.date}" data-key="date"></label>
                <label class="field"><span>Beginn</span><input type="time" name="time" value="${draft.time}" data-key="time"></label>
              </div>
              <label class="field"><span>Dauer in Minuten</span><input type="number" name="minutes" value="${draft.minutes}" min="15" max="600" step="15" inputmode="numeric" data-key="minutes"></label>
              <label class="field"><span>Ort, z. B. Range oder Kurzspielanlage</span><input type="text" name="place" value="${draft.place}" maxlength="200" data-key="place"></label>
              ${groups.length > 0 ? html`<label class="field"><span>Für</span><select name="group" data-key="group">${groupOptions(groups, draft.group, "Ganzes Team")}</select></label>` : ""}
              <label class="field"><span>Notiz, z. B. Treffpunkt oder was mitzubringen ist</span><textarea name="note" rows="2" maxlength="2000" data-key="note">${draft.note}</textarea></label>
              <label class="toggle"><span>Zu- und Absagen abfragen</span><input type="checkbox" name="asksForResponse" ${draft.asksForResponse ? "checked" : ""} data-key="asksForResponse"></label>`,
          )}
          ${chapter("Übungen", drillPicker(draft, app.store.library), { footer: "Die Spieler sehen die Übungen beim Termin und können sie direkt öffnen." })}
          ${isNew
            ? chapter(
                "",
                html`<label class="toggle"><span>Jede Woche wiederholen</span><input type="checkbox" name="repeatsWeekly" ${draft.repeatsWeekly ? "checked" : ""} data-key="repeatsWeekly"></label>
                  ${draft.repeatsWeekly ? html`<label class="field"><span>Bis</span><input type="date" name="until" value="${draft.until}" data-key="until"></label><p class="note">Legt ${count} Termine an, jeweils am selben Wochentag zur selben Zeit.</p>` : ""}`,
              )
            : ""}
          ${chapter("", html`<div class="buttons"><button type="submit" class="button flag wide" ${draft.title.trim() && start ? "" : "disabled"} data-key="save">Sichern</button></div>`)}
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-event]");
      const draft = drafts.get(key);
      if (!form || !draft) return;
      const read = () => {
        const fields = form.elements;
        draft.kind = fields.kind.value;
        draft.title = fields.title.value;
        draft.date = fields.date.value;
        draft.time = fields.time.value;
        draft.minutes = Number(fields.minutes.value) || draft.minutes;
        draft.place = fields.place.value;
        draft.group = fields.group?.value ?? "";
        draft.note = fields.note.value;
        draft.asksForResponse = fields.asksForResponse.checked;
        draft.repeatsWeekly = fields.repeatsWeekly?.checked ?? false;
        draft.until = fields.until?.value ?? draft.until;
        draft.search = fields.search.value;
        draft.drillIDs = [...form.querySelectorAll("input[name='drill']:checked")].map((box) => box.value);
      };
      form.addEventListener("input", (event) => {
        read();
        if (["search", "drill", "repeatsWeekly", "until", "title", "date", "time"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const start = fromInputs(draft.date, draft.time);
        const title = draft.title.trim();
        if (!title || !start) return;
        if (!allows(title, draft.place, draft.note)) {
          toast("Nicht gesichert. Bitte formuliere das freundlicher.");
          return;
        }
        const minutes = Math.min(600, Math.max(15, Math.round(draft.minutes)));
        const base = { kind: draft.kind, title, minutes, place: draft.place.trim(), note: draft.note.trim(), drillIDs: draft.drillIDs, asksForResponse: draft.asksForResponse, isCancelled: draft.original?.isCancelled === true };
        if (draft.group) base.group = draft.group;
        if (isNew) {
          const me = team.myMemberID;
          const firstID = newID();
          for (const date of occurrences(start, draft.repeatsWeekly, fromInputs(draft.until) ?? start)) {
            team.saveEvent({ ...base, id: date.getTime() === start.getTime() ? firstID : newID(), start: toStored(date), createdBy: me });
          }
          dropDraft(key);
          toast(draft.repeatsWeekly ? "Termine angelegt." : "Termin angelegt.");
          app.navigate(`#/team/termine/${encodeURIComponent(firstID)}`, { replace: true });
          return;
        }
        const edited = { ...draft.original, ...base, start: toStored(start) };
        if (!draft.group) delete edited.group;
        const saved = team.saveEvent(edited, draft.original);
        if (!saved) {
          toast("Der Termin ist inzwischen gelöscht.");
          return;
        }
        dropDraft(key);
        toast("Termin gesichert.");
        app.navigate(`#/team/termine/${encodeURIComponent(uid(eventID))}`, { replace: true });
      });
      return () => {
        if (!location.hash.includes("/termine/")) dropDraft(key);
      };
    },
  };
}

/** Anwesenheit beim Termin, schnell am Platz abhaken. */
export function attendancePage(app, eventID) {
  const team = app.team;
  return {
    title: "Anwesenheit",
    tab: "mehr",
    parent: `#/team/termine/${encodeURIComponent(uid(eventID))}`,
    render() {
      const data = team.data;
      const event = data.event(eventID);
      if (!event || !team.isStaff) return notFound("Termin nicht gefunden.");
      const players = data.invitedPlayers(event);
      const summary = attendanceSummary(event, data);
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`<button type="button" class="action" data-action="present-yes">Alle mit Zusage als da eintragen</button>
            <button type="button" class="action" data-action="rest-absent">Übrige als gefehlt eintragen (Absagen entschuldigt)</button>`,
          { footer: "Wer da war, bekommt die Zeit im Trainingskalender gutgeschrieben." },
        )}
        ${chapter(
          `${summary.present} da · ${summary.excused} entschuldigt · ${summary.absent} gefehlt · ${summary.open} offen`,
          html`${players.length === 0 ? empty("Keine Spieler eingeladen.") : ""}
            ${players.map((player) => {
              const answer = data.response(player.id, event.id)?.answer;
              const status = data.attendance(player.id, event.id)?.status ?? null;
              return html`<div class="attendance-row">
                <p class="row-title">${player.name}${answer ? html` <span class="kicker${answer === "no" ? " flag" : ""}">${ANSWER_NAMES[answer]}</span>` : ""}</p>
                <div class="choice" role="group" aria-label="${player.name}">${ATTENDANCE_STATUSES.map((option) => html`<button type="button" data-action="set" data-member="${uid(player.id)}" data-status="${option}" aria-pressed="${String(status === option)}" data-key="att-${uid(player.id)}-${option}">${ATTENDANCE_NAMES[option]}</button>`)}</div>
              </div>`;
            })}`,
        )}`;
    },
    mount(root) {
      mountActions(root, app, {
        set: (button) => team.setAttendance(eventID, button.dataset.member, button.dataset.status),
        "present-yes": () => {
          const data = team.data;
          const event = data.event(eventID);
          if (!event) return;
          for (const player of data.invitedPlayers(event)) {
            if (data.response(player.id, event.id)?.answer === "yes" && !data.attendance(player.id, event.id)) team.setAttendance(eventID, player.id, "present");
          }
        },
        "rest-absent": () => {
          const data = team.data;
          const event = data.event(eventID);
          if (!event) return;
          for (const player of data.invitedPlayers(event)) {
            if (!data.attendance(player.id, event.id)) team.setAttendance(eventID, player.id, data.response(player.id, event.id)?.answer === "no" ? "excused" : "absent");
          }
        },
      });
    },
  };
}

// MARK: - Pinnwand und Challenges schreiben

export function announcementEditorPage(app, announcementID = null) {
  const team = app.team;
  const isNew = announcementID == null;
  const key = `announcement:${announcementID ?? "neu"}`;
  return {
    title: "Pinnwand",
    tab: "mehr",
    parent: "#/team/pinnwand",
    render() {
      const data = team.data;
      if (!team.isStaff) return notFound("Schreiben können Trainer und Funktionäre.");
      const existing = isNew ? null : data.get(`announcement.${uid(announcementID)}`);
      if (!isNew && !existing) return notFound("Beitrag nicht gefunden.");
      const draft = useDraft(key, () => ({ original: existing ? JSON.parse(JSON.stringify(existing)) : null, title: existing?.title ?? "", text: existing?.text ?? "", group: existing?.group ?? "", isPinned: existing?.isPinned === true }));
      const groups = data.info?.groups ?? [];
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-announcement>
          ${chapter(
            "",
            html`<label class="field"><span>Titel</span><input type="text" name="title" value="${draft.title}" maxlength="200" data-key="title"></label>
              <label class="field"><span>Text</span><textarea name="text" rows="6" maxlength="4000" data-key="text">${draft.text}</textarea></label>
              ${groups.length > 0 ? html`<label class="field"><span>Für</span><select name="group" data-key="group">${groupOptions(groups, draft.group, "Ganzes Team")}</select></label>` : ""}
              <label class="toggle"><span>Oben anheften</span><input type="checkbox" name="isPinned" ${draft.isPinned ? "checked" : ""} data-key="isPinned"></label>
              <div class="buttons"><button type="submit" class="button flag wide" ${draft.title.trim() ? "" : "disabled"} data-key="save">Veröffentlichen</button></div>`,
            { footer: "Sehen alle im Team, bei einer Gruppe nur deren Spieler und die Trainer." },
          )}
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-announcement]");
      const draft = drafts.get(key);
      if (!form || !draft) return;
      const read = () => {
        draft.title = form.elements.title.value;
        draft.text = form.elements.text.value;
        draft.group = form.elements.group?.value ?? "";
        draft.isPinned = form.elements.isPinned.checked;
      };
      form.addEventListener("input", (event) => {
        read();
        if (event.target.name === "title") app.render({ keepScroll: true });
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const title = draft.title.trim();
        if (!title) return;
        if (!allows(title, draft.text)) {
          toast("Nicht gesendet. Bitte formuliere das freundlicher.");
          return;
        }
        const now = toStored(new Date());
        const item = { ...(draft.original ?? { id: newID(), authorID: team.myMemberID, date: now }), title, text: draft.text.trim(), isPinned: draft.isPinned };
        if (draft.group) item.group = draft.group;
        else delete item.group;
        const saved = team.saveAnnouncement(item, draft.original);
        if (!saved) {
          toast("Der Beitrag ist inzwischen gelöscht.");
          return;
        }
        dropDraft(key);
        toast("Veröffentlicht.");
        app.navigate("#/team/pinnwand", { replace: true });
      });
      return () => {
        if (!location.hash.includes("/pinnwand/")) dropDraft(key);
      };
    },
  };
}

export function challengeEditorPage(app, challengeID = null) {
  const team = app.team;
  const isNew = challengeID == null;
  const key = `challenge:${challengeID ?? "neu"}`;
  return {
    title: "Challenge",
    tab: "mehr",
    parent: isNew ? "#/team/challenges" : `#/team/challenges/${encodeURIComponent(uid(challengeID))}`,
    render() {
      const data = team.data;
      if (!team.isCoach) return notFound("Challenges legen Trainer an.");
      const existing = isNew ? null : data.challenge(challengeID);
      if (!isNew && !existing) return notFound("Challenge nicht gefunden.");
      const scored = app.store.library.filter((drill) => drill.scoring?.kind !== "none" && !drill.isWarmUp);
      const draft = useDraft(key, () => {
        const today = startOfDay(new Date());
        return {
          original: existing ? JSON.parse(JSON.stringify(existing)) : null,
          title: existing?.title ?? "",
          text: existing?.text ?? "",
          drillID: existing?.drillID ?? (app.store.library.find((drill) => drill.isBenchmark)?.id ?? scored[0]?.id ?? ""),
          start: toDateInput(existing ? dateOf(existing.start) : today),
          end: toDateInput(existing ? dateOf(existing.end) : addDays(today, 28)),
          group: existing?.group ?? "",
        };
      });
      const groups = data.info?.groups ?? [];
      const valid = draft.title.trim() && app.store.drill(draft.drillID);
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-challenge>
          ${chapter(
            "",
            html`<label class="field"><span>Titel, z. B. Putt-Challenge Oktober</span><input type="text" name="title" value="${draft.title}" maxlength="200" data-key="title"></label>
              <label class="field"><span>Beschreibung und Preis</span><textarea name="text" rows="3" maxlength="2000" data-key="text">${draft.text}</textarea></label>`,
          )}
          ${chapter(
            "",
            html`<label class="field"><span>Übung</span><select name="drillID" data-key="drillID">${scored.map((drill) => html`<option value="${drill.id}" ${drill.id === draft.drillID ? "selected" : ""}>${drill.name}${drill.isBenchmark ? " (Monatstest)" : ""}</option>`)}</select></label>
              <div class="field-row">
                <label class="field"><span>Beginn</span><input type="date" name="start" value="${draft.start}" data-key="start"></label>
                <label class="field"><span>Ende</span><input type="date" name="end" value="${draft.end}" min="${draft.start}" data-key="end"></label>
              </div>
              ${groups.length > 0 ? html`<label class="field"><span>Für</span><select name="group" data-key="group">${groupOptions(groups, draft.group, "Ganzes Team")}</select></label>` : ""}
              <div class="buttons"><button type="submit" class="button flag wide" ${valid ? "" : "disabled"} data-key="save">Sichern</button></div>`,
            { footer: "Es zählt das beste Ergebnis jedes Spielers in der Übung, bei Par-Spielen das mit den wenigsten Schlägen." },
          )}
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-challenge]");
      const draft = drafts.get(key);
      if (!form || !draft) return;
      const read = () => {
        draft.title = form.elements.title.value;
        draft.text = form.elements.text.value;
        draft.drillID = form.elements.drillID.value;
        draft.start = form.elements.start.value;
        draft.end = form.elements.end.value;
        draft.group = form.elements.group?.value ?? "";
        if (draft.end && draft.start && draft.end < draft.start) draft.end = draft.start;
      };
      form.addEventListener("input", (event) => {
        read();
        if (["title", "start", "end"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const title = draft.title.trim();
        const startDate = fromInputs(draft.start);
        const endDate = fromInputs(draft.end) ?? startDate;
        if (!title || !startDate || !app.store.drill(draft.drillID)) return;
        if (!allows(title, draft.text)) {
          toast("Nicht gesichert. Bitte formuliere das freundlicher.");
          return;
        }
        // Bis zum Ende des letzten Tages, und nie vor dem Beginn.
        const end = endDate < startDate ? startDate : endDate;
        end.setHours(23, 59, 59, 0);
        const challenge = { ...(draft.original ?? { id: newID(), createdBy: team.myMemberID }), title, text: draft.text.trim(), drillID: draft.drillID, start: toStored(startDate), end: toStored(end) };
        if (draft.group) challenge.group = draft.group;
        else delete challenge.group;
        let original = draft.original;
        if (original) {
          const originalEnd = dateOf(original.end) ?? end;
          originalEnd.setHours(23, 59, 59, 0);
          original = { ...original, end: toStored(originalEnd) };
        }
        const saved = team.saveChallenge(challenge, original);
        if (!saved) {
          toast("Die Challenge ist inzwischen gelöscht.");
          return;
        }
        dropDraft(key);
        toast("Challenge gesichert.");
        app.navigate(`#/team/challenges/${encodeURIComponent(uid(challenge.id))}`, { replace: true });
      });
      return () => {
        if (!location.hash.includes("/challenges/")) dropDraft(key);
      };
    },
  };
}

// MARK: - Einheiten vergeben

function assignmentRow(assignment, data, now) {
  const content = assignment.content;
  const count = doneCount(assignment, data, now);
  return html`<li><a class="row" href="#/team/zuweisungen/${encodeURIComponent(assignment.planID)}">
    <span class="row-main"><span class="row-title">${content.title}</span><span class="row-sub">${recipientsText(assignment.memberIDs, data)} · ${sessionPeriod(content)}</span>${progress(count.done, Math.max(1, count.sharing), { label: count.text })}<span class="kicker">${count.text}</span></span>
    <span class="mark" aria-hidden="true">›</span>
  </a></li>`;
}

export function assignmentsPage(app) {
  const team = app.team;
  return {
    title: "Trainingseinheiten",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      if (!team.isCoach) return notFound("Einheiten vergeben Trainer.");
      const now = new Date();
      const weekAgo = addDays(startOfDay(now), -7);
      const assignments = data.sessionAssignments;
      const isPast = (assignment) => {
        const due = dateOf(assignment.content.due);
        return due != null && startOfDay(due) < weekAgo;
      };
      const section = (title, items) => (items.length === 0 ? "" : chapter(title, html`<ul class="rows">${items.map((assignment) => assignmentRow(assignment, data, now))}</ul>`));
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`<a class="action" href="#/team/zuweisungen/neu">Neue Einheit<span class="mark" aria-hidden="true">+</span></a>
            <details class="templates"><summary class="action">Aus Vorlage<span class="mark" aria-hidden="true">▾</span></summary><ul class="rows">${SESSION_TEMPLATES.map((template) => html`<li><a class="row" href="#/team/zuweisungen/neu?vorlage=${encodeURIComponent(template.id)}"><span class="row-main"><span class="row-title">${template.title}</span><span class="row-sub">${template.drills.length} Übungen · ${durationText(templateMinutes(template))}</span></span><span class="mark" aria-hidden="true">›</span></a></li>`)}</ul></details>`,
        )}
        ${assignments.length === 0 ? empty("Stell aus Übungen eine Einheit zusammen und gib sie dem Team, einer Gruppe oder einzelnen Spielern, z. B. als Aufgabe bis zum nächsten Training. Fertige Vorlagen findest du unter „Aus Vorlage“.") : ""}
        ${section("Laufend", assignments.filter((assignment) => !isPast(assignment)))}
        ${section("Vergangen", assignments.filter(isPast))}
        ${chapter("", refreshAction(team), { footer: syncText(team) })}`;
    },
    mount(root) {
      mountActions(root, app, { refresh: () => team.refresh() });
    },
  };
}

function sessionSummary(session, data) {
  return html`${headline(session.title, `Einheit von ${data.name(session.authorID)}`)}
    ${session.text ? html`<p class="serif">${session.text}</p>` : ""}
    <ul class="rows facts">${labeled("Dauer", durationText(sessionTotalMinutes(session)))}${labeled("Zeitraum", sessionPeriod(session))}</ul>`;
}

export function assignmentPage(app, planID) {
  const team = app.team;
  return {
    title: team.data.sessionAssignment(planID)?.content.title ?? "Einheit",
    tab: "mehr",
    parent: "#/team/zuweisungen",
    render() {
      const data = team.data;
      const assignment = data.sessionAssignment(planID);
      if (!assignment || !team.isCoach) return notFound("Einheit nicht gefunden. Vielleicht hat sie ein anderer Trainer gelöscht.");
      const now = new Date();
      const year = now.getFullYear();
      const count = doneCount(assignment, data, now);
      return html`${takeMessage(team)}
        ${sessionSummary(assignment.content, data)}
        ${chapter(
          `Spieler · ${count.text}`,
          html`<ul class="rows">${assignment.sessions.map((session) => {
            const shares = data.sharesTraining(session.memberID, year);
            const state = sessionState(session, data.doneDrillIDs(session.id), now);
            const progressRecord = data.progress(session.id);
            const done = [...data.doneDrillIDs(session.id)].filter((drillID) => (session.drills ?? []).some((item) => item.drillID === drillID)).length;
            const lastActivity = Array.isArray(progressRecord?.done) && progressRecord.done.length > 0 ? dateOf(Math.max(...progressRecord.done.map((drill) => stamp(drill.date)))) : null;
            return html`<li><a class="row" href="#/team/zuweisungen/${encodeURIComponent(assignment.planID)}/spieler/${encodeURIComponent(uid(session.id))}">
              <span class="row-main"><span class="row-title">${data.name(session.memberID)}</span><span class="row-sub">${shares ? `${done} von ${(session.drills ?? []).length} Übungen${lastActivity ? ` · zuletzt ${relativeDay(lastActivity)}` : ""}` : "Teilt das Training nicht"}</span></span>
              <span class="kicker${shares && state === "overdue" ? " flag" : shares && state === "done" ? " ink" : ""}">${shares ? SESSION_STATE_NAMES[state] : "Ohne Angabe"}</span>
            </a></li>`;
          })}</ul>`,
          { footer: "Was erledigt ist, sehen die Trainer nur von Spielern, die ihr Training teilen. Punkte nur, wenn sie auch die Punkte teilen." },
        )}
        ${chapter(
          "",
          html`<a class="action" href="#/team/zuweisungen/${encodeURIComponent(assignment.planID)}/bearbeiten">Bearbeiten<span class="mark" aria-hidden="true">›</span></a>
            <a class="action" href="#/team/zuweisungen/neu?kopie=${encodeURIComponent(assignment.planID)}">Noch einmal vergeben<span class="mark" aria-hidden="true">›</span></a>
            <button type="button" class="action danger" data-action="delete">Löschen</button>`,
        )}`;
    },
    mount(root) {
      mountActions(root, app, {
        delete: async () => {
          const assignment = team.data.sessionAssignment(planID);
          if (!assignment) return;
          const choice = await ask({ title: "Einheit löschen?", message: `Die Einheit verschwindet bei allen ${assignment.sessions.length} Spielern. Ihre Ergebnisse bleiben in ihrem Tagebuch.`, actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice !== "delete") return;
          team.deleteAssignment(planID);
          app.navigate("#/team/zuweisungen", { replace: true });
        },
      });
    },
  };
}

/** Was ein Spieler von seiner Einheit erledigt hat, für die Trainer. */
export function sessionProgressPage(app, planID, sessionID) {
  const team = app.team;
  return {
    title: team.data.session(sessionID)?.title ?? "Einheit",
    tab: "mehr",
    parent: `#/team/zuweisungen/${encodeURIComponent(uid(planID))}`,
    render() {
      const data = team.data;
      const session = data.session(sessionID);
      if (!session || !team.isCoach) return notFound("Einheit nicht gefunden.");
      const progressRecord = data.progress(session.id);
      const results = new Map((Array.isArray(progressRecord?.done) ? progressRecord.done : []).map((drill) => [drill.drillID, drill]));
      return html`${takeMessage(team)}
        ${chapter(
          data.name(session.memberID),
          html`<ul class="rows">${(session.drills ?? []).map((item) => {
            const result = results.get(item.drillID) ?? null;
            const date = result ? dateOf(result.date) : null;
            return html`<li class="row">${check(result != null)}<span class="row-main"><span class="row-title">${app.store.drill(item.drillID)?.name ?? item.drillID}</span><span class="row-sub">${result && date ? `${formatShortDate(date)}, ${formatTime(date)}${scoreText(result) ? ` · ${scoreText(result)}` : ""}` : "offen"}</span></span></li>`;
          })}</ul>`,
          { footer: "Ergebnisse kommen vom Gerät, mit dem der Spieler sein Training teilt." },
        )}
        ${chapter("", html`<a class="action" href="${member(session.memberID)}">Zum Spieler<span class="mark" aria-hidden="true">›</span></a>`)}`;
    },
  };
}

/** Einheit zusammenstellen und vergeben. `options`: { template, copyOf, memberID } bei einer neuen Einheit. */
export function sessionEditorPage(app, planID = null, options = {}) {
  const team = app.team;
  const isNew = planID == null;
  const key = `session:${planID ?? "neu"}:${options.template ?? ""}:${options.copyOf ?? ""}:${options.memberID ?? ""}`;
  return {
    title: isNew ? "Neue Einheit" : "Einheit bearbeiten",
    tab: "mehr",
    parent: isNew ? "#/team/zuweisungen" : `#/team/zuweisungen/${encodeURIComponent(uid(planID))}`,
    render() {
      const data = team.data;
      if (!team.isCoach) return notFound("Einheiten vergeben Trainer.");
      const assignment = isNew ? null : data.sessionAssignment(planID);
      if (!isNew && !assignment) return notFound("Einheit nicht gefunden. Vielleicht hat sie ein anderer Trainer gelöscht.");
      const draft = useDraft(key, () => {
        const now = new Date();
        const start = sessionDay(now);
        if (assignment) {
          const content = assignment.content;
          return {
            original: JSON.parse(JSON.stringify(content)),
            originalMemberIDs: [...assignment.memberIDs],
            planID: assignment.planID,
            title: content.title ?? "",
            text: content.text ?? "",
            drills: (content.drills ?? []).map((item) => ({ drillID: item.drillID, minutes: item.minutes ?? 15, level: item.level ?? null, note: item.note ?? "" })),
            memberIDs: [...assignment.memberIDs],
            start: toDateInput(dateOf(content.start) ?? start),
            hasDue: content.due != null,
            due: toDateInput(dateOf(content.due) ?? addDays(start, 6)),
            search: "",
            choosingDrills: false,
          };
        }
        const template = options.template ? SESSION_TEMPLATES.find((item) => item.id === options.template) : null;
        const copy = options.copyOf ? data.sessionAssignment(options.copyOf) : null;
        let due = addDays(start, 6);
        if (copy?.content.due) {
          const days = Math.max(0, Math.round((startOfDay(dateOf(copy.content.due)).getTime() - startOfDay(dateOf(copy.content.start) ?? dateOf(copy.content.createdAt)).getTime()) / 86400000));
          due = addDays(start, days);
        }
        const source = copy?.content ?? template;
        return {
          original: null,
          originalMemberIDs: [],
          planID: newID(),
          title: source?.title ?? "",
          text: source?.text ?? "",
          drills: (source?.drills ?? []).map((item) => ({ drillID: item.drillID, minutes: item.minutes ?? 15, level: item.level ?? null, note: item.note ?? "" })),
          memberIDs: copy ? [...copy.memberIDs] : options.memberID ? [uid(options.memberID)] : [],
          start: toDateInput(start),
          hasDue: copy ? copy.content.due != null : true,
          due: toDateInput(due),
          search: "",
          choosingDrills: false,
        };
      });
      const total = draft.drills.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
      const players = data.players;
      const active = data.activePlayers;
      const groups = data.info?.groups ?? [];
      const chosen = new Set(draft.memberIDs);
      const canSave = draft.title.trim() && draft.drills.length > 0 && draft.memberIDs.length > 0 && fromInputs(draft.start);
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-session>
          ${chapter(
            "",
            html`<label class="field"><span>Titel, z. B. Kurzspiel bis Freitag</span><input type="text" name="title" value="${draft.title}" maxlength="200" data-key="title"></label>
              <label class="field"><span>Ziel und Hinweise für die Spieler</span><textarea name="text" rows="3" maxlength="2000" data-key="text">${draft.text}</textarea></label>`,
          )}
          ${chapter(
            `Übungen · ${durationText(total)}`,
            html`${draft.drills.map((item, index) => {
              const drill = app.store.drill(item.drillID);
              return html`<div class="session-drill">
                <p class="row-title">${drill?.name ?? "Unbekannte Übung"} <span class="kicker">${drill ? (drill.isWarmUp ? "Aufwärmen" : AREA_NAMES[drill.area]) : ""}</span></p>
                <div class="field-row">
                  <label class="field"><span>Minuten</span><input type="number" name="minutes-${index}" value="${item.minutes}" min="5" max="90" step="5" inputmode="numeric" data-key="minutes-${index}"></label>
                  ${drill && drill.levels.length > 1 ? html`<label class="field"><span>Stufe</span><select name="level-${index}" data-key="level-${index}"><option value="" ${item.level == null ? "selected" : ""}>Automatisch</option>${drill.levels.map((level, levelIndex) => html`<option value="${levelIndex}" ${item.level === levelIndex ? "selected" : ""}>Stufe ${levelIndex + 1}: ${level}</option>`)}</select></label>` : ""}
                </div>
                <label class="field"><span>Hinweis, z. B. Gewicht vorne lassen</span><input type="text" name="note-${index}" value="${item.note}" maxlength="200" data-key="note-${index}"></label>
                <p class="small"><button type="button" class="text-button" data-action="up" data-index="${index}" ${index === 0 ? "disabled" : ""}>Nach oben</button> · <button type="button" class="text-button" data-action="remove" data-index="${index}">Entfernen</button></p>
              </div>`;
            })}
              <button type="button" class="action" data-action="choose-drills">${draft.choosingDrills ? "Auswahl fertig" : draft.drills.length === 0 ? "Übungen wählen" : "Übungen hinzufügen"}<span class="mark" aria-hidden="true">${draft.choosingDrills ? "✓" : "+"}</span></button>
              ${draft.choosingDrills ? drillPicker({ search: draft.search, drillIDs: draft.drills.map((item) => item.drillID) }, app.store.library, { includesWarmUp: true }) : ""}`,
            { footer: "Ohne feste Stufe wählt die App sie nach den Ergebnissen jedes Spielers. Der Hinweis erscheint bei der Übung als Trainer-Fokus." },
          )}
          ${chapter(
            `Für wen · ${draft.memberIDs.length} gewählt`,
            html`<p class="small"><button type="button" class="text-button" data-action="all">Alle aktiven Spieler (${active.length})</button>${groups.map((group) => {
              const ids = active.filter((player) => data.group(player.id) === group);
              return ids.length > 0 ? html` · <button type="button" class="text-button" data-action="group" data-group="${group}">Gruppe ${group} (${ids.length})</button>` : "";
            })}${draft.memberIDs.length > 0 ? html` · <button type="button" class="text-button" data-action="none">Auswahl leeren</button>` : ""}</p>
              ${players.length === 0 ? empty("Noch keine Spieler im Team.") : ""}
              ${players.map((player) => html`<label class="toggle"><span>${player.name}${[data.group(player.id), data.status(player.id) === "inactive" ? "pausiert" : null].filter(Boolean).length > 0 ? html`<br><span class="kicker">${[data.group(player.id), data.status(player.id) === "inactive" ? "pausiert" : null].filter(Boolean).join(" · ")}</span>` : ""}</span><input type="checkbox" name="member" value="${uid(player.id)}" ${chosen.has(uid(player.id)) ? "checked" : ""} data-key="member-${uid(player.id)}"></label>`)}`,
            { footer: "Jeder Spieler bekommt die Einheit für sich. Wer sie sonst noch hat, sehen die Spieler nicht." },
          )}
          ${chapter(
            "Wann",
            html`<label class="field"><span>Ab</span><input type="date" name="start" value="${draft.start}" data-key="start"></label>
              <label class="toggle"><span>Mit Frist</span><input type="checkbox" name="hasDue" ${draft.hasDue ? "checked" : ""} data-key="hasDue"></label>
              ${draft.hasDue ? html`<label class="field"><span>Bis</span><input type="date" name="due" value="${draft.due}" min="${draft.start}" data-key="due"></label>` : ""}`,
          )}
          ${chapter("", html`<div class="buttons"><button type="submit" class="button flag wide" ${canSave ? "" : "disabled"} data-key="save">${isNew ? "Vergeben" : "Sichern"}</button></div>`)}
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-session]");
      const draft = drafts.get(key);
      if (!form || !draft) return;
      const read = () => {
        const fields = form.elements;
        draft.title = fields.title.value;
        draft.text = fields.text.value;
        draft.drills = draft.drills.map((item, index) => ({
          ...item,
          minutes: Math.min(90, Math.max(5, Number(fields[`minutes-${index}`]?.value) || item.minutes)),
          level: fields[`level-${index}`] ? (fields[`level-${index}`].value === "" ? null : Number(fields[`level-${index}`].value)) : item.level,
          note: fields[`note-${index}`]?.value ?? item.note,
        }));
        draft.memberIDs = [...form.querySelectorAll("input[name='member']:checked")].map((box) => box.value);
        draft.start = fields.start.value;
        draft.hasDue = fields.hasDue.checked;
        draft.due = fields.due?.value ?? draft.due;
        if (draft.hasDue && draft.due && draft.start && draft.due < draft.start) draft.due = draft.start;
        if (fields.search) draft.search = fields.search.value;
        if (draft.choosingDrills) {
          const ids = [...form.querySelectorAll("input[name='drill']:checked")].map((box) => box.value);
          const existing = new Map(draft.drills.map((item) => [item.drillID, item]));
          const seen = new Set();
          draft.drills = ids
            .filter((id) => !seen.has(id) && seen.add(id))
            .map((id) => existing.get(id) ?? { drillID: id, minutes: app.store.drill(id)?.minutes ?? 15, level: null, note: "" });
        }
      };
      form.addEventListener("input", (event) => {
        read();
        if (["search", "drill", "member", "hasDue", "title", "start", "due"].includes(event.target.name) || event.target.name.startsWith("minutes-")) app.render({ keepScroll: true });
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const title = draft.title.trim();
        const start = fromInputs(draft.start);
        if (!title || draft.drills.length === 0 || draft.memberIDs.length === 0 || !start) return;
        if (!allows(title, draft.text, ...draft.drills.map((item) => item.note))) {
          toast("Nicht gesichert. Bitte formuliere das freundlicher.");
          return;
        }
        const dueDate = draft.hasDue ? (fromInputs(draft.due) ?? start) : null;
        const now = toStored(new Date());
        const content = {
          ...(draft.original ?? { id: draft.planID, planID: draft.planID, memberID: team.myMemberID, authorID: team.myMemberID, createdAt: now, updatedAt: now }),
          title,
          text: draft.text.trim(),
          drills: draft.drills.map((item) => {
            const drill = { drillID: item.drillID, minutes: item.minutes, note: item.note.trim() };
            if (item.level != null) drill.level = item.level;
            return drill;
          }),
          start: toStored(sessionDay(start)),
        };
        if (dueDate) content.due = toStored(sessionDay(dueDate < start ? start : dueDate));
        else delete content.due;
        const saved = team.saveAssignment(content, draft.original, draft.memberIDs, draft.originalMemberIDs);
        if (!saved) {
          toast("Ein anderer Trainer hat die Einheit gelöscht. Vergib sie bei Bedarf neu.");
          return;
        }
        dropDraft(key);
        toast(isNew ? "Einheit vergeben." : "Einheit gesichert.");
        app.navigate(`#/team/zuweisungen/${encodeURIComponent(uid(content.planID ?? draft.planID))}`, { replace: true });
      });
      mountActions(root, app, {
        "choose-drills": () => {
          read();
          draft.choosingDrills = !draft.choosingDrills;
          app.render({ keepScroll: true });
        },
        remove: (button) => {
          read();
          draft.drills.splice(Number(button.dataset.index), 1);
          app.render({ keepScroll: true });
        },
        up: (button) => {
          read();
          const index = Number(button.dataset.index);
          if (index > 0) [draft.drills[index - 1], draft.drills[index]] = [draft.drills[index], draft.drills[index - 1]];
          app.render({ keepScroll: true });
        },
        all: () => {
          read();
          draft.memberIDs = [...new Set([...draft.memberIDs, ...team.data.activePlayers.map((player) => uid(player.id))])];
          app.render({ keepScroll: true });
        },
        group: (button) => {
          read();
          const ids = team.data.activePlayers.filter((player) => team.data.group(player.id) === button.dataset.group).map((player) => uid(player.id));
          draft.memberIDs = [...new Set([...draft.memberIDs, ...ids])];
          app.render({ keepScroll: true });
        },
        none: () => {
          read();
          draft.memberIDs = [];
          app.render({ keepScroll: true });
        },
      });
      return () => {
        if (!location.hash.includes("/zuweisungen/")) dropDraft(key);
      };
    },
  };
}

// MARK: - Einladungen

export function invitesPage(app) {
  const team = app.team;
  return {
    title: "Einladungen",
    tab: "mehr",
    parent: "#/team/einstellungen",
    render() {
      const data = team.data;
      if (!team.canInvite) return notFound("Einladen können Admins und Trainer.");
      const now = new Date();
      const invites = data.sortedInvites;
      const open = invites.filter((invite) => inviteIsOpen(invite, now) && data.isBackedByCreator(invite));
      const used = invites.filter((invite) => invite.usedBy != null);
      const expired = invites.filter((invite) => invite.usedBy == null && !open.includes(invite));
      const row = (invite, detail) => {
        const code = team.inviteCode(invite.id);
        const shareable = code && inviteIsOpen(invite, now) && data.isBackedByCreator(invite);
        const inner = html`<span class="row-main"><span class="row-title">${invite.name}</span><span class="row-sub">${inviteRoleText(invite)}${invite.grantsAdmin ? " · Admin" : ""} · ${detail}</span></span>`;
        const revoke = team.isAdmin || sameID(invite.createdBy, team.myMemberID) ? html`<span class="row-value"><button type="button" class="text-button" data-action="revoke" data-id="${uid(invite.id)}">${invite.usedBy == null ? "Zurückziehen" : "Löschen"}</button></span>` : "";
        return shareable ? html`<li><a class="row" href="#/team/einladungen/${encodeURIComponent(uid(invite.id))}">${inner}<span class="mark" aria-hidden="true">›</span></a>${revoke}</li>` : html`<li class="row">${inner}${revoke}</li>`;
      };
      const expiresText = (invite) => `gilt bis ${dateOf(invite.expiresAt) ? numericDate.format(dateOf(invite.expiresAt)) : "?"}`;
      return html`${takeMessage(team)}
        ${chapter("", html`<a class="action" href="#/team/einladungen/neu">Neue Einladung<span class="mark" aria-hidden="true">+</span></a>`, {
          footer: "Pro Person eine Einladung: Link und persönlicher Code. Wer den Code beim Beitritt eingibt, hat die Rolle sofort, ohne Freigabe. Ein Code gilt einmal und 30 Tage, und nur, solange du so einladen darfst. Noch einmal teilen geht nur in dem Browser, der die Einladung erstellt hat.",
        })}
        ${open.length > 0 ? chapter("Offen", html`<ul class="rows">${open.map((invite) => row(invite, expiresText(invite)))}</ul>`) : ""}
        ${used.length > 0 ? chapter("Angenommen", html`<ul class="rows">${used.map((invite) => row(invite, `${data.name(invite.usedBy)}, ${dateOf(invite.usedAt) ? numericDate.format(dateOf(invite.usedAt)) : ""}`))}</ul>`) : ""}
        ${expired.length > 0 ? chapter("Abgelaufen", html`<ul class="rows">${expired.map((invite) => row(invite, inviteIsOpen(invite, now) ? `ungültig, ${data.name(invite.createdBy)} darf so nicht mehr einladen` : "abgelaufen"))}</ul>`) : ""}`;
    },
    mount(root) {
      mountActions(root, app, {
        revoke: async (button) => {
          const choice = await ask({ title: "Einladung zurückziehen?", message: "Der Code gilt dann nicht mehr.", actions: [{ label: "Zurückziehen", value: "revoke", style: "danger" }] });
          if (choice === "revoke") team.revokeInvite(button.dataset.id);
        },
      });
    },
  };
}

export function inviteEditorPage(app) {
  const team = app.team;
  const key = "invite:neu";
  return {
    title: "Einladen",
    tab: "mehr",
    parent: "#/team/einladungen",
    render() {
      const data = team.data;
      if (!team.canInvite) return notFound("Einladen können Admins und Trainer.");
      const roles = team.assignableRoles;
      const draft = useDraft(key, () => ({ name: "", role: roles.includes("coach") ? "coach" : roles[0], title: "", group: "", grantsAdmin: false, working: false }));
      if (!roles.includes(draft.role)) draft.role = roles[0];
      const groups = data.info?.groups ?? [];
      const valid = draft.name.trim() && allows(draft.name, draft.title) && !draft.working;
      return html`${takeMessage(team)}
        <form class="editor" novalidate data-invite>
          ${chapter(
            "",
            html`<label class="field"><span>Name, z. B. Anna Schmidt</span><input type="text" name="name" value="${draft.name}" autocomplete="off" maxlength="200" data-key="name"></label>
              <label class="field"><span>Rolle</span><select name="role" data-key="role">${roles.map((role) => html`<option value="${role}" ${role === draft.role ? "selected" : ""}>${ROLE_NAMES[role]}</option>`)}</select></label>
              ${draft.role === "official" ? html`<label class="field"><span>Bezeichnung, z. B. Jugendwart</span><input type="text" name="title" value="${draft.title}" list="title-suggestions" data-key="title"><datalist id="title-suggestions">${TITLE_SUGGESTIONS.map((item) => html`<option value="${item}"></option>`)}</datalist></label>` : ""}
              ${draft.role === "player" && groups.length > 0 ? html`<label class="field"><span>Gruppe</span><select name="group" data-key="group">${groupOptions(groups, draft.group, "Keine")}</select></label>` : ""}
              ${team.isAdmin && draft.role !== "player" ? html`<label class="toggle"><span>Admin-Rechte</span><input type="checkbox" name="grantsAdmin" ${draft.grantsAdmin ? "checked" : ""} data-key="grantsAdmin"></label>` : ""}
              <div class="buttons"><button type="submit" class="button flag wide" ${valid ? "" : "disabled"} data-key="create">${draft.working ? "Bitte warten …" : "Erstellen"}</button></div>`,
            { footer: rightsText(draft.role, draft.grantsAdmin && team.isAdmin && draft.role !== "player") },
          )}
        </form>`;
    },
    mount(root) {
      const form = root.querySelector("form[data-invite]");
      const draft = drafts.get(key);
      if (!form || !draft) return;
      const read = () => {
        draft.name = form.elements.name.value;
        draft.role = form.elements.role.value;
        draft.title = form.elements.title?.value ?? draft.title;
        draft.group = form.elements.group?.value ?? draft.group;
        draft.grantsAdmin = form.elements.grantsAdmin?.checked ?? false;
      };
      form.addEventListener("input", (event) => {
        read();
        if (["role", "grantsAdmin", "name"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        read();
        if (draft.working || !draft.name.trim()) return;
        draft.working = true;
        app.render({ keepScroll: true });
        const title = draft.title.trim();
        const created = await team.createInvite({ role: draft.role, name: draft.name.trim(), title: draft.role === "official" && title ? title : null, group: draft.role === "player" ? draft.group || null : null, grantsAdmin: draft.grantsAdmin && draft.role !== "player" });
        draft.working = false;
        if (!created) {
          app.render({ keepScroll: true });
          return;
        }
        dropDraft(key);
        app.navigate(`#/team/einladungen/${encodeURIComponent(uid(created.invite.id))}`, { replace: true });
      });
    },
  };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

async function shareText(text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return true;
    }
  }
  return copyText(text);
}

/** Code groß zum Abtippen, dazu die fertige Nachricht zum Senden. */
export function inviteSharePage(app, inviteID) {
  const team = app.team;
  return {
    title: "Einladung",
    tab: "mehr",
    parent: "#/team/einladungen",
    render() {
      const invite = team.data.get(`invite.${uid(inviteID)}`);
      if (!invite) return notFound("Einladung nicht gefunden.");
      const code = team.inviteCode(inviteID);
      if (!code) return html`${chapter("", html`<p class="empty">Den Code kennt nur der Browser, der die Einladung erstellt hat.</p>`)}`;
      const message = team.invitationMessage(invite, code);
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`<p class="kicker">Code für ${invite.name} als ${inviteRoleText(invite)}</p>
            <p class="code-display">${displayCode(code)}</p>`,
        )}
        ${chapter(
          "",
          message
            ? html`<div class="buttons"><button type="button" class="button flag wide" data-action="share">Einladung senden</button></div>
                <button type="button" class="action" data-action="copy">Text kopieren<span class="mark" aria-hidden="true">→</span></button>`
            : html`<p class="note">Der Link für Spieler fehlt noch. Gleiche das Team noch einmal ab, um ihn zu laden.</p>`,
          { footer: `Am besten direkt an ${invite.name}, z. B. per WhatsApp oder Mail. Der Code gilt nur einmal.` },
        )}
        ${message ? chapter("Nachricht", html`<pre class="message">${message}</pre>`) : ""}`;
    },
    mount(root) {
      mountActions(root, app, {
        share: async () => {
          const invite = team.data.get(`invite.${uid(inviteID)}`);
          const code = team.inviteCode(inviteID);
          const message = invite && code ? team.invitationMessage(invite, code) : null;
          if (message && (await shareText(message, `Einladung: ${team.teamName}`))) toast("Einladung weitergegeben.");
        },
        copy: async () => {
          const invite = team.data.get(`invite.${uid(inviteID)}`);
          const code = team.inviteCode(inviteID);
          const message = invite && code ? team.invitationMessage(invite, code) : null;
          if (message && (await copyText(message))) toast("Kopiert.");
        },
      });
    },
  };
}

// MARK: - Einstellungen

export function settingsPage(app) {
  const team = app.team;
  const key = "settings";
  return {
    title: "Einladen und Einstellungen",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      const info = data.info;
      if (!team.isStaff) return notFound("Nur für Trainer und Funktionäre.");
      const draft = useDraft(key, () => ({ name: info?.name ?? "", club: info?.club ?? "", appLink: info?.appLink ?? "", newGroup: "", loaded: { name: info?.name ?? "", club: info?.club ?? "", appLink: info?.appLink ?? "" } }));
      const now = new Date();
      const openInvites = data.values("invite").filter((invite) => inviteIsOpen(invite, now) && data.isBackedByCreator(invite)).length;
      const candidates = data.roster.filter((profile) => !sameID(profile.id, team.myMemberID) && data.isStaff(profile.id));
      return html`${takeMessage(team)}
        ${chapter(
          "Einladen",
          html`${team.canInvite ? html`<a class="action" href="#/team/einladungen">Mit Rolle einladen${openInvites > 0 ? html` <span class="kicker">${openInvites} offen</span>` : ""}<span class="mark" aria-hidden="true">›</span></a>` : ""}
            ${team.canApproveRequests
              ? team.playerInvitationMessage
                ? html`<button type="button" class="action" data-action="share-link">Link für Spieler teilen<span class="mark" aria-hidden="true">↗</span></button>
                    <button type="button" class="action" data-action="copy-link">Link für Spieler kopieren<span class="mark" aria-hidden="true">→</span></button>
                    <button type="button" class="action" data-action="new-link">Neuen Link für Spieler erzeugen</button>`
                : html`<p class="note">Der Link für Spieler wird geladen …</p>`
              : ""}
            ${team.canInvite ? "" : html`<p class="note">Einladen können Admins und Trainer.</p>`}`,
          { footer: "Cheftrainer, Trainer und Funktionäre lädst du mit Rolle ein: Link plus persönlicher Code. Spieler kommen über den Link für Spieler und werden freigegeben. Den Link nur in der Gruppe der Jugend teilen. Ist er in falsche Hände geraten, erzeuge einen neuen: Der alte gilt dann nicht mehr, wer schon dabei ist, bleibt." },
        )}
        ${team.canEditSettings
          ? html`<form class="editor" novalidate data-settings>
              ${chapter(
                "Jugendabteilung",
                html`<label class="field"><span>Name</span><input type="text" name="name" value="${draft.name}" maxlength="200" data-key="name"></label>
                  <label class="field"><span>Club</span><input type="text" name="club" value="${draft.club}" maxlength="200" data-key="club"></label>
                  <label class="field"><span>Link zur App, z. B. https://testflight.apple.com/join/…</span><input type="url" name="appLink" value="${draft.appLink}" autocapitalize="none" data-key="appLink"></label>
                  <div class="buttons"><button type="submit" class="button wide" ${draft.name.trim() && allows(draft.name, draft.club) ? "" : "disabled"} data-key="save-info">Sichern</button></div>`,
                { footer: "Der Link zur App steht in jeder Einladung, damit neue Mitglieder die App finden. Den öffentlichen Link gibt es in App Store Connect unter TestFlight bei der externen Testgruppe." },
              )}
              ${chapter(
                "Trainingsgruppen",
                html`<ul class="rows">${(info?.groups ?? []).map((group) => html`<li class="row"><span class="row-main">${group}</span><span class="row-value"><button type="button" class="text-button" data-action="remove-group" data-group="${group}">Löschen</button></span></li>`)}</ul>
                  <div class="field-row"><label class="field"><span>Neue Gruppe, z. B. Kader</span><input type="text" name="newGroup" value="${draft.newGroup}" maxlength="60" data-key="newGroup"></label><button type="button" class="button outline" data-action="add-group" ${draft.newGroup.trim() && allows(draft.newGroup) ? "" : "disabled"}>Hinzufügen</button></div>`,
                { footer: "Termine, Nachrichten und Challenges lassen sich auf eine Gruppe beschränken. Löschst du eine Gruppe, sind ihre Spieler danach ohne Gruppe." },
              )}
              ${chapter(
                "Regeln",
                html`<label class="toggle"><span>Spieler sehen die Ranglisten</span><input type="checkbox" name="showsLeaderboards" ${info?.showsLeaderboards !== false ? "checked" : ""} data-key="showsLeaderboards"></label>
                  <label class="field"><span>Hinweis nach so vielen Tagen ohne Training (3 bis 60)</span><input type="number" name="inactivityDays" value="${info?.inactivityDays ?? 14}" min="3" max="60" inputmode="numeric" data-key="inactivityDays"></label>`,
              )}
            </form>`
          : ""}
        ${team.isOwner
          ? chapter(
              "Übergeben",
              candidates.length === 0
                ? html`<p class="note">Zum Übergeben braucht es einen Trainer oder Funktionär im Team.</p>`
                : html`<label class="field"><span>An</span><select name="candidate" data-key="candidate"><option value="">Bitte wählen</option>${candidates.map((profile) => html`<option value="${uid(profile.id)}">${profile.name} · ${data.roleText(profile.id) ?? ""}</option>`)}</select></label>
                    <button type="button" class="action danger" data-action="handover">Abteilung übergeben</button>`,
              { footer: "Die Person wird Admin und kann die Abteilung löschen. Du behältst deine Rolle, bist aber nur noch Admin, wenn sie es dir lässt." },
            )
          : ""}
        ${chapter("", html`<p class="note">Die Daten des Teams liegen auf dem Server des Kontos in Frankfurt. Eröffnet hat die Abteilung ${info ? data.name(info.ownerMemberID) : "der Admin"}. Verantwortlich für die Daten ist euer Verein.</p>`)}`;
    },
    mount(root) {
      const form = root.querySelector("form[data-settings]");
      const draft = drafts.get(key);
      const read = () => {
        if (!form || !draft) return;
        draft.name = form.elements.name.value;
        draft.club = form.elements.club.value;
        draft.appLink = form.elements.appLink.value;
        draft.newGroup = form.elements.newGroup.value;
      };
      form?.addEventListener("input", (event) => {
        read();
        if (["newGroup", "name"].includes(event.target.name)) app.render({ keepScroll: true });
      });
      form?.addEventListener("change", (event) => {
        const field = event.target;
        if (field.name === "showsLeaderboards") team.updateInfo((info) => (info.showsLeaderboards = field.checked));
        if (field.name === "inactivityDays") {
          const value = Math.min(60, Math.max(3, Math.round(Number(field.value) || 14)));
          team.updateInfo((info) => (info.inactivityDays = value));
        }
      });
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        read();
        const name = draft.name.trim();
        const club = draft.club.trim();
        const appLink = draft.appLink.trim();
        if (!name || !allows(name, club)) return;
        team.updateInfo((info) => {
          if (name !== draft.loaded.name) info.name = name;
          if (club !== draft.loaded.club) info.club = club;
          if (appLink !== draft.loaded.appLink) info.appLink = appLink || null;
        });
        draft.loaded = { name, club, appLink };
        toast("Gesichert.");
        app.render({ keepScroll: true });
      });
      mountActions(root, app, {
        "share-link": async () => {
          const message = team.playerInvitationMessage;
          if (message && (await shareText(message, `Einladung: ${team.teamName}`))) toast("Weitergegeben.");
        },
        "copy-link": async () => {
          const message = team.playerInvitationMessage;
          if (message && (await copyText(message))) toast("Kopiert.");
        },
        "new-link": async () => {
          const choice = await ask({ title: "Neuen Link für Spieler erzeugen?", message: "Der bisherige Link gilt danach nicht mehr. Wer schon dabei ist, bleibt im Team.", actions: [{ label: "Neuen Link erzeugen", value: "new", style: "danger" }] });
          if (choice !== "new") return;
          if (await team.newJoinLink()) toast("Neuer Link erzeugt.");
        },
        "add-group": () => {
          read();
          const group = draft.newGroup.trim();
          if (!group || !allows(group)) return;
          team.updateInfo((info) => {
            if (!info.groups.includes(group)) info.groups = [...info.groups, group];
          });
          draft.newGroup = "";
          app.render({ keepScroll: true });
        },
        "remove-group": async (button) => {
          const group = button.dataset.group;
          const choice = await ask({ title: `Gruppe „${group}“ löschen?`, message: "Ihre Spieler sind danach ohne Gruppe.", actions: [{ label: "Löschen", value: "delete", style: "danger" }] });
          if (choice !== "delete") return;
          team.updateInfo((info) => (info.groups = info.groups.filter((name) => name !== group)));
          for (const membership of team.data.values("membership")) {
            if (membership.group === group && team.canManage(membership.memberID)) team.updateMembership(membership.memberID, (item) => (item.group = null));
          }
        },
        handover: async () => {
          const candidate = root.querySelector("select[name='candidate']")?.value;
          if (!candidate) return;
          const choice = await ask({ title: "Abteilung übergeben?", message: "Das lässt sich nur von der neuen Person rückgängig machen.", actions: [{ label: "Übergeben", value: "handover", style: "danger" }] });
          if (choice !== "handover") return;
          team.transferOwnership(candidate);
          toast("Übergeben.");
        },
      });
      return () => {
        if (!location.hash.startsWith("#/team/einstellungen")) dropDraft(key);
      };
    },
  };
}

// MARK: - Meldungen für Admins

const SUBJECT_TITLES = { member: "Mitglied", announcement: "Beitrag an der Pinnwand", event: "Termin", response: "Notiz zu einer Antwort", challenge: "Challenge", comment: "Nachricht", clip: "Video" };
const REASON_TITLES = { insult: "Beleidigung oder Mobbing", harassment: "Belästigung oder Bedrohung", inappropriate: "Unangemessene Inhalte", privacy: "Verletzt die Privatsphäre", spam: "Werbung oder Spam", other: "Etwas anderes" };

function reportRow(report, data) {
  const created = dateOf(report.createdAt);
  const isOpen = report.resolvedAt == null;
  return html`<li><a class="row" href="#/team/meldungen/${encodeURIComponent(uid(report.id))}"><span class="row-main">
    <span class="kicker${isOpen ? " flag" : ""}">${SUBJECT_TITLES[report.subject] ?? report.subject} · ${REASON_TITLES[report.reason] ?? report.reason}</span>
    <span class="row-title">${report.excerpt ? String(report.excerpt).slice(0, 160) : "Ohne Text"}</span>
    <span class="row-sub">Gemeldet von ${data.name(report.memberID)}${created ? ` · ${formatShortDate(created)}, ${formatTime(created)}` : ""}</span>
  </span><span class="mark" aria-hidden="true">›</span></a></li>`;
}

export function reportsPage(app) {
  const team = app.team;
  return {
    title: "Meldungen",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      if (!team.isAdmin) return notFound("Meldungen sehen die Admins.");
      const reports = data.sortedReports.filter((report) => !sameID(report.reportedMemberID, team.myMemberID));
      const open = reports.filter((report) => report.resolvedAt == null);
      const done = reports.filter((report) => report.resolvedAt != null);
      return html`${takeMessage(team)}
        ${reports.length === 0 ? empty("Keine Meldungen.") : ""}
        ${open.length > 0 ? chapter("Offen", html`<ul class="rows">${open.map((report) => reportRow(report, data))}</ul>`) : ""}
        ${done.length > 0 ? chapter("Erledigt", html`<ul class="rows">${done.slice(0, 30).map((report) => reportRow(report, data))}</ul>`) : ""}
        ${chapter("", refreshAction(team), { footer: "Meldungen sehen alle Admins, außer der gemeldeten Person. Reagiere bald: Lösche den Inhalt, sprich mit den Beteiligten oder nimm jemanden aus dem Team. Bei Straftaten hilft die Polizei." })}`;
    },
    mount(root) {
      mountActions(root, app, { refresh: () => team.refresh() });
    },
  };
}

export function reportPage(app, reportID) {
  const team = app.team;
  return {
    title: "Meldung",
    tab: "mehr",
    parent: "#/team/meldungen",
    render() {
      const data = team.data;
      const report = data.get(`report.${uid(reportID)}`);
      if (!report || !team.isAdmin) return notFound("Meldung nicht gefunden.");
      const isOpen = report.resolvedAt == null;
      const created = dateOf(report.createdAt);
      const resolved = dateOf(report.resolvedAt);
      const reported = report.reportedMemberID ? uid(report.reportedMemberID) : null;
      return html`${takeMessage(team)}
        ${chapter(
          SUBJECT_TITLES[report.subject] ?? report.subject,
          html`<p class="kicker${isOpen ? " flag" : ""}">${REASON_TITLES[report.reason] ?? report.reason}</p>
            <p class="serif">${report.excerpt || "Ohne Text"}</p>
            <ul class="rows facts">
              ${reported ? labeled(report.subject === "member" ? "Gemeldet" : "Geschrieben von", data.name(reported)) : ""}
              ${labeled("Gemeldet von", data.name(report.memberID))}
              ${created ? labeled("Am", `${formatShortDate(created)}, ${formatTime(created)}`) : ""}
              ${resolved ? labeled("Erledigt", `${formatShortDate(resolved)}, ${formatTime(resolved)}${report.resolvedBy ? ` · ${data.name(report.resolvedBy)}` : ""}`) : ""}
            </ul>
            ${report.note ? html`<p class="serif small">${report.note}</p>` : ""}`,
        )}
        ${chapter(
          "Was du tun kannst",
          html`${report.subject !== "member" ? html`<button type="button" class="action danger" data-action="remove-content">${report.subject === "response" ? "Notiz löschen" : "Inhalt aus dem Team löschen"}</button>` : ""}
            ${report.subject === "clip" && data.get(report.recordName) ? html`<a class="action" href="#/team/videos/${encodeURIComponent(uid(data.get(report.recordName).id))}">Video ansehen<span class="mark" aria-hidden="true">›</span></a>` : ""}
            ${reported && data.member(reported) && team.isStaff ? html`<a class="action" href="${member(reported)}">${data.name(reported)} ansehen und verwalten<span class="mark" aria-hidden="true">›</span></a>` : ""}
            <button type="button" class="action" data-action="toggle">${isOpen ? "Als erledigt markieren" : "Wieder öffnen"}<span class="mark" aria-hidden="true">${isOpen ? "✓" : "↺"}</span></button>`,
          { footer: "Löschen entfernt den Inhalt für alle im Team. Aus dem Team nehmen geht beim Mitglied unter „Verwaltung“." },
        )}`;
    },
    mount(root) {
      mountActions(root, app, {
        toggle: () => {
          const report = team.data.get(`report.${uid(reportID)}`);
          if (report) team.setResolved(report, report.resolvedAt == null);
        },
        "remove-content": async () => {
          const report = team.data.get(`report.${uid(reportID)}`);
          if (!report) return;
          const choice = await ask({
            title: "Für alle im Team löschen?",
            message:
              report.subject === "event"
                ? "Zu- und Absagen und die Anwesenheit des Termins gehen mit. Die Meldung gilt danach als erledigt."
                : report.subject === "clip"
                  ? "Das Video und das Feedback dazu verschwinden für alle. Die Meldung gilt danach als erledigt."
                  : "Die Meldung gilt danach als erledigt. Die Kopie des Textes bleibt in der Meldung.",
            actions: [{ label: "Löschen", value: "delete", style: "danger" }],
          });
          if (choice === "delete") team.removeReportedContent(report);
        },
      });
    },
  };
}

// MARK: - Trainingskalender, Analyse, Export

const calendarChoice = { days: 14, group: "" };

export function trainingCalendarPage(app) {
  const team = app.team;
  return {
    title: "Wer wann trainiert",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      if (!team.isCoach) return notFound("Nur für Trainer.");
      const now = new Date();
      const groups = data.info?.groups ?? [];
      const players = data.activePlayers.filter((player) => !calendarChoice.group || data.group(player.id) === calendarChoice.group);
      const ids = players.map((player) => uid(player.id));
      const map = sortedByTotal(heatmap(data, ids, calendarChoice.days, now));
      const since = addDays(startOfDay(now), 1 - calendarChoice.days);
      const items = feed(data, since, now, ids);
      const byDay = new Map();
      for (const item of items) {
        const day = startOfDay(item.start).getTime();
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(item);
      }
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`<div class="choice" role="group" aria-label="Zeitraum">${[14, 28].map((days) => html`<button type="button" data-action="days" data-days="${days}" aria-pressed="${String(calendarChoice.days === days)}" data-key="days-${days}">${days === 14 ? "2 Wochen" : "4 Wochen"}</button>`)}</div>
            ${groups.length > 0 ? html`<label class="field"><span>Gruppe</span><select name="group" data-key="group">${groupOptions(groups, calendarChoice.group, "Alle")}</select></label>` : ""}
            ${map.rows.length === 0 ? empty("Noch keine Spieler freigegeben.") : html`<div class="scroll-x">${heatGrid(map)}</div>`}`,
          { footer: "Gezählt werden das Tagebuch der Spieler und Teamtermine, bei denen sie laut Anwesenheitsliste da waren." },
        )}
        ${items.length === 0 ? empty("In diesem Zeitraum hat niemand Training eingetragen.") : ""}
        ${[...byDay.keys()]
          .sort((a, b) => b - a)
          .map((day) =>
            chapter(
              dayLong.format(new Date(day)),
              html`<ul class="rows">${byDay.get(day).map(
                (item) => html`<li><a class="row" href="${member(item.memberID)}"><span class="row-main"><span class="row-title">${item.memberName}</span><span class="row-sub">${item.title} · ${formatTime(item.start)}</span>${item.detail ? html`<span class="row-sub">${item.detail}</span>` : ""}</span><span class="row-value serif">${durationText(item.minutes)}</span></a></li>`,
              )}</ul>`,
            ),
          )}`;
    },
    mount(root) {
      mountActions(root, app, {
        days: (button) => {
          calendarChoice.days = Number(button.dataset.days);
          app.render({ keepScroll: true });
        },
      });
      root.querySelector("select[name='group']")?.addEventListener("change", (event) => {
        calendarChoice.group = event.target.value;
        app.render({ keepScroll: true });
      });
    },
  };
}

export function analysisPage(app) {
  const team = app.team;
  return {
    title: "Team-Analyse",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      if (!team.isCoach) return notFound("Nur für Trainer.");
      const now = new Date();
      const players = data.activePlayers.map((player) => uid(player.id));
      const playerSet = new Set(players);
      const weeks = weeklyTotals(data, players, 12, now);
      const last = weeks[weeks.length - 1];
      const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
      const logs = [];
      for (const payload of data.values("log")) {
        if (!playerSet.has(uid(payload.memberID))) continue;
        try {
          const entry = decodeLogEntry(payload);
          if (entry.start >= fourWeeksAgo) logs.push(entry);
        } catch {
          // Unlesbar: zählt nicht.
        }
      }
      const areas = areaMinutes(logs);
      const total = Math.max(1, Object.values(areas).reduce((sum, value) => sum + value, 0));
      const strokes = teamStrokesGained(data);
      const weakest = weakestCategory(strokes);
      return html`${takeMessage(team)}
        ${chapter(
          "Trainingszeit pro Woche",
          html`${barChart(weeks.map((week) => ({ value: week.minutes })), { label: `Minuten pro Woche: ${weeks.map((week) => week.minutes).join(", ")}` })}
            <p class="kicker">Letzte 12 Wochen</p>
            ${last ? html`<ul class="rows facts">${labeled("Diese Woche", `${durationText(last.minutes)}, ${last.activePlayers} von ${players.length} Spielern`)}</ul>` : ""}`,
        )}
        ${chapter(
          "Was trainiert wird (4 Wochen)",
          html`${Object.keys(areas).length === 0 ? empty("Noch keine Bereiche eingetragen.") : ""}
            ${AREAS.filter((area) => areas[area] != null).map((area) => html`<div class="area-line"><span class="area-head"><span>${AREA_NAMES[area]}</span><span class="serif">${Math.round((areas[area] / total) * 100)} %</span></span>${progress(areas[area], total, { label: `${AREA_NAMES[area]} ${areas[area]} Minuten` })}</div>`)}`,
        )}
        ${chapter(
          "Strokes Gained des Teams",
          html`${Object.keys(strokes).length === 0 ? empty("Noch keine Runden mit Strokes Gained geteilt.") : ""}
            <ul class="rows">${SG_CATEGORIES.filter((category) => strokes[category] != null).map((category) => labeled(SG_NAMES[category] ?? category, `${strokes[category] > 0 ? "+" : ""}${strokes[category].toFixed(1).replace(".", ",")}`))}</ul>
            ${weakest ? html`<p class="serif quote">Hier verliert das Team die meisten Schläge: ${SG_NAMES[weakest] ?? weakest}. Ein guter Schwerpunkt fürs nächste Teamtraining.</p>` : ""}`,
          { footer: "Durchschnitt der letzten fünf Runden jedes Spielers. Jeder Spieler zählt gleich viel." },
        )}`;
    },
  };
}

const exportChoice = { from: null, to: null };

export function exportPage(app) {
  const team = app.team;
  return {
    title: "Export",
    tab: "mehr",
    parent: TEAM_HOME,
    render() {
      const data = team.data;
      if (!team.isStaff) return notFound("Nur für Trainer und Funktionäre.");
      const now = new Date();
      exportChoice.from ??= toDateInput(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
      exportChoice.to ??= toDateInput(now);
      const start = startOfDay(fromInputs(exportChoice.from) ?? now);
      const end = addDays(startOfDay(fromInputs(exportChoice.to) ?? now), 1);
      const events = data.values("event").filter((event) => {
        const date = dateOf(event.start);
        return date && date >= start && date < end;
      });
      return html`${takeMessage(team)}
        ${chapter(
          "",
          html`<div class="field-row">
            <label class="field"><span>Von</span><input type="date" name="from" value="${exportChoice.from}" data-key="from"></label>
            <label class="field"><span>Bis</span><input type="date" name="to" value="${exportChoice.to}" min="${exportChoice.from}" data-key="to"></label>
          </div>`,
          { footer: `${events.length} Termine im Zeitraum.` },
        )}
        ${chapter(
          "Dateien",
          html`<button type="button" class="action" data-action="attendance">Anwesenheitsliste (CSV)<span class="mark" aria-hidden="true">↓</span></button>
            ${team.isCoach ? html`<button type="button" class="action" data-action="diary">Trainingstagebuch aller Spieler (CSV)<span class="mark" aria-hidden="true">↓</span></button>` : ""}
            <button type="button" class="action" data-action="calendar">Termine als Kalender (.ics)<span class="mark" aria-hidden="true">↓</span></button>`,
          { footer: "Die CSV-Dateien öffnen sich in Excel und Numbers. Die Anwesenheitsliste hilft z. B. bei der Abrechnung von Übungsleitern. Achte beim Weitergeben auf den Datenschutz." },
        )}`;
    },
    mount(root) {
      const range = () => {
        const now = new Date();
        const start = startOfDay(fromInputs(exportChoice.from) ?? now);
        const to = startOfDay(fromInputs(exportChoice.to) ?? now);
        const end = addDays(to, 1);
        const events = team.data.values("event").filter((event) => {
          const date = dateOf(event.start);
          return date && date >= start && date < end;
        });
        return { start, to, end, events, stamp: `${fileStamp(start)} bis ${fileStamp(to)}` };
      };
      for (const name of ["from", "to"]) {
        root.querySelector(`input[name='${name}']`)?.addEventListener("change", (event) => {
          exportChoice[name] = event.target.value;
          app.render({ keepScroll: true });
        });
      }
      mountActions(root, app, {
        attendance: () => {
          const { events, stamp: label } = range();
          download(`Anwesenheit ${label}.csv`, attendanceCSV(team.data, events), "text/csv");
        },
        diary: () => {
          const { start, end, stamp: label } = range();
          download(`Trainingstagebuch ${label}.csv`, trainingLogCSV(team.data, start, end), "text/csv");
        },
        calendar: () => {
          const { events } = range();
          download(`Termine ${team.teamName}.ics`, teamCalendar(events, team.teamName, new Date()), "text/calendar");
        },
      });
    },
  };
}
