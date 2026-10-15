// Auswertungen und Texte für Trainer und Funktionäre, wie TeamAnalytics,
// TeamExport, SessionTemplates und die Einladungstexte im Kern der App.
// Reine Funktionen auf den Einträgen des Teams (core/team.js); die Zeitzone
// ist die des Geräts, wie in der App.
import { AREAS, AREA_NAMES, SG_CATEGORIES } from "./categories.js";
import { addDays, startOfDay, startOfWeek } from "./dates.js";
import { decodeLogEntry } from "./model.js";
import { KIND_NAMES, PLACE_NAMES, scoreText, sortedAreas, streak } from "./traininglog.js";
import { ATTENDANCE_CODES, EVENT_KIND_NAMES, ROLE_NAMES, ageClassLabel, dateOf, displayCode, inviteRoleText, sameID, sessionState, stamp, uid } from "./team.js";
import { attendedEvents, countsAsTraining, dailyMinutes } from "./teamshare.js";
import { fold, icsDate, icsText } from "./calendar.js";

export const ACTIVITY_NAMES = { active: "Aktiv", slipping: "Länger nicht trainiert", inactive: "Inaktiv", paused: "Pausiert", new: "Neu", unknown: "Keine Angaben" };

/** Hinweise, die ohne Trainingsdaten auskommen. Die sehen auch Funktionäre. */
export const ORGANIZATIONAL_ALERTS = new Set(["joinRequests", "missingConsent", "openResponses", "lowAttendance"]);

const dayMs = 86400000;

/** Tagebuch eines Spielers, gelesen wie in der App; unlesbare Einträge fallen weg. */
export function decodedLogs(data, memberID) {
  const logs = [];
  for (const payload of data.logs(memberID)) {
    try {
      logs.push(decodeLogEntry(payload));
    } catch {
      // Ein Eintrag aus einer anderen Version: bleibt außen vor.
    }
  }
  return logs;
}

/** Minuten pro Tag eines Spielers aus Tagebuch und besuchten Teamterminen, als Map(Tag in ms → Minuten). */
export function dailyMinutesOf(memberID, data, now = null) {
  return dailyMinutes(decodedLogs(data, memberID), attendedEvents(memberID, data, now));
}

/** Letzte Einheit, aus Tagebuch oder Teamtermin, als Date. */
export function lastTraining(memberID, data, now) {
  const limit = now.getTime();
  const dates = decodedLogs(data, memberID).map((entry) => entry.start.getTime());
  for (const event of attendedEvents(memberID, data)) {
    if (!countsAsTraining(event.kind)) continue;
    const start = dateOf(event.start);
    if (start) dates.push(start.getTime());
  }
  const past = dates.filter((time) => time <= limit);
  return past.length === 0 ? null : new Date(Math.max(...past));
}

/** Minuten in einem Zeitraum (Beginn einschließlich, Ende ausschließlich). */
export function minutesBetween(daily, start, end) {
  let total = 0;
  for (const [day, minutes] of daily) if (day >= start.getTime() && day < end.getTime()) total += minutes;
  return total;
}

/** Ganze Kalendertage zwischen zwei Zeitpunkten, wie `dateComponents([.day])` in der App. */
function calendarDays(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / dayMs);
}

/** Ab so vielen Tagen ohne Training gilt ein Spieler als inaktiv. */
export function inactivityThreshold(data) {
  return Math.max(2, Number(data.info?.inactivityDays) || 14);
}

/** Anteil der Termine, bei denen der Spieler da war; entschuldigt zählt nicht dagegen. null ohne erfasste Termine. */
export function attendanceRate(memberID, data, since, now) {
  let present = 0;
  let absent = 0;
  for (const record of data.values("attendance")) {
    if (!sameID(record.memberID, memberID)) continue;
    const event = data.event(record.eventID);
    if (!event || event.isCancelled === true) continue;
    const start = dateOf(event.start);
    if (!start || start < since || start > now) continue;
    if (record.status === "present") present += 1;
    else if (record.status === "absent") absent += 1;
  }
  return present + absent > 0 ? present / (present + absent) : null;
}

