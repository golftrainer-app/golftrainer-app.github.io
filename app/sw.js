// Service Worker: Die Web-App läuft auch ohne Netz, z. B. auf der Range.
// Er legt die eigenen Dateien im Zwischenspeicher des Browsers ab. Daten von
// dir gehen nirgendwohin, er lädt nur die Dateien dieser Seite.
//
// Jede VERSION hat einen eigenen Zwischenspeicher. Die Installation füllt ihn
// ganz oder gar nicht, danach kommen die Dateien der Seite nur noch aus ihm.
// So treffen nie Dateien aus zwei Ständen aufeinander: Passt ein Import nicht
// zum anderen, startet die Seite sonst gar nicht.
//
// Nach jeder Änderung an den Dateien VERSION erhöhen. Erst dann lädt der
// Browser den neuen Stand, beim nächsten Öffnen ist er da, und ältere
// Zwischenspeicher werden gelöscht. Neue Dateien in FILES eintragen,
// test/sw.test.mjs prüft das.
const VERSION = "2026-10-17-1";
const CACHE = `golftrainer-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/boot.js",
  "js/main.js",
  "js/poses.js",
  "js/pose/estimator.js",
  "js/pose/analyze.js",
  "js/pose/mediapipe.js",
  "js/pose/pose-worker.js",
  "js/store.js",
  "js/ui.js",
  "js/config.js",
  "js/supabase.js",
  "js/account.js",
  "js/team.js",
  "js/clips.js",
  "js/realtime.js",
  "js/link.js",
  "js/audio/impact-worklet.js",
  "js/views/home.js",
  "js/views/week.js",
  "js/views/drills.js",
  "js/views/run.js",
  "js/views/tournaments.js",
  "js/views/swing.js",
  "js/views/camera.js",
  "js/views/screen.js",
  "js/views/player.js",
  "js/views/compare.js",
  "js/views/more.js",
  "js/views/golfweek.js",
  "js/views/diary.js",
  "js/views/stats.js",
  "js/views/launch.js",
  "js/views/account.js",
  "js/views/analysis.js",
  "js/views/skeleton.js",
  "js/views/team.js",
  "js/views/coach.js",
  "js/views/clips.js",
  "js/core/agenda.js",
  "js/core/appointments.js",
  "js/core/backup.js",
  "js/core/bests.js",
  "js/core/calendar.js",
  "js/core/capture.js",
  "js/core/pose.js",
  "js/core/swing.js",
  "js/core/analysis.js",
  "js/core/screenlink.js",
  "js/core/categories.js",
  "js/core/challenge.js",
  "js/core/dates.js",
  "js/core/difficulty.js",
  "js/core/garmin.js",
  "js/core/golfweek.js",
  "js/core/handicap.js",
  "js/core/launch.js",
  "js/core/model.js",
  "js/core/planner.js",
  "js/core/reminders.js",
  "js/core/scoring.js",
  "js/core/season.js",
  "js/core/stats.js",
  "js/core/sync.js",
  "js/core/tempo.js",
  "js/core/texts.js",
  "js/core/tournament.js",
  "js/core/traininglog.js",
  "js/core/weighting.js",
  "js/core/team.js",
  "js/core/teamclips.js",
  "js/core/teamsync.js",
  "js/core/teamapi.js",
  "js/core/teamshare.js",
  "js/core/teamcoach.js",
  "js/core/moderation.js",
  "data/drills.json",
  "data/swing_feedback.json",
  "data/tournament.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-maskable-512.png",
];

/**
 * Große Dateien der Pose-Erkennung (MediaPipe, etwa 19 MB): nicht vorab, sondern
 * beim ersten Auswerten geladen und dann in einem eigenen Zwischenspeicher
 * behalten, der neue Versionen der Web-App überlebt. Ändert sich MediaPipe,
 * bekommt VENDOR_CACHE einen neuen Namen, und der alte Speicher fällt weg.
 */
const LAZY_FILES = [
  "vendor/mediapipe/LICENSE",
  "vendor/mediapipe/pose_landmarker_full.task",
  "vendor/mediapipe/vision_bundle.mjs",
  "vendor/mediapipe/wasm/vision_wasm_internal.js",
  "vendor/mediapipe/wasm/vision_wasm_internal.wasm",
];
const VENDOR_CACHE = "golftrainer-vendor-mediapipe-0.10.14";

/** Volle Adressen der Dateien ohne Abfrage, z. B. „…/app/“ für „./“. */
const PRECACHED = new Set(FILES.map((file) => new URL(file, self.location).href));
const LAZY = new Set(LAZY_FILES.map((file) => new URL(file, self.location).href));

self.addEventListener("install", (event) => {
  // Am Zwischenspeicher des Browsers vorbei und mit der VERSION in der Abfrage
  // laden, damit wirklich der neue Stand ankommt, auch durch Zwischenspeicher
  // im Netz hindurch. Fehlt eine Datei oder bricht das Laden ab, scheitert die
  // Installation, und die bisherige Version bleibt, wie sie ist.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(`${file}?v=${encodeURIComponent(VERSION)}`, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("golftrainer-") && key !== CACHE && key !== VENDOR_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Dateien der Seite nur aus dem Zwischenspeicher ihrer Version, ohne sie
// nebenbei einzeln zu erneuern. Fehlt eine wider Erwarten, kommt sie aus dem
// Netz, ohne im Zwischenspeicher zu landen. Alles andere, z. B. der Server des
// Kontos, geht wie ohne Service Worker ins Netz.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  if (LAZY.has(url.href)) {
    event.respondWith(
      caches.open(VENDOR_CACHE).then(async (cache) => {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  if (!PRECACHED.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(request, { ignoreSearch: true })) ?? fetch(request)));
});
