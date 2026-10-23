// Stand des Abgleichs eines Teams mit dem Server, wie TeamSync im Kern der App
// (GolfCore/Sources/GolfCore/Team/TeamSync.swift): welchen Stand jeder Eintrag
// auf dem Server hat, was noch hochzuladen ist und bis wohin die Änderungen
// geholt sind. Reine Logik ohne Netz: team.js schickt die Anfragen aus
// teamapi.js ab und reicht die Antworten hier durch.
//
// Zwei Stände eines Eintrags führt `TeamData.apply` zusammen, der jüngere
// gewinnt. Was auf dem Server gelöscht ist, kommt als Löschmarke und gewinnt
// gegen eine lokale Änderung. Was der Server ablehnt, nimmt der Serverstand
// wieder ein.
import { ACCESS_RANK, COACH_VIEWER, TeamData, isItemName, parseRecordName, uid } from "./team.js";

/** So viele Einträge holt ein Abgleich auf einmal (`team_pull`). */
export const PULL_BATCH = 500;
/** So viele Änderungen schickt ein Abgleich auf einmal. Der Server nimmt bis zu 500. */
export const PUSH_BATCH = 200;
/** Nach 60 Tagen ohne Abgleich alles neu holen: Löschmarken räumt der Server nach 90 Tagen auf. */
export const FULL_PULL_AFTER = 60 * 24 * 60 * 60 * 1000;

export class TeamSync {
  constructor(teamID, memberID = null) {
    this.teamID = uid(teamID);
    /** Das eigene Mitglied, sobald der Server es nennt. */
    this.memberID = uid(memberID);
    /** Folge des letzten geholten Eintrags. 0: alles holen. */
    this.lastSeq = 0;
    /** Stand jedes Eintrags auf dem Server, nach Datensatznamen. */
    this.revisions = {};
    /** Geändert und noch nicht hochgeladen. */
    this.pendingSaves = new Set();
    /** Gelöscht und noch nicht hochgeladen, mit dem Stand, den der Server hatte. */
    this.pendingDeletes = {};
    /** Wann zuletzt alles geholt war, in Millisekunden seit 1970. */
    this.lastPull = null;
    /** Was dieses Mitglied beim letzten Abgleich sehen durfte. */
    this.access = null;
    this.isAdmin = false;
    /** Geheimnis des Links für Spieler, wenn der Server ihn zeigt. */
    this.joinSecret = null;
    /** Namen, die ein vollständiges Holen ab 0 bisher gebracht hat. null: kein vollständiges Holen. */
    this.seenNames = new Set();
    /** Einträge, die diese Version nicht lesen konnte. Nach einem Update holt retryUnreadable einmal alles neu. */
    this.unreadable = new Set();
    /** Version, für die retryUnreadable zuletzt alles neu geholt hat. */
    this.retriedVersion = null;
    /** Gelöscht ohne bekannten Stand: gemeldete Inhalte, die ein Admin nie gesehen hat. Der Server prüft. */
    this.forcedDeletes = new Set();
  }

  /** Aus dem Speicher des Browsers. Fehlende Felder bekommen ihren Standardwert. */
  static fromJSON(json) {
    if (!json || typeof json !== "object" || typeof json.teamID !== "string") return null;
    const sync = new TeamSync(json.teamID, typeof json.memberID === "string" ? json.memberID : null);
    sync.lastSeq = Number.isSafeInteger(json.lastSeq) && json.lastSeq >= 0 ? json.lastSeq : 0;
    sync.revisions = {};
    for (const [name, revision] of Object.entries(json.revisions ?? {})) {
      if (Number.isInteger(revision)) sync.revisions[name] = revision;
    }
    sync.pendingSaves = new Set(Array.isArray(json.pendingSaves) ? json.pendingSaves.filter((name) => typeof name === "string") : []);
    sync.pendingDeletes = {};
    for (const [name, revision] of Object.entries(json.pendingDeletes ?? {})) {
      if (Number.isInteger(revision)) sync.pendingDeletes[name] = revision;
    }
    sync.lastPull = Number.isFinite(json.lastPull) ? json.lastPull : null;
    sync.access = ["own", "organization", "everything"].includes(json.access) ? json.access : null;
    sync.isAdmin = json.isAdmin === true;
    sync.joinSecret = typeof json.joinSecret === "string" ? json.joinSecret : null;
    // Ohne Folge wurde noch nie etwas geholt: Das nächste Holen ist ein vollständiges.
    sync.seenNames = Array.isArray(json.seenNames) ? new Set(json.seenNames.filter((name) => typeof name === "string")) : sync.lastSeq === 0 ? new Set() : null;
    sync.unreadable = new Set(Array.isArray(json.unreadable) ? json.unreadable.filter((name) => typeof name === "string") : []);
    sync.retriedVersion = typeof json.retriedVersion === "string" ? json.retriedVersion : null;
    sync.forcedDeletes = new Set(Array.isArray(json.forcedDeletes) ? json.forcedDeletes.filter((name) => typeof name === "string") : []);
    return sync;
  }

