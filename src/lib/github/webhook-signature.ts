import { bytesToHex, timingSafeEqualString } from "@/lib/security/timing-safe";

/**
 * GitHub webhook signature check: `X-Hub-Signature-256: sha256=<hex hmac>`
 * over the raw request body, compared in constant time. Web Crypto only.
 */

const SIGNATURE_PREFIX = "sha256=";

/** Raw request bytes as GitHub signed them (a string is UTF-8 encoded). */
export type WebhookBody = string | Uint8Array;

function toBytes(body: WebhookBody): ArrayBuffer {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function computeWebhookSignature(secret: string, rawBody: WebhookBody): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, toBytes(rawBody));
  return `${SIGNATURE_PREFIX}${bytesToHex(new Uint8Array(mac))}`;
}

/**
 * Returns true only when the header is present, well-formed, and equal to the
 * HMAC of the body. Any missing or malformed input is a rejection, never an
 * exception, so the caller cannot accidentally fall through.
 */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: WebhookBody,
  signatureHeader: string | null | undefined,
): Promise<boolean> {
  if (typeof signatureHeader !== "string") return false;
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  if (secret.length === 0) return false;
  const expected = await computeWebhookSignature(secret, rawBody);
  return timingSafeEqualString(`${SIGNATURE_PREFIX}${provided}`, expected);
}
