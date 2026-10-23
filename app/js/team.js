// Das Team in der Web-App, wie TeamStore in der App (App/Sources/Team/TeamStore.swift)
// und die eigenen Daten ins Team wie AppModel+Team.swift. Die Daten liegen beim
// Server des Kontos (supabase/team.sql), der prüft, wer was sieht und ändern
// darf. Jeder Eintrag ist ein Datensatz mit Inhalt und Stand. Den Abgleich
// rechnet TeamSync (core/teamsync.js): Dieses Gerät schickt seine Änderungen
// (team_push) und holt, was sich seit dem letzten Mal geändert hat
// (team_pull). Ohne Konto gibt es kein Team.
import { describe, deviceName } from "./account.js";
import { APP_VERSION } from "./config.js";
import { seed, stations } from "./core/challenge.js";
import { addDays, startOfDay, toStored } from "./core/dates.js";
import { level as difficultyLevel } from "./core/difficulty.js";
import { summaries } from "./core/launch.js";
import { allows } from "./core/moderation.js";
import { encodeLogEntry, encodeRound, newID } from "./core/model.js";
import { AREAS } from "./core/categories.js";
import {
  applyingEdits, canonical, detailsNeedConsent, effectiveSharing, isSharingDevice, isStaffRole, joinLink, normalizeCode, parseJoinLink, parseRecordName, recordName, sameID, sessionState, stamp, TeamData, uid, ANNOUNCEMENT_FIELDS, CHALLENGE_FIELDS, EVENT_FIELDS, FOCUS_FIELDS, NOTHING_SHARED,
} from "./core/team.js";
import { parseCreated, parseInvite, parseJoinLink as parseNewJoinLink, parseJoined, parsePull, parsePushResult, parseRedeemed, parseTeams, teamRequests } from "./core/teamapi.js";
import { attendedEvents, keepingProgress, makeProgress, publicStats, snapshot } from "./core/teamshare.js";
import { clipPath, clipRequests, clipTitle } from "./core/teamclips.js";
import { TeamSync } from "./core/teamsync.js";
import { invitationMessage, playerInvitationMessage } from "./core/teamcoach.js";
import { entries as logEntries } from "./core/traininglog.js";
import { SupabaseError } from "./supabase.js";

/** Das Team im Speicher des Browsers. „Meine Daten löschen“ und Abmelden entfernen es. */
export const TEAM_KEY = "golftrainer.team";
/** Kennung dieses Browsers, damit nur ein Gerät das Training teilt. Bleibt, bis du alles löschst. */
export const DEVICE_KEY = "golftrainer.geraet";

export const ACCOUNT_NEEDED = "Für das Team brauchst du ein Konto. Melde dich unter Mehr → Konto an oder lege eins an.";

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Dieser Browser als Gerät, z. B. „Browser (Android)“, mit fester Kennung. */
export function deviceIdentity(storage = defaultStorage()) {
  try {
    const json = JSON.parse(storage?.getItem(DEVICE_KEY) ?? "null");
    if (json && typeof json.id === "string" && json.id) return { id: json.id, name: typeof json.name === "string" ? json.name : deviceName() };
  } catch {
    // Neu anlegen.
  }
  const identity = { id: newID(), name: deviceName() };
  try {
    storage?.setItem(DEVICE_KEY, JSON.stringify(identity));
  } catch {
    // Kein Platz: Die Kennung gilt, bis die Seite geschlossen wird.
  }
  return identity;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
}

/** Gleicher Inhalt, egal wann zuletzt gespeichert. */
function sameContent(a, b) {
  return canonical({ ...a, updatedAt: null }) === canonical({ ...b, updatedAt: null });
}

/** Alles, was das Team auf diesem Gerät speichert. */
function emptyFile() {
  return { sync: null, data: new TeamData(), userID: null, pendingJoin: null, blocked: new Set(), inviteCodes: {}, notes: {} };
}

export class TeamStore {
  /**
   * `store`: die Daten der Web-App, `account`: das Konto. `storage`, `now`,
   * `autoSync` und `library` sind für Tests. `onNotice` bekommt Neues vom
   * Server, z. B. einen Termin, als [{ title, body }].
   */
  constructor(store, account, { storage = defaultStorage(), now = () => new Date(), autoSync = true, library = null, onNotice = null } = {}) {
    /** Geladene Videos (Kennung → Blob), nur im Speicher dieses Tabs. */
    this.clipFiles = new Map();
    this.store = store;
    this.account = account;
    this.storage = storage;
    this.now = now;
    this.autoSync = autoSync;
    this.library = library ?? store.library;
    this.onNotice = onNotice;
    this.listeners = new Set();
    this.file = this.read();
    /** Kennung dieses Browsers, erst wenn das Team sie braucht (siehe `device`). */
    this.deviceIdentity = null;
    this.isSyncing = false;
    this.isSearching = false;
    this.isConnecting = false;
    this.lastSync = null;
    /** Fehler oder Hinweis für die Oberfläche, einmal zum Anzeigen. */
    this.message = null;
    this.needsResync = false;
    this.didSearch = false;
    this.timer = null;
    this.itemsTimer = null;
    this.persistTimer = null;
    this.notices = [];
    this.lastUserID = account.client?.session?.userID ?? null;
    store.teamFocus = () => this.teamFocusPoints();
    account.subscribe(() => this.accountDidChange());
    store.subscribe(() => this.scheduleItemSync());
  }

  /** Kennung und Name dieses Browsers, für „welches Gerät teilt“. Entsteht erst mit dem Team, „Meine Daten löschen“ entfernt sie. */
  get device() {
    this.deviceIdentity ??= deviceIdentity(this.storage);
    return this.deviceIdentity;
  }

  // MARK: - Speicher

  read() {
    const file = emptyFile();
    try {
      const json = JSON.parse(this.storage?.getItem(TEAM_KEY) ?? "null");
      if (!json || typeof json !== "object") return file;
      file.sync = TeamSync.fromJSON(json.sync);
      // Nach einem Update: Was die alte Version nicht lesen konnte, einmal neu holen.
      file.sync?.retryUnreadable(APP_VERSION);
      // Ohne Stand des Abgleichs gibt es kein Team auf diesem Gerät.
      file.data = file.sync ? TeamData.fromJSON(json.data) : new TeamData();
      file.userID = typeof json.userID === "string" ? json.userID : null;
      const join = json.pendingJoin;
      if (join && typeof join.teamID === "string" && typeof join.secret === "string") {
        file.pendingJoin = { teamID: uid(join.teamID), secret: join.secret, receivedAt: Number(join.receivedAt) || 0 };
      }
      file.blocked = new Set(Array.isArray(json.blocked) ? json.blocked.map(uid) : []);
      file.inviteCodes = json.inviteCodes && typeof json.inviteCodes === "object" ? { ...json.inviteCodes } : {};
      file.notes = json.notes && typeof json.notes === "object" ? { ...json.notes } : {};
    } catch {
      // Unlesbar: Das Team findet die Suche über das Konto wieder.
    }
    return file;
  }

  persist() {
    if (this.persistTimer != null) globalThis.clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const file = this.file;
    try {
      if (!file.sync && !file.pendingJoin && file.blocked.size === 0) {
        this.storage?.removeItem(TEAM_KEY);
        return;
      }
      this.storage?.setItem(
        TEAM_KEY,
        JSON.stringify({ sync: file.sync, data: file.data, userID: file.userID, pendingJoin: file.pendingJoin, blocked: [...file.blocked].sort(), inviteCodes: file.inviteCodes, notes: file.notes }),
      );
    } catch {
      this.message = "Das Team ließ sich nicht speichern, z. B. weil der Speicher voll ist.";
    }
  }