  toJSON() {
    return {
      teamID: this.teamID,
      memberID: this.memberID,
      lastSeq: this.lastSeq,
      revisions: { ...this.revisions },
      pendingSaves: [...this.pendingSaves].sort(),
      pendingDeletes: { ...this.pendingDeletes },
      lastPull: this.lastPull,
      access: this.access,
      isAdmin: this.isAdmin,
      joinSecret: this.joinSecret,
      seenNames: this.seenNames ? [...this.seenNames].sort() : null,
      unreadable: [...this.unreadable].sort(),
      retriedVersion: this.retriedVersion,
      forcedDeletes: [...this.forcedDeletes].sort(),
    };
  }

  // MARK: - Stand

  /** Wie dieses Mitglied die Daten sieht, nach dem lokalen Stand. */
  viewer(data) {
    return { memberID: this.memberID, access: data.access(this.memberID), isAdmin: this.memberID != null && data.isAdmin(this.memberID) };
  }

  get hasPendingChanges() {
    return this.pendingSaves.size > 0 || Object.keys(this.pendingDeletes).length > 0 || this.forcedDeletes.size > 0;
  }

  /** Holt der nächste Abgleich alles ab 0? */
  /** Erst ein vollständiges Holen bis zur letzten Seite beendet es. Ein Team ohne Einträge behält die Folge 0 und gilt trotzdem als vollständig geholt. */
  get needsFullPull() {
    return this.seenNames != null;
  }

  scheduleFullPull() {
    this.lastSeq = 0;
    this.seenNames = new Set();
  }

  /** Vor einem Abgleich: lange nicht abgeglichen, dann alles neu holen. */
  prepareForPull(now) {
    if (this.lastPull != null && now.getTime() - this.lastPull > FULL_PULL_AFTER) this.scheduleFullPull();
  }

  /**
   * Nach einem Update: Gab es Einträge, die die alte Version nicht lesen
   * konnte, einmal alles neu holen. Gibt zurück, ob ein vollständiges Holen
   * ansteht. Bleiben sie unlesbar, passiert bis zur nächsten Version nichts mehr.
   */
  retryUnreadable(appVersion) {
    if (this.unreadable.size === 0 || this.retriedVersion === appVersion) return false;
    this.retriedVersion = appVersion;
    this.unreadable = new Set();
    this.scheduleFullPull();
    return true;
  }

  /** Lokal geändert: beim nächsten Abgleich hochladen. */
  markChanged(names) {
    for (const name of names) {
      this.pendingSaves.add(name);
      delete this.pendingDeletes[name];
      this.forcedDeletes.delete(name);
    }
  }

  /**
   * Lokal gelöscht: auf dem Server löschen. Was der Server nie hatte, braucht
   * dort nichts. `evenWithoutRevision`: auch ohne bekannten Stand, etwa
   * gemeldete Inhalte, die ein Admin nie gesehen hat; der Server prüft, ob er darf.
   */
  markDeleted(names, evenWithoutRevision = false) {
    for (const name of names) {
      this.pendingSaves.delete(name);
      if (Number.isInteger(this.revisions[name])) this.pendingDeletes[name] = this.revisions[name];
      else if (evenWithoutRevision) this.forcedDeletes.add(name);
    }
  }

