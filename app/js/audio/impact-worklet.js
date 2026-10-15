// Läuft im Audio-Thread des Browsers (AudioWorklet): reicht die Samples des
// Mikrofons lückenlos in Blöcken an die Seite weiter, mit dem Zählerstand der
// Tonausgabe als Zeit. Ausgewertet wird dort (ImpactDetector in core/capture.js).
class SampleRelay extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.length = 0;
    this.startFrame = null;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;
    if (this.startFrame === null) this.startFrame = currentFrame;
    this.chunks.push(Float32Array.from(input));
    this.length += input.length;
    // Etwa alle 20 ms ein Block: klein genug für eine schnelle Reaktion, groß genug für wenige Nachrichten.
    if (this.length >= 1024) {
      const samples = new Float32Array(this.length);
      let offset = 0;
      for (const chunk of this.chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      this.port.postMessage({ samples, startFrame: this.startFrame }, [samples.buffer]);
      this.chunks = [];
      this.length = 0;
      this.startFrame = null;
    }
    return true;
  }
}

registerProcessor("sample-relay", SampleRelay);
