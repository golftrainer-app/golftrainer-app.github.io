// Das Team in der Web-App, wie TeamModels und TeamData im Kern der App
// (GolfCore/Sources/GolfCore/Team/TeamModels.swift, TeamData.swift): Rollen,
// Rechte, wer was sieht, und alle Einträge eines Teams, so wie sie vom Server
// kommen. Die Einträge bleiben hier das JSON des Servers (Zeitpunkte als
// Sekunden seit 2001, Kennungen als UUID), damit die Web-App unbekannte Felder
// unverändert weiterreicht. Reine Logik ohne Netz; Beispiele dazu schreibt der
// Swift-Test WebTeamParityTests in Fixtures/web-team.json.
import { addDays, fromStored, startOfDay, toStored } from "./dates.js";
import { decodeLogEntry } from "./model.js";

// MARK: - Rollen und Arten

export const ROLES = ["headCoach", "coach", "official", "player"];
export const ROLE_NAMES = { headCoach: "Cheftrainer", coach: "Trainer", official: "Funktionär", player: "Spieler" };
export const STATUS_NAMES = { active: "Aktiv", inactive: "Pausiert", removed: "Entfernt" };
export const EVENT_KINDS = ["training", "tournament", "match", "meeting", "other"];
export const EVENT_KIND_NAMES = { training: "Training", tournament: "Turnier", match: "Mannschaftsspiel", meeting: "Treffen", other: "Termin" };
export const ANSWERS = ["yes", "maybe", "no"];
export const ANSWER_NAMES = { yes: "Zusage", maybe: "Vielleicht", no: "Absage" };
export const ATTENDANCE_STATUSES = ["present", "excused", "absent"];
export const ATTENDANCE_NAMES = { present: "Da", excused: "Entschuldigt", absent: "Gefehlt" };
/** Kürzel für die Anwesenheitsliste. */
export const ATTENDANCE_CODES = { present: "x", excused: "e", absent: "-" };
export const SESSION_STATE_NAMES = { upcoming: "Kommt noch", open: "Offen", overdue: "Überfällig", done: "Erledigt" };
export const FOCUS_PRIORITY_NAMES = { 1: "Normal", 2: "Wichtig", 3: "Sehr wichtig" };

/** Felder, die ein Editor ändern darf. Alles andere bleibt, wie es gerade ist (siehe `applyingEdits`). */
export const EVENT_FIELDS = ["kind", "title", "start", "minutes", "place", "note", "group", "drillIDs", "asksForResponse", "isCancelled"];
export const ANNOUNCEMENT_FIELDS = ["title", "text", "group", "isPinned"];
export const CHALLENGE_FIELDS = ["title", "text", "drillID", "start", "end", "group"];
export const FOCUS_FIELDS = ["text", "area", "priority", "drillIDs", "isActive"];
export const SESSION_FIELDS = ["title", "text", "drills", "start", "due"];

/**
 * Bearbeiten, ohne Änderungen anderer zu überschreiben, wie TeamEdits im Kern:
 * Vom Editor kommt nur, was dort wirklich geändert wurde (`edited` gegenüber
 * `original`), alles andere bleibt wie im aktuellen Stand `current`.
 */
export function applyingEdits(current, edited, original, fields) {
  const result = { ...current };
  for (const field of fields) {
    if (canonical(edited[field] ?? null) === canonical(original[field] ?? null)) continue;
    if (edited[field] == null) delete result[field];
    else result[field] = clone(edited[field]);
  }
  return result;
}

/** Stand einer Einheit vom Trainer: done, upcoming, overdue oder open. `doneDrillIDs` ist ein Set. */
export function sessionState(session, doneDrillIDs, now) {
  const drills = Array.isArray(session.drills) ? session.drills : [];
  if (drills.length > 0 && drills.every((item) => doneDrillIDs.has(item.drillID))) return "done";
  const start = dateOf(session.start ?? session.createdAt);
  if (start && now < startOfDay(start)) return "upcoming";
  const due = dateOf(session.due);
  if (due && now >= addDays(startOfDay(due), 1)) return "overdue";
  return "open";
}

export const sessionTotalMinutes = (session) => (Array.isArray(session.drills) ? session.drills : []).reduce((total, item) => total + (Number(item.minutes) || 0), 0);

/** Die 16 Bytes einer UUID, wie `uuid_t` in der App. */
function uuidBytes(value) {
  const hex = String(value).replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TeamDataError(`Keine Kennung: ${value}`);
  return Array.from({ length: 16 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function formatUUID(bytes) {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Feste Kennung für den Eintrag eines Spielers in einer Zuweisung, wie
 * `CoachSession.id(planID:memberID:)` im Kern: FNV-1a über beide Kennungen,
 * zweimal mit verschiedenem Anfang für 128 Bit. Geben zwei Trainer demselben
 * Spieler gleichzeitig dieselbe Einheit, entsteht so ein Eintrag statt zwei.
 */
export function sessionIDFor(planID, memberID) {
  const bytes = [...uuidBytes(planID), ...uuidBytes(memberID)];
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  const fnv = (list, seed) => list.reduce((hash, byte) => ((hash ^ BigInt(byte)) * prime) & mask, seed);
  const high = fnv(bytes, 0xcbf29ce484222325n);
  const low = fnv([...bytes].reverse(), 0x84222325cbf29ce4n);
  const bigEndian = (value) => Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 8)) & 0xffn));
  const result = [...bigEndian(high), ...bigEndian(low)];
  // Version 8 (eigenes Verfahren) und Variante nach RFC 9562.
  result[6] = (result[6] & 0x0f) | 0x80;
  result[8] = (result[8] & 0x3f) | 0x80;
  return formatUUID(result);
}

