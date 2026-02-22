import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { CryptoService } from "./CryptoService"

export type Platform = "meta" | "google_ads" | "linkedin" | "tiktok" | "youtube"

export interface OAuthStateData {
  state: string
  userId: string
  clientId: string
  platform: Platform
  redirectUri?: string
  expiresAt: Date
}

/**
 * StateManager handles OAuth state parameter generation and validation
 * Prevents CSRF attacks by validating state parameters match stored values
 */
export class StateManager {
  private cryptoService: CryptoService
  private stateTTLMinutes = 10 // States expire after 10 minutes

  constructor() {
    this.cryptoService = new CryptoService()
  }

  /**
   * Generates a secure state parameter for OAuth flow.
   * Stores it in database with user_id, client_id, platform, expiration.
   */
  async generateState(
    userId: string,
    clientId: string,
    platform: Platform,
    redirectUri?: string
  ): Promise<string> {
    const state = this.cryptoService.generateSecureRandom(32)
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + this.stateTTLMinutes)

    const { error } = await supabaseAdmin.from("oauth_states").insert({
      state,
      user_id: userId,
      client_id: clientId,
      platform,
      redirect_uri: redirectUri ?? null,
      expires_at: expiresAt.toISOString(),
      used: false,
    })

    if (error) {
      throw new Error(`Failed to store OAuth state: ${error.message}`)
    }

    return state
  }

  /**
   * Validates an OAuth state parameter
   * Returns the stored state data if valid, null otherwise
   */
  async validateState(
    state: string,
    userId: string,
    platform: Platform
  ): Promise<OAuthStateData | null> {
    if (!state || !userId || !platform) return null

    const { data, error } = await supabaseAdmin
      .from("oauth_states")
      .select("*")
      .eq("state", state)
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("used", false)
      .single()

    if (error || !data) return null

    const expiresAt = new Date(data.expires_at)
    if (expiresAt < new Date()) {
      await this.invalidateState(state)
      return null
    }

    return {
      state: data.state,
      userId: data.user_id,
      clientId: data.client_id,
      platform: data.platform as Platform,
      redirectUri: data.redirect_uri ?? undefined,
      expiresAt: new Date(data.expires_at),
    }
  }

  /**
   * Validates state for callback (extracts userId, clientId, platform from DB).
   * Returns state data if valid and not expired; does not mark used (call invalidateState after).
   */
  async validateStateForCallback(state: string): Promise<OAuthStateData | null> {
    if (!state) return null

    const { data, error } = await supabaseAdmin
      .from("oauth_states")
      .select("*")
      .eq("state", state)
      .eq("used", false)
      .maybeSingle()

    if (error || !data) return null

    const expiresAt = new Date(data.expires_at)
    if (expiresAt < new Date()) {
      await this.invalidateState(state)
      return null
    }

    return {
      state: data.state,
      userId: data.user_id,
      clientId: data.client_id,
      platform: data.platform as Platform,
      redirectUri: data.redirect_uri ?? undefined,
      expiresAt: new Date(data.expires_at),
    }
  }

  /**
   * Marks a state as used (prevents reuse)
   */
  async invalidateState(state: string): Promise<void> {
    await supabaseAdmin.from("oauth_states").update({ used: true }).eq("state", state)
  }

  /**
   * Cleans up expired states (can be called periodically)
   */
  async cleanupExpiredStates(): Promise<number> {
    const { data, error } = await supabaseAdmin.rpc("cleanup_expired_oauth_states")

    if (error) {
      // Fallback: manual cleanup
      const { error: deleteError } = await supabaseAdmin
        .from("oauth_states")
        .delete()
        .lt("expires_at", new Date().toISOString())

      if (deleteError) {
        console.error("Failed to cleanup expired OAuth states:", deleteError)
        return 0
      }
    }

    // Return number of cleaned up states (approximate)
    return 0 // Function doesn't return count, but that's okay
  }
}

