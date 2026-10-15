// Abgleich über das Konto: die Regeln aus AccountSync im Kern
// (GolfCore/Sources/GolfCore/Model/AccountSync.swift), übertragen auf die
// dekodierten Daten der Web-App. Reine Funktionen. Beispiele dazu schreibt der
// Swift-Test WebParityTests in Fixtures/web-planner.json, test/parity.test.mjs
// prüft sie.

/** So lange bleibt eine Löschmarke, in Millisekunden: 180 Tage. */
export const DELETION_RETENTION = 180 * 24 * 60 * 60 * 1000;
export const MAXIMUM_DELETIONS = 2000;
/** Listen, aus denen gelöscht wird, benannt wie das Feld in den Daten. */
export const DELETION_KINDS = ["trainingLog", "launchSessions", "analyses", "tournaments", "focusPoints", "rounds"];

/**
 * Was mit dem Server zu tun ist: "nothing", "push" oder "merge".
 * `localRevision` ist der Stand, den das Gerät zuletzt vom Server kannte, 0
 * vor dem ersten Abgleich. `isDirty`: Seitdem gab es Änderungen hier.
 * `remoteRevision`: der Stand auf dem Server, null, wenn dort noch nichts
 * liegt. Ein kleinerer Stand als der bekannte, z. B. nach einem neuen Konto,
 * zählt wie ein fremder: zusammenführen.
 */
export function action(localRevision, isDirty, remoteRevision) {
  if (remoteRevision == null) return "push";
  if (remoteRevision === localRevision) return isDirty ? "push" : "nothing";
  return "merge";
}

/**
 * Der Wert aus dem neueren Stand, bei Gleichstand der vom Server. Für
 * Einstellungen wie Golfwoche oder Spielhand. Bei Gleichstand zählt immer der
 * Server, damit zwei Geräte mit demselben Stand nicht abwechselnd ihren
 * eigenen Wert hochladen.
 */
export function newer(local, localSavedAt, remote, remoteSavedAt) {
  return remoteSavedAt >= localSavedAt ? remote : local;
}

/**
 * Der Zeitpunkt der letzten Änderung nach dem Zusammenführen: der jüngere von
 * beiden. Übernommene Änderungen zählen nicht als eigene, sonst wäre jedes
 * Gerät nach jedem Abgleich „jünger“ als der Server und gewänne beim nächsten
 * Mal mit seinem alten Stand.
 */
export function stamp(localSavedAt, remoteSavedAt) {
  return remoteSavedAt.getTime() > localSavedAt.getTime() ? remoteSavedAt : localSavedAt;
}

function mergedItems(local, localSavedAt, remote, remoteSavedAt, deleted, updatedAt) {
  const remoteByID = new Map();
  for (const item of remote) {
    const key = String(item.id);
    if (!remoteByID.has(key)) remoteByID.set(key, item);
  }
  const seen = new Set();
  const items = [];
  for (const item of local) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (deleted.has(key)) continue;
    const other = remoteByID.get(key);
    if (!other) {
      items.push(item);
      continue;
    }
    const localTime = updatedAt(item);
    const remoteTime = updatedAt(other);
    if (localTime != null && remoteTime != null) items.push(remoteTime >= localTime ? other : item);
    else items.push(remoteSavedAt >= localSavedAt ? other : item);
  }
  for (const item of remote) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (deleted.has(key)) continue;
    items.push(item);
  }
  return items;
}

/**
 * Zwei Listen zu einer: alles von beiden, jede Kennung einmal. Gibt es einen
 * Eintrag auf beiden Seiten, zählt bei Einträgen mit eigenem Zeitpunkt
 * (`updatedAt`) der neuere, sonst der aus dem neueren Stand, bei Gleichstand
 * der vom Server. Was eine Löschmarke der Liste `kind` nennt, fehlt; eine
 * Marke mit `restored` hebt die Löschung auf. Reihenfolge: die eigene Liste,
 * dann, was nur der andere Stand hat.
 */
export function merged(local, localSavedAt, remote, remoteSavedAt, { deletions = [], kind = null, updatedAt = () => null } = {}) {
  const deleted = new Set(deletions.filter((deletion) => deletion.kind === kind && !deletion.restored).map((deletion) => deletion.id));
  return mergedItems(local, localSavedAt, remote, remoteSavedAt, deleted, updatedAt);
}

/** Übung plus geplante Einheit oder Trainer-Einheit. Freie Übungen haben keinen Schlüssel. */
function sessionKey(result) {
  const reference = result.planReference;
  if (reference) {
    const weekStart = reference.weekStart instanceof Date ? reference.weekStart.getTime() : reference.weekStart;
    return `plan|${weekStart}|${reference.slotID}|${result.drillID}`;
  }
  if (result.sessionID) return `session|${result.sessionID}|${result.drillID}`;
  return null;
}

/** Von zwei Ergebnissen derselben Einheit bleibt das zuerst eingetragene, bei gleichem Zeitpunkt das mit der kleineren Kennung. */
function prevails(result, other) {
  const time = (value) => (value instanceof Date ? value.getTime() : Number(value));
  if (time(result.date) !== time(other.date)) return time(result.date) < time(other.date);
  return String(result.id) < String(other.id);
}

/**
 * Ergebnisse: wie `merged`, ohne Löschmarken. Dazu gibt es Ergebnisse derselben
 * Übung in derselben geplanten Einheit oder Trainer-Einheit nur einmal, auch
 * von zwei Geräten mit zwei Kennungen, wie mergeResults in backup.js. Sonst
 * stiege die Stufe zu früh. Beide Geräte behalten dasselbe Ergebnis.
 */
