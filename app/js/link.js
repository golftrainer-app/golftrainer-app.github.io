// Zweites Gerät als Bildschirm: Das Handy mit der Kamera (CameraLink) und das
// Tablet als Bildschirm (ScreenHost) finden sich über den Server des Kontos
// (realtime.js, nur für den Verbindungsaufbau) und sprechen dann direkt
// miteinander (WebRTC): Live-Bild, Clips und Befehle. Fremde Vermittler gibt
// es nicht: Beide Geräte müssen sich erreichen können, meist im selben WLAN
// oder am Hotspot des Handys. Jede Nachricht über den Server trägt einen
// Prüfwert aus dem Code (core/screenlink.js), damit niemand ohne Code eine
// Verbindung unterschieben kann.
import { ClipAssembler, chunksOf, deriveKey, open, seal, topicFor } from "./core/screenlink.js";
import { newID } from "./core/model.js";
import { RealtimeChannel } from "./realtime.js";

const SIGNAL_EVENT = "signal";
/** Ohne fremde Server: Verbindungen nur dort, wo die Geräte sich direkt erreichen. */
const RTC_CONFIG = { iceServers: [] };
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;
const RETRY_MS = 3000;

/** Gemeinsam: dem Thema beitreten, Nachrichten unterschreiben und prüfen, in Reihenfolge verarbeiten. */
class Signaling {
  constructor(code) {
    this.code = code;
    this.id = newID();
    this.seq = 0;
    this.lastSeq = new Map();
    this.channel = null;
    this.key = null;
    this.handlers = new Set();
    this.closeHandlers = new Set();
    this.queue = Promise.resolve();
  }

  get isOpen() {
    return Boolean(this.channel?.joined);
  }

  async connect() {
    this.key ??= await deriveKey(this.code);
    const topic = await topicFor(this.code);
    this.channel?.close();
    this.channel = new RealtimeChannel(topic);
    this.channel.onMessage((event, payload) => {
      if (event === SIGNAL_EVENT) this.queue = this.queue.then(() => this.receive(payload)).catch(() => {});
    });
    this.channel.onClose(() => {
      for (const handler of this.closeHandlers) handler();
    });
    await this.channel.connect();
  }

  async receive(payload) {
    const message = await open(this.key, payload, this.lastSeq);
    if (!message || message.from === this.id) return;
    for (const handler of this.handlers) await handler(message);
  }

  async send(kind, body = {}) {
    if (!this.isOpen) return false;
    this.seq += 1;
    return this.channel.send(SIGNAL_EVENT, await seal(this.key, { from: this.id, seq: this.seq, kind, body }));
  }

  onMessage(handler) {
    this.handlers.add(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
  }

  close() {
    this.channel?.close();
    this.channel = null;
  }
}

function forwardIce(pc, signaling, to) {
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate) signaling.send("ice", { to, candidate: event.candidate.toJSON() });
  });
}

/** Das Handy mit der Kamera: schickt Live-Bild, Clips und seinen Stand, nimmt Befehle an. */
export class CameraLink {
  constructor({ code, liveVideo = true, onState = null, onCommand = null }) {
    this.code = code;
    this.liveVideo = liveVideo;
    this.onState = onState;
    this.onCommand = onCommand;
    this.signaling = new Signaling(code);
    this.state = "idle";
    this.active = false;
    this.stream = null;
    this.pc = null;
    this.data = null;
    this.screenID = null;
    this.lastStatus = null;
    this.sending = Promise.resolve();
    this.retryTimer = null;
    this.signaling.onMessage((message) => this.handle(message));
    this.signaling.onClose(() => this.retryLater());
  }

  setState(state, detail = null) {
    this.state = state;
    this.onState?.(state, detail);
  }

  /** Startet die Suche nach dem Bildschirm mit dem Kamerabild `stream`. */
  async start(stream) {
    this.stream = stream;
    this.active = true;
    clearTimeout(this.retryTimer);
    try {
      this.setState("searching");
      await this.signaling.connect();
      await this.signaling.send("hello", { role: "camera" });
    } catch (error) {
      this.setState("error", error?.message ?? "Keine Verbindung zum Server.");
      this.retryLater();
    }
  }