/** Beginn und Frist einer Einheit sind Kalendertage, gespeichert um 12 Uhr an diesem Tag. */
export function sessionDay(date) {
  const day = startOfDay(date);
  day.setHours(12, 0, 0, 0);
  return day;
}

/** Inhalt einer Zuweisung: der zuletzt geänderte Eintrag. */
export function assignmentContent(sessions) {
  return sessions.reduce((best, session) => (best == null || stamp(session.updatedAt) > stamp(best.updatedAt) ? session : best), null);
}

/** Trainer sehen die Trainingsdaten der Spieler und geben Feedback. */
export const isCoachRole = (role) => role === "headCoach" || role === "coach";
/** Alle außer Spielern: Trainer und Funktionäre. */
export const isStaffRole = (role) => role != null && ROLES.includes(role) && role !== "player";

/** Was eine Rolle von den privaten Einträgen anderer sehen darf. */
export function roleAccess(role) {
  switch (role) {
    case "headCoach":
    case "coach":
      return "everything";
    case "official":
      return "organization";
    default:
      return "own";
  }
}

export const ACCESS_RANK = { own: 0, organization: 1, everything: 2 };

/** Arten von Einträgen. Der Name ist der Anfang des Datensatznamens. */
export const KINDS = [
  "info", "member", "membership", "details", "log", "event", "response", "attendance", "announcement", "challenge",
  "stats", "focus", "comment", "clip", "round", "snapshot", "invite", "session", "progress", "report",
];
/** Private Einträge sehen nur der Spieler selbst und die Trainer. */
export const PRIVATE_KINDS = new Set(["details", "log", "attendance", "focus", "comment", "clip", "round", "snapshot", "session", "progress", "report"]);
/** Private Einträge, die auch Funktionäre für die Organisation brauchen. */
export const ORGANIZATIONAL_KINDS = new Set(["details", "attendance"]);
/** Team, Profile, Mitgliedschaften und Einladungen kommen beim Abgleich immer ganz, nicht als Einträge mit Folge. */
export const TABLE_KINDS = new Set(["info", "member", "membership", "invite"]);

export const INFO_KEY = "team";
export const INFO_NAME = "info.team";
/** Die leere Kennung: Eröffner ohne Konto, Tagebuch ohne Team. */
export const ZERO_ID = "00000000-0000-0000-0000-000000000000";

const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** Kennung in Großbuchstaben, wie die App sie schreibt. Der Server schreibt sie klein. */
export const uid = (value) => (value == null ? null : String(value).toUpperCase());
export const isUUID = (value) => typeof value === "string" && UUID_RE.test(value);
export const sameID = (a, b) => a != null && b != null && uid(a) === uid(b);

export function recordName(kind, key) {
  return `${kind}.${key}`;
}

export function parseRecordName(name) {
  const dot = String(name).indexOf(".");
  if (dot < 0) return null;
  const kind = name.slice(0, dot);
  const key = name.slice(dot + 1);
  if (!KINDS.includes(kind) || !key) return null;
  return { kind, key };
}

/** Schlüssel „Termin_Mitglied“ für Zu- und Absagen und die Anwesenheit. */
export function pairKey(eventID, memberID) {
  return `${uid(eventID)}_${uid(memberID)}`;
}

/** Einträge in team_items, im Gegensatz zu Team, Profilen, Mitgliedschaften und Einladungen. */
export function isItemName(name) {
  const parsed = parseRecordName(name);
  return parsed != null && !TABLE_KINDS.has(parsed.kind);
}

/** Schlüssel eines Eintrags aus seinem Inhalt, wie `set` in TeamData der App. */
export function keyFor(kind, payload) {
  switch (kind) {
    case "info":
      return INFO_KEY;
    case "member":
      return uid(payload.id);
    case "membership":
    case "details":
    case "stats":
    case "snapshot":
      return uid(payload.memberID);
    case "log":
      return String(payload.id);
    case "response":
    case "attendance":
      return pairKey(payload.eventID, payload.memberID);
    case "round":
      return uid(payload.round?.id);
    case "progress":
      return uid(payload.sessionID);
    default:
      return uid(payload.id);
  }
}

/** Wem ein privater Eintrag gehört; bei Meldungen, wer gemeldet hat. */
export function ownerOf(kind, key, payload) {
  switch (kind) {
    case "details":
    case "stats":
    case "snapshot":
      return uid(payload?.memberID ?? key);
    case "log":
    case "response":
    case "attendance":
    case "focus":
    case "comment":
    case "clip":
    case "round":
    case "session":
    case "progress":
    case "report":
      return uid(payload?.memberID);
    default:
      return null;
  }
}

// MARK: - JSON

/**
 * Fester Text für einen Eintrag: Schlüssel sortiert, null und fehlende Felder
 * gleich. So erkennt die Web-App echte Änderungen, wie `TeamData.encode` mit
 * sortierten Schlüsseln in der App, wo ein fehlendes Feld nil ist.
 */
export function canonical(value) {
  return JSON.stringify(normalize(value));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map((item) => (item == null ? null : normalize(item)));
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] == null) continue;
      result[key] = normalize(value[key]);
    }
    return result;
  }
  return value;
}

/** Zeitpunkt eines Eintrags als Zahl, fehlend oder unlesbar zählt als uralt. */
export function stamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const time = toStored(fromStored(value));
    return Number.isFinite(time) ? time : -Infinity;
  }
  return -Infinity;
}

export const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