export function mergedResults(local, localSavedAt, remote, remoteSavedAt) {
  const items = mergedItems(local, localSavedAt, remote, remoteSavedAt, new Set(), () => null);
  const winners = new Map();
  for (const result of items) {
    const key = sessionKey(result);
    if (key == null) continue;
    const other = winners.get(key);
    if (other && !prevails(result, other)) continue;
    winners.set(key, result);
  }
  return items.filter((result) => {
    const key = sessionKey(result);
    return key == null || winners.get(key)?.id === result.id;
  });
}

/** Jüngste zuerst, bei gleichem Zeitpunkt nach Liste und Kennung, damit beide Seiten dieselbe Reihenfolge haben. */
function byAge(a, b) {
  const difference = b.at.getTime() - a.at.getTime();
  if (difference !== 0) return difference;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Löschmarken beider Stände: jede Kennung einmal mit dem jüngsten Zeitpunkt,
 * ohne die, die älter als DELETION_RETENTION sind, höchstens MAXIMUM_DELETIONS.
 */
export function mergedDeletions(local, remote, now) {
  const newest = new Map();
  for (const deletion of [...local, ...remote]) {
    const key = `${deletion.kind}|${deletion.id}`;
    const existing = newest.get(key);
    if (existing && existing.at.getTime() >= deletion.at.getTime()) continue;
    newest.set(key, deletion);
  }
  const cutoff = now.getTime() - DELETION_RETENTION;
  return [...newest.values()]
    .filter((deletion) => deletion.at.getTime() >= cutoff)
    .sort(byAge)
    .slice(0, MAXIMUM_DELETIONS);
}

/** Eine neue Löschmarke zu den vorhandenen: dieselbe Kennung nur einmal, höchstens MAXIMUM_DELETIONS. */
export function noting(deletion, deletions) {
  const others = deletions.filter((other) => !(other.kind === deletion.kind && other.id === deletion.id));
  return [deletion, ...others].sort(byAge).slice(0, MAXIMUM_DELETIONS);
}

/**
 * Nach dem Übernehmen einer Sicherung: Für Kennungen, die hier eine Löschmarke
 * haben, kommt eine jüngere Marke mit `restored` dazu. Sonst verschwände der
 * zurückgeholte Eintrag beim nächsten Abgleich wieder.
 */
export function restoring(ids, kind, now, deletions) {
  const marked = new Set(deletions.filter((deletion) => deletion.kind === kind && !deletion.restored).map((deletion) => deletion.id));
  let result = deletions;
  for (const id of ids) {
    if (marked.has(id)) result = noting({ kind, id, at: now, restored: true }, result);
  }
  return result;
}

/**
 * Die eigenen Daten mit dem Stand vom Server, wie AppData.merged(with:) in der
 * App: alles von beiden Seiten, Gelöschtes bleibt gelöscht, bei Einstellungen
 * zählt der jüngere Stand, die Erinnerung gehört zu diesem Gerät. Was die
 * Web-App nicht bearbeitet (`extra`), kommt vom Server, denn hier ändert es
 * sich nie. Schwunganalysen darin löscht die Web-App seit Oktober 2026, darum
 * werden sie wie die übrigen Listen zusammengeführt, mit Löschmarken, so wie
 * `AccountSync.merged` in der App. `preferRemoteSettings`: beim ersten Abgleich
 * nach dem Anmelden gelten die Einstellungen des Kontos, nicht die der eben
 * erst beantworteten Einrichtung.
 */
export function mergedData(local, remote, { localSavedAt, remoteSavedAt, now, preferRemoteSettings = false }) {
  const deletions = mergedDeletions(local.deletions ?? [], remote.deletions ?? [], now);
  const list = (key, updatedAt) => merged(local[key], localSavedAt, remote[key], remoteSavedAt, { deletions, kind: key, updatedAt });
  const either = (mine, theirs) => (mine == null ? theirs : theirs == null ? mine : preferRemoteSettings ? theirs : newer(mine, localSavedAt, theirs, remoteSavedAt));
  const localWins = !preferRemoteSettings && localSavedAt.getTime() > remoteSavedAt.getTime();
  return {
    ...local,
    deletions,
    results: mergedResults(local.results, localSavedAt, remote.results, remoteSavedAt),
    trainingLog: list("trainingLog", (entry) => entry.updatedAt),
    launchSessions: list("launchSessions"),
    tournaments: list("tournaments"),
    focusPoints: list("focusPoints"),
    rounds: list("rounds"),
    golfWeek: either(local.golfWeek, remote.golfWeek),
    handedness: either(local.handedness, remote.handedness),
    weekPlan: either(local.weekPlan, remote.weekPlan),
    // Gespeicherte Spaltenzuordnungen: beide, bei gleichem Namen die aus dem jüngeren Stand.
    csvMappings: localWins ? { ...(remote.csvMappings ?? {}), ...(local.csvMappings ?? {}) } : { ...(local.csvMappings ?? {}), ...(remote.csvMappings ?? {}) },
    extra: mergedExtra(local.extra, remote.extra, localSavedAt, remoteSavedAt, deletions),
  };
}

function mergedExtra(local, remote, localSavedAt, remoteSavedAt, deletions) {
  const extra = { ...(local ?? {}), ...(remote ?? {}) };
  if (Array.isArray(local?.analyses) || Array.isArray(remote?.analyses)) {
    const list = (value) => (Array.isArray(value) ? value.filter((item) => item?.id != null) : []);
    extra.analyses = merged(list(local?.analyses), localSavedAt, list(remote?.analyses), remoteSavedAt, { deletions, kind: "analyses" });
  }
  return extra;
}
