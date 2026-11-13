/**
 * Pure redirect rules for src/proxy.ts (docs/contract.md section 3).
 * Kept free of Next.js imports so they are unit-testable.
 */

export type ProxyDecision =
  | { kind: "next" }
  | { kind: "redirect"; to: "/login" | "/dashboard" }
  | { kind: "unauthorized" };

/** Sessionless routes: never checked, never redirected. */
export const UNCHECKED_API_PATHS: ReadonlySet<string> = new Set([
  "/api/auth/callback",
  "/api/github/webhook",
]);

/** Browser-navigated API routes: unauthenticated users go to /login. */
export const BROWSER_API_PATHS: ReadonlySet<string> = new Set([
  "/api/github/install",
  "/api/github/authorize",
  "/api/github/installations/callback",
]);

const APP_PREFIXES = ["/dashboard", "/projects", "/flows", "/settings"] as const;
const AUTH_PAGES: ReadonlySet<string> = new Set(["/login", "/signup"]);

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isAppPath(pathname: string): boolean {
  const path = normalize(pathname);
  return APP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function decideProxy(input: { pathname: string; isAuthenticated: boolean }): ProxyDecision {
  const path = normalize(input.pathname);

  if (path === "/api" || path.startsWith("/api/")) {
    if (UNCHECKED_API_PATHS.has(path)) return { kind: "next" };
    if (input.isAuthenticated) return { kind: "next" };
    if (BROWSER_API_PATHS.has(path)) return { kind: "redirect", to: "/login" };
    return { kind: "unauthorized" };
  }

  if (isAppPath(path)) {
    return input.isAuthenticated ? { kind: "next" } : { kind: "redirect", to: "/login" };
  }

  if (AUTH_PAGES.has(path)) {
    return input.isAuthenticated ? { kind: "redirect", to: "/dashboard" } : { kind: "next" };
  }

  // Marketing and everything else: never redirected.
  return { kind: "next" };
}

/** Matcher: skip _next/static, _next/image, favicon.ico and files with an extension. */
export const PROXY_MATCHER = "/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)";
