# MediaPipe für die Schwunganalyse im Browser

Hier liegen die Dateien von Googles MediaPipe, mit denen die Web-App das 3D-Skelett aus einem Video schätzt. Sie werden von dieser Seite selbst ausgeliefert. Die Web-App lädt nichts von Google, und kein Bild verlässt den Browser.

| Datei | Woher | Version |
|---|---|---|
| `vision_bundle.mjs` | npm-Paket `@mediapipe/tasks-vision` | 0.10.14 |
| `wasm/vision_wasm_internal.js`, `wasm/vision_wasm_internal.wasm` | dasselbe Paket, Ausgabe mit WebAssembly SIMD | 0.10.14 |
| `pose_landmarker_full.task` | Modell „Pose Landmarker (Full)“, `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task` | Stand 15. Oktober 2026 |

Lizenz: Apache License 2.0 (`LICENSE` in diesem Ordner), Urheber Google LLC. Änderungen an den Dateien: keine.

Die Ausgabe ohne SIMD (`vision_wasm_nosimd_internal.*`) liegt nicht bei. Browser ohne WebAssembly SIMD (Chrome vor Version 91, Safari vor 16.4) bekommen in der Web-App eine Meldung statt der Auswertung.

Neue Version einspielen: Dateien aus `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@<Version>/` und das Modell herunterladen, hier ersetzen, Tabelle und `MEDIAPIPE_VERSION` in `js/pose/pose-worker.js` anpassen, `VERSION` in `sw.js` erhöhen, dann `node site/app/test/browser-pose.mjs`.
