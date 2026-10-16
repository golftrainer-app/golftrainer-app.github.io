// Eigene Termine im Kalender der Startseite, z. B. eine Trainerstunde oder
// eine Runde mit Freunden, wie Appointment im Kern
// (GolfCore/Sources/GolfCore/Model/Appointment.swift). Nach dem Termin geht
// er mit einem Tipp ins Tagebuch. Gespeichert im JSON der App.
import { fromStored, toStored } from "./dates.js";

export const APPOINTMENT_KINDS = ["lesson", "round", "practice", "fitness", "other"];

export const APPOINTMENT_KIND_NAMES = {
  lesson: "Trainerstunde",
  round: "Runde",
  practice: "Training",
  fitness: "Athletik",
  other: "Termin",
};

/** Art des Eintrags im Tagebuch, wenn der Termin übernommen wird. */
const TRAINING_KINDS = { lesson: "lesson", round: "round", practice: "free", fitness: "fitness", other: "other" };

/** Dauer bis zu einem ganzen Tag. */
export const APPOINTMENT_MINUTES = [1, 24 * 60];

const EARLIEST = Date.UTC(1970, 0, 1);
const LATEST = Date.UTC(2200, 0, 1);
const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

function validDate(date) {
  const time = date?.getTime?.();
  return Number.isFinite(time) && time >= EARLIEST && time <= LATEST;
}

/** Zeitpunkt aus dem JSON, nil bei falscher Art von Wert. */
function storedDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return fromStored(value);
}

const textOr = (value, fallback) => (typeof value === "string" ? value : fallback);
const limited = (value, limit) => ([...value].length > limit ? [...value].slice(0, limit).join("") : value);
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

/**
 * Ein Termin aus dem JSON der App. Fehlt ein Feld, gilt sein Standardwert,
 * eine unbekannte Art wird „Termin“. Ohne Kennung oder mit einem Beginn, der
 * nicht stimmen kann, gibt es null, wie `sanitized` in der App.
 */
export function decodeAppointment(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  if (typeof json.id !== "string" || !UUID_RE.test(json.id)) return null;
  const start = storedDate(json.start);
  if (!start) return null;
  return sanitizeAppointment({
    id: json.id.toUpperCase(),
    kind: APPOINTMENT_KINDS.includes(json.kind) ? json.kind : "other",
    title: textOr(json.title, ""),
    start,
    minutes: Number.isInteger(json.minutes) ? json.minutes : 60,
    place: textOr(json.place, ""),
    note: textOr(json.note, ""),
    trainingEntryID: typeof json.trainingEntryID === "string" ? json.trainingEntryID : null,
    updatedAt: storedDate(json.updatedAt) ?? start,
  });
}

/** Im Bereich der Eingabe. Null bei einem unmöglichen Beginn. */
export function sanitizeAppointment(appointment) {
  if (!validDate(appointment.start)) return null;
  return {
    ...appointment,
    title: limited(appointment.title, 100),
    minutes: clamp(appointment.minutes, APPOINTMENT_MINUTES),
    place: limited(appointment.place, 100),
    note: limited(appointment.note, 1000),
    trainingEntryID: appointment.trainingEntryID == null ? null : limited(appointment.trainingEntryID, 200),
    updatedAt: validDate(appointment.updatedAt) ? appointment.updatedAt : appointment.start,
  };
}

/** Im JSON der App. Ohne Eintrag im Tagebuch fehlt `trainingEntryID`. */
export function encodeAppointment(appointment) {
  const json = {
    id: appointment.id,
    kind: appointment.kind,
    title: appointment.title,
    start: toStored(appointment.start),
    minutes: appointment.minutes,
    place: appointment.place,
    note: appointment.note,
    updatedAt: toStored(appointment.updatedAt),
  };
  if (appointment.trainingEntryID != null) json.trainingEntryID = appointment.trainingEntryID;
  return json;
}

export function appointmentEnd(appointment) {
  return new Date(appointment.start.getTime() + appointment.minutes * 60000);
}

/** Der Titel oder, wenn keiner da ist, der Name der Art. */
export function appointmentTitle(appointment) {
  const trimmed = appointment.title.trim();
  return trimmed || APPOINTMENT_KIND_NAMES[appointment.kind] || "Termin";
}

/**
 * Der Eintrag fürs Tagebuch: gleiche Zeit, Dauer und Notiz, die Art passend.
 * Der Titel kommt vor die Notiz, wenn es einen eigenen gibt.
 */
export function appointmentTrainingEntry(appointment, id, now, memberID) {
  const parts = [appointment.title.trim(), appointment.note.trim()].filter((part) => part.length > 0);
  return {
    id,
    memberID,
    start: new Date(appointment.start.getTime()),
    minutes: clamp(appointment.minutes, APPOINTMENT_MINUTES),
    kind: TRAINING_KINDS[appointment.kind] ?? "other",
    place: appointment.kind === "round" ? "course" : null,
    areaMinutes: {},
    drills: [],
    note: parts.join(". "),
    effort: null,
    updatedAt: now,
  };
}
