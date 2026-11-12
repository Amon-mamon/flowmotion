import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getClientEnv } from "@/lib/env";
import { decideProxy } from "@/server/proxy-rules";

/**
 * Auth proxy (Next.js 16 name for middleware, D-14; docs/contract.md section 3).
 * Refreshes the Supabase session cookie on every matched request and applies
 * the redirect rules in src/server/proxy-rules.ts.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const env = getClientEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() validates the token with Supabase Auth and refreshes it when
  // needed (writing the new cookies through setAll above). Without a session
  // cookie it returns null without a network call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = decideProxy({ pathname: request.nextUrl.pathname, isAuthenticated: user !== null });
  if (decision.kind === "next") return response;

  const next =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : NextResponse.json(
          { ok: false, error: { code: "UNAUTHORIZED", message: "You must be signed in." } },
          { status: 401 },
        );
  // Keep refreshed session cookies on the redirect / error response.
  for (const cookie of response.cookies.getAll()) next.cookies.set(cookie);
  return next;
}

// Must be a literal (Next parses it statically). Kept equal to PROXY_MATCHER
// in src/server/proxy-rules.ts by tests/server/proxy-rules.test.ts.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)"],
};
