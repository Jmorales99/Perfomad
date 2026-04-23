/**
 * Returns true when the error indicates an expired/revoked OAuth token,
 * meaning the user must re-authorize via the OAuth flow.
 * Rate-limit and transient server errors are NOT reconnect-required.
 */
export function isReconnectRequired(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /invalid_grant|OAuthException|token_expired|token has been expired|error 190/i.test(msg)
}
