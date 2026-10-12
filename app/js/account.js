// Das Konto und der Abgleich der eigenen Daten mit dem Server, wie
// AccountManager in der App (App/Sources/Account/AccountManager.swift). Ohne
// Anmeldung passiert hier nichts, die Web-App läuft wie bisher.
import { BackupError, readBackupJSON, syncDocument } from "./core/backup.js";
import { action as syncAction } from "./core/sync.js";
import { MAXIMUM_DOCUMENT_BYTES, MINIMUM_PASSWORD_LENGTH, SupabaseClient, SupabaseError } from "./supabase.js";

/** Stand des Abgleichs im Speicher des Browsers: bekannter Stand, Prüfsumme, Zeitpunkte. */
export const STATE_KEY = "golftrainer.konto.stand";
/** Steht in der Zeile auf dem Server und in der Sicherung, höchstens 40 Zeichen. */
export const APP_NAME = "Golf Trainer im Browser";

const TOO_LARGE = "Deine Daten sind zu groß für den Abgleich, höchstens 2 MB. Lösche alte Launch-Monitor-Sessions.";
const BUSY_ELSEWHERE = "Ein anderes Gerät ändert gerade die Daten. Der Abgleich wird später wiederholt.";

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function trimmed(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

/** Satz für die Anzeige zu einem Fehler. */
export function describe(error) {
  if (error instanceof SupabaseError || error instanceof BackupError) return error.message;
  return error?.message ? String(error.message) : String(error);
}

/** Welches Gerät zuletzt geschrieben hat, für die Zeile auf dem Server, höchstens 80 Zeichen. */
export function deviceName() {
  const platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || "";
  return (platform ? `Browser (${platform})` : "Browser").slice(0, 80);
}

/** Prüfsumme der Daten, um Änderungen seit dem letzten Hochladen zu erkennen. */
export async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Ohne Web Crypto, z. B. über http im Heimnetz: FNV-1a. Sie muss nur Änderungen auf diesem Gerät erkennen.
  let value = 0x811c9dc5;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return `fnv-${value.toString(16)}`;
}

const emptyState = () => ({ revision: 0, userID: null, lastSyncAt: null, pushedHash: null, changedAt: null, awaitingEmail: null, pending: null });

export class Account {
  /**
   * `store`: die Daten der Web-App. Der Abgleich hängt sich an `store.changed`.
   * `client`, `storage`, `now` und `autoSync` sind für Tests.
   */
  constructor(store, { client = null, storage = defaultStorage(), now = () => new Date(), autoSync = true } = {}) {
    this.store = store;
    this.client = client ?? new SupabaseClient();
    this.storage = storage;
    this.now = now;
    this.autoSync = autoSync;
    this.listeners = new Set();
    this.timer = null;
    this.state = this.readState();
    /** "signedOut", "awaitingConfirmation" (die Bestätigungsmail ist unterwegs) oder "signedIn". */
    this.status = this.client.session ? "signedIn" : this.state.awaitingEmail ? "awaitingConfirmation" : "signedOut";
    this.email = this.client.session?.email ?? this.state.awaitingEmail ?? "";
    /** Eine Anfrage läuft gerade, z. B. Anmelden. */
    this.isBusy = false;
    this.isSyncing = false;
    /** Warum der letzte Abgleich nicht geklappt hat, null nach einem guten. */
    this.syncProblem = null;
    /** Was ein Link aus einer E-Mail ergeben hat, für die Seite Konto. */
    this.linkMessage = null;
    store.changed = () => this.dataDidChange();
  }

  // MARK: - Stand

  readState() {
    try {
      const text = this.storage?.getItem(STATE_KEY);
      if (!text) return emptyState();
      const json = JSON.parse(text);
      return { ...emptyState(), ...(json && typeof json === "object" ? json : {}) };
    } catch {
      return emptyState();
    }
  }

  writeState() {
    try {
      this.storage?.setItem(STATE_KEY, JSON.stringify(this.state));
    } catch {
      // Kein Platz: Dann gleicht die Seite beim nächsten Mal noch einmal ab.
    }
  }

  /** Nach Änderungen in einem anderen Tab, z. B. Abmelden dort. */
  reload() {
    this.state = this.readState();
    this.client.session = this.client.loadSession();
    this.status = this.client.session ? "signedIn" : this.state.awaitingEmail ? "awaitingConfirmation" : "signedOut";
    this.email = this.client.session?.email ?? this.state.awaitingEmail ?? "";
    this.notify();
  }

  get lastSyncAt() {
    return this.state.lastSyncAt ? new Date(this.state.lastSyncAt) : null;
  }

