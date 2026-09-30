import crypto from "crypto";

export function appUrl(path = "") { return `${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")}${path}`; }
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new Error("Enter a valid US phone number, including area code.");
}
export const formatPhone = (phone?: string | null) => phone && phone.length === 12 ? `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}` : phone || "Not configured";
export function hashPin(pin: string) { return crypto.createHash("sha256").update(`${process.env.TOKEN_ENCRYPTION_KEY || "development-only-secret"}:${pin}`).digest("hex"); }
export function encrypt(value: string) {
  const key = crypto.createHash("sha256").update(process.env.TOKEN_ENCRYPTION_KEY || "development-only-secret").digest(); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}
export function decrypt(value: string) {
  const raw = Buffer.from(value, "base64url"), key = crypto.createHash("sha256").update(process.env.TOKEN_ENCRYPTION_KEY || "development-only-secret").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12)); decipher.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
/** Normalizes a short voice response before comparing it to control phrases. */
export function normalizeVoiceResponse(value: string) {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const affirmativeResponses = new Set([
  "yes", "yeah", "yep", "sure", "do it", "send it", "go ahead",
  "sounds good", "correct", "that's right", "thats right", "please do",
]);
const negativeResponses = new Set([
  "no", "nope", "nah", "don't", "dont", "do not", "cancel", "never mind",
  "nevermind", "that's all", "thats all", "i'm good", "im good", "nothing else",
  "i'm done", "im done", "all good", "that's it", "thats it", "no thanks", "no thank you",
]);

export function isAffirmative(value: string) {
  return affirmativeResponses.has(normalizeVoiceResponse(value));
}

export function isNegative(value: string) {
  const response = normalizeVoiceResponse(value);
  return negativeResponses.has(response) || response.startsWith("no ") || response.startsWith("cancel ");
}
export function escapeXml(text: string) { return text.replace(/[<>&'\"]/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;","\"":"&quot;"})[c] || c); }
export function twiml(body: string) { return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } }); }