// MARK: - Wer schaut

/** Sieht alles, wie ein Trainer, der auch Admin ist. */
export const COACH_VIEWER = Object.freeze({ memberID: null, access: "everything", isAdmin: true });

/**
 * Darf der Betrachter einen Eintrag dieser Art sehen, der `memberID` gehört?
 * Öffentliche Arten immer. Meldungen haben eigene Regeln (`canSeeReport`).
 */
export function canSee(viewer, kind, memberID) {
  if (!PRIVATE_KINDS.has(kind)) return true;
  const isOwn = memberID != null && viewer.memberID != null && sameID(memberID, viewer.memberID);
  if (kind === "report") return Boolean(viewer.isAdmin) || isOwn;
  switch (viewer.access) {
    case "everything":
      return true;
    case "organization":
      return ORGANIZATIONAL_KINDS.has(kind) || isOwn;
    default:
      return isOwn;
  }
}

/** Eine Meldung sehen, wer gemeldet hat, und die Admins, nie das gemeldete Mitglied. */
export function canSeeReport(viewer, report) {
  if (viewer.memberID != null && sameID(report.memberID, viewer.memberID)) return true;
  if (!viewer.isAdmin) return false;
  return viewer.memberID == null || report.reportedMemberID == null || !sameID(report.reportedMemberID, viewer.memberID);
}

// MARK: - Persönliche Angaben

/** Unter 16 braucht die Einwilligung die Eltern. Ohne Jahrgang zählt wie unter 16. */
export function needsParentalConsent(birthYear, year) {
  return birthYear == null ? true : year - birthYear <= 16;
}

/** „AK 12“ bis „AK 18“, nach dem Alter, das man im Kalenderjahr erreicht. */
export function ageClassLabel(birthYear, year) {
  const age = year - birthYear;
  if (age <= 12) return "AK 12";
  if (age <= 14) return "AK 14";
  if (age <= 16) return "AK 16";
  if (age <= 18) return "AK 18";
  return "Erwachsene";
}

/** Fehlt noch das Einverständnis der Eltern? */
export function detailsNeedConsent(details, year) {
  if (details?.consent != null) return false;
  return needsParentalConsent(details?.birthYear ?? null, year);
}

export const NOTHING_SHARED = Object.freeze({ trainingLog: false, drillResults: false, rounds: false, distances: false, leaderboards: false });

/** Freigaben mit allen fünf Schaltern, wie SharingSettings in der App. */
export function sharingOf(value) {
  return {
    trainingLog: value?.trainingLog === true,
    drillResults: value?.drillResults === true,
    rounds: value?.rounds === true,
    distances: value?.distances === true,
    leaderboards: value?.leaderboards === true,
  };
}

/** Punkte gibt es nur zusammen mit dem Training. */
export function effectiveSharing(value) {
  const sharing = sharingOf(value);
  sharing.drillResults = sharing.trainingLog && sharing.drillResults;
  return sharing;
}

export function isNothingShared(value) {
  return !Object.values(sharingOf(value)).some(Boolean);
}

/** Teilt dieses Gerät das Training? Solange keins festgelegt ist, das erste. */
export function isSharingDevice(details, deviceID) {
  return details?.sharingDevice?.id ? details.sharingDevice.id === deviceID : true;
}

/**
 * Zwei Stände desselben Mitglieds: der jüngere, aber Freigaben und
 * Einverständnis aus dem Stand, in dem sie zuletzt geändert wurden.
 */
export function mergeDetails(local, incoming) {
  const localIsNewer = stamp(local.updatedAt) > stamp(incoming.updatedAt);
  const result = { ...(localIsNewer ? local : incoming) };
  const other = localIsNewer ? incoming : local;
  const consentTime = (details) => stamp(details.consentUpdatedAt ?? details.privacyUpdatedAt);
  const otherSharingIsNewer = stamp(other.privacyUpdatedAt) > stamp(result.privacyUpdatedAt);
  const otherConsentIsNewer = consentTime(other) > consentTime(result);
  if (otherSharingIsNewer) {
    assign(result, "sharing", other.sharing);
    assign(result, "privacyUpdatedAt", other.privacyUpdatedAt);
  }
  if (otherConsentIsNewer) {
    assign(result, "consent", other.consent);
    assign(result, "consentUpdatedAt", other.consentUpdatedAt);
  }
  return result;
}

/** Feld setzen oder weglassen, wie ein nil in der App. */
function assign(target, key, value) {
  if (value == null) delete target[key];
  else target[key] = clone(value);
}

// MARK: - Einladungen