/** Anteil der erledigten Übungen im Wochenplan, aus dem Stand des Spielers. */
export function planProgress(snapshot) {
  const planned = Number(snapshot?.plannedDrills) || 0;
  return planned > 0 ? Math.min(1, (Number(snapshot.doneDrills) || 0) / planned) : null;
}

/** Zeile der Spielerübersicht für den Trainer, wie `TeamAnalytics.overview`. */
export function overview(data, now) {
  const weekStart = startOfWeek(now);
  const fourWeeksAgo = addDays(weekStart, -28);
  const eightWeeksAgo = new Date(now.getTime() - 56 * dayMs);
  const threshold = inactivityThreshold(data);
  const year = now.getFullYear();
  const rows = [];
  for (const member of data.roster) {
    const role = data.role(member.id);
    if (!role) continue;
    const daily = dailyMinutesOf(member.id, data, now);
    const last = lastTraining(member.id, data, now);
    const daysSince = last ? calendarDays(last, now) : null;
    let minutesThisWeek = 0;
    let trainingDaysThisWeek = 0;
    const trainingDays = new Set();
    for (const [day, minutes] of daily) {
      if (minutes > 0) trainingDays.add(day);
      if (day >= weekStart.getTime() && day <= now.getTime()) {
        minutesThisWeek += minutes;
        if (minutes > 0) trainingDaysThisWeek += 1;
      }
    }
    const shares = data.sharesTraining(member.id, year);
    let state;
    if (data.status(member.id) === "inactive") state = "paused";
    else if (daysSince != null) {
      if (daysSince >= threshold) state = shares ? "inactive" : "unknown";
      else state = daysSince * 2 >= threshold ? "slipping" : "active";
    } else {
      const joined = dateOf(member.joinedAt);
      const joinedDays = joined ? Math.floor((now.getTime() - joined.getTime()) / dayMs) : threshold;
      state = joinedDays < threshold ? "new" : shares ? "inactive" : "unknown";
    }
    const details = data.details(member.id);
    rows.push({
      id: uid(member.id),
      member,
      role,
      group: data.group(member.id) ?? null,
      ageClass: details?.birthYear != null ? ageClassLabel(details.birthYear, year) : null,
      lastTraining: last,
      daysSinceTraining: daysSince,
      minutesThisWeek,
      trainingDaysThisWeek,
      weeklyAverage: Math.floor(minutesBetween(daily, fourWeeksAgo, weekStart) / 4),
      attendanceRate: attendanceRate(member.id, data, eightWeeksAgo, now),
      streak: streak(trainingDays, now),
      state,
      planProgress: planProgress(data.get(`snapshot.${uid(member.id)}`)),
    });
  }
  return rows;
}

/** Wer wann trainiert hat: Minuten pro Spieler und Tag über die letzten `days` Tage, älteste zuerst. */
export function heatmap(data, memberIDs, days, now) {
  const today = startOfDay(now);
  const dates = Array.from({ length: Math.max(1, days) }, (_, index) => addDays(today, index - Math.max(1, days) + 1));
  const rows = [];
  for (const id of memberIDs) {
    const member = data.member(id);
    if (!member) continue;
    const daily = dailyMinutesOf(id, data, now);
    const minutes = dates.map((day) => daily.get(day.getTime()) ?? 0);
    rows.push({ member, minutes, total: minutes.reduce((sum, value) => sum + value, 0) });
  }
  return { days: dates, rows, maxMinutes: Math.max(0, ...rows.flatMap((row) => row.minutes)) };
}

/** Wer am meisten trainiert hat, zuerst. */
export function sortedByTotal(map) {
  const rows = [...map.rows].sort((a, b) => (a.total !== b.total ? b.total - a.total : a.member.name < b.member.name ? -1 : a.member.name > b.member.name ? 1 : 0));
  return { ...map, rows };
}

