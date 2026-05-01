/**
 * Domain interface for OAuth state (CSRF protection).
 * State is stored with user_id, client_id, platform and used for callback resolution.
 */
export type Platform = "meta" | "google_ads" | "linkedin" | "tiktok" | "youtube" | "google_merchant_center"

export interface OAuthStateData {
  state: string
  userId: string
  clientId: string
  platform: Platform
  redirectUri?: string
  expiresAt: Date
}

export interface OAuthStatesRepository {
  save(params: {
    state: string
    userId: string
    clientId: string
    platform: Platform
    redirectUri?: string | null
    expiresAt: string
  }): Promise<void>
  findByState(state: string): Promise<OAuthStateData | null>
  markUsed(state: string): Promise<void>
}
