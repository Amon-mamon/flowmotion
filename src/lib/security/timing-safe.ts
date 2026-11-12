/**
 * Constant-time string comparison (Web-only, no Node `crypto`).
 *
 * Always walks the longer of the two inputs so timing does not reveal the
 * position of the first difference. A length mismatch still returns false.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  const length = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

/** Hex encoding of a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Cryptographically random hex string of `byteLength` bytes. */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