  /** Alles vergessen, was dieses Gerät vom Server weiß, z. B. nach dem Austritt. */
  reset() {
    this.lastSeq = 0;
    this.revisions = {};
    this.pendingSaves = new Set();
    this.pendingDeletes = {};
    this.lastPull = null;
    this.access = null;
    this.isAdmin = false;
    this.joinSecret = null;
    this.seenNames = new Set();
    this.unreadable = new Set();
    this.retriedVersion = null;
    this.forcedDeletes = new Set();
  }

  // MARK: - Hochladen

  /** Die nächsten Änderungen für `team_push`, höchstens `limit` Stück. */
  batch(data, limit = PUSH_BATCH) {
    const batch = { items: [], deletions: [], stale: [] };
    for (const name of [...this.pendingSaves].sort()) {
      if (batch.items.length >= limit) break;
      const payload = data.get(name);
      if (!payload) {
        batch.stale.push(name);
        continue;
      }
      batch.items.push({ name, revision: this.revisions[name] ?? null, payload: JSON.parse(JSON.stringify(payload)), text: data.payload(name) });
    }
    for (const name of Object.keys(this.pendingDeletes).sort()) {
      if (batch.items.length + batch.deletions.length >= limit) break;
      batch.deletions.push({ name, revision: this.pendingDeletes[name] });
    }
    for (const name of [...this.forcedDeletes].sort()) {
      if (batch.items.length + batch.deletions.length >= limit) break;
      batch.deletions.push({ name, revision: null });
    }
    return batch;
  }

  /** Verbucht die Antwort auf ein `team_push`. */
  applyPush(result, batch, data) {
    const report = { changed: false, denied: [], invalid: [], removed: [] };
    const viewer = this.viewer(data);
    for (const name of batch.stale) this.pendingSaves.delete(name);
    const sent = new Map(batch.items.map((item) => [item.name, item.text]));
    const deleting = new Set(batch.deletions.map((deletion) => deletion.name));
    for (const entry of result.entries ?? []) {
      const name = entry.name;
      if (deleting.has(name) && !sent.has(name)) {
        this.applyDeletion(entry, name, viewer, data, report);
        continue;
      }
      switch (entry.outcome) {
        case "stored": {
          if (!Number.isInteger(entry.revision)) break;
          this.revisions[name] = entry.revision;
          const current = data.payload(name);
          if (current == null) {
            // Inzwischen gelöscht: jetzt auch auf dem Server.
            this.pendingSaves.delete(name);
            this.pendingDeletes[name] = entry.revision;
          } else if (current === sent.get(name)) {
            this.pendingSaves.delete(name);
          }
          // Sonst inzwischen wieder geändert: bleibt offen.
          break;
        }
        case "conflict": {
          const current = entry.current;
          if (!current) {
            this.pendingSaves.delete(name);
            break;
          }
          this.revisions[name] = current.revision;
          if (current.payload == null) {
            // Auf dem Server gelöscht: Das Löschen gewinnt.
            this.removeItem(name, data, report);
            break;
          }
          let outcome = null;
          try {
            outcome = data.apply(name, current.payload, viewer).outcome;
          } catch {
            outcome = null;
          }
          switch (outcome) {
            case "stored":
              this.pendingSaves.delete(name);
              report.changed = true;
              break;
            case "unchanged":
              this.pendingSaves.delete(name);
              break;
            case "keptLocal":
              // Unser Stand ist jünger: mit dem neuen Serverstand noch einmal.
              this.pendingSaves.add(name);
              break;
            case "merged":
              this.pendingSaves.add(name);
              report.changed = true;
              break;
            default:
              this.pendingSaves.delete(name);
          }
          break;
        }
        case "missing":
          // Auf dem Server gelöscht und schon aufgeräumt: Das Löschen gewinnt.
          delete this.revisions[name];
          this.removeItem(name, data, report);
          break;
        case "denied":
          this.pendingSaves.delete(name);
          report.denied.push(name);
          this.restore(entry.current, name, viewer, data, report);
          break;
        case "invalid":
          this.pendingSaves.delete(name);
          report.invalid.push(name);
          break;
        case "deleted":
          this.pendingSaves.delete(name);
          break;
        default:
          break;
      }
    }
    return report;
  }

