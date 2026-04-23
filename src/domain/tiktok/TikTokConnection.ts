/**
 * TikTok connection payload stored in ad_accounts.platform_account_data (JSON).
 * Tokens live in encrypted columns on the row, not inside this object.
 */
export const TIKTOK_PENDING_PLATFORM_ACCOUNT_ID = "__tiktok_pending__" as const

export interface TikTokAuthorizedAdvertiser {
  id: string
  name: string
  currency?: string
}

export interface TikTokConnectionPayload {
  selectionPending: boolean
  authorizedAdvertisers: TikTokAuthorizedAdvertiser[]
  /** ISO timestamp when refresh_token expires, if TikTok returned refresh_token_expires_in */
  refreshTokenExpiresAt?: string
  appId?: string
  advertiserAuthUrl?: string
  advertiserRedirectUri?: string
}

export interface TikTokPlatformAccountDataShape {
  tiktok: TikTokConnectionPayload
}

export function getTiktokPayloadFromRow(data: unknown): TikTokConnectionPayload | null {
  if (!data || typeof data !== "object") return null
  const t = (data as TikTokPlatformAccountDataShape).tiktok
  if (!t || typeof t !== "object") return null
  if (!Array.isArray(t.authorizedAdvertisers)) return null
  return t as TikTokConnectionPayload
}