  /** Fasst mehrere Änderungen zu einem Schreibvorgang zusammen. */
  persistSoon() {
    if (this.persistTimer != null) return;
    this.persistTimer = globalThis.setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 300);
  }

  /** Nach Änderungen in einem anderen Tab. */
  reload() {
    this.file = this.read();
    this.notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  /** Die Meldung, einmal zum Anzeigen. */
  takeMessage() {
    const message = this.message;
    this.message = null;
    return message;
  }

  // MARK: - Konto

  get isSignedIn() {
    return this.account.status === "signedIn" && Boolean(this.account.client?.session);
  }

  get userID() {
    return this.account.client?.session?.userID ?? null;
  }

  /** Schickt eine Anfrage mit der Sitzung des Kontos und gibt die Antwort zurück. */
  send(make) {
    if (!this.isSignedIn) return Promise.reject(new SupabaseError(401, "signed_out", ACCOUNT_NEEDED));
    const client = this.account.client;
    return client.authorized((session) => make(client.config, session));
  }

  /** Angemeldet, abgemeldet oder ein anderes Konto: Das Team gehört zum Konto. */
  accountDidChange() {
    if (this.isSignedIn) {
      const userID = this.userID;
      if (userID !== this.lastUserID) {
        this.lastUserID = userID;
        this.didSearch = false;
      }
      if (this.file.userID && userID && this.file.userID !== userID) {
        // Ein anderes Konto als das, zu dem das Team gehört.
        this.resetLocal(null, true, { keepingPendingJoin: true });
      }
      if (!this.isInTeam) this.findExistingTeam();
      else this.syncSoon(500);
      return;
    }
    // Das Konto meldet sich auch zwischendurch, z. B. während es anmeldet: Nur ein echtes Abmelden zählt.
    const wasSignedIn = this.lastUserID != null;
    this.lastUserID = null;
    if (wasSignedIn) this.accountDidSignOut();
  }

  /** Nach dem Abmelden gehört das Team nicht mehr zu diesem Gerät. Blockliste und ein wartender Einladungslink bleiben. */
  accountDidSignOut() {
    this.didSearch = false;
    if (!this.isInTeam) return;
    this.resetLocal(null, true, { keepingPendingJoin: true });
  }

  // MARK: - Wer bin ich

  get data() {
    return this.file.data;
  }

  get teamID() {
    return this.file.sync?.teamID ?? null;
  }

  get isInTeam() {
    return this.file.sync != null;
  }

  get myMemberID() {
    return this.file.sync?.memberID ?? null;
  }

  get isOwner() {
    return this.myMemberID != null && this.data.isOwner(this.myMemberID);
  }

  /** Die Abteilung hat keinen Eröffner mehr (Konto gelöscht), und dieses Mitglied ist Admin: Es kann sie übernehmen oder löschen. */
  get canTakeOver() {
    return this.isAdmin && !this.isOwner && this.data.info != null && !this.data.hasOwner();
  }

  /** Löschen darf, wer eröffnet hat; ohne Eröffner jeder Admin. */
  get canDeleteTeam() {
    return this.isOwner || this.canTakeOver;
  }

  get me() {
    return this.data.member(this.myMemberID);
  }

  get myDetails() {
    return this.data.details(this.myMemberID);
  }

  get myRole() {
    return this.data.role(this.myMemberID);
  }

  get isCoach() {
    return this.data.isCoach(this.myMemberID);
  }

  get isStaff() {
    return isStaffRole(this.myRole);
  }

  get isPlayer() {
    return this.myRole === "player";
  }

  get isAdmin() {
    return this.data.isAdmin(this.myMemberID);
  }

  get teamName() {
    return this.data.info?.name ?? "Team";
  }

  /** Der erste Abgleich ist durch. */
  get hasLoaded() {
    return this.file.sync?.lastPull != null;
  }

  get isFullyLoaded() {
    return this.hasLoaded && !(this.file.sync?.needsFullPull ?? true);
  }

  get isPending() {
    return this.myMemberID != null && this.data.isPending(this.myMemberID);
  }

  get isRemoved() {
    return this.data.membership(this.myMemberID)?.status === "removed";
  }

  /** Freigegeben und nicht entfernt. Erst dann teilt die Web-App Trainingsdaten. */
  get isActiveMember() {
    return this.me != null && this.myRole != null && !this.isRemoved;
  }

  /** Ein Einladungslink wartet auf Name und Angaben. */
  get pendingJoin() {
    return this.file.pendingJoin;
  }

  get year() {
    return this.now().getFullYear();
  }

  /** Unter 16 ohne Einverständnis der Eltern: keine Trainingsdaten, keine Nachrichten. Ohne Angaben: unbekanntes Alter, also wie unter 16. */
  get needsParentalConsent() {
    if (!this.isPlayer) return false;
    const details = this.myDetails;
    return details ? detailsNeedConsent(details, this.year) : true;
  }

  /** Ein anderes Gerät teilt das Training, z. B. das iPhone. Dieses dann nicht. */
  get otherSharingDevice() {
    const details = this.myDetails;
    if (!this.isPlayer || !details || isSharingDevice(details, this.device.id)) return null;
    return details.sharingDevice;
  }

  get viewer() {
    return { memberID: this.myMemberID, access: this.data.access(this.myMemberID), isAdmin: this.isAdmin };
  }

  /** Der Link für Spieler, wenn dieses Gerät ihn sehen darf. */
  get joinLink() {
    const secret = this.file.sync?.joinSecret;
    return this.teamID && secret ? joinLink(this.teamID, secret) : null;
  }

  get hasPendingChanges() {
    return this.file.sync?.hasPendingChanges ?? false;
  }

  // MARK: - Lokal ändern

  /** Speichert einen Eintrag und lädt ihn beim nächsten Abgleich hoch. Gibt den Datensatznamen zurück. */
  saveItem(kind, payload) {
    const name = this.file.data.put(kind, payload);
    this.file.sync?.markChanged([name]);
    this.persistSoon();
    this.syncSoon();
    this.notify();
    return name;
  }

  /** Speichert nur, wenn sich der Inhalt geändert hat. Der Zeitstempel steigt dabei immer. */
  saveIfChanged(kind, payload, existing) {
    if (existing && sameContent(existing, payload)) return null;
    const floor = (existing ? stamp(existing.updatedAt) : -Infinity) + 0.001;
    return this.saveItem(kind, { ...payload, updatedAt: Math.max(toStored(this.now()), floor) });
  }

  deleteNames(names, { evenWithoutRevision = false } = {}) {
    if (names.length === 0) return;
    for (const name of names) this.file.data.remove(name);
    this.file.sync?.markDeleted(names, evenWithoutRevision);
    this.persistSoon();
    this.syncSoon();
    this.notify();
  }

  // MARK: - Beitreten und suchen

  /** Ein Einladungslink ist angekommen, aus der Adresse oder eingefügt. Gibt zurück, ob der Text ein Link zum Team war. */
  receiveLink(text) {
    const parsed = parseJoinLink(text);
    if (!parsed) return false;
    if (this.file.sync) {
      if (this.file.sync.teamID === parsed.teamID) this.refresh();
      else this.message = `Du bist schon im Team „${this.teamName}“. Verlasse es zuerst, um einem anderen beizutreten.`;
      return true;
    }
    this.file.pendingJoin = { teamID: parsed.teamID, secret: parsed.secret, receivedAt: this.now().getTime() };
    this.persist();
    this.notify();
    // Wer schon dabei ist, z. B. vom iPhone aus, braucht kein neues Profil.
    this.findExistingTeam({ force: true, quietly: true });
    return true;
  }

  discardPendingJoin() {
    this.file.pendingJoin = null;
    this.persist();
    this.notify();
  }

  /**
   * Beitritt mit Profil über den wartenden Link: mit Code aus einer Einladung
   * mit Rolle sofort Mitglied, sonst als Spieler mit Anfrage an die Trainer.
   * Geteilt wird nur, was beim Beitritt ausdrücklich gewählt wurde.
   * null, wenn es geklappt hat, sonst der Satz für die Anzeige.
   */
  async createProfile({ name, birthYear = null, handicap = null, handedness = null, consent = null, sharing = NOTHING_SHARED, inviteCode = null }) {
    const pending = this.file.pendingJoin;
    if (!pending) return "Öffne zuerst den Einladungslink.";
    if (!this.isSignedIn) return ACCOUNT_NEEDED;
    if (this.isInTeam || this.isConnecting) return "Du bist schon in einem Team.";
    this.isConnecting = true;
    this.notify();
    try {
      let memberID;
      let writesDetails;
      if (inviteCode && normalizeCode(inviteCode)) {
        const redeemed = parseRedeemed(await this.send((config, session) => teamRequests.redeemInvite(config, session, pending.teamID, inviteCode, name)));
        memberID = redeemed.memberID;
        writesDetails = redeemed.role === "player";
      } else {
        const joined = parseJoined(await this.send((config, session) => teamRequests.join(config, session, pending.teamID, pending.secret, name)));
        memberID = joined.memberID;
        // Schon dabei, z. B. vom iPhone aus: Die Angaben dort gelten.
        writesDetails = joined.isPending;
      }
      this.connect(new TeamSync(pending.teamID, memberID), this.userID);
      if (writesDetails) {
        const now = toStored(this.now());
        const isChild = birthYear == null || this.year - birthYear <= 16;
        const blocked = isChild && consent == null;
        const details = { memberID, sharing: blocked ? { ...NOTHING_SHARED } : effectiveSharing(sharing), privacyUpdatedAt: now, consentUpdatedAt: now, updatedAt: now };
        if (birthYear != null) details.birthYear = birthYear;
        if (!blocked && handicap != null) details.handicap = handicap;
        if (!blocked && handedness) details.handedness = handedness;
        if (consent) details.consent = consent;
        this.saveItem("details", details);
      }
      this.persist();
      await this.refresh();
      return null;
    } catch (error) {
      return `Der Beitritt hat nicht geklappt: ${describe(error)}`;
    } finally {
      this.isConnecting = false;
      this.notify();
    }
  }

  /** Code nachträglich einlösen, z. B. wer erst ohne Code beigetreten ist. null, wenn es geklappt hat. */
  async redeemInvite(code) {
    const teamID = this.teamID;
    if (!teamID) return "Du bist in keinem Team.";
    try {
      parseRedeemed(await this.send((config, session) => teamRequests.redeemInvite(config, session, teamID, code, this.me?.name ?? "")));
      await this.refresh();
      return null;
    } catch (error) {
      return describe(error);
    }
  }

  /** Sucht ein Team, dem dieses Konto schon angehört, z. B. nach dem Anmelden im Browser. */
  async findExistingTeam({ force = false, quietly = false } = {}) {
    if (!this.isSignedIn || this.isInTeam || this.isSearching || this.isConnecting || (!force && this.didSearch)) return;
    this.didSearch = true;
    this.isSearching = true;
    this.notify();
    try {
      const teams = parseTeams(await this.send((config, session) => teamRequests.mine(config, session)));
      if (this.isInTeam || this.isConnecting) return;
      const found = teams.find((team) => team.teamID === this.file.pendingJoin?.teamID) ?? teams[0] ?? null;
      if (!found) {
        if (force && !quietly) this.message = "Kein Team gefunden. Öffne den Einladungslink, den du bekommen hast.";
        return;
      }
      this.connect(new TeamSync(found.teamID, found.memberID), this.userID);
      await this.refresh();
    } catch (error) {
      if (force && !quietly) this.message = `Suche fehlgeschlagen: ${describe(error)}`;
    } finally {
      this.isSearching = false;
      this.notify();
    }
  }

  /** Mit einem Team auf dem Server verbinden. Die Blockliste bleibt. */
  connect(sync, userID) {
    const fresh = emptyFile();
    fresh.blocked = this.file.blocked;
    fresh.userID = userID;
    fresh.sync = sync;
    this.file = fresh;
    this.persist();
    this.notify();
  }

  // MARK: - Austritt

  /** Verlässt das Team. Wer die Abteilung eröffnet hat, löscht sie dabei. null, wenn es geklappt hat. */
  async leaveTeam(deleteMyData) {
    const teamID = this.teamID;
    if (!teamID) return null;
    if (this.isOwner) return this.deleteTeam();
    // Die eigenen Videos vorher aus dem Speicher: Danach darf die Person es nicht mehr.
    if (deleteMyData && this.myMemberID) await this.deleteClipFiles(this.clipPaths(this.myMemberID));
    try {
      await this.send((config, session) => teamRequests.leave(config, session, teamID, deleteMyData));
      this.resetLocal("Du hast das Team verlassen.", true);
      return null;
    } catch (error) {
      return `Der Austritt hat nicht geklappt: ${describe(error)} Ausgetreten bist du noch nicht.`;
    }
  }

  /** Löscht die Jugendabteilung mit allen Daten. Wer sie eröffnet hat; ohne Eröffner jeder Admin. */
  async deleteTeam() {
    const teamID = this.teamID;
    if (!this.canDeleteTeam || !teamID) return null;
    // Die Videos aller Mitglieder aus dem Speicher, solange das Team sie noch kennt.
    await this.deleteClipFiles(this.allClipPaths);
    try {
      await this.send((config, session) => teamRequests.deleteTeam(config, session, teamID));
      this.resetLocal("Das Team wurde gelöscht.", true);
      return null;
    } catch (error) {
      return `Das Team konnte nicht gelöscht werden: ${describe(error)}`;
    }
  }

  /** Schickt, was noch aussteht, z. B. vor dem Löschen aller Daten im Browser. */
  async sendPendingChanges() {
    const teamID = this.teamID;
    if (!teamID || !this.hasPendingChanges) return;
    try {
      await this.pushPending(teamID);
    } catch {
      // Was nicht ankam, bleibt auf diesem Gerät, bis es gelöscht wird.
    }
    this.persist();
  }

  /** Für „Meine Daten löschen“: Team, Blockliste, wartender Link und die Kennung des Browsers vom Gerät nehmen. Auf dem Server ändert das nichts. */
  forgetLocalData() {
    this.resetLocal(null, false);
    this.deviceIdentity = null;
    try {
      this.storage?.removeItem(DEVICE_KEY);
    } catch {
      // Dann bleibt die Kennung, sie enthält nichts Persönliches.
    }
  }

  resetLocal(message, keepingBlocked, { keepingPendingJoin = false } = {}) {
    this.cancelScheduledSync();
    const fresh = emptyFile();
    if (keepingBlocked) fresh.blocked = this.file.blocked;
    if (keepingPendingJoin) fresh.pendingJoin = this.file.pendingJoin;
    this.file = fresh;
    this.lastSync = null;
    this.notices = [];
    this.clipFiles?.clear();
    this.persist();
    if (message) this.message = message;
    this.notify();
  }

  // MARK: - Eigene Einträge

  /** Zu- oder Absage zu einem Termin. Eine neue Antwort löscht die Notiz der alten. */
  respond(event, answer) {
    const me = this.myMemberID;
    if (!me) return;
    const current = this.data.response(me, event.id);
    const response = current ? { ...current } : { eventID: uid(event.id), memberID: me, answer, note: "", updatedAt: toStored(this.now()) };
    if (response.answer !== answer) response.note = "";
    response.answer = answer;
    this.saveIfChanged("response", response, current);
  }

  /** Notiz zur Antwort. null, wenn gesichert, sonst der Hinweis des Wortfilters. */
  setResponseNote(event, note) {
    const me = this.myMemberID;
    const current = me ? this.data.response(me, event.id) : null;
    if (!current) return null;
    const trimmed = String(note ?? "").trim();
    if (!allows(trimmed)) return "Nicht gesichert. Bitte formuliere das freundlicher.";
    this.saveIfChanged("response", { ...current, note: trimmed }, current);
    return null;
  }

  /** Eigenen Namen ändern. */
  rename(name) {
    const profile = this.me;
    if (!profile) return;
    this.saveIfChanged("member", { ...profile, name: String(name).trim() }, profile);
  }

  /** Jahrgang und Handicap, nur für Spieler. Ohne Einverständnis der Eltern weder Handicap noch Spielhand. */
  updateDetails({ birthYear = null, handicap = null }) {
    const me = this.myMemberID;
    if (!me || this.isStaff) return;
    const existing = this.myDetails;
    // Ohne bekannte Angaben und ohne Eingabe nichts anlegen: Sie sind vielleicht nur noch nicht geladen.
    if (!existing && birthYear == null && handicap == null) return;
    const details = existing ? { ...existing } : { memberID: me, sharing: { ...NOTHING_SHARED }, updatedAt: toStored(this.now()) };
    if (birthYear == null) delete details.birthYear;
    else details.birthYear = birthYear;
    const blocked = detailsNeedConsent(details, this.year);
    if (blocked || handicap == null) delete details.handicap;
    else details.handicap = handicap;
    if (blocked || !this.store.data.handedness) delete details.handedness;
    else details.handedness = this.store.data.handedness;
    if (blocked && !Object.values(effectiveSharing(details.sharing)).every((value) => !value)) {
      details.sharing = { ...NOTHING_SHARED };
      details.privacyUpdatedAt = toStored(this.now());
    }
    this.saveIfChanged("details", details, existing);
  }

  /** Einverständnis oder Freigaben von Hand ändern, mit eigenem Zeitpunkt. `change` ändert eine Kopie. */
  updatePrivacy(change) {
    const me = this.myMemberID;
    if (!me) return;
    const existing = this.myDetails ?? { memberID: me, sharing: { ...NOTHING_SHARED }, updatedAt: -Infinity };
    const details = { ...existing, sharing: { ...effectiveSharingKeys(existing.sharing) } };
    change(details);
    if (sameContent(details, existing)) return;
    const now = toStored(this.now());
    details.privacyUpdatedAt = now;
    if (canonical(details.consent ?? null) !== canonical(existing.consent ?? null)) {
      details.consentUpdatedAt = now;
    } else if (details.consentUpdatedAt == null) {
      // Stand einer älteren Version: den Zeitpunkt des Einverständnisses festhalten.
      details.consentUpdatedAt = existing.privacyUpdatedAt ?? -62135596800;
    }
    this.saveIfChanged("details", details, this.myDetails);
  }

  /** Eine Freigabe umschalten, z. B. „Wann und wie lange ich trainiere“. */
  setSharing(key, value) {
    this.updatePrivacy((details) => {
      details.sharing[key] = Boolean(value);
      // Ohne Training keine Punkte.
      if (key === "trainingLog" && !value) details.sharing.drillResults = false;
    });
    this.scheduleItemSync();
  }

  /** Einverständnis der Eltern geben oder zurückziehen. Das Einverständnis schaltet nichts ein. */
  setConsent(consent, birthYear = null) {
    this.updatePrivacy((details) => {
      if (details.birthYear == null && birthYear != null) details.birthYear = birthYear;
      if (consent) details.consent = consent;
      else delete details.consent;
      details.sharing = { ...NOTHING_SHARED };
      if (!consent) {
        delete details.handicap;
        delete details.handedness;
        delete details.sharingDevice;
      } else if (this.store.data.handedness) {
        details.handedness = this.store.data.handedness;
      }
    });
    this.scheduleItemSync();
  }

  /** Ab jetzt teilt dieser Browser das Training. */
  shareFromThisDevice() {
    const existing = this.myDetails;
    if (!existing) return;
    this.saveIfChanged("details", { ...existing, sharingDevice: { id: this.device.id, name: this.device.name } }, existing);
    this.scheduleItemSync();
  }

  /** Nachricht an die Trainer. null, wenn gesichert, sonst der Hinweis. */
  sendComment(text, memberID = this.myMemberID, { clipID = null } = {}) {
    const me = this.myMemberID;
    if (!me || memberID == null) return ACCOUNT_NEEDED;
    if (this.needsParentalConsent) return "Antworten geht erst, wenn deine Eltern einverstanden sind. Trag es unter „Profil“ ein.";
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return null;
    if (!allows(trimmed)) return "Bitte formuliere das freundlicher. Beleidigungen, Drohungen und sexuelle Ausdrücke sind im Team nicht erlaubt.";
    const now = toStored(this.now());
    const comment = { id: newID(), memberID: uid(memberID), authorID: me, text: trimmed, date: now, updatedAt: now };
    // Feedback zu einem Video hängt am Video und verschwindet mit ihm.
    if (clipID) comment.clipID = uid(clipID);
    this.saveItem("comment", comment);
    return null;
  }

  // MARK: - Videos im Team

  /** Eigene Videos an die Trainer, neueste zuerst. */
  get myClips() {
    return this.myMemberID ? this.data.clips(this.myMemberID) : [];
  }

  /** Pfad der Datei eines Videos im Speicher des Kontos. */
  clipPath(clip) {
    return this.teamID ? clipPath(this.teamID, clip.memberID, clip.id) : null;
  }

  /** Pfade der Videos einer Person, z. B. vor dem Entfernen oder dem Austritt. */
  clipPaths(memberID) {
    return this.teamID ? this.data.clips(memberID).map((clip) => this.clipPath(clip)) : [];
  }

  /** Pfade aller Videos im Team, die dieser Browser kennt, vor dem Löschen der Abteilung. */
  get allClipPaths() {
    return this.teamID ? this.data.values("clip").map((clip) => this.clipPath(clip)) : [];
  }

  /** Die Datei eines Videos als Blob: aus dem Speicher des Tabs, sonst vom Server. */
  async clipFile(clip) {
    const key = uid(clip.id);
    const cached = this.clipFiles.get(key);
    if (cached) return cached;
    const path = this.clipPath(clip);
    if (!path) throw new SupabaseError(0, "no_team", "Du bist in keinem Team.");
    const blob = await this.send((config, session) => clipRequests.download(config, session, path));
    this.clipFiles.set(key, blob);
    return blob;
  }

  /** Löscht ein Video aus dem Team: Eintrag, Feedback dazu und die Datei. Spieler ihre eigenen, Admins jedes. Gibt zurück, ob es erlaubt war. */
  async deleteClip(clip) {
    if (!(sameID(clip.memberID, this.myMemberID) || this.isAdmin)) return false;
    const path = this.clipPath(clip);
    this.deleteNames(this.data.recordNamesRemovedWith(recordName("clip", uid(clip.id))));
    this.clipFiles.delete(uid(clip.id));
    if (path) await this.deleteClipFiles([path]);
    return true;
  }

  /** Dateien im Speicher löschen. Fehler bleiben still: Eine Datei ohne Eintrag zeigt die App niemandem mehr, und beim Entfernen der Person räumt ein Admin sie weg. */
  async deleteClipFiles(paths) {
    if (paths.length === 0) return;
    try {
      await this.send((config, session) => clipRequests.delete(config, session, paths));
    } catch {
      // Siehe oben.
    }
  }

  /** Geladene Videos, deren Eintrag nicht mehr im Team ist. Nur mit vollständigem Stand, sonst fehlte ein Video bloß, weil es noch nicht geladen ist. */
  pruneClipFiles() {
    if (!this.isFullyLoaded) return;
    for (const key of [...this.clipFiles.keys()]) {
      if (!this.data.has(recordName("clip", key))) this.clipFiles.delete(key);
    }
  }

  // MARK: - Rechte der Trainer

  get assignableRoles() {
    return this.myMemberID ? this.data.assignableRoles(this.myMemberID) : [];
  }

  get canInvite() {
    return this.assignableRoles.length > 0;
  }

  /** Spieler freigeben dürfen Trainer, Cheftrainer und Admins. */
  get canApproveRequests() {
    return this.assignableRoles.includes("player");
  }

  get canEditSettings() {
    return this.myMemberID != null && this.data.canEditSettings(this.myMemberID);
  }

  canManage(memberID) {
    return this.myMemberID != null && this.data.canManage(memberID, this.myMemberID);
  }

  // MARK: - Mitglieder (Trainer)

  /** Beitrittsanfrage freigeben. Admin-Rechte vergeben nur Admins. */
  approve(memberID, { role, title = null, group = null, isAdmin = false } = {}) {
    if (!this.canManage(memberID) || !this.assignableRoles.includes(role)) return false;
    const membership = { memberID: uid(memberID), role, isAdmin: Boolean(isAdmin) && this.isAdmin && role !== "player", status: "active", updatedAt: toStored(this.now()) };
    if (title) membership.title = title;
    if (group) membership.group = group;
    this.saveItem("membership", membership);
    return true;
  }

  /** Rolle, Bezeichnung, Gruppe, Admin-Recht oder Pause ändern. `change` bekommt eine Kopie der Mitgliedschaft. */
  updateMembership(memberID, change) {
    if (!this.canManage(memberID)) return;
    const existing = this.data.membership(memberID);
    const membership = existing ? { ...existing } : { memberID: uid(memberID), role: "player", isAdmin: false, status: "active", updatedAt: toStored(this.now()) };
    change(membership);
    for (const key of ["title", "group", "inviteID"]) if (membership[key] == null || membership[key] === "") delete membership[key];
    this.saveIfChanged("membership", membership, existing);
  }

  /** Entfernt ein Mitglied oder lehnt eine Anfrage ab. Der Server löscht dabei die Daten der Person. null, wenn es geklappt hat. */
  async removeMember(memberID) {
    const teamID = this.teamID;
    if (!teamID || !this.canManage(memberID)) return "Dieses Mitglied darfst du nicht verwalten.";
    // Die Videos der Person aus dem Speicher, bevor ihr Eintrag verschwindet.
    await this.deleteClipFiles(this.clipPaths(memberID));
    try {
      await this.send((config, session) => teamRequests.removeMember(config, session, teamID, memberID));
      await this.refresh();
      return null;
    } catch (error) {
      this.message = `Entfernen fehlgeschlagen: ${describe(error)}`;
      this.notify();
      return this.message;
    }
  }

  // MARK: - Notizen der Trainer, nur auf diesem Gerät

  note(memberID) {
    return this.file.notes[uid(memberID)] ?? "";
  }

  setNote(text, memberID) {
    const key = uid(memberID);
    const trimmed = String(text ?? "");
    if (trimmed) this.file.notes[key] = trimmed;
    else delete this.file.notes[key];
    this.persistSoon();
  }

  // MARK: - Einladungen mit Rolle

  /** Neue Einladung auf dem Server. Gibt { invite, code } zurück, den Code nur dieses eine Mal. null bei einem Fehler, die Meldung steht dann bereit. */
  async createInvite({ role, name, title = null, group = null, grantsAdmin = false }) {
    const teamID = this.teamID;
    if (!teamID || !this.assignableRoles.includes(role)) return null;
    try {
      const created = parseInvite(await this.send((config, session) => teamRequests.createInvite(config, session, teamID, { role, title, name, group, grantsAdmin: Boolean(grantsAdmin) && this.isAdmin })));
      this.file.inviteCodes[uid(created.invite.id)] = created.code;
      const recordName = this.file.data.put("invite", created.invite);
      if (this.file.sync) this.file.sync.revisions[recordName] = created.revision;
      this.persistSoon();
      this.notify();
      return { invite: this.data.get(recordName), code: created.code };
    } catch (error) {
      this.message = `Die Einladung konnte nicht erstellt werden: ${describe(error)}`;
      this.notify();
      return null;
    }
  }

  /** Einladung zurückziehen. Der Code gilt dann nicht mehr. */
  revokeInvite(id) {
    delete this.file.inviteCodes[uid(id)];
    this.deleteNames([recordName("invite", uid(id))]);
  }

  /** Code einer Einladung, wenn sie in diesem Browser erstellt wurde. */
  inviteCode(id) {
    return this.file.inviteCodes[uid(id)] ?? null;
  }

  invitationMessage(invite, code) {
    return invitationMessage({ invite, code, joinLink: this.joinLink, teamName: this.teamName, club: this.data.info?.club ?? "", appLink: this.data.info?.appLink ?? null });
  }

  get playerInvitationMessage() {
    return playerInvitationMessage({ joinLink: this.joinLink, teamName: this.teamName, appLink: this.data.info?.appLink ?? null });
  }

  /** Neuer Link für Spieler. Der alte gilt danach nicht mehr. */
  async newJoinLink() {
    const teamID = this.teamID;
    if (!teamID) return false;
    try {
      const secret = parseNewJoinLink(await this.send((config, session) => teamRequests.newJoinLink(config, session, teamID)));
      if (this.file.sync) this.file.sync.joinSecret = secret;
      this.persistSoon();
      this.notify();
      return true;
    } catch (error) {
      this.message = `Der Link konnte nicht erneuert werden: ${describe(error)}`;
      this.notify();
      return false;
    }
  }

  // MARK: - Einstellungen der Jugendabteilung

  /** Name, Club, Gruppen, Regeln, Link zur App. `change` bekommt eine Kopie. */
  updateInfo(change) {
    const existing = this.data.info;
    if (!this.canEditSettings || !existing) return;
    const info = { ...existing };
    change(info);
    if (info.appLink == null || info.appLink === "") delete info.appLink;
    this.saveIfChanged("info", info, existing);
  }

  /** Wer eröffnet hat, übergibt die Abteilung an einen Trainer oder Funktionär. */
  transferOwnership(memberID) {
    const existing = this.data.info;
    if (!this.isOwner || !existing || !this.data.isStaff(memberID)) return;
    this.saveIfChanged("info", { ...existing, ownerMemberID: uid(memberID) }, existing);
  }

  /** Ohne Eröffner (Konto gelöscht) übernimmt ein Admin die Abteilung für sich. Der Server prüft das. */
  takeOverTeam() {
    const existing = this.data.info;
    const me = this.myMemberID;
    if (!this.canTakeOver || !existing || !me) return;
    this.saveIfChanged("info", { ...existing, ownerMemberID: uid(me) }, existing);
  }

  // MARK: - Termine, Pinnwand, Challenges (Trainer und Funktionäre)

  /** Termin anlegen oder ändern. Beim Ändern zählt nur, was gegenüber `original` geändert wurde. Gibt zurück, ob gespeichert wurde. */
  saveEvent(event, original = null) {
    if (!this.isStaff) return false;
    if (original) {
      const current = this.data.event(event.id);
      if (!current) return false;
      this.saveIfChanged("event", applyingEdits(current, event, original, EVENT_FIELDS), current);
      return true;
    }
    this.saveItem("event", { ...event, updatedAt: toStored(this.now()) });
    return true;
  }

  setCancelled(eventID, isCancelled) {
    const current = this.data.event(eventID);
    if (!current || !this.isStaff) return;
    this.saveIfChanged("event", { ...current, isCancelled: Boolean(isCancelled) }, current);
  }

  /** Löscht einen Termin samt Zu- und Absagen und Anwesenheit. */
  deleteEvent(eventID) {
    if (!this.isStaff) return;
    this.deleteNames(this.data.recordNamesRemovedWith(recordName("event", uid(eventID))));
  }

  setAttendance(eventID, memberID, status) {
    if (!this.isStaff) return;
    const existing = this.data.attendance(memberID, eventID);
    this.saveIfChanged("attendance", { eventID: uid(eventID), memberID: uid(memberID), status, updatedAt: toStored(this.now()) }, existing);
  }

  saveAnnouncement(item, original = null) {
    if (!this.isStaff) return false;
    const current = this.data.get(recordName("announcement", uid(item.id)));
    if (current) {
      this.saveIfChanged("announcement", original ? applyingEdits(current, item, original, ANNOUNCEMENT_FIELDS) : { ...current, ...item }, current);
      return true;
    }
    // Neu. Eine inzwischen gelöschte Nachricht kommt dagegen nicht zurück.
    if (original && String(original.title ?? "").trim()) return false;
    this.saveItem("announcement", { ...item, updatedAt: toStored(this.now()) });
    return true;
  }

  deleteAnnouncement(id) {
    if (!this.isStaff) return;
    this.deleteNames([recordName("announcement", uid(id))]);
  }

  saveChallenge(challenge, original = null) {
    if (!this.isCoach) return false;
    const current = this.data.challenge(challenge.id);
    if (current) {
      this.saveIfChanged("challenge", original ? applyingEdits(current, challenge, original, CHALLENGE_FIELDS) : { ...current, ...challenge }, current);
      return true;
    }
    if (original && String(original.title ?? "").trim()) return false;
    this.saveItem("challenge", { ...challenge, updatedAt: toStored(this.now()) });
    return true;
  }

  deleteChallenge(id) {
    if (!this.isCoach) return;
    this.deleteNames([recordName("challenge", uid(id))]);
  }

  // MARK: - Schwerpunkte und Einheiten (Trainer)

  /** Schwerpunkt für einen Spieler setzen oder ändern. `point`: { id, text, area, priority, drillIDs, isActive }. */
  saveFocus(memberID, point, original = null) {
    const me = this.myMemberID;
    if (!me || !this.isCoach) return false;
    const existing = this.data.get(recordName("focus", uid(point.id)));
    const now = toStored(this.now());
    let focus = {
      id: uid(point.id),
      memberID: uid(memberID),
      authorID: uid(existing?.authorID ?? me),
      text: point.text,
      area: point.area,
      priority: point.priority ?? 2,
      drillIDs: [...(point.drillIDs ?? [])],
      isActive: point.isActive !== false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (original && sameID(original.id, point.id)) {
      // Nur, was hier geändert wurde. Gelöscht bleibt gelöscht.
      if (!existing) return false;
      focus = applyingEdits(existing, focus, original, FOCUS_FIELDS);
    }
    this.saveIfChanged("focus", focus, existing);
    return true;
  }

  deleteFocus(id) {
    if (!this.isCoach) return;
    this.deleteNames([recordName("focus", uid(id))]);
  }

  /** Einheit vergeben oder ändern. false, wenn die Einheit inzwischen gelöscht ist. */
  saveAssignment(content, original, memberIDs, originalMemberIDs = []) {
    const me = this.myMemberID;
    if (!me || !this.isCoach) return false;
    const changes = this.data.assignmentChanges(content, original, memberIDs, originalMemberIDs, me, this.now());
    if (changes.save.length === 0 && changes.delete.length === 0) return original == null;
    this.deleteNames(changes.delete);
    for (const session of changes.save) this.saveIfChanged("session", session, this.data.session(session.id));
    return true;
  }

  /** Löscht die Einheit bei allen Spielern, samt Erledigt-Stand. */
  deleteAssignment(planID) {
    if (!this.isCoach) return;
    this.deleteNames(this.data.recordNamesOfAssignment(planID));
  }

  // MARK: - Meldungen (Admins)

  /** Ein Admin hat sich gekümmert, oder die Meldung ist wieder offen. */
  setResolved(report, isResolved) {
    const me = this.myMemberID;
    if (!me || !this.isAdmin) return;
    const updated = { ...report };
    if (isResolved) {
      updated.resolvedAt = toStored(this.now());
      updated.resolvedBy = me;
    } else {
      delete updated.resolvedAt;
      delete updated.resolvedBy;
    }
    this.saveIfChanged("report", updated, report);
  }

  /** Löscht den gemeldeten Inhalt aus dem Team und erledigt die Meldung. Von einer Antwort verschwindet nur die Notiz. */
  removeReportedContent(report) {
    const parsed = parseRecordName(report.recordName);
    if (!this.isAdmin || !parsed) return;
    if (parsed.kind === "response") {
      const current = this.data.get(report.recordName);
      if (current && current.note) this.saveIfChanged("response", { ...current, note: "" }, current);
    } else if (parsed.kind !== "member") {
      if (parsed.kind === "clip") {
        const clip = this.data.get(report.recordName);
        this.clipFiles.delete(uid(parsed.key));
        if (clip && this.clipPath(clip)) this.deleteClipFiles([this.clipPath(clip)]);
      }
      // Auch ohne bekannten Stand: Ein Jugendwart sieht Nachrichten sonst nicht. Der Server erlaubt Admins das Löschen gemeldeter Inhalte.
      this.deleteNames(this.data.recordNamesRemovedWith(report.recordName), { evenWithoutRevision: true });
    }
    this.setResolved(report, true);
  }

  // MARK: - Melden und Blockieren

  get blocked() {
    return this.file.blocked;
  }

  isBlocked(memberID) {
    return memberID != null && this.file.blocked.has(uid(memberID));
  }

  block(memberID) {
    if (memberID == null || sameID(memberID, this.myMemberID)) return;
    this.file.blocked.add(uid(memberID));
    this.persistSoon();
    this.notify();
  }

  unblock(memberID) {
    this.file.blocked.delete(uid(memberID));
    this.persistSoon();
    this.notify();
  }

  /** Meldet einen Inhalt oder ein Mitglied an die Admins. Das gemeldete Mitglied sieht die Meldung nicht. */
  report({ subject, recordName: reported, reportedMemberID, text, reason, note }) {
    const me = this.myMemberID;
    if (!me) return;
    const now = toStored(this.now());
    const excerpt = String(text ?? "").trim();
    const report = {
      id: newID(),
      memberID: me,
      subject,
      recordName: reported,
      excerpt: [...excerpt].length > 1000 ? `${[...excerpt].slice(0, 1000).join("")} …` : excerpt,
      reason,
      note: String(note ?? "").trim(),
      createdAt: now,
      updatedAt: now,
    };
    if (reportedMemberID) report.reportedMemberID = uid(reportedMemberID);
    this.saveItem("report", report);
  }

  // MARK: - Abgleich

  /** Holt Änderungen und sendet eigene, z. B. beim Öffnen der Seite. */
  refresh() {
    return this.sync();
  }

  syncIfSignedIn() {
    if (this.isInTeam && this.isSignedIn) this.syncSoon(500);
  }

  /** Nach eigenen Änderungen: kurz sammeln, dann abgleichen. */
  syncSoon(milliseconds = 2000) {
    if (!this.autoSync || !this.isInTeam) return;
    this.cancelScheduledSync();
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.sync();
    }, milliseconds);
  }

  cancelScheduledSync() {
    if (this.timer != null) globalThis.clearTimeout(this.timer);
    this.timer = null;
  }

  async sync() {
    const teamID = this.teamID;
    if (!teamID || !this.isSignedIn) return;
    // Ein anderes Konto als das, zu dem das Team gehört: Das Team ist nicht mehr dieses Geräts.
    if (this.file.userID && this.userID && this.file.userID !== this.userID) {
      this.resetLocal(null, true);
      return;
    }
    if (this.isSyncing) {
      this.needsResync = true;
      return;
    }
    this.cancelScheduledSync();
    this.isSyncing = true;
    this.needsResync = false;
    this.notify();
    try {
      await this.pushPending(teamID);
      await this.pullChanges(teamID);
      this.lastSync = this.now();
    } catch (error) {
      // Ohne Netz holt der nächste Abgleich alles nach. Keine Meldung.
      if (!(error instanceof SupabaseError && error.code === "offline")) this.message = `Abgleich fehlgeschlagen: ${describe(error)}`;
    } finally {
      this.isSyncing = false;
      this.persist();
      this.notify();
      if (this.needsResync && this.isInTeam) {
        this.needsResync = false;
        this.syncSoon(1000);
      }
    }
  }

  /** Eigene Änderungen zum Server, paketweise. Lehnt der Server etwas ab oder hat er einen anderen Stand, verbucht TeamSync das. */
  async pushPending(teamID) {
    for (let round = 0; round < 10; round += 1) {
      const sync = this.file.sync;
      if (!sync || sync.teamID !== teamID || !sync.hasPendingChanges) return;
      const batch = sync.batch(this.file.data);
      if (batch.items.length === 0 && batch.deletions.length === 0) {
        // Nur Namen, zu denen es lokal nichts mehr gibt.
        sync.applyPush({ entries: [] }, batch, this.file.data);
        return;
      }
      const json = await this.send((config, session) => teamRequests.push(config, session, teamID, batch));
      const result = parsePushResult(json);
      const current = this.file.sync;
      if (!current || current.teamID !== teamID) return;
      const report = current.applyPush(result, batch, this.file.data);
      if (report.denied.length > 0) this.message = "Der Server hat eine Änderung abgelehnt. Vielleicht hat sich deine Rolle im Team geändert.";
      else if (report.invalid.length > 0) this.message = "Ein Eintrag ließ sich nicht speichern, er ist zu groß oder unvollständig.";
      if (report.changed) this.remoteDidChange();
    }
  }

  /** Neues vom Server, seitenweise, bis nichts mehr folgt. */
  async pullChanges(teamID) {
    const prepared = this.file.sync;
    if (!prepared || prepared.teamID !== teamID) return;
    prepared.prepareForPull(this.now());
    const wasPending = this.isPending;
    // Beim ersten Holen und beim kompletten Neuladen ist alles „neu“: keine Hinweise.
    let suppressNotices = prepared.lastPull == null || prepared.needsFullPull;
    let changed = false;
    for (let page = 0; page < 40; page += 1) {
      const since = this.file.sync?.lastSeq;
      if (since == null) return;
      const json = await this.send((config, session) => teamRequests.pull(config, session, teamID, since));
      const pull = parsePull(json);
      const current = this.file.sync;
      if (!current || current.teamID !== teamID) return;
      const report = current.applyPull(pull, this.file.data, this.now());
      if (report.teamGone) {
        this.resetLocal("Du bist nicht mehr im Team, oder es wurde gelöscht.", true);
        return;
      }
      if (report.changed) changed = true;
      if (!suppressNotices) {
        for (const change of report.stored) this.collectNotice(change.kind, change.key, wasPending);
      }
      if (report.needsFullPull) suppressNotices = true;
      if (report.isComplete && !this.file.sync?.needsFullPull) break;
    }
    if (changed) this.remoteDidChange();
    this.pruneClipFiles();
    this.postNotices();
  }

  /** Nach jeder Änderung vom Server: eigene Werte neu berechnen, Seite neu zeichnen. */
  remoteDidChange() {
    this.scheduleItemSync();
    this.notify();
  }

  // MARK: - Hinweise

  /** Merkt sich, was neu vom Server kam und den Nutzer interessiert. */
  collectNotice(kind, key, wasPending) {
    const me = this.myMemberID;
    if (!me) return;
    const data = this.data;
    switch (kind) {
      case "event": {
        const event = data.event(key);
        if (!event || sameID(event.createdBy, me) || !data.concerns(event.group, me)) return;
        this.notices.push({ title: event.isCancelled ? `Abgesagt: ${event.title}` : `Termin: ${event.title}`, body: "" });
        return;
      }
      case "announcement": {
        const item = data.get(recordName("announcement", uid(key)));
        if (!item || sameID(item.authorID, me) || this.isBlocked(item.authorID) || !data.concerns(item.group, me)) return;
        this.notices.push({ title: `Pinnwand: ${item.title}`, body: item.text ?? "" });
        return;
      }
      case "focus": {
        const focus = data.get(recordName("focus", uid(key)));
        if (!focus || !sameID(focus.memberID, me) || sameID(focus.authorID, me) || focus.isActive === false) return;
        this.notices.push({ title: "Neuer Schwerpunkt vom Trainer", body: focus.text ?? "" });
        return;
      }
      case "session": {
        const session = data.session(key);
        if (!session || !sameID(session.memberID, me) || sameID(session.authorID, me)) return;
        const isNew = stamp(session.updatedAt) - stamp(session.createdAt) < 60;
        this.notices.push({ title: isNew ? `Neue Einheit vom Trainer: ${session.title}` : `Einheit geändert: ${session.title}`, body: "" });
        return;
      }
      case "comment": {
        const comment = data.get(recordName("comment", uid(key)));
        if (!comment || sameID(comment.authorID, me) || this.isBlocked(comment.authorID)) return;
        this.notices.push({ title: `Nachricht von ${data.name(comment.authorID)}`, body: comment.text ?? "" });
        return;
      }
      case "challenge": {
        const challenge = data.challenge(key);
        if (!challenge || sameID(challenge.createdBy, me) || !data.concerns(challenge.group, me)) return;
        this.notices.push({ title: `Neue Challenge: ${challenge.title}`, body: challenge.text ?? "" });
        return;
      }
      case "membership": {
        if (!wasPending || !sameID(key, me)) return;
        const membership = data.membership(me);
        if (!membership || membership.status !== "active") return;
        const sharesTraining = effectiveSharing(this.myDetails?.sharing).trainingLog;
        const body =
          membership.role === "player"
            ? sharesTraining
              ? "Du bist freigeschaltet. Deine Trainer sehen jetzt dein Training."
              : "Du bist freigeschaltet. Was die Trainer sehen, wählst du unter „Was die Trainer sehen“."
            : `Du bist als ${data.roleText(me) ?? membership.role} freigeschaltet.`;
        this.notices.push({ title: "Willkommen im Team", body });
        return;
      }
      case "clip": {
        // Trainer erfahren von neuen Videos; Admins ohne Trainerrolle nicht.
        if (!this.isCoach) return;
        const clip = data.get(recordName("clip", uid(key)));
        if (!clip || sameID(clip.memberID, me) || this.isBlocked(clip.memberID)) return;
        this.notices.push({ title: `Neues Video von ${data.name(clip.memberID)}`, body: `${clipTitle(clip)}. Sieh es dir an und gib Feedback.` });
        return;
      }
      default:
        return;
    }
  }

  postNotices() {
    const pending = this.notices.slice(0, 5);
    this.notices = [];
    if (pending.length > 0) this.onNotice?.(pending);
  }

  // MARK: - Eigene Daten ins Team

  /** Fasst Änderungen kurz zusammen, bevor die Team-Einträge neu berechnet werden. */
  scheduleItemSync() {
    if (!this.autoSync || !this.isInTeam) return;
    if (this.itemsTimer != null) globalThis.clearTimeout(this.itemsTimer);
    this.itemsTimer = globalThis.setTimeout(() => {
      this.itemsTimer = null;
      this.syncTeamItems();
    }, 1000);
  }

  /**
   * Übernimmt eigene Daten ins Team: Tagebuch, Einheiten vom Trainer, Runden,
   * Stand des Wochenplans und die Werte für die Ranglisten. Was der Spieler
   * nicht teilt, wird gelöscht. Wie `syncTeamItems` in der App.
   */
  syncTeamItems(now = this.now()) {
    const me = this.myMemberID;
    // Trainer nutzen das Tagebuch für sich. Wer vom Spieler aufsteigt, nimmt seine Einträge mit aus dem Team.
    if (me && this.isActiveMember && this.isStaff && this.lastSync) this.retractUnshared(me, { ...NOTHING_SHARED }, false);
    if (!me || !this.isActiveMember || !this.isPlayer) return;
    const existing = this.data.details(me);
    if (!existing) return;
    const blocked = this.needsParentalConsent;
    if (this.lastSync) this.retractUnshared(me, blocked ? { ...NOTHING_SHARED } : effectiveSharing(existing.sharing), blocked);
    if (!isSharingDevice(existing, this.device.id)) return;

    const details = { ...(this.data.details(me) ?? existing) };
    if (!blocked && !details.sharingDevice) details.sharingDevice = { id: this.device.id, name: this.device.name };
    if (blocked || !this.store.data.handedness) delete details.handedness;
    else details.handedness = this.store.data.handedness;
    this.saveIfChanged("details", details, this.data.details(me));

    const sharing = blocked ? { ...NOTHING_SHARED } : effectiveSharing(details.sharing);
    const data = this.store.data;
    const windowStart = startOfDay(addDays(now, -120));

    // Tagebuch
    const wanted = new Map();
    if (sharing.trainingLog) {
      const entries = logEntries({ memberID: me, manual: data.trainingLog, results: data.results, library: this.library, includeScores: sharing.drillResults, since: windowStart });
      for (const entry of entries) {
        const payload = encodeLogEntry(entry);
        // Die Notiz sehen die Trainer: Der Wortfilter gilt wie für Nachrichten.
        if (!allows(payload.note)) payload.note = "";
        wanted.set(payload.id, payload);
      }
    }
    for (const payload of wanted.values()) this.saveIfChanged("log", payload, this.data.get(recordName("log", payload.id)));
    // Nach einer Neuinstallation ohne Sicherung nichts löschen, sonst wären die letzten 120 Tage bei den Trainern weg.
    const hasLocalTraining = data.trainingLog.length > 0 || data.results.length > 0;
    const windowStored = toStored(windowStart);
    this.deleteNames(
      this.data
        .logs(me)
        .filter((entry) => !wanted.has(entry.id) && (!sharing.trainingLog || (hasLocalTraining && stamp(entry.start) >= windowStored)))
        .map((entry) => recordName("log", entry.id)),
    );

    // Einheiten vom Trainer: was erledigt ist.
    const sessions = this.data.sessions(me);
    if (sharing.trainingLog) {
      for (const session of sessions) {
        const current = this.data.progress(session.id);
        const progress = keepingProgress(makeProgress({ session, results: data.results, library: this.library, includeScores: sharing.drillResults, now }), current, session, sharing.drillResults);
        if (progress.done.length === 0 && !current) continue;
        this.saveIfChanged("progress", progress, current);
      }
    }
    const sessionIDs = new Set(sessions.map((session) => uid(session.id)));
    this.deleteNames(
      this.data
        .values("progress")
        .filter((item) => sameID(item.memberID, me) && !sessionIDs.has(uid(item.sessionID)))
        .map((item) => recordName("progress", uid(item.sessionID))),
    );

    // Runden mit Strokes Gained, ein Jahr zurück
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const rounds = sharing.rounds ? data.rounds.filter((round) => round.date >= yearAgo) : [];
    for (const round of rounds) {
      this.saveIfChanged("round", { memberID: me, round: encodeRound(round), updatedAt: toStored(now) }, this.data.get(recordName("round", uid(round.id))));
    }
    const roundIDs = new Set(rounds.map((round) => uid(round.id)));
    this.deleteNames(
      this.data
        .values("round")
        .filter((share) => sameID(share.memberID, me) && share.round?.id != null && !roundIDs.has(uid(share.round.id)))
        .map((share) => recordName("round", uid(share.round.id))),
    );

    // Stand für den Trainer
    const snapshotName = recordName("snapshot", me);
    if (sharing.trainingLog || sharing.distances) {
      let state = snapshot({ memberID: me, plan: data.weekPlan, results: data.results, tournaments: data.tournaments, distances: sharing.distances ? this.carryByClub() : {}, now });
      if (!sharing.trainingLog) state = { memberID: me, plannedDrills: 0, doneDrills: 0, plannedMinutes: 0, distances: state.distances, updatedAt: state.updatedAt };
      this.saveIfChanged("snapshot", state, this.data.get(snapshotName));
    } else if (this.data.has(snapshotName)) {
      this.deleteNames([snapshotName]);
    }

    // Werte für die Ranglisten
    const statsName = recordName("stats", me);
    if (sharing.leaderboards) {
      const logs = logEntries({ memberID: me, manual: data.trainingLog, results: data.results, library: this.library, since: addMonths(now, -6) });
      const stats = publicStats({ memberID: me, logs, attendedEvents: attendedEvents(me, this.data, now), challenges: this.data.challenges(me), now });
      if (!sharing.drillResults) {
        stats.benchmarks = {};
        stats.challenges = {};
      }
      this.saveIfChanged("stats", stats, this.data.get(statsName));
    } else if (this.data.has(statsName)) {
      this.deleteNames([statsName]);
    }
  }

  /** Löscht oder kürzt, was laut Freigaben nicht (mehr) geteilt wird. Geht auch auf dem Gerät, das gerade nicht teilt. */
  retractUnshared(me, sharing, blocked) {
    const team = this.data;
    const names = [];
    if (blocked) {
      names.push(...team.values("comment").filter((comment) => sameID(comment.authorID, me)).map((comment) => recordName("comment", uid(comment.id))));
      const details = team.details(me);
      if (details && (details.handicap != null || details.handedness != null)) {
        const reduced = { ...details };
        delete reduced.handicap;
        delete reduced.handedness;
        this.saveIfChanged("details", reduced, details);
      }
    }
    if (!sharing.trainingLog) {
      names.push(...team.logs(me).map((entry) => recordName("log", entry.id)));
      names.push(...team.values("progress").filter((item) => sameID(item.memberID, me)).map((item) => recordName("progress", uid(item.sessionID))));
    }
    if (!sharing.rounds) {
      names.push(...team.values("round").filter((share) => sameID(share.memberID, me) && share.round?.id != null).map((share) => recordName("round", uid(share.round.id))));
    }
    const snapshotName = recordName("snapshot", me);
    if (!sharing.trainingLog && !sharing.distances && team.has(snapshotName)) names.push(snapshotName);
    const statsName = recordName("stats", me);
    if (!sharing.leaderboards && team.has(statsName)) names.push(statsName);
    this.deleteNames(names);

    // Was teilweise geteilt bleibt, ohne das Ausgeschaltete.
    const current = team.get(snapshotName);
    if (current && (sharing.trainingLog || sharing.distances)) {
      let reduced = sharing.trainingLog ? { ...current } : { memberID: me, plannedDrills: 0, doneDrills: 0, plannedMinutes: 0, distances: current.distances ?? {}, updatedAt: current.updatedAt };
      if (!sharing.distances) reduced = { ...reduced, distances: {} };
      this.saveIfChanged("snapshot", reduced, current);
    }
    const stats = team.get(statsName);
    if (stats && sharing.leaderboards && !sharing.drillResults) this.saveIfChanged("stats", { ...stats, benchmarks: {}, challenges: {} }, stats);
    if (sharing.trainingLog && !sharing.drillResults) {
      const strip = (drill) => {
        const copy = { ...drill };
        delete copy.score;
        delete copy.maxScore;
        return copy;
      };
      for (const entry of team.logs(me)) {
        if (!(entry.drills ?? []).some((drill) => drill.score != null || drill.maxScore != null)) continue;
        this.saveIfChanged("log", { ...entry, drills: entry.drills.map(strip) }, entry);
      }
      for (const item of team.values("progress")) {
        if (!sameID(item.memberID, me) || !(item.done ?? []).some((drill) => drill.score != null || drill.maxScore != null)) continue;
        this.saveIfChanged("progress", { ...item, done: item.done.map(strip) }, item);
      }
    }
  }

  /** Durchschnittliches Carry pro Schläger aus den Launch-Monitor-Daten. */
  carryByClub() {
    const shots = this.store.data.launchSessions.flatMap((session) => session.shots);
    const result = {};
    for (const summary of summaries(shots)) {
      if (summary.averages?.carryDistance != null) result[summary.club] = summary.averages.carryDistance;
    }
    return result;
  }

  // MARK: - Für den Wochenplan und die Seiten

  /** Aktive Schwerpunkte vom Trainer als Schwerpunkte des Planers. */
  teamFocusPoints() {
    const me = this.myMemberID;
    if (!me || !this.isPlayer) return [];
    return this.data
      .activeFocus(me)
      .filter((item) => AREAS.includes(item.area))
      .map((item) => ({
        id: uid(item.id),
        text: String(item.text ?? ""),
        area: item.area,
        priority: Math.min(3, Math.max(1, Number(item.priority) || 2)),
        isActive: true,
        drillIDs: Array.isArray(item.drillIDs) ? item.drillIDs.filter((id) => typeof id === "string") : [],
      }));
  }

  /** Schwerpunkte vom Trainer, die der Wochenplan noch nicht kennt. */
  focusMissingInPlan() {
    const focus = this.teamFocusPoints();
    const plan = this.store.data.weekPlan;
    if (!plan) return focus;
    const notes = new Set(plan.sessions.flatMap((session) => session.drills).flatMap((drill) => drill.focusNotes));
    return focus.filter((point) => !notes.has(point.text));
  }

  /**
   * Was das Team zum Kalender der Startseite beiträgt, wie `agendaTeam` in
   * der App: Termine, die dich betreffen, deine Antworten, die Anwesenheit
   * laut Trainer und deine Einheiten. Null ohne Team.
   */
  agendaTeam(now = this.now()) {
    const me = this.myMemberID;
    if (!this.isActiveMember || !me) return null;
    const events = this.data
      .values("event")
      .filter((event) => this.data.concerns(event.group, me))
      .sort((a, b) => (stamp(a.start) !== stamp(b.start) ? stamp(a.start) - stamp(b.start) : uid(a.id) < uid(b.id) ? -1 : 1));
    const responses = new Map();
    const attendance = new Map();
    for (const event of events) {
      const id = uid(event.id);
      const response = this.data.response(me, id);
      if (response?.answer) responses.set(id, response.answer);
      const entry = this.data.attendance(me, id);
      if (entry?.status) attendance.set(id, entry.status);
    }
    // Gezählt wie in der Zeile der Einheit: jede Übung einmal.
    const sessions = this.mySessions().map((session) => {
      const done = this.doneDrillIDs(session);
      const drills = Array.isArray(session.drills) ? session.drills : [];
      return {
        session,
        done: new Set(drills.map((item) => item.drillID).filter((id) => done.has(id))).size,
        total: drills.length,
        state: sessionState(session, done, now),
      };
    });
    return { events, responses, attendance, answersEvents: this.isPlayer, sessions };
  }

  /** Einheiten, die mir Trainer gegeben haben, nächste Frist zuerst. */
  mySessions() {
    const me = this.myMemberID;
    return me && this.isPlayer ? this.data.sessions(me) : [];
  }

  /** Erledigte Übungen einer Einheit: hier eingetragen oder vom Gerät gemeldet, das das Training teilt. */
  doneDrillIDs(session) {
    const local = this.store.data.results.filter((result) => result.sessionID != null && sameID(result.sessionID, session.id)).map((result) => result.drillID);
    const reported = (this.data.progress(session.id)?.done ?? []).map((drill) => drill.drillID);
    return new Set([...local, ...reported]);
  }

  /** Eine Übung der Einheit, wie sie durchgeführt wird: Minuten und Hinweis vom Trainer, Stufe fest oder nach den eigenen Ergebnissen. */
  plannedDrill(item, now = this.now()) {
    const drill = this.store.drill(item.drillID);
    if (!drill) return null;
    const maxLevel = Math.max(0, drill.levels.length - 1);
    const chosen = Number.isInteger(item.level) ? item.level : difficultyLevel(drill, this.store.data.results);
    const level = Math.min(Math.max(0, chosen), maxLevel);
    const note = String(item.note ?? "").trim();
    return {
      drillID: drill.id,
      minutes: Number.isInteger(item.minutes) ? item.minutes : drill.minutes,
      level,
      focusNotes: note ? [note] : [],
      stations: drill.generator ? stations(drill.generator, drill.scoring.attempts, level, seed(drill.id, now)) : [],
    };
  }
}

/** Freigaben mit allen Schaltern, auch aus älteren Ständen. */
function effectiveSharingKeys(value) {
  return {
    trainingLog: value?.trainingLog === true,
    drillResults: value?.drillResults === true,
    rounds: value?.rounds === true,
    distances: value?.distances === true,
    leaderboards: value?.leaderboards === true,
  };
}