/** Alle Einheiten seit `since`, neueste zuerst: Tagebuch und besuchte Teamtermine, die schon begonnen haben. */
export function feed(data, since, now = new Date(), memberIDs = null) {
  const allowed = memberIDs ? new Set([...memberIDs].map(uid)) : null;
  const included = (id) => (allowed ? allowed.has(uid(id)) : data.role(id) != null);
  const items = [];
  for (const payload of data.values("log")) {
    if (!included(payload.memberID)) continue;
    let entry;
    try {
      entry = decodeLogEntry(payload);
    } catch {
      continue;
    }
    if (entry.start < since) continue;
    const titleParts = [KIND_NAMES[entry.kind] ?? entry.kind];
    if (entry.place) titleParts.push(PLACE_NAMES[entry.place] ?? entry.place);
    const areas = sortedAreas(entry).map((item) => `${AREA_NAMES[item.area] ?? item.area} ${item.minutes}`);
    const drills = entry.drills.map((drill) => drill.name);
    items.push({
      id: `log-${entry.id}`,
      memberID: uid(entry.memberID),
      memberName: data.name(entry.memberID),
      start: entry.start,
      minutes: entry.minutes,
      title: titleParts.join(" · "),
      detail: (areas.length > 0 ? areas : drills).join(", "),
      source: { kind: "log", entry },
    });
  }
  for (const record of data.values("attendance")) {
    if (record.status !== "present" || !included(record.memberID)) continue;
    const event = data.event(record.eventID);
    const start = event ? dateOf(event.start) : null;
    if (!event || !start || start < since || start > now || event.isCancelled === true || !countsAsTraining(event.kind)) continue;
    items.push({
      id: `event-${uid(event.id)}-${uid(record.memberID)}`,
      memberID: uid(record.memberID),
      memberName: data.name(record.memberID),
      start,
      minutes: Number(event.minutes) || 0,
      title: event.title,
      detail: (EVENT_KIND_NAMES[event.kind] ?? "Termin") + (event.place ? ` · ${event.place}` : ""),
      source: { kind: "event", event },
    });
  }
  return items.sort((a, b) => (a.start.getTime() !== b.start.getTime() ? b.start - a.start : a.memberName < b.memberName ? -1 : a.memberName > b.memberName ? 1 : 0));
}

/** Trainingsminuten pro Woche, älteste zuerst: { weekStart, minutes, activePlayers }. */
export function weeklyTotals(data, memberIDs, weeks, now) {
  const thisWeek = startOfWeek(now);
  const count = Math.max(1, weeks);
  const starts = Array.from({ length: count }, (_, index) => addDays(thisWeek, -7 * (count - 1 - index)));
  const dailies = memberIDs.map((id) => dailyMinutesOf(id, data, now));
  return starts.map((start) => {
    const end = addDays(start, 7);
    const perMember = dailies.map((daily) => minutesBetween(daily, start, end));
    return { weekStart: start, minutes: perMember.reduce((sum, value) => sum + value, 0), activePlayers: perMember.filter((value) => value > 0).length };
  });
}

/** Minuten pro Bereich aus Tagebucheinträgen (gelesen oder roh). */
export function areaMinutes(logs) {
  const result = {};
  for (const entry of logs) {
    for (const [area, minutes] of Object.entries(entry.areaMinutes ?? {})) {
      const value = Number(minutes) || 0;
      if (value > 0 || area in result) result[area] = (result[area] ?? 0) + value;
    }
  }
  return result;
}

