// Nachrichten zwischen zwei Geräten über den Server des Kontos (Supabase
// Realtime, Broadcast auf einem Thema), nur für den Verbindungsaufbau des
// Bildschirm-Modus. Spricht das Protokoll des Servers (Phoenix) direkt über
// WebSocket, ohne SDK: beitreten, senden, Herzschlag, Antworten lesen.
// Angemeldet sein muss niemand: Das Thema ist aus dem Kopplungscode abgeleitet,
// und die Nachrichten selbst tragen einen Prüfwert (core/screenlink.js).
import { SUPABASE } from "./config.js";

const HEARTBEAT_MS = 25000;
const JOIN_TIMEOUT_MS = 15000;

export function realtimeURL(config = SUPABASE) {
  const base = config.url.replace(/^http/, "ws").replace(/\/$/, "");
  return `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(config.anonKey)}&vsn=1.0.0`;
}

/** Eine Verbindung zu einem Thema. Jede Nachricht kommt bei allen anderen auf dem Thema an. */
export class RealtimeChannel {
  constructor(topic, { config = SUPABASE, WebSocketClass = globalThis.WebSocket, now = () => Date.now() } = {}) {
    this.topic = `realtime:${topic}`;
    this.url = realtimeURL(config);
    this.WebSocketClass = WebSocketClass;
    this.now = now;
    this.socket = null;
    this.ref = 0;
    this.joined = false;
    this.closedByUs = false;
    this.listeners = new Set();
    this.closeListeners = new Set();
    this.heartbeat = null;
    this.pendingHeartbeat = null;
  }

  nextRef() {
    this.ref += 1;
    return String(this.ref);
  }

  /** Die Nachricht ans Thema, wie der Server sie erwartet. */
  static joinMessage(topic, ref) {
    return { topic, event: "phx_join", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, postgres_changes: [], private: false } }, ref };
  }

  static broadcastMessage(topic, event, payload, ref) {
    return { topic, event: "broadcast", payload: { type: "broadcast", event, payload }, ref };
  }

  /** Verbindet und tritt dem Thema bei. */
  connect() {
    if (!this.WebSocketClass) return Promise.reject(new Error("Dieser Browser kann keine Verbindung zum Server halten."));
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new this.WebSocketClass(this.url);
      this.socket = socket;
      const joinRef = this.nextRef();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error("Der Server antwortet nicht."));
      }, JOIN_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify(RealtimeChannel.joinMessage(this.topic, joinRef)));
      });
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.event === "phx_reply" && message.ref === joinRef && !settled) {
          settled = true;
          clearTimeout(timer);
          if (message.payload?.status === "ok") {
            this.joined = true;
            this.startHeartbeat();
            resolve();
          } else {
            this.close();
            reject(new Error("Der Server hat die Verbindung abgelehnt."));
          }
          return;
        }
        if (message.event === "phx_reply" && message.topic === "phoenix") {
          this.pendingHeartbeat = null;
          return;
        }
        if (message.event === "broadcast" && message.topic === this.topic) {
          const inner = message.payload ?? {};
          for (const listener of this.listeners) listener(inner.event, inner.payload);
        }
        if (message.event === "phx_error" || message.event === "phx_close") this.handleClose();
      });
      socket.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Keine Verbindung zum Server."));
      });
      socket.addEventListener("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Keine Verbindung zum Server."));
        }
        this.handleClose();
      });
    });
  }

  startHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.pendingHeartbeat) {
        // Keine Antwort auf den letzten Herzschlag: Die Verbindung ist tot.
        this.handleClose();
        return;
      }
      this.pendingHeartbeat = this.nextRef();
      this.rawSend({ topic: "phoenix", event: "heartbeat", payload: {}, ref: this.pendingHeartbeat });
    }, HEARTBEAT_MS);
  }

  rawSend(message) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Schickt eine Nachricht an alle anderen auf dem Thema. */
  send(event, payload) {
    return this.rawSend(RealtimeChannel.broadcastMessage(this.topic, event, payload, this.nextRef()));
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  handleClose() {
    const wasJoined = this.joined;
    this.joined = false;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.pendingHeartbeat = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Schon zu.
    }
    if (wasJoined && !this.closedByUs) for (const listener of this.closeListeners) listener();
  }

  close() {
    this.closedByUs = true;
    this.handleClose();
  }
}
