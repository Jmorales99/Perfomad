import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { AdAccount, AdAccountsRepository, CreateAdAccountInput, Platform } from "@/domain/repositories/AdAccountsRepository"

// Re-export for consumers that still import from here
export type { AdAccount, Platform } from "@/domain/repositories/AdAccountsRepository"

const defaultAccountFields = {
  is_active: true,
  access_token_iv: null,
  access_token_tag: null,
  refresh_token_iv: null,
  refresh_token_tag: null,
} as const

export class SupabaseAdAccountsRepository implements AdAccountsRepository {
  async create(input: CreateAdAccountInput): Promise<AdAccount> {
    const now = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .insert({
        user_id: input.user_id,
        client_id: input.client_id,
        platform: input.platform,
        platform_account_id: input.platform_account_id,
        platform_user_id: input.platform_user_id ?? null,
        account_name: input.account_name ?? null,
        currency: input.currency ?? "USD",
        is_active: input.is_active ?? true,
        connected_at: input.connected_at ?? now,
        last_synced_at: input.last_synced_at ?? now,
        platform_account_data: input.platform_account_data ?? null,
        access_token: input.access_token ?? null,
        access_token_iv: input.access_token_iv ?? null,
        access_token_tag: input.access_token_tag ?? null,
        refresh_token: input.refresh_token ?? null,
        refresh_token_iv: input.refresh_token_iv ?? null,
        refresh_token_tag: input.refresh_token_tag ?? null,
        token_expires_at: input.token_expires_at ?? null,
      })
      .select()
      .single()

    if (error) throw error
    return data as AdAccount
  }

  async findByUserId(userId: string): Promise<AdAccount[]> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("connected_at", { ascending: false })

    if (error) throw error
    return (data ?? []) as AdAccount[]
  }

  async findByUserAndClient(userId: string, clientId: string): Promise<AdAccount[]> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("connected_at", { ascending: false })

    if (error) throw error
    return (data ?? []) as AdAccount[]
  }

  async findByUserClientAndPlatform(
    userId: string,
    clientId: string,
    platform: Platform
  ): Promise<AdAccount | null> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("platform", platform)
      .eq("is_active", true)
      .maybeSingle()

    if (error && error.code !== "PGRST116") throw error
    return data as AdAccount | null
  }

  /** @deprecated Use findByUserAndClient or findByUserClientAndPlatform. Kept for backward compat. */
  async findByUserAndPlatform(userId: string, platform: Platform): Promise<AdAccount | null> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()

    if (error && error.code !== "PGRST116") throw error
    return data as AdAccount | null
  }

  async update(userId: string, id: string, updates: Partial<AdAccount>): Promise<AdAccount> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .update(updates)
      .eq("user_id", userId)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return data as AdAccount
  }

  async delete(userId: string, id: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("ad_accounts")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)

    if (error) throw error
  }
}
