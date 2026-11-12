// @vitest-environment node
import { describe, expect, it } from "vitest";

import { computeWebhookSignature, verifyWebhookSignature } from "@/lib/github/webhook-signature";
import { timingSafeEqualString } from "@/lib/security/timing-safe";

const SECRET = "It's a Secret to Everybody";
const BODY = "Hello, World!";
// Published example from GitHub's webhook docs for the secret/body above.
const KNOWN_SIGNATURE =
  "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

describe("webhook signature", () => {
  it("computes the documented HMAC-SHA256 value", async () => {
    expect(await computeWebhookSignature(SECRET, BODY)).toBe(KNOWN_SIGNATURE);
  });

  it("accepts a valid signature (case-insensitive hex)", async () => {
    expect(await verifyWebhookSignature(SECRET, BODY, KNOWN_SIGNATURE)).toBe(true);
    expect(await verifyWebhookSignature(SECRET, BODY, KNOWN_SIGNATURE.toUpperCase().replace("SHA256=", "sha256="))).toBe(true);
  });

  it("signs raw bytes identically to their UTF-8 string, and distinguishes a BOM", async () => {
    const bytes = new TextEncoder().encode(BODY);
    expect(await computeWebhookSignature(SECRET, bytes)).toBe(KNOWN_SIGNATURE);
    expect(await verifyWebhookSignature(SECRET, bytes, KNOWN_SIGNATURE)).toBe(true);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    expect(await verifyWebhookSignature(SECRET, withBom, KNOWN_SIGNATURE)).toBe(false);
    const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const sig = await computeWebhookSignature(SECRET, invalidUtf8);
    expect(await verifyWebhookSignature(SECRET, invalidUtf8, sig)).toBe(true);
  });

  it("rejects a missing header", async () => {
    expect(await verifyWebhookSignature(SECRET, BODY, null)).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, undefined)).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, "")).toBe(false);
  });

  it("rejects a wrong signature, wrong secret, or tampered body", async () => {
    const flipped = KNOWN_SIGNATURE.slice(0, -1) + (KNOWN_SIGNATURE.endsWith("7") ? "8" : "7");
    expect(await verifyWebhookSignature(SECRET, BODY, flipped)).toBe(false);
    expect(await verifyWebhookSignature("other secret", BODY, KNOWN_SIGNATURE)).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY + " ", KNOWN_SIGNATURE)).toBe(false);
  });

  it("rejects malformed headers without throwing", async () => {
    expect(await verifyWebhookSignature(SECRET, BODY, "sha1=abc")).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, KNOWN_SIGNATURE.slice(7))).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, "sha256=zz")).toBe(false);
    expect(await verifyWebhookSignature(SECRET, BODY, "sha256=" + "0".repeat(63))).toBe(false);
  });

  it("rejects everything when the secret is empty", async () => {
    expect(await verifyWebhookSignature("", BODY, KNOWN_SIGNATURE)).toBe(false);
    expect(await verifyWebhookSignature("", BODY, "sha256=" + "0".repeat(64))).toBe(false);
  });
});

describe("timingSafeEqualString", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "xbc")).toBe(false);
    expect(timingSafeEqualString("abc", "ab")).toBe(false);
    expect(timingSafeEqualString("", "")).toBe(true);
    expect(timingSafeEqualString("", "a")).toBe(false);
  });

  it("compares byte-wise over the longer input (no early return on length)", () => {
    // Both of these must return false; the implementation walks max(len) bytes.
    expect(timingSafeEqualString("a".repeat(64), "a".repeat(63))).toBe(false);
    expect(timingSafeEqualString("a".repeat(63), "a".repeat(64))).toBe(false);
    expect(timingSafeEqualString("é", "e")).toBe(false);
  });
});
