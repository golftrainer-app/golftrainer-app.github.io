// Spricht mit Supabase ohne SDK, wie SupabaseAPI im Kern und SupabaseClient in
// der App (GolfCore/Sources/GolfCore/Account/SupabaseAPI.swift,
// App/Sources/Account/SupabaseClient.swift): baut die Anfragen, schickt sie mit
// fetch, erneuert die Sitzung, bevor sie abläuft, und hält sie im Speicher des
// Browsers. Nichts hier kennt die Daten der App, nur ihr Dokument als JSON.
import { SUPABASE } from "./config.js";

/** So groß darf das Dokument sein, wie im Schema (supabase/schema.sql). */
export const MAXIMUM_DOCUMENT_BYTES = 2 * 1024 * 1024;
/** Ab hier hört der Abgleich auf, mit Puffer: Der Server misst das Dokument in seiner eigenen Form, die etwas größer sein kann als der Text. */
export const SAFE_DOCUMENT_BYTES = 1800 * 1024;
export const MINIMUM_PASSWORD_LENGTH = 8;
/** Die Sitzung im Speicher des Browsers. „Meine Daten löschen“ und Abmelden entfernen sie. */
export const SESSION_KEY = "golftrainer.konto.sitzung";

const UNEXPECTED = "Die Antwort des Servers ließ sich nicht lesen.";

/** Antwort des Servers, die kein Erfolg war, mit einem Satz für die Anzeige. */
export class SupabaseError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code ?? null;
  }

  /** Nicht angemeldet oder abgelaufen: Die Seite meldet sich ab. */
  get isSessionProblem() {
    return this.status === 401 || ["session_expired", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "invalid_grant"].includes(this.code ?? "");
  }
}

/** Satz für die Anzeige aus Status, Fehlercode und Text des Servers, wie SupabaseAPI.message in der App. */
export function errorMessage(status, code, raw) {
  // Ältere Fassung der Fehler: „invalid_grant“ mit dem Grund im Text.
  if (code === "invalid_grant" && String(raw ?? "").toLowerCase().includes("not confirmed")) return errorMessage(status, "email_not_confirmed", raw);
  switch (code) {
    case "invalid_credentials":
    case "invalid_grant":
      return "E-Mail-Adresse oder Passwort stimmt nicht.";
    case "email_not_confirmed":
      return "Bestätige zuerst deine E-Mail-Adresse. Sieh in deinem Postfach nach, auch im Spam-Ordner.";
    case "user_already_exists":
    case "email_exists":
      return "Mit dieser E-Mail-Adresse gibt es schon ein Konto. Melde dich an.";
    case "weak_password":
      return `Das Passwort ist zu schwach. Nimm mindestens ${MINIMUM_PASSWORD_LENGTH} Zeichen.`;
    case "same_password":
      return "Das ist schon dein Passwort.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
    case "over_sms_send_rate_limit":
      return "Zu viele Versuche in kurzer Zeit. Warte eine Stunde und versuche es noch einmal.";
    case "validation_failed":
    case "email_address_invalid":
      return "Prüfe die E-Mail-Adresse.";
    case "email_address_not_authorized":
      // Der eingebaute Mailversand von Supabase schickt nur an das Team des Projekts.
      return "An diese E-Mail-Adresse kann der Server noch keine Mails schicken. Der Mailversand ist beim Anbieter noch nicht eingerichtet.";
    case "signup_disabled":
      return "Zurzeit lassen sich keine Konten anlegen.";
    case "user_not_found":
      return "Zu dieser E-Mail-Adresse gibt es kein Konto.";
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "bad_jwt":
      return "Die Anmeldung ist abgelaufen. Melde dich noch einmal an.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "Dafür verlangt der Server eine frische Anmeldung. Melde dich ab und wieder an, dann versuche es gleich noch einmal.";
    case "P0001":
      // Eine Funktion des Servers (supabase/team.sql) mit einem Satz für die Anzeige.
      if (raw) return String(raw);
      break;
    case "42501":
      return "Dafür fehlt die Berechtigung.";
    case "23514":
      // Die Größenregel der Datenbank (supabase/schema.sql) kommt als 400, nicht als 413.
      if (String(raw ?? "").includes("document_size")) return "Die Daten sind zu groß für den Server, höchstens 2 MB.";
      break;
    default:
      break;
  }
  switch (status) {
    case 401:
      return "Nicht angemeldet. Melde dich noch einmal an.";
    case 403:
      return "Dafür fehlt die Berechtigung.";
    case 409:
      return "Auf dem Server liegt schon ein Stand. Der Abgleich wird wiederholt.";
    case 413:
      return "Die Daten sind zu groß für den Server, höchstens 2 MB.";
    case 429:
      return "Zu viele Anfragen in kurzer Zeit. Versuche es später noch einmal.";
    default:
      if (status >= 500) return "Der Server antwortet gerade nicht. Versuche es später noch einmal.";
      return raw ? `Der Server hat die Anfrage abgelehnt (${status}): ${raw}` : `Der Server hat die Anfrage abgelehnt (${status}).`;
  }
}