  /**
   * Zeitpunkt der letzten Änderung der Daten in diesem Browser. Er steht als
   * `createdAt` im Dokument und entscheidet beim Zusammenführen, welcher Stand
   * der jüngere ist. Vor der ersten Änderung: 1970, also älter als alles.
   */
  get changedAt() {
    return this.state.changedAt ? new Date(this.state.changedAt) : new Date(0);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  /** Nach jeder Änderung der Daten: Zeitpunkt merken und, mit Konto, bald abgleichen. */
  dataDidChange() {
    this.state.changedAt = this.now().getTime();
    this.writeState();
    if (this.status === "signedIn") this.syncSoon(5000);
  }

  // MARK: - Anmelden und Registrieren

  async busy(work) {
    this.isBusy = true;
    this.notify();
    try {
      return await work();
    } catch (error) {
      return describe(error);
    } finally {
      this.isBusy = false;
      this.notify();
    }
  }

  /** null, wenn es geklappt hat, sonst der Satz für die Anzeige. */
  async signUp({ email, password, underSixteen, parentalConsent }) {
    if (underSixteen && !parentalConsent) return "Unter 16 geht es nur mit dem Einverständnis eines Elternteils.";
    if (password.length < MINIMUM_PASSWORD_LENGTH) return `Das Passwort braucht mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen.`;
    const address = trimmed(email);
    return this.busy(async () => {
      // Alter und Einverständnis merken, bis die erste Anmeldung sie ins Profil schreibt.
      this.state.pending = { underSixteen: Boolean(underSixteen), parentalConsent: Boolean(parentalConsent), consentAt: parentalConsent ? this.now().getTime() : null };
      this.writeState();
      const outcome = await this.client.signUp(address, password);
      if (outcome.kind === "signedIn") {
        await this.didSignIn(outcome.session);
      } else {
        this.state.awaitingEmail = address;
        this.writeState();
        this.email = address;
        this.status = "awaitingConfirmation";
      }
      return null;
    });
  }

  async signIn({ email, password }) {
    return this.busy(async () => {
      const session = await this.client.signIn(trimmed(email), password);
      await this.didSignIn(session);
      return null;
    });
  }

  async didSignIn(session) {
    this.state.awaitingEmail = null;
    // Ein anderes Konto als zuletzt: Stand und Prüfsumme gelten nicht mehr.
    if (this.state.userID !== session.userID) {
      this.state.userID = session.userID;
      this.state.revision = 0;
      this.state.pushedHash = null;
      this.state.lastSyncAt = null;
    }
    this.writeState();
    this.syncProblem = null;
    this.status = "signedIn";
    this.email = session.email;
    this.notify();
    await this.writePendingProfile();
    this.syncSoon(0);
  }

  /** Alter und Einverständnis aus dem Registrieren ins Profil, sobald es eine Sitzung gibt. */
  async writePendingProfile() {
    const pending = this.state.pending;
    if (!pending) return;
    try {
      await this.client.upsertProfile(pending);
      this.state.pending = null;
      this.writeState();
    } catch {
      // Beim nächsten Anmelden noch einmal.
    }
  }

  async recover(email) {
    return this.busy(async () => {
      await this.client.recover(trimmed(email));
      return null;
    });
  }

  async resendConfirmation(email) {
    return this.busy(async () => {
      await this.client.resendConfirmation(trimmed(email));
      return null;
    });
  }

  /** Zurück zum Anmelden, z. B. nach dem Bestätigen der E-Mail auf einem anderen Gerät. */
  cancelConfirmation() {
    this.state.awaitingEmail = null;
    this.writeState();
    if (this.status === "awaitingConfirmation") {
      this.status = "signedOut";
      this.email = "";
      this.notify();
    }
  }

  /**
   * Der Link aus einer E-Mail von Supabase („E-Mail bestätigen“, „Passwort
   * zurücksetzen“) bringt die Sitzung hinter dem # mit. `params` sind diese
   * Felder. Gibt { type } zurück, z. B. "signup" oder "recovery", null ohne Link.
   */
  async handleLink(params) {
    if (params.has("error") || params.has("error_code")) {
      const code = params.get("error_code") ?? params.get("error");
      this.linkMessage = code === "otp_expired" ? "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an." : `Der Link hat nicht funktioniert (${code}).`;
      return { type: "error" };
    }
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    const type = params.get("type") ?? "";
    try {
      const user = await this.client.user(accessToken);
      const expiresAt = params.get("expires_at") ? Number(params.get("expires_at")) * 1000 : this.now().getTime() + (Number(params.get("expires_in")) || 3600) * 1000;
      const session = { accessToken, refreshToken, expiresAt, userID: user.id, email: user.email };
      this.client.adopt(session);
      await this.didSignIn(session);
      return { type };
    } catch (error) {
      this.linkMessage = describe(error);
      return { type: "error" };
    }
  }

  /** Die Meldung zum Link, einmal für die Anzeige. */
  takeLinkMessage() {
    const message = this.linkMessage;
    this.linkMessage = null;
    return message;
  }

  /** Neues Passwort nach dem Link „Passwort zurücksetzen“. null, wenn es geklappt hat. */
  async updatePassword(password) {
    if (password.length < MINIMUM_PASSWORD_LENGTH) return `Das Passwort braucht mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen.`;
    return this.busy(async () => {
      await this.client.updatePassword(password);
      return null;
    });
  }

  // MARK: - Abmelden und Löschen

  /** Abmelden: Die Daten bleiben in diesem Browser. */
  async signOut() {
    await this.busy(async () => {
      this.cancelScheduledSync();
      await this.client.signOut();
      this.clearLocalState();
      this.status = "signedOut";
      this.email = "";
      return null;
    });
  }

  /** „Meine Daten löschen“: die Anmeldung in diesem Browser vergessen, ohne den Server. */
  forgetSession() {
    this.cancelScheduledSync();
    this.client.forget();
    this.clearLocalState();
    this.state.awaitingEmail = null;
    this.writeState();
    this.status = "signedOut";
    this.email = "";
    this.notify();
  }

  /** Konto, Profil und Daten auf dem Server löschen. Die Daten in diesem Browser bleiben. */
  async deleteAccount() {
    return this.busy(async () => {
      this.cancelScheduledSync();
      await this.client.deleteAccount();
      this.clearLocalState();
      this.status = "signedOut";
      this.email = "";
      return null;
    });
  }

  clearLocalState() {
    this.state.revision = 0;
    this.state.userID = null;
    this.state.lastSyncAt = null;
    this.state.pushedHash = null;
    this.state.pending = null;
    this.writeState();
    this.syncProblem = null;
  }

  // MARK: - Abgleich

  /** Beim Öffnen der Seite und beim Zurückkehren. */
  syncIfSignedIn() {
    if (this.status === "signedIn") this.syncSoon(500);
  }

  syncSoon(milliseconds) {
    if (!this.autoSync) return;
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

  /**
   * Abgleich nach `action` in sync.js: laden, bei Bedarf zusammenführen,
   * hochladen. Hat ein anderes Gerät dazwischen geschrieben, noch einmal von
   * vorn, höchstens dreimal.
   */
  async sync() {
    if (this.status !== "signedIn" || this.isSyncing) return;
    this.cancelScheduledSync();
    this.isSyncing = true;
    this.notify();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const row = await this.client.fetchDocument();
        let document = this.document();
        const isDirty = (await hash(document.payloadText)) !== this.state.pushedHash;
        const what = syncAction(this.state.revision, isDirty, row ? row.revision : null);
        if (what === "nothing") {
          this.finishSync();
          return;
        }
        if (what === "merge") {
          if (!row) continue;
          this.applyRemote(row.document);
          document = this.document();
        }
        if (new TextEncoder().encode(document.text).length > MAXIMUM_DOCUMENT_BYTES) {
          this.syncProblem = TOO_LARGE;
          return;
        }
        const revision = await this.client.pushDocument(document.object, { expectedRevision: row ? row.revision : null, device: deviceName(), app: APP_NAME });
        if (revision != null) {
          this.state.revision = revision;
          this.state.pushedHash = await hash(document.payloadText);
          this.writeState();
          this.finishSync();
          return;
        }
        // Ein anderes Gerät hat dazwischen geschrieben: noch einmal mit dessen Stand.
      }
      this.syncProblem = BUSY_ELSEWHERE;
    } catch (error) {
      this.syncProblem = describe(error);
      if (error instanceof SupabaseError && error.isSessionProblem) {
        this.clearLocalState();
        this.status = "signedOut";
        this.email = "";
        this.syncProblem = error.message;
      }
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }

  finishSync() {
    this.state.lastSyncAt = this.now().getTime();
    this.writeState();
    this.syncProblem = null;
  }

  /** Das Dokument für den Server mit dem Zeitpunkt der letzten Änderung als Stand. */
  document() {
    return syncDocument(this.store.data, this.changedAt, APP_NAME);
  }

  /** Den Stand vom Server übernehmen: zusammenführen, nicht ersetzen. Ein kaputtes Dokument ist ein BackupError. */
  applyRemote(json) {
    const backup = readBackupJSON(json);
    this.store.applyRemote(backup, { localSavedAt: this.changedAt, now: this.now() });
  }
}
