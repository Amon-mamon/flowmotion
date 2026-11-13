/**
 * Maps Supabase Auth errors to user-facing copy. Only rate-limit codes get
 * their own message; everything else stays generic so the form never reveals
 * whether an account exists (no account enumeration).
 */
type AuthErrorLike = { code?: string | null; status?: number | null } | null | undefined;

export const SIGNUP_GENERIC_ERROR = "Could not create your account. Check your details and try again.";
/** exact (design.md "Auth pages", signup rate limit) */
export const SIGNUP_EMAIL_RATE_LIMIT =
  "Too many sign-up emails were sent recently. Wait a few minutes and try again.";
export const LOGIN_GENERIC_ERROR = "Invalid email or password";
/** exact (design.md "Auth pages", login rate limit; D-23, R11-4) */
export const LOGIN_RATE_LIMIT = "Too many attempts. Please wait a moment and try again.";

/** design.md: code `over_email_send_rate_limit`, or any HTTP 429 from `signUp`. */
export function signupErrorMessage(error: AuthErrorLike): string {
  const rateLimited = error?.code === "over_email_send_rate_limit" || error?.status === 429;
  return rateLimited ? SIGNUP_EMAIL_RATE_LIMIT : SIGNUP_GENERIC_ERROR;
}

/** design.md: code `over_request_rate_limit`, or any HTTP 429 from sign-in. */
export function loginErrorMessage(error: AuthErrorLike): string {
  const rateLimited = error?.code === "over_request_rate_limit" || error?.status === 429;
  return rateLimited ? LOGIN_RATE_LIMIT : LOGIN_GENERIC_ERROR;
}
