import "server-only";

import { randomHex, timingSafeEqualString } from "@/lib/security/timing-safe";

/** Cookie that binds the GitHub install `state` to the browser session. */
export const GH_STATE_COOKIE = "fm_gh_state";
export const GH_STATE_MAX_AGE_SECONDS = 10 * 60;

/** Random 32-byte state as 64 hex chars. */
export function generateInstallState(): string {
  return randomHex(32);
}

export interface StateCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/**
 * Cookie options (docs/security.md section 3). `secure` follows the APP_URL
 * scheme so local http development still receives the cookie.
 */
export function stateCookieOptions(appUrl: string): StateCookieOptions {
  let secure = true;
  try {
    secure = new URL(appUrl).protocol === "https:";
  } catch {
    secure = true;
  }
  return { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: GH_STATE_MAX_AGE_SECONDS };
}

/**
 * Cookie value binds the state to the Flow Motion user that started the
 * install: `<userId>.<state>`. A different user signing in on the same
 * browser within the 10 minutes cannot complete that install (review R1-5).
 */
export function encodeStateCookie(userId: string, state: string): string {
  return `${userId}.${state}`;
}

/**
 * Reads one cookie from a Cookie header without decoding (the value is
 * `<uuid>.<hex>`, which needs none). Never throws on malformed input.
 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (typeof header !== "string" || header === "") return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/**
 * Verifies the callback: the cookie's user part must equal the signed-in
 * user and its state part must equal the query state (both constant-time).
 * Every comparison runs even after a mismatch.
 */
export function verifyInstallState(
  queryState: string | null | undefined,
  cookieValue: string | null | undefined,
  sessionUserId: string,
): boolean {
  if (typeof queryState !== "string" || typeof cookieValue !== "string") return false;
  if (queryState.length === 0 || sessionUserId.length === 0) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return false;
  const cookieUser = cookieValue.slice(0, dot);
  const cookieState = cookieValue.slice(dot + 1);
  const userMatches = timingSafeEqualString(cookieUser, sessionUserId);
  const stateMatches = timingSafeEqualString(cookieState, queryState);
  return userMatches && stateMatches;
}
