// Notausgang beim Start. Fehlt eine Datei, bricht das Laden ab oder kommen
// Dateien aus zwei Ständen zusammen, startet js/main.js gar nicht. Die Seite
// bliebe dann bei „Lädt …“ stehen, und „Meine Daten löschen“ wäre nicht zu
// erreichen. Nach 8 Sekunden ohne Start zeigt dieses Skript deshalb, was du
// tun kannst: neu laden oder den Zwischenspeicher leeren.
//
// Bewusst ein einfaches Skript ohne Modul und ohne andere Dateien, damit es
// auch dann läuft, wenn die Module nicht laden. Es baut seine Elemente selbst
// und setzt Text nur mit textContent, ohne HTML.
//
// Als gestartet gilt die Seite, wenn js/main.js
// `document.documentElement.dataset.started = "1"` gesetzt oder schon eine
// Seite gezeichnet hat (ein Element .page in #view).
(() => {
  const WAIT = 8000;

  const isStarted = (view) => document.documentElement.dataset.started === "1" || view.querySelector(".page") != null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /**
   * Löscht die Dateien der Seite im Zwischenspeicher und meldet den Service
   * Worker ab, wie „Meine Daten löschen“, aber ohne deine Einträge: Der
   * Speicher mit deinen Daten (localStorage) bleibt unangetastet. Danach lädt
   * die Seite alles neu aus dem Netz.
   */
  async function clearAndReload(status) {
    if (navigator.onLine === false) {
      status.textContent = "Ohne Internet geht das nicht. Verbinde dich und tippe dann noch einmal.";
      return;
    }
    status.textContent = "Der Zwischenspeicher wird geleert …";
    try {
      const keys = (await globalThis.caches?.keys()) ?? [];
      await Promise.all(keys.filter((key) => key.startsWith("golftrainer-")).map((key) => caches.delete(key)));
      const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch {
      // Was sich nicht löschen ließ, lädt die Seite trotzdem neu.
    }
    location.reload();
  }

  function showHelp(view) {
    const box = element("div", "boot-help");
    const problem = element("p", "hint problem", "Golf Trainer startet nicht.");
    problem.setAttribute("role", "alert");
    box.append(
      problem,
      element(
        "p",
        "note",
        "Vielleicht ist das Laden abgebrochen, oder ein Teil der Seite ist veraltet. Lade die Seite neu. Hilft das nicht, leere mit Internet den Zwischenspeicher. Deine Einträge bleiben dabei erhalten.",
      ),
    );
    const buttons = element("div", "buttons");
    const reload = element("button", "button", "Neu laden");
    reload.type = "button";
    reload.dataset.boot = "reload";
    const clear = element("button", "button outline", "Zwischenspeicher leeren und neu laden");
    clear.type = "button";
    clear.dataset.boot = "clear";
    buttons.append(reload, clear);
    const status = element("p", "note");
    status.setAttribute("role", "status");
    box.append(buttons, status);
    reload.addEventListener("click", () => location.reload());
    clear.addEventListener("click", () => clearAndReload(status));
    // „Lädt …“ ersetzen. Steht schon eine Meldung von main.js da, bleibt sie darüber stehen.
    view.querySelector(".loading")?.remove();
    view.append(box);
  }

  setTimeout(() => {
    const view = document.getElementById("view");
    if (!view || isStarted(view) || view.querySelector(".boot-help")) return;
    showHelp(view);
  }, WAIT);
})();