/**
 * Fehler aus Status und Antwort. Auth: {"code":400,"error_code":"…","msg":"…"}
 * oder {"error":"…","error_description":"…"}; Datenbank: {"code":"…","message":"…"}.
 */
export function errorFrom(status, json) {
  let code = null;
  let raw = null;
  if (json && typeof json === "object" && !Array.isArray(json)) {
    code = [json.error_code, json.error, json.code].find((value) => typeof value === "string") ?? null;
    raw = [json.msg, json.error_description, json.message].find((value) => typeof value === "string") ?? null;
  }
  return new SupabaseError(status, code, errorMessage(status, code, raw));
}

/** Sitzung aus der Antwort auf Anmelden oder Erneuern. `expiresAt` in Millisekunden. */
export function sessionFrom(json, now = Date.now()) {
  if (!json || typeof json !== "object" || typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || !json.user || typeof json.user.id !== "string") {
    throw new SupabaseError(200, "unexpected", UNEXPECTED);
  }
  let expiresAt;
  if (typeof json.expires_at === "number") expiresAt = json.expires_at * 1000;
  else if (typeof json.expires_in === "number") expiresAt = now + json.expires_in * 1000;
  else expiresAt = now + 3600 * 1000;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt,
    userID: json.user.id,
    email: typeof json.user.email === "string" ? json.user.email : "",
  };
}

/** Nach dem Registrieren: { kind: "signedIn", session } oder { kind: "confirmationSent" }. */
export function signUpOutcome(json, now = Date.now()) {
  try {
    return { kind: "signedIn", session: sessionFrom(json, now) };
  } catch {
    if (!json || typeof json !== "object" || (json.id == null && json.user == null)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
    // Gibt es die Adresse schon, antwortet Supabase bei eingeschalteter Bestätigung
    // wie bei einem neuen Konto, nur ohne Identitäten, damit niemand erraten kann,
    // wer ein Konto hat. Die Person wartete sonst auf eine Mail, die nie kommt.
    const user = json.user && typeof json.user === "object" ? json.user : json;
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      throw new SupabaseError(200, "user_already_exists", errorMessage(200, "user_already_exists", null));
    }
    return { kind: "confirmationSent" };
  }
}

