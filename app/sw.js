// Service Worker: Die Web-App läuft auch ohne Netz, z. B. auf der Range.
// Er legt die eigenen Dateien im Zwischenspeicher des Browsers ab. Daten von
// dir gehen nirgendwohin, er lädt nur die Dateien dieser Seite.
//
// Nach jeder Änderung an den Dateien VERSION erhöhen. Neue Dateien kommen
// dann beim nächsten Öffnen an, ältere Zwischenspeicher werden gelöscht.
const VERSION = "2026-10-11-7";
const CACHE = `golftrainer-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/main.js",
  "js/store.js",
  "js/ui.js",
  "js/views/week.js",
  "js/views/drills.js",
  "js/views/run.js",
  "js/views/tournaments.js",
  "js/views/swing.js",
  "js/views/compare.js",
  "js/views/more.js",
  "js/views/golfweek.js",
  "js/views/diary.js",
  "js/views/stats.js",
  "js/views/launch.js",
  "js/core/backup.js",
  "js/core/bests.js",
  "js/core/calendar.js",
  "js/core/categories.js",
  "js/core/challenge.js",
  "js/core/dates.js",
  "js/core/difficulty.js",
  "js/core/garmin.js",
  "js/core/golfweek.js",
  "js/core/launch.js",
  "js/core/model.js",
  "js/core/planner.js",
  "js/core/reminders.js",
  "js/core/scoring.js",
  "js/core/stats.js",
  "js/core/tempo.js",
  "js/core/tournament.js",
  "js/core/traininglog.js",
  "js/core/weighting.js",
  "data/drills.json",
  "data/tournament.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  // Am Zwischenspeicher des Browsers vorbei laden, damit wirklich die neue Version ankommt.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("golftrainer-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Aus dem Zwischenspeicher, im Hintergrund aktualisieren. Nur eigene Dateien.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