  applyDeletion(entry, name, viewer, data, report) {
    // Jede Antwort erledigt ein Löschen ohne Stand; ein Konflikt macht daraus eines mit Stand.
    this.forcedDeletes.delete(name);
    switch (entry.outcome) {
      case "deleted":
        delete this.pendingDeletes[name];
        // Der Stand der Löschmarke: Mit ihm lässt sich der Eintrag wiederherstellen.
        if (Number.isInteger(entry.revision)) this.revisions[name] = entry.revision;
        else delete this.revisions[name];
        break;
      case "missing":
        delete this.pendingDeletes[name];
        delete this.revisions[name];
        break;
      case "conflict":
        // Inzwischen geändert. Das Löschen gilt trotzdem: mit dem neuen Stand noch einmal.
        if (entry.current) {
          this.pendingDeletes[name] = entry.current.revision;
          this.revisions[name] = entry.current.revision;
        } else {
          delete this.pendingDeletes[name];
        }
        break;
      case "denied":
        delete this.pendingDeletes[name];
        report.denied.push(name);
        this.restore(entry.current, name, viewer, data, report);
        break;
      case "invalid":
        delete this.pendingDeletes[name];
        report.invalid.push(name);
        break;
      default:
        delete this.pendingDeletes[name];
    }
  }

  /** Nach einer Ablehnung gilt der Serverstand, auch wenn der lokale jünger ist. */
  restore(current, name, viewer, data, report) {
    if (!current || current.payload == null) {
      // Nicht sichtbar oder gelöscht: lokal weg.
      delete this.revisions[name];
      this.removeItem(name, data, report);
      return;
    }
    this.revisions[name] = current.revision;
    data.remove(name);
    let outcome = null;
    try {
      outcome = data.apply(name, current.payload, viewer).outcome;
    } catch {
      outcome = null;
    }
    if (outcome !== "stored") report.removed.push(name);
    report.changed = true;
  }

  removeItem(name, data, report) {
    this.pendingSaves.delete(name);
    delete this.pendingDeletes[name];
    const hadIt = data.has(name);
    data.remove(name);
    if (hadIt) {
      report.removed.push(name);
      report.changed = true;
    }
  }

  // MARK: - Holen