/** Der neue Stand aus der Antwort auf Einfügen oder Ändern. null: Der Server hatte schon einen anderen Stand. */
export function revisionFrom(json) {
  if (!Array.isArray(json)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
  if (json.length === 0) return null;
  const revision = json[0]?.revision;
  if (!Number.isInteger(revision)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
  return revision;
}

/** Läuft die Sitzung in Kürze ab? Dann vorher erneuern. */
export function isExpiring(session, now = Date.now(), leeway = 60 * 1000) {
  return session.expiresAt - now < leeway;
}

// MARK: - Anfragen

function url(config, path, query = []) {
  const base = config.url.endsWith("/") ? config.url.slice(0, -1) : config.url;
  const search = new URLSearchParams(query).toString();
  return `${base}/${path}${search ? `?${search}` : ""}`;
}

function headers(config, accessToken, extra = {}) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${accessToken ?? config.anonKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

function request(method, config, path, { query = [], accessToken = null, body = undefined, headers: extra = {} } = {}) {
  return { method, url: url(config, path, query), headers: headers(config, accessToken, extra), body: body === undefined ? null : JSON.stringify(body) };
}

/** Die Anfragen an Auth und Datenbank, noch ohne Netz, wie SupabaseAPI in der App. */
export const requests = {
  signUp: (config, email, password) => request("POST", config, "auth/v1/signup", { body: { email, password } }),
  signIn: (config, email, password) => request("POST", config, "auth/v1/token", { query: [["grant_type", "password"]], body: { email, password } }),
  refresh: (config, refreshToken) => request("POST", config, "auth/v1/token", { query: [["grant_type", "refresh_token"]], body: { refresh_token: refreshToken } }),
  /** Abmelden, nur diese Sitzung: Ohne `scope=local` beendete Supabase alle Sitzungen des Kontos, auch die auf iPhone und iPad. */
  signOut: (config, session) => request("POST", config, "auth/v1/logout", { query: [["scope", "local"]], accessToken: session.accessToken, body: {} }),
  /** „Passwort vergessen“: Supabase schickt einen Link, der zur Web-App führt. */
  recover: (config, email) => request("POST", config, "auth/v1/recover", { body: { email } }),
  resendConfirmation: (config, email) => request("POST", config, "auth/v1/resend", { body: { type: "signup", email } }),
  /** Neues Passwort, mit der Sitzung aus dem Link der Mail oder der eigenen. */
  updatePassword: (config, accessToken, password) => request("PUT", config, "auth/v1/user", { accessToken, body: { password } }),
  user: (config, accessToken) => request("GET", config, "auth/v1/user", { accessToken }),
  /** Das Konto samt Profil und Daten löschen (delete_account() im Schema). */
  deleteAccount: (config, session) => request("POST", config, "rest/v1/rpc/delete_account", { accessToken: session.accessToken, body: {} }),
  upsertProfile: (config, session, { underSixteen, parentalConsent, consentAt }) =>
    request("POST", config, "rest/v1/profiles", {
      accessToken: session.accessToken,
      body: { user_id: session.userID, under_sixteen: underSixteen, parental_consent: parentalConsent, consent_at: consentAt ? new Date(consentAt).toISOString() : null },
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    }),
  /** Nur der Stand auf dem Server, ohne das Dokument: reicht, um zu sehen, ob es etwas Neues gibt, und kostet kaum Daten. */
  fetchRevision: (config, session) =>
    request("GET", config, "rest/v1/app_data", {
      query: [
        ["select", "revision"],
        ["user_id", `eq.${session.userID}`],
      ],
      accessToken: session.accessToken,
    }),
  fetchDocument: (config, session) =>
    request("GET", config, "rest/v1/app_data", {
      query: [
        ["select", "document,revision,device"],
        ["user_id", `eq.${session.userID}`],
      ],
      accessToken: session.accessToken,
    }),
  /** Erster Stand auf dem Server. `document` ist die Sicherungsdatei als Objekt. */
  insertDocument: (config, session, document, device, app) =>
    request("POST", config, "rest/v1/app_data", {
      query: [["select", "revision"]],
      accessToken: session.accessToken,
      body: { user_id: session.userID, device, app, document },
      headers: { Prefer: "return=representation" },
    }),
  /** Neuer Stand, nur wenn der Server noch `expectedRevision` hat. Sonst ändert sich nichts, und die Antwort ist eine leere Liste. */
  updateDocument: (config, session, expectedRevision, document, device, app) =>
    request("PATCH", config, "rest/v1/app_data", {
      query: [
        ["select", "revision"],
        ["user_id", `eq.${session.userID}`],
        ["revision", `eq.${expectedRevision}`],
      ],
      accessToken: session.accessToken,
      body: { device, app, document },
      headers: { Prefer: "return=representation" },
    }),
};

// MARK: - Schicken

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Gesperrt, z. B. wenn der Browser keine Website-Daten erlaubt.
    return null;
  }
}

export class SupabaseClient {
  constructor(config = SUPABASE, { fetch: fetchImpl = null, storage = defaultStorage(), now = () => Date.now() } = {}) {
    this.config = config;
    this.fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.storage = storage;
    this.now = now;
    this.session = this.loadSession();
  }

  loadSession() {
    try {
      const text = this.storage?.getItem(SESSION_KEY);
      if (!text) return null;
      const json = JSON.parse(text);
      if (typeof json.accessToken !== "string" || typeof json.refreshToken !== "string" || typeof json.userID !== "string") return null;
      return {
        accessToken: json.accessToken,
        refreshToken: json.refreshToken,
        expiresAt: Number(json.expiresAt) || 0,
        userID: json.userID,
        email: typeof json.email === "string" ? json.email : "",
      };
    } catch {
      return null;
    }
  }

  store(session) {
    this.session = session;
    try {
      this.storage?.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Kein Platz: Die Sitzung gilt, bis die Seite geschlossen wird.
    }
  }

  /** Die Sitzung auf diesem Gerät vergessen, ohne den Server. */
  forget() {
    this.session = null;
    try {
      this.storage?.removeItem(SESSION_KEY);
    } catch {
      // Nichts zu entfernen.
    }
  }

  /** Sitzung aus dem Link einer E-Mail übernehmen (Bestätigen, Passwort zurücksetzen). */
  adopt(session) {
    this.store(session);
  }

  // MARK: - Konto

  async signIn(email, password) {
    const json = await this.send(requests.signIn(this.config, email, password));
    const session = sessionFrom(json, this.now());
    this.store(session);
    return session;
  }

  async signUp(email, password) {
    const json = await this.send(requests.signUp(this.config, email, password));
    const outcome = signUpOutcome(json, this.now());
    if (outcome.kind === "signedIn") this.store(outcome.session);
    return outcome;
  }

  async recover(email) {
    await this.send(requests.recover(this.config, email));
  }

  async resendConfirmation(email) {
    await this.send(requests.resendConfirmation(this.config, email));
  }

  /** Abmelden: dem Server Bescheid sagen, wenn es geht, und die Sitzung vergessen. */
  async signOut() {
    if (this.session) {
      try {
        await this.send(requests.signOut(this.config, this.session));
      } catch {
        // Der Server erfährt es spätestens, wenn die Sitzung abläuft.
      }
    }
    this.forget();
  }

  /** Konto, Profil und Daten auf dem Server löschen. */
  async deleteAccount() {
    await this.authorized((session) => requests.deleteAccount(this.config, session));
    this.forget();
  }

  async updatePassword(password) {
    await this.authorized((session) => requests.updatePassword(this.config, session.accessToken, password));
  }

  /** Kennung und E-Mail-Adresse zu einem Zugangsschlüssel, z. B. aus dem Link einer Mail. */
  async user(accessToken) {
    const json = await this.send(requests.user(this.config, accessToken));
    if (!json || typeof json.id !== "string") throw new SupabaseError(200, "unexpected", UNEXPECTED);
    return { id: json.id, email: typeof json.email === "string" ? json.email : "" };
  }

  // MARK: - Profil und Daten

  async upsertProfile(profile) {
    await this.authorized((session) => requests.upsertProfile(this.config, session, profile));
  }

  /** Der Stand des Kontos auf dem Server, null, wenn dort noch nichts liegt. */
  async fetchRevision() {
    const json = await this.authorized((session) => requests.fetchRevision(this.config, session));
    if (!Array.isArray(json)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
    const row = json[0];
    if (!row) return null;
    if (!Number.isInteger(row.revision)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
    return row.revision;
  }

  /** Die Zeile des Kontos: { document, revision, device }, null, wenn noch keine auf dem Server liegt. */
  async fetchDocument() {
    const json = await this.authorized((session) => requests.fetchDocument(this.config, session));
    if (!Array.isArray(json)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
    const row = json[0];
    if (!row) return null;
    if (!row.document || typeof row.document !== "object" || !Number.isInteger(row.revision)) throw new SupabaseError(200, "unexpected", UNEXPECTED);
    return { document: row.document, revision: row.revision, device: typeof row.device === "string" ? row.device : "" };
  }

  /**
   * Neuer Stand auf dem Server. Mit `expectedRevision` nur, wenn der Server
   * noch diesen Stand hat, ohne nur, wenn dort noch nichts liegt. null heißt:
   * Ein anderes Gerät war schneller, nichts wurde geändert.
   */
  async pushDocument(document, { expectedRevision = null, device, app }) {
    if (expectedRevision != null) {
      return revisionFrom(await this.authorized((session) => requests.updateDocument(this.config, session, expectedRevision, document, device, app)));
    }
    try {
      return revisionFrom(await this.authorized((session) => requests.insertDocument(this.config, session, document, device, app)));
    } catch (error) {
      if (error instanceof SupabaseError && error.status === 409) return null;
      throw error;
    }
  }

  // MARK: - Schicken

  /** Mit gültiger Sitzung: Läuft sie bald ab, zuerst erneuern. Lehnt der Server sie trotzdem ab, einmal erneuern und wiederholen. */
  async authorized(make) {
    let current = this.session;
    if (!current) throw new SupabaseError(401, "signed_out", "Nicht angemeldet. Melde dich noch einmal an.");
    if (isExpiring(current, this.now())) current = await this.refresh(current);
    try {
      return await this.send(make(current));
    } catch (error) {
      if (!(error instanceof SupabaseError) || error.status !== 401) throw error;
      const renewed = await this.refresh(current);
      try {
        return await this.send(make(renewed));
      } catch (again) {
        // Auch mit frischer Sitzung abgelehnt: Sie gilt nicht mehr, sonst stünde die Seite nach dem Neuladen wieder auf „angemeldet“.
        if (again instanceof SupabaseError && again.status === 401) this.forget();
        throw again;
      }
    }
  }

  async refresh(current) {
    try {
      const json = await this.send(requests.refresh(this.config, current.refreshToken));
      const renewed = sessionFrom(json, this.now());
      this.store(renewed);
      return renewed;
    } catch (error) {
      if (error instanceof SupabaseError && (error.isSessionProblem || error.status === 400)) {
        // Die Sitzung gilt nicht mehr, z. B. nach dem Abmelden auf einem anderen Gerät.
        this.forget();
        throw new SupabaseError(401, error.code ?? "session_expired", "Die Anmeldung ist abgelaufen. Melde dich noch einmal an.");
      }
      throw error;
    }
  }

  /** Schickt eine Anfrage. Jede Antwort außer 2xx wird zu SupabaseError. */
  async send(request) {
    let response;
    try {
      response = await this.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout?.(30000),
        cache: "no-store",
        credentials: "omit",
      });
    } catch {
      throw new SupabaseError(0, "offline", "Keine Verbindung zum Server. Prüfe die Internetverbindung.");
    }
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!response.ok) throw errorFrom(response.status, json);
    return json;
  }
}
