// Zweites Gerät als Bildschirm: der Kopplungscode, die Prüfung der Nachrichten
// und das Stückeln der Clips, wie PairingCode und PairingHandshake in der App
// (GolfCore/Sources/GolfCore/Video/Pairing.swift), nur im Browser. Reine
// Logik ohne Netz: link.js schickt die Nachrichten über den Server des Kontos
// (Supabase Realtime, nur für den Verbindungsaufbau) und über WebRTC.

/** Zwölf Zeichen ohne 0, O, 1 und I, damit man sie sicher abtippt. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 12;
const SALT = "de.juliansteffl.golftrainer.bildschirm";
/** Stücke, in denen ein Clip über den Datenkanal geht: klein genug für jeden Browser. */
export const CHUNK_SIZE = 16384;

const encoder = new TextEncoder();

/** Ein neuer Code aus dem Zufall des Geräts. */
export function generateCode(random = globalThis.crypto) {
  const bytes = new Uint8Array(CODE_LENGTH);
  random.getRandomValues(bytes);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

/** Groß, ohne Striche und Leerzeichen; Nullen und Einsen werden zu O und I, falls jemand sie so abliest. */
export function normalizeCode(text) {
  return String(text ?? "")
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/[^A-Z2-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/[01]/g, "");
}

export function isCode(text) {
  const code = normalizeCode(text);
  return code.length === CODE_LENGTH && [...code].every((char) => CODE_ALPHABET.includes(char));
}

/** Zum Ablesen: ABCD-EFGH-JKLM. */
export function displayCode(code) {
  const clean = normalizeCode(code);
  return clean.match(/.{1,4}/g)?.join("-") ?? "";
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Das Thema auf dem Server: aus dem Code abgeleitet, der Code selbst bleibt auf den Geräten. */
export async function topicFor(code) {
  const hash = await sha256Hex(`${SALT}:topic:${normalizeCode(code)}`);
  return `golftrainer:bildschirm:${hash.slice(0, 24)}`;
}

/** Schlüssel für die Prüfwerte, aus dem Code. Nur wer den Code kennt, kann Nachrichten gültig unterschreiben. */
export async function deriveKey(code) {
  const material = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(`${SALT}:key:${normalizeCode(code)}`));
  return globalThis.crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** Nachricht mit Absender, laufender Nummer und Prüfwert. Ohne den Code lässt sie sich weder fälschen noch wiederholen. */
export async function seal(key, { from, seq, kind, body }) {
  const envelope = { from, seq, kind, body };
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(canonical(envelope)));
  return { ...envelope, mac: [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}

/** Prüft eine Nachricht. Gibt sie ohne Prüfwert zurück, oder null bei falschem Prüfwert oder alter Nummer. */
export async function open(key, envelope, lastSeq = new Map()) {
  if (!envelope || typeof envelope !== "object" || typeof envelope.mac !== "string" || typeof envelope.from !== "string") return null;
  const { mac, ...rest } = envelope;
  if (!Number.isInteger(rest.seq) || typeof rest.kind !== "string") return null;
  const bytes = new Uint8Array(mac.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  if (bytes.length !== 32) return null;
  const valid = await globalThis.crypto.subtle.verify("HMAC", key, bytes, encoder.encode(canonical({ from: rest.from, seq: rest.seq, kind: rest.kind, body: rest.body })));
  if (!valid) return null;
  if ((lastSeq.get(rest.from) ?? -1) >= rest.seq) return null;
  lastSeq.set(rest.from, rest.seq);
  return rest;
}

/** Ein Clip in Stücken für den Datenkanal. */
export function chunksOf(buffer, size = CHUNK_SIZE) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.byteLength)));
  return chunks;
}

/** Setzt einen Clip aus Kopf, Stücken und Ende wieder zusammen. */
export class ClipAssembler {
  constructor() {
    this.header = null;
    this.parts = [];
    this.received = 0;
  }

  begin(header) {
    this.header = header;
    this.parts = [];
    this.received = 0;
  }

  add(chunk) {
    if (!this.header) return;
    this.parts.push(chunk);
    this.received += chunk.byteLength ?? chunk.length ?? 0;
  }

  /** Der fertige Clip, oder null, wenn Stücke fehlen. */
  finish() {
    const header = this.header;
    if (!header) return null;
    const complete = this.received === header.bytes;
    const result = complete ? { clip: header.clip, blob: new Blob(this.parts, { type: header.clip?.mimeType || "video/webm" }) } : null;
    this.header = null;
    this.parts = [];
    this.received = 0;
    return result;
  }

  get progress() {
    return this.header && this.header.bytes > 0 ? Math.min(1, this.received / this.header.bytes) : 0;
  }
}