  /**
   * Verbucht die Antwort auf ein `team_pull` (siehe `parsePull` in teamapi.js).
   * Team, Profile, Mitgliedschaften und Einladungen kommen immer ganz,
   * Einträge nur ab `lastSeq`.
   */
  applyPull(pull, data, now) {
    const report = { stored: [], removed: [], changed: false, isComplete: false, needsFullPull: false, teamGone: false, wasPending: false, isPending: false };
    report.wasPending = this.memberID != null && data.isPending(this.memberID);
    this.memberID = uid(pull.me);
    this.joinSecret = pull.joinSecret ?? null;
    if (pull.me == null || !pull.team) {
      // Kein Mitglied mehr: Team gelöscht, Profil gelöscht oder nie dabei.
      report.teamGone = true;
      return report;
    }
    // Team, Profile, Mitgliedschaften und Einladungen sind öffentlich.
    const expected = new Set();
    for (const row of [pull.team, ...pull.members, ...pull.memberships, ...pull.invites]) {
      expected.add(row.name);
      this.applyRow(row, COACH_VIEWER, data, report);
    }
    for (const name of data.allRecordNames()) {
      if (isItemName(name) || expected.has(name) || this.pendingSaves.has(name)) continue;
      delete this.revisions[name];
      this.removeLocal(name, data, report);
    }
    // Jetzt steht die eigene Rolle fest, und die Einträge folgen.
    const viewer = this.viewer(data);
    for (const item of pull.items) {
      this.seenNames?.add(item.name);
      this.applyRow(item, viewer, data, report);
      this.lastSeq = Math.max(this.lastSeq, item.seq ?? 0);
    }
    if (!pull.more) {
      if (this.seenNames) {
        // Vollständig geholt: Was der Server nicht mehr kennt, ist weg.
        for (const name of data.allRecordNames()) {
          if (!isItemName(name) || this.seenNames.has(name) || this.pendingSaves.has(name)) continue;
          delete this.revisions[name];
          this.removeLocal(name, data, report);
        }
        this.seenNames = null;
      }
      this.lastPull = now.getTime();
      report.isComplete = true;
    }
    // Rolle geändert?
    const after = this.viewer(data);
    const isPendingNow = this.memberID != null && data.isPending(this.memberID);
    if (report.wasPending && !isPendingNow) {
      // Frisch freigegeben: Bis eben kamen nur die eigenen Angaben, jetzt auch
      // Termine, Beiträge und Challenges von vor dem Beitritt. Alles neu holen.
      this.scheduleFullPull();
      report.needsFullPull = true;
    }
    if (this.access != null) {
      if (ACCESS_RANK[after.access] > ACCESS_RANK[this.access] || (after.isAdmin && !this.isAdmin)) {
        // Darf mehr sehen: Was früher nicht kam, jetzt holen.
        this.scheduleFullPull();
        report.needsFullPull = true;
      } else if (ACCESS_RANK[after.access] < ACCESS_RANK[this.access] || (!after.isAdmin && this.isAdmin)) {
        const hidden = data.removeHidden(after);
        for (const name of Object.keys(hidden)) {
          delete this.revisions[name];
          this.pendingSaves.delete(name);
          delete this.pendingDeletes[name];
          report.removed.push(name);
        }
        if (Object.keys(hidden).length > 0) report.changed = true;
      }
    }
    this.access = after.access;
    this.isAdmin = after.isAdmin;
    report.isPending = isPendingNow;
    return report;
  }

  applyRow(row, viewer, data, report) {
    const name = row.name;
    if (row.payload == null) {
      this.unreadable.delete(name);
      if (this.pendingSaves.has(name) && !Number.isInteger(this.revisions[name])) {
        // Lokal neu angelegt, der Server kennt nur eine alte Löschmarke, z. B.
        // die Angaben der Eltern nach dem Wiederbeitritt: Das Neue gewinnt und
        // belebt die Löschmarke beim Hochladen wieder.
        return;
      }
      // Löschmarke: Das Löschen gewinnt, auch gegen eine lokale Änderung.
      this.revisions[name] = row.revision;
      this.pendingSaves.delete(name);
      delete this.pendingDeletes[name];
      this.removeLocal(name, data, report);
      return;
    }
    let outcome;
    try {
      outcome = data.apply(name, row.payload, viewer).outcome;
    } catch {
      // Unlesbar, z. B. aus einer neueren Version. Die Folge geht weiter; nach einem Update holt retryUnreadable alles neu.
      this.unreadable.add(name);
      return;
    }
    this.unreadable.delete(name);
    switch (outcome) {
      case "stored": {
        this.revisions[name] = row.revision;
        this.pendingSaves.delete(name);
        report.changed = true;
        const parsed = parseRecordName(name);
        if (parsed) report.stored.push({ kind: parsed.kind, key: parsed.key });
        break;
      }
      case "unchanged":
        this.revisions[name] = row.revision;
        this.pendingSaves.delete(name);
        break;
      case "keptLocal":
        // Unser Stand ist jünger: hochladen, mit dem Stand des Servers.
        this.revisions[name] = row.revision;
        this.pendingSaves.add(name);
        break;
      case "merged":
        this.revisions[name] = row.revision;
        this.pendingSaves.add(name);
        report.changed = true;
        break;
      case "hidden":
        delete this.revisions[name];
        break;
      default:
        break;
    }
  }

  removeLocal(name, data, report) {
    const hadIt = data.has(name);
    data.remove(name);
    if (hadIt) {
      report.removed.push(name);
      report.changed = true;
    }
  }
}

export { TeamData };