/** Durchschnitt pro Kategorie über die Runden. */
export function averageStrokesGained(rounds) {
  const result = {};
  for (const category of SG_CATEGORIES) {
    const values = rounds.map((round) => round.strokesGained?.[category]).filter((value) => typeof value === "number" && Number.isFinite(value));
    if (values.length > 0) result[category] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return result;
}

/** Team-Durchschnitt aus den letzten Runden jedes Spielers. Jeder Spieler zählt gleich viel. */
export function teamStrokesGained(data, lastRounds = 5) {
  const perPlayer = data.activePlayers.map((player) => averageStrokesGained(data.rounds(player.id).slice(0, lastRounds)));
  const result = {};
  for (const category of SG_CATEGORIES) {
    const values = perPlayer.map((item) => item[category]).filter((value) => value != null);
    if (values.length > 0) result[category] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return result;
}

/** Wo das Team die meisten Schläge verliert. */
export function weakestCategory(values) {
  let weakest = null;
  for (const [category, value] of Object.entries(values)) if (weakest == null || value < values[weakest]) weakest = category;
  return weakest;
}

// MARK: - Termine

/** Wer kommt: { yes, maybe, no, open } mit Kennungen der eingeladenen Spieler. */
export function responses(event, data) {
  const summary = { yes: [], maybe: [], no: [], open: [] };
  for (const player of data.invitedPlayers(event)) {
    const answer = data.response(player.id, event.id)?.answer;
    (summary[answer] ?? summary.open).push(uid(player.id));
  }
  return summary;
}

/** Anwesenheit: { present, excused, absent, open }. */
export function attendanceSummary(event, data) {
  const summary = { present: 0, excused: 0, absent: 0, open: 0 };
  for (const player of data.invitedPlayers(event)) {
    const status = data.attendance(player.id, event.id)?.status;
    if (status in summary) summary[status] += 1;
    else summary.open += 1;
  }
  return summary;
}

// MARK: - Hinweise

function names(ids, data) {
  return ids.map((id) => data.name(id)).sort().join(", ");
}

/** Hinweise auf der Startseite der Trainer, wie `TeamAnalytics.alerts`. */
export function alerts(data, now) {
  const result = [];
  const year = now.getFullYear();
  const push = (kind, title, detail, memberIDs, extra = {}) => result.push({ id: kind + (extra.eventID ?? "") + (extra.planID ?? ""), kind, title, detail, memberIDs: memberIDs.map(uid), eventID: null, planID: null, ...extra });

  const pending = data.pendingMembers;
  if (pending.length > 0) {
    push("joinRequests", pending.length === 1 ? "1 Beitrittsanfrage" : `${pending.length} Beitrittsanfragen`, names(pending.map((member) => member.id), data), pending.map((member) => member.id));
  }
  const missingConsent = data.players.filter((player) => data.needsConsent(player.id, year)).map((player) => player.id);
  if (missingConsent.length > 0) {
    push("missingConsent", "Einverständnis der Eltern fehlt", `${names(missingConsent, data)}. Bis dahin teilen sie keine Trainingsdaten.`, missingConsent);
  }
  const players = overview(data, now).filter((item) => item.role === "player");
  const inactive = players.filter((item) => item.state === "inactive" && data.sharesTraining(item.id, year)).map((item) => item.id);
  if (inactive.length > 0) {
    push("inactive", `Seit ${inactivityThreshold(data)} Tagen oder länger kein Training`, names(inactive, data), inactive);
  }
  const weekAhead = new Date(now.getTime() + 7 * dayMs);
  for (const event of data.upcomingEvents(now)) {
    if (event.asksForResponse === false || event.isCancelled === true) continue;
    const start = dateOf(event.start);
    if (!start || start > weekAhead) continue;
    const open = responses(event, data).open;
    if (open.length > 0) push("openResponses", `${event.title}: ${open.length} ohne Antwort`, names(open, data), open, { eventID: uid(event.id) });
  }
  const eightWeeksAgo = new Date(now.getTime() - 56 * dayMs);
  const lowAttendance = players
    .filter((item) => {
      if (item.attendanceRate == null || item.attendanceRate >= 0.5) return false;
      const recorded = data.values("attendance").filter((record) => {
        if (!sameID(record.memberID, item.id)) return false;
        const start = dateOf(data.event(record.eventID)?.start);
        return start != null && start >= eightWeeksAgo;
      });
      return recorded.length >= 3;
    })
    .map((item) => item.id);
  if (lowAttendance.length > 0) push("lowAttendance", "Bei weniger als der Hälfte der Termine da", names(lowAttendance, data), lowAttendance);

  const weekAgo = startOfDay(addDays(now, -7));
  for (const assignment of data.sessionAssignments) {
    const content = assignment.content;
    const due = dateOf(content.due);
    if (!due || startOfDay(due) < weekAgo) continue;
    const behind = assignment.sessions
      .filter(
        (session) =>
          data.status(session.memberID) === "active" &&
          data.role(session.memberID) === "player" &&
          data.sharesTraining(session.memberID, year) &&
          sessionState(session, data.doneDrillIDs(session.id), now) === "overdue",
      )
      .map((session) => session.memberID);
    if (behind.length > 0) push("overdueSessions", `„${content.title}“: ${behind.length} nicht erledigt`, names(behind, data), behind, { planID: assignment.planID });
  }

  const waiting = data.values("clip").filter((clip) => !data.values("comment").some((comment) => sameID(comment.clipID, clip.id) && data.isCoach(comment.authorID)));
  if (waiting.length > 0) {
    const members = [...new Set(waiting.map((clip) => uid(clip.memberID)))];
    push("clipsWithoutFeedback", waiting.length === 1 ? "1 Video wartet auf Feedback" : `${waiting.length} Videos warten auf Feedback`, names(members, data), members);
  }
  return result;
}

// MARK: - Einheiten

/** „Lena Meier“, „Lena Meier und Tom Becker“ oder „5 Spieler“. */
export function recipientsText(memberIDs, data) {
  const list = memberIDs.map((id) => data.name(id)).sort();
  if (list.length === 0) return "niemand";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} und ${list[1]}`;
  return `${list.length} Spieler`;
}

/** Fertig von denen, die ihr Training teilen; die anderen zählen weder als fertig noch als offen. */
export function doneCount(assignment, data, now) {
  const year = now.getFullYear();
  const sharing = assignment.sessions.filter((session) => data.sharesTraining(session.memberID, year));
  const done = sharing.filter((session) => sessionState(session, data.doneDrillIDs(session.id), now) === "done").length;
  const unknown = assignment.sessions.length - sharing.length;
  let text = `${done} von ${sharing.length} fertig`;
  if (unknown > 0) text += ` · ${unknown} ohne Angabe`;
  return { done, sharing: sharing.length, text };
}

/** Vorlagen für Trainer, die sie anpassen und zuweisen. */
export const SESSION_TEMPLATES = [
  { id: "shortgame-60", title: "Kurzspiel kompakt", text: "Einmal rund ums Grün: sauberer Treffmoment, wechselnde Lagen, Bunker und lange Putts. Gut als Aufgabe zwischen zwei Teamtrainings.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "chip-landing", minutes: 15, note: "" }, { drillID: "chip-random-lies", minutes: 15, note: "" }, { drillID: "bunker-zones", minutes: 10, note: "" }, { drillID: "putt-lag-zone", minutes: 10, note: "" }] },
  { id: "bunker-50", title: "Bunker: raus und nah ran", text: "Erst die richtige Menge Sand, dann wechselnde Lagen am Hang und zum Schluss ein Punktespiel, bei dem jeder Ball zählt.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "bunker-dollar", minutes: 10, note: "" }, { drillID: "bunker-slopes", minutes: 15, note: "" }, { drillID: "bunker-points", minutes: 15, note: "" }] },
  { id: "putting-45", title: "Putten: Start, Länge, Druck", text: "Erst die Startlinie, dann das Gefühl für die Länge, zum Schluss kurze Putts, die fallen müssen.", drills: [{ drillID: "putt-gate", minutes: 10, note: "" }, { drillID: "putt-ladder", minutes: 15, note: "" }, { drillID: "putt-lag-zone", minutes: 10, note: "" }, { drillID: "putt-must-make", minutes: 10, note: "" }] },
  { id: "greens-50", title: "Putten: Break und Hang", text: "Die Linie sichtbar machen, Tempo und Break zusammenbringen und zum Schluss Putts am Hang mit Punkten.", drills: [{ drillID: "putt-break-read", minutes: 15, note: "" }, { drillID: "putt-three-speeds", minutes: 15, note: "" }, { drillID: "putt-slope-challenge", minutes: 20, note: "" }] },
  { id: "wedges-50", title: "Wedges 30–100 m", text: "Längen nach dem Uhr-System festigen und dann bei wechselnden Distanzen anwenden.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "wedge-clock", minutes: 20, note: "" }, { drillID: "wedge-random", minutes: 20, note: "" }] },
  { id: "range-75", title: "Range: Eisen und Driver", text: "Technik zuerst, dann wechselnde Ziele und zum Schluss Abschläge wie auf dem Platz.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "iron-technique", minutes: 15, note: "" }, { drillID: "iron-nine-window", minutes: 20, note: "" }, { drillID: "drive-fairway", minutes: 15, note: "" }, { drillID: "range-course", minutes: 15, note: "" }] },
  { id: "approach-60", title: "Eisen: Streubild und sichere Seite", text: "Erst das eigene Streubild kennenlernen, dann flache Schläge für den Wind und zum Schluss mit nur einem Ball auf die sichere Seite des Grüns.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "iron-dispersion", minutes: 15, note: "" }, { drillID: "iron-knockdown", minutes: 15, note: "" }, { drillID: "iron-safe-side", minutes: 20, note: "" }] },
  { id: "driving-55", title: "Abschlag: Tempo und Strategie", text: "Rhythmus festigen, dann bei jedem Ball ein anderes Fairway und zum Schluss ein Spiel mit Aus wie auf dem Platz.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "drive-tempo", minutes: 10, note: "" }, { drillID: "drive-fairway-switch", minutes: 15, note: "" }, { drillID: "drive-oob-game", minutes: 20, note: "" }] },
  { id: "tournament-60", title: "Turniervorbereitung", text: "Kurz vor dem Turnier: wenig Technik, viel Routine und Spielformen, bei denen jeder Schlag zählt.", drills: [{ drillID: "warmup", minutes: 10, note: "" }, { drillID: "routine-range", minutes: 15, note: "" }, { drillID: "chip-par18", minutes: 20, note: "" }, { drillID: "putt-must-make", minutes: 15, note: "" }] },
  { id: "tests-65", title: "Testtag Kurzspiel", text: "Die Monatstests für Kurzspiel und Putten. Die Ergebnisse zeigen, wo du stehst.", drills: [{ drillID: "shortgame-test", minutes: 40, note: "" }, { drillID: "putt-test", minutes: 25, note: "" }] },
];

export const templateMinutes = (template) => template.drills.reduce((total, item) => total + item.minutes, 0);

// MARK: - Einladungen

/** Was die Rolle darf, in einem Satz. */
export function rightsText(role, admin) {
  const base = {
    headCoach: "Sportliche Leitung: sieht alle Trainingsdaten, gibt Feedback, lädt Trainer, Funktionäre und Spieler ein und ändert die Einstellungen.",
    coach: "Sieht die Trainingsdaten der Spieler, setzt Schwerpunkte, gibt Feedback, plant Termine und gibt Spieler frei.",
    official: "Organisiert: Termine, Pinnwand, Anwesenheit und die Mitgliederliste mit Jahrgang und Einverständnis. Keine Trainingsdaten.",
    player: "Kommt ohne Freigabe direkt ins Team, in die gewählte Gruppe.",
  }[role] ?? "";
  return admin ? `${base} Verwaltet als Admin dazu alle Mitglieder und Einladungen.` : base;
}

export const TITLE_SUGGESTIONS = ["Jugendwart", "Sportwart", "Mannschaftsführer", "Kassenwart", "Elternvertreter", "Sekretariat"];

const numericDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

function appStep(appLink) {
  return appLink ? `App „Golf Trainer“ installieren: ${appLink}` : "App „Golf Trainer“ installieren, den Link dazu bekommst du von uns.";
}

/** Nachricht für WhatsApp oder Mail: Link zur App, Einladungslink und Code, wie in der App. */
export function invitationMessage({ invite, code, joinLink, teamName, club = "", appLink = null }) {
  if (!joinLink) return null;
  const steps = [
    appStep(appLink),
    "In der App unter Einstellungen → Konto ein Konto anlegen, falls du noch keins hast.",
    `Diesen Link öffnen: ${joinLink}`,
    `Beim Profil diesen Code eingeben: ${displayCode(code)}`,
  ];
  const expires = dateOf(invite.expiresAt);
  return [
    `Hallo ${invite.name},`,
    "",
    `du bist als ${inviteRoleText(invite)} in die Jugendabteilung „${teamName}“${club ? ` des ${club}` : ""} eingeladen.`,
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    `Der Code gilt nur für dich und bis ${expires ? numericDate.format(expires) : "zum Ablauf"}.`,
  ].join("\n");
}

/** Nachricht mit dem Link für Spieler, z. B. für die WhatsApp-Gruppe der Jugend. */
export function playerInvitationMessage({ joinLink, teamName, appLink = null }) {
  if (!joinLink) return null;
  const steps = [appStep(appLink), "In der App unter Einstellungen → Konto ein Konto anlegen.", `Diesen Link öffnen und das Profil anlegen: ${joinLink}`];
  return [
    "Hallo,",
    "",
    `die Jugendabteilung „${teamName}“ nutzt die App Golf Trainer: Termine mit Zu- und Absagen, Schwerpunkte und Feedback von den Trainern.`,
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Ein Trainer gibt dich danach frei.",
  ].join("\n");
}

// MARK: - Dateien für den Verein

/** CSV wie Excel sie in Deutschland erwartet: Semikolon, UTF-8 mit BOM, CRLF. */
export function csv(rows) {
  return `﻿${rows.map((row) => row.map(csvField).join(";")).join("\r\n")}\r\n`;
}

function csvField(value) {
  const text = withoutFormula(String(value ?? ""));
  if (!/[;"\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Excel und Numbers rechnen Text, der mit =, +, - oder @ beginnt, als Formel. Ein Hochkomma davor macht daraus Text. */
export function withoutFormula(value) {
  const first = value[0];
  if (first == null || !"=+-@\t\r".includes(first)) return value;
  const rest = value.slice(1);
  const isNumber = "+-".includes(first) && rest.length > 0 && /^[0-9,.]+$/.test(rest);
  if (value === "-" || isNumber) return value;
  return `'${value}`;
}

const germanDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const germanTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Anwesenheitsliste: eine Zeile pro Spieler, eine Spalte pro Termin. x = da, e = entschuldigt, - = gefehlt, / = nicht eingeladen. */
export function attendanceCSV(data, events) {
  const list = events.filter((event) => event.isCancelled !== true).sort((a, b) => stamp(a.start) - stamp(b.start));
  const rows = [["Spieler", "Gruppe", ...list.map((event) => `${germanDate.format(dateOf(event.start))} ${event.title}`), "Anwesend", "Quote"]];
  const players = data.players;
  for (const player of players) {
    let present = 0;
    let counted = 0;
    const cells = [];
    for (const event of list) {
      const status = data.attendance(player.id, event.id)?.status ?? null;
      if (status == null && !data.concerns(event.group, player.id)) {
        cells.push("/");
        continue;
      }
      if (status === "present") present += 1;
      if (status === "present" || status === "absent") counted += 1;
      cells.push(status ? (ATTENDANCE_CODES[status] ?? "") : "");
    }
    const rate = counted > 0 ? `${Math.round((present / counted) * 100)} %` : "";
    rows.push([player.name, data.group(player.id) ?? "", ...cells, String(present), rate]);
  }
  rows.push(["Anwesend gesamt", "", ...list.map((event) => String(players.filter((player) => data.attendance(player.id, event.id)?.status === "present").length)), "", ""]);
  rows.push([]);
  rows.push(["x = da, e = entschuldigt, - = gefehlt, / = nicht eingeladen"]);
  return csv(rows);
}

/** Alle Einheiten im Zeitraum: eigenes Training der Spieler und besuchte Teamtermine. */
export function trainingLogCSV(data, start, end) {
  const rows = [["Datum", "Beginn", "Spieler", "Gruppe", "Minuten", "Art", "Ort", "Bereiche", "Übungen", "Anstrengung", "Notiz"]];
  const items = feed(data, start)
    .filter((item) => item.start < end)
    .sort((a, b) => (a.start.getTime() !== b.start.getTime() ? a.start - b.start : a.memberName < b.memberName ? -1 : a.memberName > b.memberName ? 1 : 0));
  for (const item of items) {
    if (item.source.kind === "log") {
      const entry = item.source.entry;
      rows.push([
        germanDate.format(entry.start),
        germanTime.format(entry.start),
        item.memberName,
        data.group(entry.memberID) ?? "",
        String(entry.minutes),
        KIND_NAMES[entry.kind] ?? entry.kind,
        entry.place ? (PLACE_NAMES[entry.place] ?? entry.place) : "",
        sortedAreas(entry).map((area) => `${AREA_NAMES[area.area] ?? area.area} ${area.minutes}`).join(", "),
        entry.drills.map((drill) => (scoreText(drill) ? `${drill.name} (${scoreText(drill)})` : drill.name)).join(", "),
        entry.effort == null ? "" : String(entry.effort),
        entry.note,
      ]);
    } else {
      const event = item.source.event;
      rows.push([
        germanDate.format(item.start),
        germanTime.format(item.start),
        item.memberName,
        data.group(item.memberID) ?? "",
        String(Number(event.minutes) || 0),
        `Team: ${EVENT_KIND_NAMES[event.kind] ?? "Termin"}`,
        event.place ?? "",
        "",
        "",
        "",
        event.title,
      ]);
    }
  }
  return csv(rows);
}

/** Termine als iCalendar-Datei (.ics) für den Kalender auf dem Handy. */
export function teamCalendar(events, teamName, now) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Golf Trainer//Team//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(teamName)}`];
  for (const event of [...events].sort((a, b) => stamp(a.start) - stamp(b.start))) {
    const start = dateOf(event.start);
    if (!start) continue;
    const end = new Date(start.getTime() + (Number(event.minutes) || 0) * 60000);
    lines.push("BEGIN:VEVENT", `UID:${uid(event.id)}@golftrainer`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsText(event.isCancelled === true ? `Abgesagt: ${event.title}` : event.title)}`);
    if (event.place) lines.push(`LOCATION:${icsText(event.place)}`);
    const description = [EVENT_KIND_NAMES[event.kind] ?? "Termin", event.group ? `Gruppe: ${event.group}` : null, event.note ? event.note : null].filter((part) => part != null).join("\n");
    lines.push(`DESCRIPTION:${icsText(description)}`);
    if (event.isCancelled === true) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Für Dateinamen, z. B. „2026-10-01“, in der Zeitzone des Geräts. */
export function fileStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Spieler und Funktionäre in der Übersicht nach Rolle und Gruppe, in der Reihenfolge der App. */
export function groupedOverview(rows, groups) {
  const key = (item) => (item.role === "headCoach" || item.role === "coach" ? "Trainer" : item.role === "official" ? "Funktionäre" : (item.group ?? "Ohne Gruppe"));
  const grouped = new Map();
  for (const item of rows) {
    const name = key(item);
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(item);
  }
  const order = ["Trainer", "Funktionäre", ...groups, "Ohne Gruppe"];
  const keys = [...order.filter((name) => grouped.has(name)), ...[...grouped.keys()].filter((name) => !order.includes(name)).sort()];
  return keys.map((name) => ({ name, rows: grouped.get(name) }));
}

export { ROLE_NAMES, AREAS };
