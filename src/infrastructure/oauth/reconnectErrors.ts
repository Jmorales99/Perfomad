/**
 * Helpers for detecting and serialising "OAuth reconnection required" errors.
 *
 * DESIGN NOTE:
 * When a platform token is revoked/expired we return HTTP 422 (not 401).
 * 401 is reserved for "the caller is not authenticated to this API" and would
 * trigger the frontend interceptor to sign the user out of Supabase.
 * 422 is safe and carries a machine-readable code the front can act on.
 */

/** Messages that indicate the stored token can no longer be refreshed. */
const RECONNECT_PATTERNS = [
  "invalid_grant",
  "reconnect",                             // our own messages
  "not properly encrypted",                // CryptoService IV/tag missing
  "Missing IV or tag",
  "No refresh token available",
  "Failed to refresh token",
  // Meta Graph API error codes embedded in messages
  "Error validating access token",         // OAuthException code 190
  "Session has expired",
  "The session has been invalidated",
  "token has expired",
  "token has been expired or revoked",
]

/**
 * Returns true when the error message indicates the user must go through OAuth
 * again to get a new refresh token.
 */
export function tokenErrorRequiresReconnect(message: string): boolean {
  const lower = message.toLowerCase()
  return RECONNECT_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

export interface ReconnectErrorPayload {
  code: "oauth_reconnect_required"
  message: string
  requires_reconnection: true
  platform: string
  ad_account_id?: string
}

/**
 * Builds the JSON body sent to the frontend when a token error is detected.
 */
export function reconnectErrorPayload(
  err: Error,
  platform: string,
  adAccountId?: string
): ReconnectErrorPayload {
  return {
    code: "oauth_reconnect_required",
    message: err.message,
    requires_reconnection: true,
    platform,
    ...(adAccountId ? { ad_account_id: adAccountId } : {}),
  }
}
