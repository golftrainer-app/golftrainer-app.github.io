// Golfwoche wählen wie in der App (App/Sources/Views/GolfWeekViews.swift):
// Teamtraining, Golftage und die Zeit pro Golftag. Für die Frage beim ersten
// Öffnen in „Woche“ und für „Mehr“. Gewählte Tage stehen in Tinte, Tage mit
// Teamtraining lassen sich nicht als Golftag wählen.
import { weekdayName } from "../core/categories.js";
import {
  MINUTE_RANGE,
  MINUTE_STEP,
  dayCount,
  golfWeekSlots,
  hasOwnMinutes,
  minutesOn,
  setGolfDay,
  setMinutes,
  setTeamDay,
  suggestedMinutes,
} from "../core/golfweek.js";
import { durationText, html } from "../ui.js";

const SHORT_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Sieben Felder von Mo bis So. `kind`: "team" oder "golf". */
export function dayButtons(kind, selected, unavailable = []) {
  return html`<div class="days" role="group" aria-label="${kind === "team" ? "Teamtraining" : "Golftage"}">
    ${SHORT_NAMES.map((name, index) => {
      const day = index + 1;
      const isUnavailable = unavailable.includes(day);
      return html`<button type="button" data-kind="${kind}" data-day="${day}" data-key="${kind}-${day}" aria-pressed="${String(selected.includes(day))}" aria-label="${weekdayName(day)}${isUnavailable ? ", Teamtraining" : ""}" ${isUnavailable ? "disabled" : ""}>${name}</button>`;
    })}
  </div>`;
}

/** Golftage der Woche in der Reihenfolge der Tage, ohne Tage mit Teamtraining. */
export function golfDays(week) {
  return golfWeekSlots(week).map((slot) => slot.weekday);
}

/** Zeit je Golftag: kleiner Zähler in Schritten von 15 Minuten, darunter, ob es der Vorschlag ist. */
export function minutesRows(week) {
  const suggested = suggestedMinutes(dayCount(week));
  return golfDays(week).map((day) => {
    const minutes = minutesOn(week, day);
    return html`<div class="day-minutes">
      <span class="row-main">
        <span class="row-title">${weekdayName(day)}</span>
        ${hasOwnMinutes(week, day)
          ? html`<button type="button" class="text-button" data-reset-day="${day}" data-key="reset-${day}">Vorschlag nehmen: ${durationText(suggested)}</button>`
          : html`<span class="row-sub">Vorschlag der App</span>`}
      </span>
      <span class="small-stepper">
        <button type="button" data-step-day="${day}" data-step="${-MINUTE_STEP}" data-key="less-${day}" aria-label="${weekdayName(day)}: ${MINUTE_STEP} Minuten weniger" ${minutes - MINUTE_STEP < MINUTE_RANGE[0] ? "disabled" : ""}>−</button>
        <output aria-live="polite">${durationText(minutes)}</output>
        <button type="button" data-step-day="${day}" data-step="${MINUTE_STEP}" data-key="more-${day}" aria-label="${weekdayName(day)}: ${MINUTE_STEP} Minuten mehr" ${minutes + MINUTE_STEP > MINUTE_RANGE[1] ? "disabled" : ""}>+</button>
      </span>
    </div>`;
  });
}

/**
 * Wendet einen Tipp in der Auswahl auf `week` an und ändert es dabei. Gibt
 * true zurück, wenn der Tipp zur Auswahl gehörte.
 */
export function applyGolfWeekClick(week, target) {
  const dayButton = target.closest("[data-day]");
  if (dayButton) {
    const day = Number(dayButton.dataset.day);
    const isOn = dayButton.getAttribute("aria-pressed") !== "true";
    if (dayButton.dataset.kind === "team") setTeamDay(week, day, isOn);
    else setGolfDay(week, day, isOn);
    return true;
  }
  const step = target.closest("[data-step-day]");
  if (step) {
    const day = Number(step.dataset.stepDay);
    const minutes = minutesOn(week, day);
    if (minutes != null) setMinutes(week, day, minutes + Number(step.dataset.step));
    return true;
  }
  const reset = target.closest("[data-reset-day]");
  if (reset) {
    setMinutes(week, Number(reset.dataset.resetDay), null);
    return true;
  }
  return false;
}

/** Eigene Kopie zum Ändern, ohne die gespeicherte Golfwoche anzufassen. */
export function copyGolfWeek(week) {
  return {
    teamDays: [...week.teamDays],
    golfDays: week.golfDays.map((day) => ({ ...day })),
    facilities: [...week.facilities],
  };
}

/** „2 Golftage, Teamtraining am Dienstag und Donnerstag.“ für den Knopf „Weiter“. */
export function golfWeekSummary(week) {
  const team = week.teamDays.length > 0 ? `Teamtraining am ${dayList(week.teamDays)}` : null;
  const count = golfDays(week).length;
  if (count === 0) {
    return [team ? `${team}.` : null, "Ohne Golftage schlägt die App noch nichts vor. Du kannst sie später festlegen."].filter(Boolean).join(" ");
  }
  return `${[count === 1 ? "1 Golftag" : `${count} Golftage`, team].filter(Boolean).join(", ")}.`;
}

/** „Dienstag und Donnerstag“, „Montag, Mittwoch und Freitag“. */
export function dayList(days) {
  const names = [...new Set(days)].sort((a, b) => a - b).map(weekdayName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}
