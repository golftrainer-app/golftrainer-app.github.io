// Kalender wie in der App: Die Woche beginnt am Montag, gerechnet wird in der
// Zeitzone des Geräts. Daten speichert die App als Sekunden seit dem
// 1. Januar 2001 (so schreibt sie auch die Datensicherung), hier sind es Date-Objekte.

/** 1. Januar 2001, 00:00 UTC, in Millisekunden seit 1970. */
const REFERENCE_EPOCH = 978307200000;
const DAY = 86400000;

/** Zeitpunkt aus der Datensicherung: Sekunden seit 2001 oder, aus älteren Versionen, Text nach ISO 8601. */
export function fromStored(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "string") return new Date(value);
  return new Date(REFERENCE_EPOCH + value * 1000);
}

/** Zeitpunkt für die Datensicherung: Sekunden seit 2001. */
export function toStored(date) {
  return (date.getTime() - REFERENCE_EPOCH) / 1000;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Kalendertage weiter, die Uhrzeit bleibt (auch über die Zeitumstellung). */
export function addDays(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

/** Montag, 0 Uhr, der Woche von `date`. */
export function startOfWeek(date) {
  const offset = (date.getDay() + 6) % 7;
  return startOfDay(addDays(date, -offset));
}

/** Derselbe Tag mit anderer Uhrzeit. */
export function atTime(day, hour, minute) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** Ganze Kalendertage von `from` bis `to`, z. B. 1 für morgen. */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/** Liegen beide Zeitpunkte in derselben Woche (Montag bis Sonntag)? */
export function sameWeek(a, b) {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

/**
 * Gilt ein Wochenplan für `date`? Gemessen an der Mitte der Woche, wie in der
 * App: So bleibt der Plan nach einer Reise in eine andere Zeitzone derselbe.
 */
export function planCovers(weekStart, date) {
  return sameWeek(new Date(weekStart.getTime() + 3.5 * DAY), date);
}

/**
 * Nummer des Kalendertags vor Ort, gezählt ab dem 1. Januar 1970, für die
 * Startwerte der Ansagen. Gleich für jede Uhrzeit des Tages, in UTC genau die
 * Tage seit 1970. Wie `ChallengeGenerator.dayNumber` in der App.
 */
export function localDayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

// MARK: - Anzeige

const dateFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const shortDateFormat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/** „Dienstag, 6. Oktober“ */
export function formatDay(date) {
  return dateFormat.format(date);
}

/** „6. Okt. 2026“ */
export function formatShortDate(date) {
  return shortDateFormat.format(date);
}

/** „17:00“ */
export function formatTime(date) {
  return timeFormat.format(date);
}

/** Wert für ein Eingabefeld `type="date"`, z. B. „2026-10-06“, in der Zeitzone des Geräts. */
export function toDateInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Wert für ein Eingabefeld `type="time"`, z. B. „09:30“. */
export function toTimeInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Datum und Uhrzeit aus Eingabefeldern, in der Zeitzone des Geräts. */
export function fromInputs(dateText, timeText = "00:00") {
  const [year, month, day] = dateText.split("-").map(Number);
  const [hour, minute] = timeText.split(":").map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}
