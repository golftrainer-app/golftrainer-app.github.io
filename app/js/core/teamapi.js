// Anfragen an den Server für das Team (supabase/team.sql) und das Lesen der
// Antworten, wie TeamAPI im Kern der App (GolfCore/Sources/GolfCore/Team/TeamAPI.swift).
// Reine Funktionen: team.js schickt die Anfragen über den SupabaseClient ab.
// Alles läuft über die Funktionen des Servers (rpc), die Regeln prüft der Server.
import { INFO_NAME, ROLES, canonical, normalizeCode, recordName, uid } from "./team.js";
import { PULL_BATCH } from "./teamsync.js";

export const UNEXPECTED = "Die Antwort des Servers ließ sich nicht lesen.";

export class TeamAPIError extends Error {}

function url(config, path) {
  const base = config.url.endsWith("/") ? config.url.slice(0, -1) : config.url;
  return `${base}/${path}`;
}

function headers(config, session, extra = {}) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

function rpc(name, config, session, body) {
  return { method: "POST", url: url(config, `rest/v1/rpc/${name}`), headers: headers(config, session), body: JSON.stringify(body) };
}

/** Kennungen in Kleinbuchstaben, wie Postgres sie schreibt. */
const id = (value) => String(value).toLowerCase();

/** Die Anfragen, noch ohne Netz. `session` ist die Sitzung des Kontos. */
export const teamRequests = {
  /** Jugendabteilung eröffnen. Wer eröffnet, ist Admin und bekommt dazu die gewählte Rolle. */
  create: (config, session, { name, club, myName, myRole, myTitle }) =>
    rpc("team_create", config, session, { p_name: name, p_club: club, p_my_name: myName, p_my_role: myRole, p_my_title: myTitle ?? null }),
  /** Über den Link für Spieler um Aufnahme bitten. */
  join: (config, session, teamID, secret, name) => rpc("team_join", config, session, { p_team: id(teamID), p_secret: secret, p_name: name }),
  /** Einladung mit Code einlösen. Der Server prüft den Code. */
  redeemInvite: (config, session, teamID, code, name) => rpc("team_redeem_invite", config, session, { p_team: id(teamID), p_code: normalizeCode(code), p_name: name }),
  createInvite: (config, session, teamID, { role, title, name, group, grantsAdmin }) =>
    rpc("team_create_invite", config, session, { p_team: id(teamID), p_role: role, p_title: title ?? null, p_name: name, p_group: group ?? null, p_grants_admin: Boolean(grantsAdmin) }),
  /** Neuer Link für Spieler, der alte gilt danach nicht mehr. */
  newJoinLink: (config, session, teamID) => rpc("team_new_join_link", config, session, { p_team: id(teamID) }),
  /** Die eigenen Teams, z. B. für ein zweites Gerät. */
  mine: (config, session) => rpc("team_mine", config, session, {}),
  /** Team, Mitglieder, Einladungen und alle Einträge ab der Folge `since`. */
  pull: (config, session, teamID, since, batch = PULL_BATCH) => rpc("team_pull", config, session, { p_team: id(teamID), p_since: since, p_batch: batch }),
  /** Änderungen dieses Geräts (siehe `TeamSync.batch`). */
  push: (config, session, teamID, batch) =>
    rpc("team_push", config, session, {
      p_team: id(teamID),
      p_items: batch.items.map((item) => ({ name: item.name, revision: item.revision ?? null, payload: item.payload })),
      p_deletions: batch.deletions.map((deletion) => ({ name: deletion.name, revision: deletion.revision ?? null })),
    }),
  leave: (config, session, teamID, deleteMyData) => rpc("team_leave", config, session, { p_team: id(teamID), p_delete_my_data: Boolean(deleteMyData) }),
  removeMember: (config, session, teamID, memberID) => rpc("team_remove_member", config, session, { p_team: id(teamID), p_member: id(memberID) }),
  /** Die Abteilung mit allen Daten löschen. Nur wer eröffnet hat. */
  deleteTeam: (config, session, teamID) => ({
    method: "DELETE",
    url: `${url(config, "rest/v1/teams")}?id=eq.${encodeURIComponent(id(teamID))}`,
    headers: headers(config, session, { Prefer: "return=minimal" }),
    body: null,
  }),
};

// MARK: - Antworten

function object(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new TeamAPIError(UNEXPECTED);
  return json;
}

const uuid = (value) => (typeof value === "string" && /^[0-9A-Fa-f-]{36}$/.test(value) ? uid(value) : null);

export function parseCreated(json) {
  const fields = object(json);
  const teamID = uuid(fields.teamID);
  const memberID = uuid(fields.memberID);
  if (!teamID || !memberID || typeof fields.joinSecret !== "string") throw new TeamAPIError(UNEXPECTED);
  return { teamID, memberID, joinSecret: fields.joinSecret };
}

export function parseJoined(json) {
  const fields = object(json);
  const memberID = uuid(fields.memberID);
  if (!memberID || typeof fields.state !== "string") throw new TeamAPIError(UNEXPECTED);
  return { memberID, isPending: fields.state === "pending" };
}

