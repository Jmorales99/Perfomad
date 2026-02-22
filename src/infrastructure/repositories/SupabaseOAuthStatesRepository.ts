import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type {
  OAuthStatesRepository,
  OAuthStateData,
  Platform,
} from "@/domain/repositories/OAuthStatesRepository"

export class SupabaseOAuthStatesRepository implements OAuthStatesRepository {
  async save(params: {
    state: string
    userId: string
    clientId: string
    platform: Platform
    redirectUri?: string | null
    expiresAt: string
  }): Promise<void> {
    const { error } = await supabaseAdmin.from("oauth_states").insert({
      state: params.state,
      user_id: params.userId,
      client_id: params.clientId,
      platform: params.platform,
      redirect_uri: params.redirectUri ?? null,
      expires_at: params.expiresAt,
      used: false,
    })
    if (error) throw new Error(`Failed to store OAuth state: ${error.message}`)
  }

  async findByState(state: string): Promise<OAuthStateData | null> {
    const { data, error } = await supabaseAdmin
      .from("oauth_states")
      .select("*")
      .eq("state", state)
      .eq("used", false)
      .maybeSingle()

    if (error || !data) return null
    const expiresAt = new Date(data.expires_at)
    if (expiresAt < new Date()) {
      await this.markUsed(state)
      return null
    }
    return {
      state: data.state,
      userId: data.user_id,
      clientId: data.client_id,
      platform: data.platform as Platform,
      redirectUri: data.redirect_uri ?? undefined,
      expiresAt,
    }
  }

  async markUsed(state: string): Promise<void> {
    await supabaseAdmin.from("oauth_states").update({ used: true }).eq("state", state)
  }
}
