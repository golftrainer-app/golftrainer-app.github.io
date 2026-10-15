// Pose-Erkennung im Hintergrund: MediaPipe Pose Landmarker aus
// vendor/mediapipe/, von dieser Seite selbst ausgeliefert. Der Worker bekommt
// Bilder (ImageBitmap) mit ihrer Zeit und antwortet mit den 33 Punkten im Bild
// und im Raum. Nichts davon verlässt den Browser. Ein klassischer Worker, weil
// MediaPipe seinen WebAssembly-Lader mit importScripts holt.
const VENDOR = "../../vendor/mediapipe";
const MODEL = `${VENDOR}/pose_landmarker_full.task`;

let vision = null;
let landmarker = null;
let delegate = null;

async function start(preferred) {
  if (landmarker) return;
  vision ??= await import(`${VENDOR}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${VENDOR}/wasm`);
  let failure = null;
  // Erst die Grafikeinheit, dann der Prozessor. Headless oder ohne WebGL gibt es nur den Prozessor.
  for (const candidate of preferred === "CPU" ? ["CPU"] : ["GPU", "CPU"]) {
    try {
      landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: candidate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      delegate = candidate;
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure ?? new Error("Pose-Erkennung lässt sich nicht starten.");
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case "start":
        await start(data.delegate ?? "GPU");
        self.postMessage({ type: "ready", delegate });
        break;
      case "frame": {
        if (!landmarker) throw new Error("Pose-Erkennung nicht gestartet.");
        // Zeiten in Millisekunden, streng aufsteigend, sonst verwirft MediaPipe das Bild.
        const result = landmarker.detectForVideo(data.bitmap, Math.round(data.time * 1000));
        data.bitmap.close?.();
        self.postMessage({ type: "pose", id: data.id, time: data.time, landmarks: result.landmarks[0] ?? null, worldLandmarks: result.worldLandmarks[0] ?? null });
        break;
      }
      case "stop":
        landmarker?.close();
        landmarker = null;
        self.postMessage({ type: "stopped" });
        break;
      default:
        break;
    }
  } catch (error) {
    data.bitmap?.close?.();
    self.postMessage({ type: "error", id: data.id ?? null, message: String(error?.message ?? error) });
  }
};