export function parseRedeemed(json) {
  const fields = object(json);
  const memberID = uuid(fields.memberID);
  if (!memberID || !ROLES.includes(fields.role)) throw new TeamAPIError(UNEXPECTED);
  return {
    memberID,
    role: fields.role,
    title: typeof fields.title === "string" ? fields.title : null,
    group: typeof fields.group === "string" ? fields.group : null,
    isAdmin: fields.isAdmin === true,
    inviteID: uuid(fields.inviteID),
  };
}

/** Die neue Einladung, ihr Code und ihr Stand auf dem Server. */
export function parseInvite(json) {
  const fields = object(json);
  if (typeof fields.code !== "string" || !fields.invite || typeof fields.invite !== "object") throw new TeamAPIError(UNEXPECTED);
  const { revision, ...invite } = fields.invite;
  if (!uuid(invite.id)) throw new TeamAPIError(UNEXPECTED);
  return { invite, code: fields.code, revision: Number.isInteger(revision) ? revision : 1 };
}

export function parseJoinLink(json) {
  if (typeof json !== "string" || !json) throw new TeamAPIError(UNEXPECTED);
  return json;
}

export function parseTeams(json) {
  if (!Array.isArray(json)) throw new TeamAPIError(UNEXPECTED);
  const teams = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const teamID = uuid(row.teamID);
    const memberID = uuid(row.memberID);
    if (!teamID || !memberID || typeof row.name !== "string") continue;
    const status = ["active", "inactive", "removed", "pending"].includes(row.status) ? row.status : "pending";
    teams.push({ teamID, memberID, name: row.name, club: typeof row.club === "string" ? row.club : "", status });
  }
  return teams;
}

/** Eine Zeile aus Team, Profilen, Mitgliedschaften oder Einladungen als Eintrag mit Datensatznamen, ohne ihren Stand. */
function row(fields, name) {
  object(fields);
  const { revision, ...payload } = fields;
  if (!Number.isInteger(revision)) throw new TeamAPIError(UNEXPECTED);
  return { name, revision, seq: 0, payload };
}

/**
 * Antwort von `team_pull`: { me, team, joinSecret, members, memberships,
 * invites, items, more }. Team, Profile, Mitgliedschaften und Einladungen
 * kommen als Einträge mit den Datensatznamen der App (info.team,
 * member.<ID>, …), damit `TeamSync.applyPull` sie wie alle anderen zusammenführt.
 */
export function parsePull(json) {
  const fields = object(json);
  const pull = { me: uuid(fields.me), team: null, joinSecret: typeof fields.joinSecret === "string" ? fields.joinSecret : null, members: [], memberships: [], invites: [], items: [], more: fields.more === true };
  if (fields.team && typeof fields.team === "object") pull.team = row(fields.team, INFO_NAME);
  for (const member of Array.isArray(fields.members) ? fields.members : []) {
    const memberID = uuid(member?.id);
    if (memberID) pull.members.push(row(member, recordName("member", memberID)));
  }
  for (const membership of Array.isArray(fields.memberships) ? fields.memberships : []) {
    const memberID = uuid(membership?.memberID);
    if (memberID) pull.memberships.push(row(membership, recordName("membership", memberID)));
  }
  for (const invite of Array.isArray(fields.invites) ? fields.invites : []) {
    const inviteID = uuid(invite?.id);
    if (inviteID) pull.invites.push(row(invite, recordName("invite", inviteID)));
  }
  for (const item of Array.isArray(fields.items) ? fields.items : []) {
    if (!item || typeof item.name !== "string" || !Number.isInteger(item.revision)) throw new TeamAPIError(UNEXPECTED);
    const seq = Number.isSafeInteger(item.seq) ? item.seq : 0;
    const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload : null;
    pull.items.push({ name: item.name, revision: item.revision, seq, payload });
  }
  return pull;
}

const OUTCOMES = ["stored", "conflict", "missing", "denied", "invalid", "deleted"];

/** Antwort von `team_push`, ein Ergebnis je Eintrag. */
export function parsePushResult(json) {
  const fields = object(json);
  if (!Array.isArray(fields.results)) throw new TeamAPIError(UNEXPECTED);
  const entries = [];
  for (const result of fields.results) {
    if (!result || typeof result.name !== "string" || !OUTCOMES.includes(result.outcome)) throw new TeamAPIError(UNEXPECTED);
    let current = null;
    if (result.current && typeof result.current === "object" && Number.isInteger(result.current.revision)) {
      const payload = result.current.payload && typeof result.current.payload === "object" && !Array.isArray(result.current.payload) ? result.current.payload : null;
      current = { revision: result.current.revision, payload };
    }
    entries.push({
      name: result.name,
      outcome: result.outcome,
      revision: Number.isInteger(result.revision) ? result.revision : null,
      message: typeof result.message === "string" ? result.message : null,
      current,
    });
  }
  return { entries };
}

/** Fester Text eines Inhalts, z. B. für Tests. */
export { canonical };
