/**
 * GitHub App JWT (RS256) built with Web Crypto only, so the same module runs
 * in Next.js route handlers and the Deno worker (D-12).
 */

const encoder = new TextEncoder();

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlEncode(input: string | Uint8Array): string {
  return base64UrlEncodeBytes(typeof input === "string" ? encoder.encode(input) : input);
}

export function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64DecodeToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Restores a PEM read from an env var where newlines were escaped as `\n`.
 * Also strips surrounding quotes some env loaders leave in place.
 */
export function normalizePrivateKeyPem(raw: string): string {
  let pem = raw.trim();
  if (
    (pem.startsWith('"') && pem.endsWith('"')) ||
    (pem.startsWith("'") && pem.endsWith("'"))
  ) {
    pem = pem.slice(1, -1);
  }
  return pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
}

export class PrivateKeyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateKeyFormatError";
  }
}

// --- DER helpers (PKCS#1 -> PKCS#8 wrapping) ----------------------------------

function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** rsaEncryption OID 1.2.840.113549.1.1.1 with NULL parameters. */
const RSA_ALGORITHM_IDENTIFIER = derTlv(
  0x30,
  concat(
    derTlv(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01])),
    derTlv(0x05, new Uint8Array(0)),
  ),
);

/** Wraps a PKCS#1 RSAPrivateKey DER in a PKCS#8 PrivateKeyInfo DER. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  return derTlv(
    0x30,
    concat(
      derTlv(0x02, new Uint8Array([0x00])), // version 0
      RSA_ALGORITHM_IDENTIFIER,
      derTlv(0x04, pkcs1), // privateKey OCTET STRING
    ),
  );
}

/** Parses a PEM (PKCS#1 "RSA PRIVATE KEY" or PKCS#8 "PRIVATE KEY") to PKCS#8 DER. */
export function pemToPkcs8Der(pem: string): Uint8Array {
  const normalized = normalizePrivateKeyPem(pem);
  const match = /-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----([\s\S]+?)-----END \1-----/.exec(
    normalized,
  );
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new PrivateKeyFormatError(
      "GITHUB_APP_PRIVATE_KEY must be a PEM 'RSA PRIVATE KEY' or 'PRIVATE KEY' block",
    );
  }
  const body = match[2].replace(/\s+/g, "");
  let der: Uint8Array;
  try {
    der = base64DecodeToBytes(body);
  } catch {
    throw new PrivateKeyFormatError("GITHUB_APP_PRIVATE_KEY body is not valid base64");
  }
  return match[1] === "RSA PRIVATE KEY" ? pkcs1ToPkcs8(der) : der;
}

/** Imports the App private key for RS256 signing. */
export async function importAppPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToPkcs8Der(pem);
  // Copy into a fresh ArrayBuffer so the BufferSource type is exact.
  const buffer = new ArrayBuffer(der.byteLength);
  new Uint8Array(buffer).set(der);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new PrivateKeyFormatError("GITHUB_APP_PRIVATE_KEY could not be imported as an RSA key");
  }
}

export interface CreateAppJwtInput {
  appId: string;
  privateKeyPem: string;
  /** Seconds since epoch; defaults to now. */
  now?: number;
}

/** GitHub allows at most 10 minutes; 9 keeps clock skew headroom. */
const APP_JWT_TTL_SECONDS = 9 * 60;
/** Issued-at is backdated 60 s to tolerate clock drift, as GitHub recommends. */
const APP_JWT_SKEW_SECONDS = 60;

/**
 * Creates a GitHub App JWT: `{ iat: now - 60, exp: now + 540, iss: appId }`
 * signed RS256. The result is a bearer credential: never log it.
 */
export async function createAppJwt(input: CreateAppJwtInput): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - APP_JWT_SKEW_SECONDS,
      exp: now + APP_JWT_TTL_SECONDS,
      iss: input.appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importAppPrivateKey(input.privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}
