// Tab „Übungen“: die Bibliothek nach Bereichen wie ein Inhaltsverzeichnis,
// mit Suche. Jede Übung lässt sich auch außerhalb des Plans starten.
import { AREAS, AREA_NAMES, MODE_NAMES } from "../core/categories.js";
import { overview, records } from "../core/bests.js";
import { addDays, formatShortDate } from "../core/dates.js";
import { chapter, empty, headline, html, scoreLabel } from "../ui.js";

/** Kleinbuchstaben ohne Akzente, damit „uber“ auch „Über“ findet. */
function searchable(text) {
  return text.toLocaleLowerCase("de-DE").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function libraryPage(app) {
  const { store } = app;
  return {
    title: "Übungen",
    tab: "uebungen",
    parent: null,
    render() {
      const count = overview(store.library, store.data.results).length;
      return html`
        <label class="search">
          <span class="visually-hidden">Übungen suchen</span>
          <input type="search" placeholder="Suchen, z. B. Bunker oder Tempo" autocomplete="off" enterkeyhint="search" data-search>
        </label>
        <p class="empty" data-no-match hidden>Keine Übung passt zu deiner Suche.</p>
        ${chapter(null, html`<ul class="rows"><li><a class="row" href="#/uebungen/bestleistungen"><span class="row-main row-title">Bestleistungen</span><span class="row-value">${count}</span></a></li></ul>`)}
        ${AREAS.map((area) => {
          const drills = store.drills(area);
          return html`<section class="chapter" data-area>
            <div class="rule"></div>
            <h2>${AREA_NAMES[area]}<span class="side">${drills.length}</span></h2>
            <ul class="rows">
              ${drills.map(
                (drill) => html`<li data-text="${searchable(`${drill.name} ${drill.purpose} ${drill.summary} ${AREA_NAMES[area]}`)}">
                  <a class="row" href="#/uebungen/${encodeURIComponent(drill.id)}">
                    <span class="row-main">
                      <span class="row-title">${drill.name}</span>
                      <span class="row-sub">${drill.isBenchmark ? "Monatstest" : MODE_NAMES[drill.mode]} · ${drill.minutes} Min.${drill.isCorrective ? html` · <span class="kicker ink">Korrektur</span>` : ""}${drill.isTournamentPrep ? html` · <span class="kicker ink">Turnier</span>` : ""}</span>
                      <span class="row-purpose">${drill.purpose}</span>
                    </span>
                  </a>
                </li>`,
              )}
            </ul>
          </section>`;
        })}
      `;
    },
    mount(root) {
      const input = root.querySelector("[data-search]");
      const noMatch = root.querySelector("[data-no-match]");
      input.addEventListener("input", () => {
        const words = searchable(input.value).split(/\s+/).filter(Boolean);
        let visible = 0;
        for (const section of root.querySelectorAll("[data-area]")) {
          let inSection = 0;
          for (const item of section.querySelectorAll("li[data-text]")) {
            const match = words.every((word) => item.dataset.text.includes(word));
            item.hidden = !match;
            if (match) inSection += 1;
          }
          section.hidden = inSection === 0;
          visible += inSection;
        }
        noMatch.hidden = visible > 0;
      });
    },
  };
}

/** Die besten Ergebnisse aller Übungen mit Wertung, nach Bereichen wie die Bibliothek. */
export function bestsPage(app) {
  const { store } = app;
  return {
    title: "Bestleistungen",
    tab: "uebungen",
    parent: "#/uebungen",
    render() {
      const entries = overview(store.library, store.data.results);
      // Neu heißt: in den letzten 30 Tagen aufgestellt.
      const recent = new Set(records(addDays(new Date(), -30), store.library, store.data.results).map((result) => result.id));
      if (entries.length === 0) {
        return html`${headline("Bestleistungen")}${empty("Noch keine Bestleistungen. Sobald du Übungen mit Ergebnis einträgst, stehen hier deine besten.")}`;
      }
      return html`
        ${headline("Bestleistungen")}
        ${recent.size > 0 ? html`<p class="note">${recent.size === 1 ? "1 neue Bestleistung in den letzten 30 Tagen." : `${recent.size} neue Bestleistungen in den letzten 30 Tagen.`}</p>` : ""}
        ${AREAS.map((area) => {
          const rows = entries.filter((entry) => entry.drill.area === area);
          if (rows.length === 0) return "";
          return chapter(
            AREA_NAMES[area],
            html`<ul class="rows">${rows.map((entry) => {
              const details = [];
              if (entry.drill.levels.length > 1) details.push(`Stufe ${entry.level + 1} von ${entry.drill.levels.length}`);
              details.push(formatShortDate(entry.result.date));
              details.push(entry.attempts === 1 ? "1 Ergebnis" : `${entry.attempts} Ergebnisse`);
              return html`<li>
                <a class="row" href="#/uebungen/bestleistungen/${encodeURIComponent(entry.drill.id)}">
                  <span class="row-main">
                    <span class="row-title">${entry.drill.name}${recent.has(entry.result.id) ? html` <span class="kicker flag">Neu</span>` : ""}</span>
                    <span class="row-sub">${details.join(" · ")}</span>
                  </span>
                  <span class="row-value">${scoreLabel(entry.result.score, entry.drill.scoring)}</span>
                </a>
              </li>`;
            })}</ul>`,
          );
        })}
      `;
    },
  };
}
