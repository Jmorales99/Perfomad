import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export type Platform = "meta" | "google_ads" | "linkedin"

export interface AdAccount {
  id: string
  user_id: string
  platform: Platform
  plai_user_id: string
  platform_account_id: string
  account_name: string | null
  currency: string
  is_active: boolean
  connected_at: string
  last_synced_at: string | null
  plai_account_data: any | null
  created_at: string
}

export class SupabaseAdAccountsRepository {
  async create(account: Omit<AdAccount, "id" | "created_at">): Promise<AdAccount> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .insert(account)
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
    return (data || []) as AdAccount[]
  }

  async findByUserAndPlatform(
    userId: string,
    platform: Platform
  ): Promise<AdAccount | null> {
    const { data, error } = await supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("is_active", true)
      .maybeSingle()

    if (error && error.code !== "PGRST116") throw error
    return data as AdAccount | null
  }

  async syncConnectedAccounts(
    userId: string,
    plaiUserId: string,
    connectedAccounts: {
      facebookAds?: any[]
      linkedinAds?: any[]
      googleAds?: any[]
    }
  ): Promise<AdAccount[]> {
    const accounts: AdAccount[] = []

    // Process Facebook/Meta accounts
    if (connectedAccounts.facebookAds && Array.isArray(connectedAccounts.facebookAds)) {
      for (const fbAccount of connectedAccounts.facebookAds) {
        const account = await this.createOrUpdate({
          user_id: userId,
          platform: "meta",
          plai_user_id: plaiUserId,
          platform_account_id: fbAccount.id || fbAccount.accountId || String(fbAccount.adAccountId) || `act_${Math.random().toString(36).substring(7)}`,
          account_name: fbAccount.name || fbAccount.accountName || fbAccount.adAccountName || `Meta Account - ${userId.slice(0, 8)}`,
          currency: fbAccount.currency || fbAccount.currencyCode || "USD",
          plai_account_data: fbAccount,
        })
        accounts.push(account)
      }
    }

    // Process LinkedIn accounts
    if (connectedAccounts.linkedinAds && Array.isArray(connectedAccounts.linkedinAds)) {
      for (const liAccount of connectedAccounts.linkedinAds) {
        const account = await this.createOrUpdate({
          user_id: userId,
          platform: "linkedin",
          plai_user_id: plaiUserId,
          platform_account_id: liAccount.id || liAccount.accountId || `li_${Math.random().toString(36).substring(7)}`,
          account_name: liAccount.name || "LinkedIn Ad Account",
          currency: liAccount.currency || "USD",
          plai_account_data: liAccount,
        })
        accounts.push(account)
      }
    }

    // Process Google Ads accounts
    if (connectedAccounts.googleAds && Array.isArray(connectedAccounts.googleAds)) {
      for (const googleAccount of connectedAccounts.googleAds) {
        const account = await this.createOrUpdate({
          user_id: userId,
          platform: "google_ads",
          plai_user_id: plaiUserId,
          platform_account_id: googleAccount.id || googleAccount.accountId || `${Math.random().toString(36).substring(7)}`,
          account_name: googleAccount.name || "Google Ads Account",
          currency: googleAccount.currency || "USD",
          plai_account_data: googleAccount,
        })
        accounts.push(account)
      }
    }

    return accounts
  }

  private async createOrUpdate(data: Partial<AdAccount>): Promise<AdAccount> {
    // Try to find existing account
    const { data: existing } = await supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", data.user_id!)
      .eq("platform", data.platform!)
      .eq("platform_account_id", data.platform_account_id!)
      .maybeSingle()

    if (existing) {
      // Update existing account
      const { data: updated, error } = await supabaseAdmin
        .from("ad_accounts")
        .update({
          ...data,
          last_synced_at: new Date().toISOString(),
          is_active: true,
        })
        .eq("id", existing.id)
        .select()
        .single()

      if (error) throw error
      return updated as AdAccount
    } else {
      // Create new account
      return this.create({
        user_id: data.user_id!,
        platform: data.platform!,
        plai_user_id: data.plai_user_id!,
        platform_account_id: data.platform_account_id!,
        account_name: data.account_name || null,
        currency: data.currency || "USD",
        is_active: true,
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        plai_account_data: data.plai_account_data || null,
      })
    }
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
