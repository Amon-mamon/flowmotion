// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

import {
  PrivateKeyFormatError,
  base64UrlDecodeToString,
  createAppJwt,
  normalizePrivateKeyPem,
  pemToPkcs8Der,
} from "@/lib/github/app-jwt";

let publicKey: CryptoKey;
let pkcs8Pem: string;
let pkcs1Pem: string;

function toPem(label: string, der: ArrayBuffer | Uint8Array): string {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64.trim()}\n-----END ${label}-----`;
}

/** Minimal DER reader: returns [length, headerSize] at offset. */
function readLength(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset] ?? 0;
  if (first < 0x80) return [first, 1];
  const n = first & 0x7f;
  let length = 0;
  for (let i = 0; i < n; i += 1) length = (length << 8) | (bytes[offset + 1 + i] ?? 0);
  return [length, 1 + n];
}

/** Extracts the PKCS#1 RSAPrivateKey octet string from a PKCS#8 DER. */
function pkcs8ToPkcs1(pkcs8: Uint8Array): Uint8Array {
  let offset = 0;
  expect(pkcs8[offset]).toBe(0x30);
  offset += 1 + readLength(pkcs8, offset + 1)[1];
  // version INTEGER
  expect(pkcs8[offset]).toBe(0x02);
  const [vLen, vHdr] = readLength(pkcs8, offset + 1);
  offset += 1 + vHdr + vLen;
  // AlgorithmIdentifier SEQUENCE
  expect(pkcs8[offset]).toBe(0x30);
  const [aLen, aHdr] = readLength(pkcs8, offset + 1);
  offset += 1 + aHdr + aLen;
  // privateKey OCTET STRING
  expect(pkcs8[offset]).toBe(0x04);
  const [kLen, kHdr] = readLength(pkcs8, offset + 1);
  offset += 1 + kHdr;
  return pkcs8.slice(offset, offset + kLen);
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  publicKey = pair.publicKey;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  pkcs8Pem = toPem("PRIVATE KEY", pkcs8);
  pkcs1Pem = toPem("RSA PRIVATE KEY", pkcs8ToPkcs1(pkcs8));
}, 30_000);

async function verifyJwt(jwt: string): Promise<{ header: unknown; payload: Record<string, unknown> }> {
  const [h, p, s] = jwt.split(".");
  expect(h).toBeDefined();
  expect(p).toBeDefined();
  expect(s).toBeDefined();
  const signature = Uint8Array.from(
    atob((s ?? "").replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - ((s ?? "").length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    signature,
    new TextEncoder().encode(`${h}.${p}`),
  );
  expect(valid).toBe(true);
  return {
    header: JSON.parse(base64UrlDecodeToString(h ?? "")),
    payload: JSON.parse(base64UrlDecodeToString(p ?? "")) as Record<string, unknown>,
  };
}

describe("GitHub App JWT", () => {
  it("signs RS256 with a PKCS#8 PEM and carries iat/exp/iss", async () => {
    const now = 1_700_000_000;
    const jwt = await createAppJwt({ appId: "123456", privateKeyPem: pkcs8Pem, now });
    const { header, payload } = await verifyJwt(jwt);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({ iat: now - 60, exp: now + 540, iss: "123456" });
    // GitHub rejects exp - iat > 10 minutes.
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(600);
  });

  it("signs with a PKCS#1 'RSA PRIVATE KEY' PEM (GitHub's download format)", async () => {
    const jwt = await createAppJwt({ appId: "7", privateKeyPem: pkcs1Pem, now: 1_700_000_000 });
    const { payload } = await verifyJwt(jwt);
    expect(payload.iss).toBe("7");
  });

  it("restores \\n-escaped PEMs from env vars", async () => {
    const escaped = `"${pkcs1Pem.replace(/\n/g, "\\n")}"`;
    expect(normalizePrivateKeyPem(escaped)).toBe(pkcs1Pem);
    const jwt = await createAppJwt({ appId: "7", privateKeyPem: escaped, now: 1_700_000_000 });
    await verifyJwt(jwt);
  });

  it("produces the same PKCS#8 DER from both PEM forms", () => {
    expect(pemToPkcs8Der(pkcs1Pem)).toEqual(pemToPkcs8Der(pkcs8Pem));
  });

  it("rejects malformed keys with PrivateKeyFormatError", async () => {
    expect(() => pemToPkcs8Der("not a pem")).toThrow(PrivateKeyFormatError);
    expect(() => pemToPkcs8Der("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")).toThrow(
      PrivateKeyFormatError,
    );
    expect(() =>
      pemToPkcs8Der("-----BEGIN RSA PRIVATE KEY-----\n@@@@\n-----END RSA PRIVATE KEY-----"),
    ).toThrow(PrivateKeyFormatError);
    await expect(
      createAppJwt({
        appId: "1",
        privateKeyPem: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
      }),
    ).rejects.toBeInstanceOf(PrivateKeyFormatError);
  });
});