/** Zeichen ohne Verwechslungsgefahr: kein I, L, O, 0 und 1. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

/** Eingabe vereinheitlichen: Großbuchstaben, ohne Leerzeichen und Bindestriche. */
export function normalizeCode(code) {
  return String(code ?? "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function isCode(normalized) {
  return normalized.length === CODE_LENGTH && [...normalized].every((character) => CODE_ALPHABET.includes(character));
}

/** Zum Lesen und Abtippen in zwei Gruppen: „K7P3-QXMB“. */
export function displayCode(code) {
  const normalized = normalizeCode(code);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/**
 * Code aus eingefügtem Text, z. B. der ganzen Einladung aus WhatsApp. Gesucht
 * wird die Schreibweise mit Bindestrich in der Mitte („K7P3-QXMB“). Links
 * zählen nicht. Bei mehreren gilt der letzte. Ist der Text selbst ein Code,
 * zählt er auch so.
 */
export function extractCode(text) {
  let found = null;
  for (const word of String(text ?? "").split(/\s+/u)) {
    if (!word) continue;
    const lowered = word.toLowerCase();
    if (lowered.includes("://") || lowered.startsWith("www.")) continue;
    for (const part of word.split(/[^\p{L}\p{N}-]+/u)) {
      if (!part.includes("-")) continue;
      const groups = part.split("-");
      const normalized = normalizeCode(part);
      if (groups.length === 2 && groups[0].length === groups[1].length && isCode(normalized)) found = normalized;
    }
  }
  if (found) return found;
  const whole = normalizeCode(text);
  return isCode(whole) ? whole : null;
}

export function inviteIsOpen(invite, now) {
  return invite.usedBy == null && stamp(now instanceof Date ? toStored(now) : now) < stamp(invite.expiresAt);
}

/** Rolle mit Titel, z. B. „Trainer“ oder „Jugendwart“. */
export function inviteRoleText(invite) {
  return invite.title ? invite.title : (ROLE_NAMES[invite.role] ?? invite.role);
}

// MARK: - Links

export const WEB_APP = "https://golftrainer-app.github.io/app/";
export const APP_SCHEME = "golftrainer";

/** Zum Beispiel „https://golftrainer-app.github.io/app/#/team/beitreten/<Team>/<Geheimnis>“. */
export function joinLink(teamID, secret) {
  return `${WEB_APP}#/team/beitreten/${String(teamID).toLowerCase()}/${secret}`;
}

/** Derselbe Beitritt als Link, der die App direkt öffnet. */
export function appJoinLink(teamID, secret) {
  return `${APP_SCHEME}://team/beitreten/${String(teamID).toLowerCase()}/${secret}`;
}

/** Team und Geheimnis aus einem Link (Web-App oder App) oder einem Text, der ihn enthält. */
export function parseJoinLink(text) {
  const marker = "/team/beitreten/";
  const source = String(text ?? "");
  const index = source.indexOf(marker);
  if (index < 0) return null;
  const parts = source
    .slice(index + marker.length)
    .split(/[/\s?&]+/u)
    .filter(Boolean);
  if (parts.length < 2 || !isUUID(parts[0])) return null;
  const secret = parts[1];
  if (secret.length < 16 || secret.length > 64 || !/^[\p{L}\p{N}_-]+$/u.test(secret)) return null;
  return { teamID: parts[0].toUpperCase(), secret };
}

// MARK: - Daten eines Teams

export class TeamDataError extends Error {}

/** Beim Vergleich zweier Namen: Groß- und Kleinschreibung wie in der App. */
const byName = (a, b) => String(a).localeCompare(String(b), "de", { sensitivity: "base" });

/**
 * Alle Einträge eines Teams, nach Datensatznamen, jeder als JSON des Servers.
 * Bei zwei Ständen gewinnt der jüngere. Private Einträge anderer Spieler
 * bleiben nicht auf dem Gerät.
 */
export class TeamData {
  constructor(items = {}) {
    this.items = new Map(Object.entries(items ?? {}).filter(([name, payload]) => parseRecordName(name) && payload && typeof payload === "object"));
  }

  static fromJSON(json) {
    return new TeamData(json && typeof json === "object" ? json : {});
  }

  toJSON() {
    return Object.fromEntries(this.items);
  }

  get(name) {
    return this.items.get(name) ?? null;
  }

  has(name) {
    return this.items.has(name);
  }

  /** Inhalt als fester Text für den Upload und Vergleiche, null wenn es den Eintrag nicht gibt. */
  payload(name) {
    const item = this.items.get(name);
    return item ? canonical(item) : null;
  }

  /** Alle Datensätze auf diesem Gerät, sortiert. */
  allRecordNames() {
    return [...this.items.keys()].sort();
  }

  /** Einträge einer Art als [Schlüssel, Inhalt]. */
  entries(kind) {
    const prefix = `${kind}.`;
    const result = [];
    for (const [name, payload] of this.items) {
      if (name.startsWith(prefix)) result.push([name.slice(prefix.length), payload]);
    }
    return result;
  }

  values(kind) {
    return this.entries(kind).map(([, payload]) => payload);
  }

  /** Eintrag speichern, der Name folgt aus dem Inhalt. Gibt den Datensatznamen zurück. */
  put(kind, payload) {
    const name = recordName(kind, keyFor(kind, payload));
    this.items.set(name, clone(payload));
    return name;
  }

  remove(name) {
    this.items.delete(name);
  }

  /**
   * Übernimmt einen Datensatz vom Server. Ergebnis: stored (neu oder jünger),
   * keptLocal (der lokale Stand ist jünger), unchanged, merged (beide Stände
   * zusammengeführt, siehe `mergeDetails`) oder hidden (privater Eintrag
   * eines anderen Mitglieds, mit `memberID`).
   */
  apply(name, payload, viewer) {
    const parsed = parseRecordName(name);
    if (!parsed) throw new TeamDataError(`Unbekannter Datensatz: ${name}`);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TeamDataError(`Unlesbar: ${name}`);
    const { kind, key } = parsed;
    if (kind === "log") {
      // Grenzen wie bei einer fremden Sicherung: unmögliche Werte lesen sich nicht.
      try {
        decodeLogEntry(payload);
      } catch {
        throw new TeamDataError(`Unlesbar: ${name}`);
      }
    }
    if (kind === "report") {
      if (!canSeeReport(viewer, payload)) return { outcome: "hidden", memberID: uid(payload.memberID) };
    } else if (PRIVATE_KINDS.has(kind)) {
      const owner = ownerOf(kind, key, payload);
      if (!canSee(viewer, kind, owner)) return { outcome: "hidden", memberID: owner };
    }
    const existing = this.items.get(name) ?? null;
    if (kind === "details") return this.mergeDetails(name, existing, payload);
    if (!existing) {
      this.items.set(name, clone(payload));
      return { outcome: "stored" };
    }
    if (canonical(existing) === canonical(payload)) return { outcome: "unchanged" };
    if (stamp(existing.updatedAt) > stamp(payload.updatedAt)) return { outcome: "keptLocal" };
    this.items.set(name, clone(payload));
    return { outcome: "stored" };
  }

  /** Wie `apply`, aber Einverständnis und Freigaben nach ihrem eigenen Zeitpunkt. */
  mergeDetails(name, existing, incoming) {
    if (!existing) {
      this.items.set(name, clone(incoming));
      return { outcome: "stored" };
    }
    const incomingText = canonical(incoming);
    if (canonical(existing) === incomingText) return { outcome: "unchanged" };
    const result = mergeDetails(existing, incoming);
    const resultText = canonical(result);
    if (resultText === incomingText) {
      this.items.set(name, clone(incoming));
      return { outcome: "stored" };
    }
    if (resultText === canonical(existing)) return { outcome: "keptLocal" };
    result.updatedAt = Math.max(stamp(existing.updatedAt), stamp(incoming.updatedAt)) + 0.001;
    this.items.set(name, result);
    return { outcome: "merged" };
  }

  /**
   * Entfernt private Einträge, die der Betrachter nicht sehen darf, z. B.
   * wenn ein Trainer Spieler wird. Gibt die entfernten Namen mit dem
   * Mitglied zurück, dem sie gehören.
   */
  removeHidden(viewer) {
    const removed = {};
    for (const [key, report] of this.entries("report")) {
      if (canSeeReport(viewer, report)) continue;
      const name = recordName("report", key);
      removed[name] = uid(report.memberID);
      this.items.delete(name);
    }
    if (viewer.access === "everything") return removed;
    for (const [name, payload] of [...this.items]) {
      const parsed = parseRecordName(name);
      if (!parsed || parsed.kind === "report" || !PRIVATE_KINDS.has(parsed.kind)) continue;
      const owner = ownerOf(parsed.kind, parsed.key, payload);
      if (canSee(viewer, parsed.kind, owner)) continue;
      removed[name] = owner;
      this.items.delete(name);
    }
    return removed;
  }

  /** Alles, was zu einem Mitglied gehört, z. B. zum Löschen beim Austritt. */
  recordNamesOfMember(memberID, { includingProfile = true, includingReports = true } = {}) {
    const id = uid(memberID);
    const names = [];
    for (const [name, payload] of this.items) {
      const parsed = parseRecordName(name);
      if (!parsed) continue;
      switch (parsed.kind) {
        case "member":
        case "membership":
          if (includingProfile && sameID(parsed.key, id)) names.push(name);
          break;
        case "report":
          if (includingReports && sameID(payload.memberID, id)) names.push(name);
          break;
        case "invite":
          if (payload.usedBy != null && sameID(payload.usedBy, id)) names.push(name);
          break;
        case "info":
        case "event":
        case "announcement":
        case "challenge":
          break;
        default:
          if (sameID(ownerOf(parsed.kind, parsed.key, payload), id)) names.push(name);
      }
    }
    return names.sort();
  }

  /**
   * Was von entfernten Mitgliedern noch im Team liegt. `hidden` sind private
   * Datensätze, die dieses Gerät nur dem Namen nach kennt. Meldungen bleiben.
   */
  leftoverRecordNames(hidden = {}) {
    const owner = this.info?.ownerMemberID;
    const removed = new Set(
      this.values("membership")
        .filter((membership) => membership.status === "removed" && !(owner != null && sameID(membership.memberID, owner)))
        .map((membership) => uid(membership.memberID)),
    );
    if (removed.size === 0) return [];
    const names = new Set();
    for (const [name, memberID] of Object.entries(hidden)) {
      if (removed.has(uid(memberID)) && parseRecordName(name)?.kind !== "report") names.add(name);
    }
    for (const id of removed) {
      for (const name of this.recordNamesOfMember(id, { includingProfile: false, includingReports: false })) names.add(name);
    }
    return [...names].sort();
  }

  // MARK: Mitglieder

  get info() {
    return this.items.get(INFO_NAME) ?? null;
  }

  member(memberID) {
    return memberID == null ? null : (this.items.get(recordName("member", uid(memberID))) ?? null);
  }

  membership(memberID) {
    return memberID == null ? null : (this.items.get(recordName("membership", uid(memberID))) ?? null);
  }

  details(memberID) {
    return memberID == null ? null : (this.items.get(recordName("details", uid(memberID))) ?? null);
  }

  get members() {
    return this.values("member");
  }

  isOwner(memberID) {
    const owner = this.info?.ownerMemberID;
    return memberID != null && owner != null && sameID(owner, memberID);
  }

  /** Rolle eines Mitglieds. Wer eröffnet hat, behält immer eine, ohne Angabe Cheftrainer. */
  role(memberID) {
    if (memberID == null) return null;
    if (this.isOwner(memberID)) return this.membership(memberID)?.role ?? "headCoach";
    const membership = this.membership(memberID);
    if (!membership || membership.status === "removed") return null;
    return membership.role ?? null;
  }

  isCoach(memberID) {
    return isCoachRole(this.role(memberID));
  }

  isStaff(memberID) {
    return isStaffRole(this.role(memberID));
  }

  /** Admin: wer eröffnet hat und wem ein Admin das Recht gegeben hat. Spieler nie. */
  isAdmin(memberID) {
    if (memberID == null) return false;
    if (this.isOwner(memberID)) return true;
    const membership = this.membership(memberID);
    if (!membership || membership.status === "removed") return false;
    return membership.isAdmin === true && membership.role !== "player";
  }

  access(memberID) {
    const role = this.role(memberID);
    return role ? roleAccess(role) : "own";
  }

  /** Rolle zum Anzeigen, z. B. „Jugendwart · Admin“ oder „Trainer“. */
  roleText(memberID) {
    const role = this.role(memberID);
    if (!role) return null;
    const base = this.title(memberID) ?? ROLE_NAMES[role] ?? role;
    return this.isAdmin(memberID) ? `${base} · Admin` : base;
  }

  /** Rollen, die dieses Mitglied vergeben darf. */
  assignableRoles(actorID) {
    if (this.isAdmin(actorID)) return [...ROLES];
    switch (this.role(actorID)) {
      case "headCoach":
        return ["coach", "official", "player"];
      case "coach":
        return ["player"];
      default:
        return [];
    }
  }

  /** Darf `actorID` dieses Mitglied freigeben, ändern oder entfernen? */
  canManage(memberID, actorID) {
    if (memberID == null || actorID == null || sameID(memberID, actorID) || this.isOwner(memberID)) return false;
    if (this.isAdmin(actorID)) return true;
    if (this.isAdmin(memberID)) return false;
    const current = this.membership(memberID)?.role ?? "player";
    return this.assignableRoles(actorID).includes(current);
  }

  canEditSettings(memberID) {
    return this.isAdmin(memberID) || this.role(memberID) === "headCoach";
  }

  /** Bezeichnung, z. B. „Jugendwart“. Nur Funktionäre haben eine. */
  title(memberID) {
    const membership = this.membership(memberID);
    if (!membership || this.role(memberID) !== "official") return null;
    return membership.title ? membership.title : null;
  }

  status(memberID) {
    if (this.isOwner(memberID)) return "active";
    return this.membership(memberID)?.status ?? null;
  }

  /** Hat ein Profil, aber noch keine Freigabe. */
  isPending(memberID) {
    return this.member(memberID) != null && !this.isOwner(memberID) && this.membership(memberID) == null;
  }

  group(memberID) {
    return this.membership(memberID)?.group ?? null;
  }

  name(memberID) {
    return this.member(memberID)?.name ?? "Unbekannt";
  }

  /** Aktive und pausierte Mitglieder, nach Namen sortiert. */
  get roster() {
    return this.members.filter((member) => this.role(member.id) != null).sort((a, b) => byName(a.name, b.name));
  }

  get players() {
    return this.roster.filter((member) => this.role(member.id) === "player");
  }

  get activePlayers() {
    return this.players.filter((member) => this.status(member.id) === "active");
  }

  get coaches() {
    return this.roster.filter((member) => this.isCoach(member.id));
  }

  get officials() {
    return this.roster.filter((member) => this.role(member.id) === "official");
  }

  /** Beitrittsanfragen, älteste zuerst. */
  get pendingMembers() {
    return this.members.filter((member) => this.isPending(member.id)).sort((a, b) => stamp(a.joinedAt) - stamp(b.joinedAt));
  }

  /** Gilt ein Termin, eine Nachricht oder eine Challenge für dieses Mitglied? Trainer und Funktionäre sehen alles. */
  concerns(group, memberID) {
    if (!group) return true;
    return this.isStaff(memberID) || this.group(memberID) === group;
  }

  // MARK: Einladungen

  /** Eine Einladung gilt nur, solange wer sie erstellt hat, die Rolle noch vergeben darf. */
  isBackedByCreator(invite) {
    if (!this.assignableRoles(invite.createdBy).includes(invite.role)) return false;
    return !invite.grantsAdmin || this.isAdmin(invite.createdBy);
  }

  /** Einladungen, neueste zuerst. */
  get sortedInvites() {
    return this.values("invite").sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
  }

  /** Spieler, die zu einem Termin eingeladen sind. Pausierte nur, wenn sie geantwortet haben. */
  invitedPlayers(event) {
    return this.players.filter((player) => {
      if (!this.concerns(event.group, player.id)) return false;
      return this.status(player.id) === "active" || this.response(player.id, event.id) != null;
    });
  }

  // MARK: Abfragen

  response(memberID, eventID) {
    return this.items.get(recordName("response", pairKey(eventID, memberID))) ?? null;
  }

  attendance(memberID, eventID) {
    return this.items.get(recordName("attendance", pairKey(eventID, memberID))) ?? null;
  }

  /** Tagebuch eines Mitglieds, neueste Einheit zuerst. */
  logs(memberID) {
    return this.values("log")
      .filter((entry) => sameID(entry.memberID, memberID))
      .sort((a, b) => stamp(b.start) - stamp(a.start));
  }

  /** Aktive Schwerpunkte vom Trainer, wichtigste zuerst. */
  activeFocus(memberID) {
    return this.values("focus")
      .filter((item) => sameID(item.memberID, memberID) && item.isActive !== false)
      .sort((a, b) => (a.priority !== b.priority ? (b.priority ?? 2) - (a.priority ?? 2) : stamp(b.createdAt) - stamp(a.createdAt)));
  }

  /** Verlauf mit einem Spieler, älteste Nachricht zuerst, ohne blockierte Absender. */
  comments(memberID, { clipID = null, hiding = new Set() } = {}) {
    return this.values("comment")
      .filter((comment) => sameID(comment.memberID, memberID) && (clipID == null || sameID(comment.clipID, clipID)) && !hiding.has(uid(comment.authorID)))
      .sort((a, b) => stamp(a.date) - stamp(b.date));
  }

  /** Runden eines Mitglieds, neueste zuerst. */
  rounds(memberID) {
    return this.values("round")
      .filter((share) => sameID(share.memberID, memberID))
      .map((share) => share.round)
      .filter(Boolean)
      .sort((a, b) => stamp(b.date) - stamp(a.date));
  }

  /** Termine ab `date`, nächster zuerst. Abgesagte bleiben sichtbar. */
  upcomingEvents(date, memberID = null) {
    const from = toStored(date);
    return this.values("event")
      .filter((event) => eventEnd(event) >= from && (memberID == null || this.concerns(event.group, memberID)))
      .sort((a, b) => stamp(a.start) - stamp(b.start));
  }

  pastEvents(date, memberID = null) {
    const before = toStored(date);
    return this.values("event")
      .filter((event) => eventEnd(event) < before && (memberID == null || this.concerns(event.group, memberID)))
      .sort((a, b) => stamp(b.start) - stamp(a.start));
  }

  event(eventID) {
    return eventID == null ? null : (this.items.get(recordName("event", uid(eventID))) ?? null);
  }

  /** Pinnwand: angeheftete zuerst, dann die neuesten, ohne blockierte Absender. */
  announcements(memberID = null, hiding = new Set()) {
    return this.values("announcement")
      .filter((item) => (memberID == null || this.concerns(item.group, memberID)) && !hiding.has(uid(item.authorID)))
      .sort((a, b) => {
        const pinnedA = a.isPinned === true;
        const pinnedB = b.isPinned === true;
        if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
        return stamp(b.date) - stamp(a.date);
      });
  }

  challenges(memberID = null) {
    return this.values("challenge")
      .filter((item) => memberID == null || this.concerns(item.group, memberID))
      .sort((a, b) => stamp(b.end) - stamp(a.end));
  }

  challenge(id) {
    return id == null ? null : (this.items.get(recordName("challenge", uid(id))) ?? null);
  }

  /** Einheiten vom Trainer für einen Spieler: nächste Frist zuerst, ohne Frist zuletzt. */
  sessions(memberID) {
    return this.values("session")
      .filter((session) => sameID(session.memberID, memberID))
      .sort((a, b) => {
        const left = a.due == null ? Infinity : stamp(a.due);
        const right = b.due == null ? Infinity : stamp(b.due);
        return left !== right ? left - right : stamp(b.start ?? b.createdAt) - stamp(a.start ?? a.createdAt);
      });
  }

  session(id) {
    return id == null ? null : (this.items.get(recordName("session", uid(id))) ?? null);
  }

  progress(sessionID) {
    return sessionID == null ? null : (this.items.get(recordName("progress", uid(sessionID))) ?? null);
  }

  /** Fehlt bei einem Spieler das Einverständnis der Eltern? Ohne Angaben: ja. */
  needsConsent(memberID, year) {
    const details = this.details(memberID);
    return details ? detailsNeedConsent(details, year) : true;
  }

  /** Teilt der Spieler sein Training mit den Trainern? */
  sharesTraining(memberID, year) {
    const details = this.details(memberID);
    if (!details) return false;
    return details.sharing?.trainingLog === true && !detailsNeedConsent(details, year);
  }

  /** Meldungen, offene zuerst, darin die neuesten zuerst. */
  get sortedReports() {
    return this.values("report").sort((a, b) => {
      const openA = a.resolvedAt == null;
      const openB = b.resolvedAt == null;
      if (openA !== openB) return openA ? -1 : 1;
      return stamp(b.createdAt) - stamp(a.createdAt);
    });
  }

  /** Was mit einem gemeldeten Inhalt verschwindet: zu einem Termin die Antworten und die Anwesenheit. */
  recordNamesRemovedWith(name) {
    const parsed = parseRecordName(name);
    if (!parsed) return [];
    const names = [name];
    if (parsed.kind === "event") {
      for (const [key, payload] of this.entries("response")) if (sameID(payload.eventID, parsed.key)) names.push(recordName("response", key));
      for (const [key, payload] of this.entries("attendance")) if (sameID(payload.eventID, parsed.key)) names.push(recordName("attendance", key));
    } else if (parsed.kind === "clip") {
      for (const [key, payload] of this.entries("comment")) if (sameID(payload.clipID, parsed.key)) names.push(recordName("comment", key));
    }
    return names.sort();
  }

  // MARK: - Einheiten für Trainer

  /** Übungen mit Ergebnis in einer Einheit, aus dem Stand des Spielers. */
  doneDrillIDs(sessionID) {
    const progress = this.progress(sessionID);
    return new Set((Array.isArray(progress?.done) ? progress.done : []).map((drill) => drill.drillID));
  }

  /**
   * Einheiten eines Spielers mit Stand, für die Trainer: erst die laufenden
   * (nächste Frist vorne), dann die überfälligen (zuletzt abgelaufene vorne),
   * dann was noch kommt, zuletzt die erledigten, neueste zuerst.
   */
  sessionsForCoach(memberID, now) {
    const order = { open: 0, overdue: 1, upcoming: 2, done: 3 };
    return this.sessions(memberID)
      .map((session, index) => ({ session, state: sessionState(session, this.doneDrillIDs(session.id), now), index }))
      .sort((a, b) => {
        const left = order[a.state] ?? 4;
        const right = order[b.state] ?? 4;
        if (left !== right) return left - right;
        const x = a.session;
        const y = b.session;
        if (a.state === "overdue" && stamp(x.due) !== stamp(y.due)) return stamp(y.due) - stamp(x.due);
        if (a.state === "upcoming" && stamp(x.start) !== stamp(y.start)) return stamp(x.start) - stamp(y.start);
        if (a.state === "done" && stamp(x.start) !== stamp(y.start)) return stamp(y.start) - stamp(x.start);
        return a.index - b.index;
      })
      .map(({ session, state }) => ({ session, state }));
  }

  /** Eine Zuweisung: dieselbe Einheit an mehrere Spieler, nach Namen sortiert. */
  makeAssignment(planID, sessions) {
    const sorted = [...sessions].sort((a, b) => this.name(a.memberID).localeCompare(this.name(b.memberID), "de", { sensitivity: "base" }));
    return { planID: uid(planID), sessions: sorted, content: assignmentContent(sorted), memberIDs: sorted.map((session) => uid(session.memberID)) };
  }

  /** Alle Zuweisungen, die neuesten zuerst. Für Trainer. */
  get sessionAssignments() {
    const groups = new Map();
    for (const session of this.values("session")) {
      const key = uid(session.planID ?? session.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    }
    return [...groups.entries()]
      .map(([planID, sessions]) => this.makeAssignment(planID, sessions))
      .sort((a, b) => {
        const left = a.content;
        const right = b.content;
        const leftStart = stamp(left.start ?? left.createdAt);
        const rightStart = stamp(right.start ?? right.createdAt);
        return leftStart !== rightStart ? rightStart - leftStart : stamp(right.createdAt) - stamp(left.createdAt);
      });
  }

  sessionAssignment(planID) {
    const sessions = this.values("session").filter((session) => sameID(session.planID ?? session.id, planID));
    return sessions.length === 0 ? null : this.makeAssignment(planID, sessions);
  }

  /** Eintrag eines Spielers samt Erledigt-Stand. */
  recordNamesOfSession(sessionID) {
    const names = [];
    if (this.session(sessionID)) names.push(recordName("session", uid(sessionID)));
    if (this.progress(sessionID)) names.push(recordName("progress", uid(sessionID)));
    return names;
  }

  /** Einträge einer Zuweisung samt Erledigt-Stand, z. B. zum Löschen. */
  recordNamesOfAssignment(planID) {
    return this.values("session")
      .filter((session) => sameID(session.planID ?? session.id, planID))
      .flatMap((session) => this.recordNamesOfSession(session.id))
      .sort();
  }

  /**
   * Was beim Vergeben oder Ändern einer Einheit zu tun ist, wie
   * `assignmentChanges` im Kern: `content` ist der Stand aus dem Editor,
   * `original` der beim Öffnen (null bei einer neuen Einheit), `memberIDs`
   * die gewählten Spieler, `originalMemberIDs` die beim Öffnen. Wer neu gewählt
   * ist, bekommt einen Eintrag, wer abgewählt ist, verliert ihn samt Stand.
   * Eine inzwischen gelöschte Einheit kommt beim Bearbeiten nicht zurück.
   */
  assignmentChanges(content, original, memberIDs, originalMemberIDs, author, now) {
    const planID = uid(content.planID ?? content.id);
    const existing = this.values("session").filter((session) => sameID(session.planID ?? session.id, planID));
    if (original && existing.length === 0) return { save: [], delete: [] };
    const base = assignmentContent(existing);
    const merged = original && base ? applyingEdits(base, content, original, SESSION_FIELDS) : content;
    const wanted = new Set([...memberIDs].map(uid));
    const before = new Set([...originalMemberIDs].map(uid));
    const removed = new Set(original ? [...before].filter((id) => !wanted.has(id)) : []);
    const added = original ? [...wanted].filter((id) => !before.has(id)) : [...wanted];
    const remove = existing
      .filter((session) => removed.has(uid(session.memberID)))
      .flatMap((session) => this.recordNamesOfSession(session.id))
      .sort();
    const save = existing
      .filter((session) => !removed.has(uid(session.memberID)))
      .sort((a, b) => (uid(a.memberID) < uid(b.memberID) ? -1 : uid(a.memberID) > uid(b.memberID) ? 1 : 0))
      .map((current) => (original ? applyingEdits(current, content, original, SESSION_FIELDS) : current));
    const present = new Set(existing.map((session) => uid(session.memberID)));
    for (const memberID of added.filter((id) => !present.has(id)).sort()) {
      const session = clone(merged);
      session.id = sessionIDFor(planID, memberID);
      session.planID = planID;
      session.memberID = memberID;
      session.authorID = uid(base?.authorID ?? author);
      session.createdAt = toStored(now);
      session.updatedAt = toStored(now);
      save.push(session);
    }
    return { save, delete: remove };
  }

  /** Offene Meldungen für die Liste der Admins. Meldungen über sich selbst sieht niemand. */
  openReports(memberID = null) {
    return this.sortedReports.filter((report) => report.resolvedAt == null && (memberID == null || !sameID(report.reportedMemberID, memberID)));
  }
}

/** Ende eines Termins in Sekunden seit 2001. */
export function eventEnd(event) {
  return stamp(event.start) + (Number(event.minutes) || 0) * 60;
}

/** Zeitpunkt eines Eintrags als Date, null wenn er fehlt. */
export function dateOf(value) {
  if (value == null) return null;
  const date = fromStored(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Beginn des Tages als Sekunden seit 2001, für Vergleiche mit Einträgen. */
export function storedStartOfDay(date) {
  return toStored(startOfDay(date));
}
