// Das Konto und der Abgleich der eigenen Daten mit dem Server, wie
// AccountManager in der App (App/Sources/Account/AccountManager.swift). Ohne
// Anmeldung passiert hier nichts, die Web-App läuft wie bisher.
import { BackupError, readBackupJSON, syncDocument } from "./core/backup.js";
import { action as syncAction, stamp } from "./core/sync.js";
import { MINIMUM_PASSWORD_LENGTH, SAFE_DOCUMENT_BYTES, SupabaseClient, SupabaseError } from "./supabase.js";

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
    /** Die zuletzt angemeldete Adresse, um das Feld nach einer abgelaufenen Anmeldung vorzubelegen. Nur im Speicher. */
    this.lastEmail = this.client.session?.email ?? null;
    /** Eine Anfrage läuft gerade, z. B. Anmelden. */
    this.isBusy = false;
    this.isSyncing = false;
    /** Warum der letzte Abgleich nicht geklappt hat, null nach einem guten. */
    this.syncProblem = null;
    /** Warum die Seite abgemeldet wurde, z. B. eine abgelaufene Anmeldung; null nach dem Abmelden von Hand. */
    this.signedOutReason = null;
    /** Was ein Link aus einer E-Mail ergeben hat, für die Seite Konto. */
    this.linkMessage = null;
    /** Eine Sitzung aus einem Link, die erst nach einer Rückfrage gilt: { session, type }. */
    this.pendingLink = null;
    /** Nach dem Link „Passwort zurücksetzen“: Die Sitzung gilt nur zum Ändern, bis du entscheidest, ob sie bleibt. */
    this.pendingRecovery = false;
    /** Während ein Abgleich läuft, kam eine Änderung: danach noch einmal. */
    this.needsResync = false;
    this.isApplyingRemote = false;
    store.changed = (options) => this.dataDidChange(options);
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
    // Die Sitzung aus dem Link „Passwort zurücksetzen“ steht nur in dieser Seite; sie bleibt, bis du entscheidest.
    if (this.pendingRecovery) return;
    this.state = this.readState();
    this.client.session = this.client.loadSession();
    this.status = this.client.session ? "signedIn" : this.state.awaitingEmail ? "awaitingConfirmation" : "signedOut";
    this.email = this.client.session?.email ?? this.state.awaitingEmail ?? "";
    if (this.client.session) this.lastEmail = this.client.session.email;
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

  /**
   * Nach jeder Änderung der Daten: Zeitpunkt merken und, mit Konto, bald
   * abgleichen. `stamp: false` für Änderungen, die nicht von dir kommen, z. B.
   * neue Vorschläge zu Wochenbeginn: Sie zählen nicht als eigene Änderung,
   * sonst gewänne beim Zusammenführen die alte Golfwoche dieses Browsers
   * gegen die neuere eines anderen Geräts.
   */
  dataDidChange({ stamp: counts = true } = {}) {
    if (this.isApplyingRemote) return;
    if (counts) {
      this.state.changedAt = this.now().getTime();
      this.writeState();
    }
    if (this.status !== "signedIn") return;
    if (this.isSyncing) this.needsResync = true;
    else this.syncSoon(5000);
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

  /** null, wenn es geklappt hat, sonst der Satz für die Anzeige. `underSixteen` muss gewählt sein, nichts ist vorausgewählt. */
  async signUp({ email, password, underSixteen, parentalConsent }) {
    if (typeof underSixteen !== "boolean") return "Sag uns, ob du unter 16 bist.";
    if (underSixteen && !parentalConsent) return "Unter 16 geht es nur mit dem Einverständnis eines Elternteils.";
    if (password.length < MINIMUM_PASSWORD_LENGTH) return `Das Passwort braucht mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen.`;
    const address = trimmed(email);
    // Das Einverständnis zählt nur unter 16, sonst stünde im Profil etwas, das nicht gefragt war.
    const consent = underSixteen && Boolean(parentalConsent);
    return this.busy(async () => {
      // Alter und Einverständnis merken, bis die erste Anmeldung dieser Adresse
      // sie ins Profil schreibt. Mit der Adresse: Sie gehören zu diesem Konto,
      // nicht zu dem, das sich als Nächstes hier anmeldet.
      this.state.pending = { email: address, underSixteen, parentalConsent: consent, consentAt: consent ? this.now().getTime() : null };
      this.writeState();
      let outcome;
      try {
        outcome = await this.client.signUp(address, password);
      } catch (error) {
        // Ohne Konto bleibt nichts liegen, was ein anderes Konto bekäme.
        this.state.pending = null;
        this.writeState();
        throw error;
      }
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
    this.signedOutReason = null;
    this.pendingRecovery = false;
    this.status = "signedIn";
    this.email = session.email;
    this.lastEmail = session.email;
    this.notify();
    await this.writePendingProfile(session);
    this.syncSoon(0);
  }

  /**
   * Alter und Einverständnis aus dem Registrieren ins Profil, sobald es eine
   * Sitzung dieser Adresse gibt. Meldet sich ein anderes Konto an, fällt der
   * Rest weg: Er gehört nicht in dessen Profil.
   */
  async writePendingProfile(session) {
    const pending = this.state.pending;
    if (!pending) return;
    if (typeof pending.email !== "string" || trimmed(pending.email) !== trimmed(session?.email ?? "")) {
      this.state.pending = null;
      this.writeState();
      return;
    }
    try {
      await this.client.upsertProfile({ underSixteen: pending.underSixteen, parentalConsent: pending.parentalConsent, consentAt: pending.consentAt });
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
   * Felder. Gibt { type } zurück: "signup" (angemeldet), "recovery" (Sitzung
   * nur zum Ändern des Passworts), "confirm" (erst nach einer Rückfrage
   * anmelden), "error", null ohne Link.
   *
   * Ohne Rückfrage meldet nur der Link an, dessen Adresse in diesem Browser
   * registriert wurde. Jeder andere Link könnte von jemand anderem stammen:
   * Er meldete den Browser in einem fremden Konto an, und deine Daten gingen
   * dorthin. Deshalb zeigt die Seite Konto die Adresse und fragt.
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
      if (type === "recovery") {
        // Nur zum Ändern des Passworts, nur in dieser Seite: Nach dem Neuladen
        // ist der Browser nicht angemeldet, bis du nach dem neuen Passwort
        // „bleiben“ wählst. Sonst machte ein untergeschobener Link den Browser
        // zum Gerät eines fremden Kontos, und der Abgleich schickte deine
        // Daten dorthin.
        this.client.adopt(session, { persist: false });
        this.pendingRecovery = true;
        this.status = "signedIn";
        this.email = session.email;
        this.notify();
        return { type };
      }
      if (this.state.awaitingEmail && trimmed(this.state.awaitingEmail) === trimmed(user.email)) {
        this.client.adopt(session);
        await this.didSignIn(session);
        return { type: "signup" };
      }
      this.pendingLink = { session, type };
      this.notify();
      return { type: "confirm" };
    } catch (error) {
      this.linkMessage = describe(error);
      return { type: "error" };
    }
  }

  /** Nach der Rückfrage zu einem Link: anmelden. */
  async acceptPendingLink() {
    const pending = this.pendingLink;
    if (!pending) return;
    this.pendingLink = null;
    this.client.adopt(pending.session);
    await this.didSignIn(pending.session);
  }

  /** Nach der Rückfrage zu einem Link: nicht anmelden. Die Adresse ist trotzdem bestätigt. */
  discardPendingLink() {
    this.pendingLink = null;
    this.notify();
  }

  /**
   * Nach dem neuen Passwort: Die Sitzung aus dem Link bleibt (`stay`), oder
   * sie wird vergessen, z. B. auf einem fremden Gerät. Erst mit „bleiben“
   * beginnt der Abgleich.
   */
  async finishRecovery(stay) {
    const session = this.client.session;
    this.pendingRecovery = false;
    if (stay && session) {
      this.client.keep();
      await this.didSignIn(session);
      return;
    }
    this.client.forget();
    this.status = "signedOut";
    this.email = "";
    this.notify();
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

  /** Abmelden, nur diesen Browser: Die Daten bleiben hier. */
  async signOut() {
    await this.busy(async () => {
      this.cancelScheduledSync();
      await this.client.signOut();
      this.clearLocalState();
      this.signedOutReason = null;
      this.pendingRecovery = false;
      this.status = "signedOut";
      this.email = "";
      return null;
    });
  }

  /** Die Anmeldung gilt nicht mehr, z. B. abgelaufen: abmelden und den Grund zeigen. Die Daten bleiben. */
  signOutLocally(reason) {
    this.cancelScheduledSync();
    this.client.forget();
    this.clearLocalState();
    this.pendingRecovery = false;
    this.pendingLink = null;
    this.status = "signedOut";
    this.email = "";
    this.signedOutReason = reason;
    this.syncProblem = reason;
    this.notify();
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

  /** Beim Öffnen der Seite, beim Zurückkehren und wenn das Netz zurückkommt. */
  syncIfSignedIn() {
    if (this.status === "signedIn") this.syncSoon(500);
  }

  /**
   * Beim Verlassen der Seite: sofort, ohne Wartezeit. Im Hintergrund frieren
   * Browser auf dem Handy die Zeitgeber ein, der Abgleich käme sonst erst beim
   * nächsten Öffnen.
   */
  syncBeforeLeaving() {
    if (this.status !== "signedIn") return;
    this.cancelScheduledSync();
    this.sync();
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
   * Abgleich nach `action` in sync.js: zuerst nur den Stand laden, bei Bedarf
   * das Dokument, zusammenführen, hochladen. Hat ein anderes Gerät dazwischen
   * geschrieben, noch einmal von vorn, höchstens dreimal. Ist der eigene
   * Stand nach dem Zusammenführen derselbe wie auf dem Server, gibt es
   * nichts hochzuladen.
   */
  async sync() {
    if (this.status !== "signedIn" || this.isSyncing || this.pendingRecovery) return;
    this.cancelScheduledSync();
    this.isSyncing = true;
    this.needsResync = false;
    this.notify();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remoteRevision = await this.client.fetchRevision();
        let document = this.document();
        const isDirty = (await hash(document.payloadText)) !== this.state.pushedHash;
        const what = syncAction(this.state.revision, isDirty, remoteRevision);
        if (what === "nothing") {
          this.finishSync();
          return;
        }
        let expectedRevision = remoteRevision;
        if (what === "merge") {
          const row = await this.client.fetchDocument();
          if (!row) continue;
          expectedRevision = row.revision;
          const outcome = this.applyRemote(row.document);
          document = this.document();
          if (outcome.sameAsRemote) {
            // Alles Neue kam vom Server, hier gibt es nichts, was dort fehlt.
            this.state.revision = row.revision;
            this.state.pushedHash = await hash(document.payloadText);
            this.writeState();
            this.finishSync();
            return;
          }
        }
        if (new TextEncoder().encode(document.text).length > SAFE_DOCUMENT_BYTES) {
          this.syncProblem = TOO_LARGE;
          return;
        }
        const revision = await this.client.pushDocument(document.object, { expectedRevision, device: deviceName(), app: APP_NAME });
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
        this.signOutLocally(error.message);
      }
    } finally {
      this.isSyncing = false;
      this.notify();
      if (this.needsResync && this.status === "signedIn") {
        this.needsResync = false;
        this.syncSoon(5000);
      }
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

  /**
   * Den Stand vom Server übernehmen: zusammenführen, nicht ersetzen. Ein
   * kaputtes Dokument ist ein BackupError. Beim ersten Abgleich nach dem
   * Anmelden gelten die Einstellungen des Kontos. Danach zählt als Zeitpunkt
   * der letzten Änderung der jüngere von beiden, nicht „jetzt“.
   */
  applyRemote(json) {
    const backup = readBackupJSON(json);
    const preferRemoteSettings = this.state.revision === 0;
    this.isApplyingRemote = true;
    let outcome;
    try {
      outcome = this.store.applyRemote(backup, { localSavedAt: this.changedAt, now: this.now(), preferRemoteSettings });
    } finally {
      this.isApplyingRemote = false;
    }
    this.state.changedAt = stamp(this.changedAt, backup.createdAt).getTime();
    this.writeState();
    return outcome;
  }
}