  retryLater() {
    if (!this.active) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.active || this.state === "connected") return;
      this.start(this.stream);
    }, RETRY_MS);
  }

  async handle(message) {
    switch (message.kind) {
      case "hello":
        if (message.body?.role === "screen" && this.state !== "connected") await this.offer(message.from);
        break;
      case "answer":
        if (message.body?.to === this.signaling.id && this.pc && message.from === this.screenID) {
          try {
            await this.pc.setRemoteDescription({ type: message.body.type, sdp: message.body.sdp });
          } catch {
            this.teardownPeer();
          }
        }
        break;
      case "ice":
        if (message.body?.to === this.signaling.id && this.pc && message.from === this.screenID) {
          try {
            await this.pc.addIceCandidate(message.body.candidate);
          } catch {
            // Ein Kandidat, der nicht passt, schadet nicht.
          }
        }
        break;
      case "bye":
        if (message.from === this.screenID) {
          this.teardownPeer();
          this.setState("searching");
        }
        break;
      default:
        break;
    }
  }

  async offer(screenID) {
    this.teardownPeer();
    this.screenID = screenID;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    const data = pc.createDataChannel("golf", { ordered: true });
    data.binaryType = "arraybuffer";
    data.bufferedAmountLowThreshold = LOW_WATER;
    this.data = data;
    data.addEventListener("open", () => {
      if (this.pc !== pc) return;
      this.setState("connected");
      if (this.lastStatus) this.sendStatus(this.lastStatus);
    });
    data.addEventListener("close", () => {
      if (this.pc !== pc) return;
      this.teardownPeer();
      this.setState("searching");
      this.signaling.send("hello", { role: "camera" });
    });
    data.addEventListener("message", (event) => this.onData(event.data));
    if (this.liveVideo && this.stream) {
      const track = this.stream.getVideoTracks()[0];
      if (track) {
        try {
          pc.addTransceiver(track, { direction: "sendonly", streams: [this.stream], sendEncodings: [{ maxBitrate: 1_500_000, scaleResolutionDownBy: 2, maxFramerate: 30 }] });
        } catch {
          pc.addTrack(track, this.stream);
        }
      }
    }
    forwardIce(pc, this.signaling, screenID);
    pc.addEventListener("connectionstatechange", () => {
      if (this.pc !== pc) return;
      if (["failed", "closed"].includes(pc.connectionState)) {
        this.teardownPeer();
        this.setState("searching");
        this.retryLater();
      }
    });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.setState("connecting");
      await this.signaling.send("offer", { to: screenID, type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (error) {
      this.teardownPeer();
      this.setState("error", error?.message ?? "Die Verbindung ließ sich nicht aufbauen.");
    }
  }

  onData(raw) {
    if (typeof raw !== "string") return;
    try {
      const message = JSON.parse(raw);
      if (message.t === "command" && typeof message.command === "string") this.onCommand?.(message.command);
    } catch {
      // Keine Nachricht von uns.
    }
  }

  get isConnected() {
    return this.data?.readyState === "open";
  }

  /** Der Stand der Kamera für den Bildschirm; geht auch nach dem Verbinden noch raus. */
  sendStatus(status) {
    this.lastStatus = status;
    if (!this.isConnected) return false;
    this.data.send(JSON.stringify({ t: "status", ...status }));
    return true;
  }

  /** Schickt einen Clip in Stücken. Mehrere Clips gehen nacheinander. */
  sendClip(clip, blob) {
    if (!this.isConnected) return Promise.resolve(false);
    this.sending = this.sending.then(() => this.transfer(clip, blob)).catch(() => false);
    return this.sending;
  }

  async transfer(clip, blob) {
    const data = this.data;
    if (!data || data.readyState !== "open") return false;
    const buffer = await blob.arrayBuffer();
    data.send(JSON.stringify({ t: "clip", clip, bytes: buffer.byteLength }));
    for (const chunk of chunksOf(buffer)) {
      if (data.readyState !== "open") return false;
      if (data.bufferedAmount > HIGH_WATER) {
        await new Promise((resolve) => {
          const done = () => {
            data.removeEventListener("bufferedamountlow", done);
            data.removeEventListener("close", done);
            resolve();
          };
          data.addEventListener("bufferedamountlow", done);
          data.addEventListener("close", done);
        });
      }
      if (data.readyState !== "open") return false;
      data.send(chunk);
    }
    data.send(JSON.stringify({ t: "end", id: clip.id }));
    return true;
  }

  teardownPeer() {
    const { pc, data } = this;
    this.pc = null;
    this.data = null;
    try {
      data?.close();
    } catch {
      // Schon zu.
    }
    try {
      pc?.close();
    } catch {
      // Schon zu.
    }
  }

  stop() {
    this.active = false;
    clearTimeout(this.retryTimer);
    if (this.screenID) this.signaling.send("bye", { to: this.screenID });
    this.teardownPeer();
    this.screenID = null;
    this.signaling.close();
    this.setState("idle");
  }
}

/** Das Tablet als Bildschirm: zeigt den Code, nimmt Live-Bild und Clips an, schickt Befehle. */
export class ScreenHost {
  constructor({ code, onState = null, onStream = null, onClip = null, onStatus = null, onProgress = null }) {
    this.code = code;
    this.onState = onState;
    this.onStream = onStream;
    this.onClip = onClip;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.signaling = new Signaling(code);
    this.state = "idle";
    this.active = false;
    this.pc = null;
    this.data = null;
    this.cameraID = null;
    this.pendingIce = [];
    this.assembler = new ClipAssembler();
    this.retryTimer = null;
    this.signaling.onMessage((message) => this.handle(message));
    this.signaling.onClose(() => this.retryLater());
  }

  setState(state, detail = null) {
    this.state = state;
    this.onState?.(state, detail);
  }

  async start() {
    this.active = true;
    clearTimeout(this.retryTimer);
    try {
      await this.signaling.connect();
      this.setState("waiting");
      // Falls das Handy schon sucht.
      await this.signaling.send("hello", { role: "screen" });
    } catch (error) {
      this.setState("error", error?.message ?? "Keine Verbindung zum Server.");
      this.retryLater();
    }
  }

  retryLater() {
    if (!this.active) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.active) return;
      this.start();
    }, RETRY_MS);
  }

  async handle(message) {
    switch (message.kind) {
      case "hello":
        if (message.body?.role === "camera") await this.signaling.send("hello", { role: "screen" });
        break;
      case "offer":
        if (message.body?.to === this.signaling.id) await this.answer(message.from, message.body);
        break;
      case "ice":
        if (message.body?.to === this.signaling.id && message.from === this.cameraID) {
          if (this.pc?.remoteDescription) {
            try {
              await this.pc.addIceCandidate(message.body.candidate);
            } catch {
              // Ein Kandidat, der nicht passt, schadet nicht.
            }
          } else {
            this.pendingIce.push(message.body.candidate);
          }
        }
        break;
      case "bye":
        if (message.from === this.cameraID) {
          this.teardownPeer();
          this.setState("waiting");
        }
        break;
      default:
        break;
    }
  }

  async answer(cameraID, body) {
    this.teardownPeer();
    this.cameraID = cameraID;
    this.pendingIce = [];
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    pc.addEventListener("track", (event) => {
      if (this.pc !== pc) return;
      this.onStream?.(event.streams[0] ?? new MediaStream([event.track]));
    });
    pc.addEventListener("datachannel", (event) => {
      if (this.pc !== pc) return;
      const data = event.channel;
      data.binaryType = "arraybuffer";
      this.data = data;
      data.addEventListener("open", () => {
        if (this.pc === pc) this.setState("connected");
      });
      data.addEventListener("close", () => {
        if (this.pc !== pc) return;
        this.teardownPeer();
        this.setState("waiting");
      });
      data.addEventListener("message", (incoming) => this.onData(incoming.data));
      if (data.readyState === "open") this.setState("connected");
    });
    forwardIce(pc, this.signaling, cameraID);
    pc.addEventListener("connectionstatechange", () => {
      if (this.pc !== pc) return;
      if (["failed", "closed"].includes(pc.connectionState)) {
        this.teardownPeer();
        this.setState("waiting");
      }
    });
    try {
      await pc.setRemoteDescription({ type: body.type, sdp: body.sdp });
      for (const candidate of this.pendingIce.splice(0)) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // Siehe oben.
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.setState("connecting");
      await this.signaling.send("answer", { to: cameraID, type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (error) {
      this.teardownPeer();
      this.setState("error", error?.message ?? "Die Verbindung ließ sich nicht aufbauen.");
    }
  }

  onData(raw) {
    if (typeof raw === "string") {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.t === "status") {
        const { t, ...status } = message;
        this.onStatus?.(status);
      } else if (message.t === "clip" && message.clip && Number.isInteger(message.bytes)) {
        this.assembler.begin({ clip: message.clip, bytes: message.bytes });
        this.onProgress?.(0);
      } else if (message.t === "end") {
        const result = this.assembler.finish();
        this.onProgress?.(null);
        if (result) this.onClip?.(result.clip, result.blob);
      }
      return;
    }
    this.assembler.add(new Uint8Array(raw));
    this.onProgress?.(this.assembler.progress);
  }

  get isConnected() {
    return this.data?.readyState === "open";
  }

  /** Befehl ans Handy: save, pause oder resume. */
  sendCommand(command) {
    if (!this.isConnected) return false;
    this.data.send(JSON.stringify({ t: "command", command }));
    return true;
  }

  teardownPeer() {
    const { pc, data } = this;
    this.pc = null;
    this.data = null;
    this.pendingIce = [];
    try {
      data?.close();
    } catch {
      // Schon zu.
    }
    try {
      pc?.close();
    } catch {
      // Schon zu.
    }
  }

  stop() {
    this.active = false;
    clearTimeout(this.retryTimer);
    if (this.cameraID) this.signaling.send("bye", { to: this.cameraID });
    this.teardownPeer();
    this.cameraID = null;
    this.signaling.close();
    this.setState("idle");
  }
}
