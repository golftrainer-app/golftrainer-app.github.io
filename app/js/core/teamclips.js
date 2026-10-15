// Videos im Team: Die Dateien liegen im Speicher des Kontos (Supabase
// Storage) im privaten Bucket „team-clips“ unter <Team>/<Mitglied>/<Video>.mp4,
// der Eintrag dazu ist der Datensatz clip.<Video>. Wie TeamClipStorage im
// Kern der App (GolfCore/Sources/GolfCore/Team/TeamClipStorage.swift): reine
// Funktionen, team.js schickt die Anfragen über den SupabaseClient ab. Wer
// eine Datei lesen oder löschen darf, prüft der Server (supabase/team.sql).
// Die Web-App lädt Videos nur herunter und löscht sie. Hochladen geht in der
// App, die das Video auf den Schwung schneidet und verkleinert.
import { isUUID, uid } from "./team.js";
import { TeamAPIError, UNEXPECTED } from "./teamapi.js";

export const BUCKET = "team-clips";
export const CONTENT_TYPE = "video/mp4";
/** Dieselben Grenzen wie DataLimits im Kern und der Trigger auf dem Server. */
export const CLIP_LIMITS = { seconds: 6, bytes: 25 * 1024 * 1024, perMember: 10 };

export const PERSPECTIVE_NAMES = { faceOn: "Von vorne", downTheLine: "Von hinten (Ziellinie)", closeUp: "Nahaufnahme Ballkontakt", other: "Andere" };
export const SWING_TYPE_NAMES = { full: "Voller Schwung", pitch: "Pitch", chip: "Chip" };

/** Zum Beispiel „Eisen 7 · Von vorne“, wie SharedClip.title in der App. */
export function clipTitle(clip) {
  const club = String(clip?.club ?? "");
  const first = club === "" ? (SWING_TYPE_NAMES[clip?.swingType] ?? SWING_TYPE_NAMES.full) : club;
  return `${first} · ${PERSPECTIVE_NAMES[clip?.perspective] ?? PERSPECTIVE_NAMES.other}`;
}

/** Pfad der Datei im Bucket, Kennungen groß wie in den Datensatznamen. */
export function clipPath(teamID, memberID, clipID) {
  return `${uid(teamID)}/${uid(memberID)}/${uid(clipID)}.mp4`;
}

const VIDEO_FILE = /^(.*)\.(mp4|mov)$/i;

/** Kennung des Videos aus einem Dateinamen wie „<Video>.mp4“, sonst null. */
function clipIDOf(fileName) {
  const match = VIDEO_FILE.exec(String(fileName ?? ""));
  return match && isUUID(match[1]) ? uid(match[1]) : null;
}

/** Team, Mitglied und Video aus einem Pfad, z. B. aus einer Liste des Speichers. Null, wenn der Pfad nicht die erwartete Form hat. */
export function parseClipPath(path) {
  const parts = String(path ?? "").split("/");
  if (parts.length !== 3) return null;
  const [teamID, memberID, file] = parts;
  const clipID = clipIDOf(file);
  if (!isUUID(teamID) || !isUUID(memberID) || !clipID) return null;
  return { teamID: uid(teamID), memberID: uid(memberID), clipID };
}

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

/** Die Anfragen an den Speicher, noch ohne Netz. `session` ist die Sitzung des Kontos. */
export const clipRequests = {
  /** Hochladen, eine vorhandene Datei wird ersetzt (x-upsert). Nur zum Vergleich mit dem Kern: Die Web-App lädt nicht hoch. */
  upload: (config, session, path, data) => ({
    method: "POST",
    url: url(config, `storage/v1/object/${BUCKET}/${path}`),
    headers: headers(config, session, { "Content-Type": CONTENT_TYPE, "x-upsert": "true" }),
    body: data,
  }),
  /** Die Datei selbst, mit Sitzung: Der Server prüft, wer sie lesen darf. Die Antwort kommt als Blob (`binary`). */
  download: (config, session, path) => ({
    method: "GET",
    url: url(config, `storage/v1/object/authenticated/${BUCKET}/${path}`),
    headers: headers(config, session, { Accept: "*/*" }),
    body: undefined,
    binary: true,
  }),
  /** Eine oder mehrere Dateien löschen. Was es nicht gibt oder nicht gelöscht werden darf, fehlt in der Antwort, ohne Fehler. */
  delete: (config, session, paths) => ({
    method: "DELETE",
    url: url(config, `storage/v1/object/${BUCKET}`),
    headers: headers(config, session),
    body: JSON.stringify({ prefixes: paths }),
  }),
  /** Die Dateien im Ordner eines Mitglieds, z. B. zum Aufräumen. */
  list: (config, session, teamID, memberID) => ({
    method: "POST",
    url: url(config, `storage/v1/object/list/${BUCKET}`),
    headers: headers(config, session),
    body: JSON.stringify({ prefix: `${uid(teamID)}/${uid(memberID)}`, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  }),
};

/** Antwort auf `list`: Dateien mit Größe und Kennung des Videos, Ordner ohne. */
export function parseListed(json) {
  if (!Array.isArray(json)) throw new TeamAPIError(UNEXPECTED);
  return json
    .filter((row) => row && typeof row === "object" && typeof row.name === "string" && row.name !== "")
    .map((row) => {
      const size = row.metadata && typeof row.metadata === "object" ? row.metadata.size : null;
      return { name: row.name, bytes: typeof size === "number" && Number.isFinite(size) ? Math.trunc(size) : null, clipID: clipIDOf(row.name) };
    });
}

/** Pfade aus der Antwort auf `delete`: welche Dateien wirklich weg sind. */
export function parseDeleted(json) {
  if (!Array.isArray(json)) throw new TeamAPIError(UNEXPECTED);
  return json.filter((row) => row && typeof row === "object" && typeof row.name === "string").map((row) => row.name);
}
