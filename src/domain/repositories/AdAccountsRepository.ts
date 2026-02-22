/**
 * Domain interface for ad accounts (platform connections).
 * All ad-related data is scoped by user_id + client_id.
 */
export type Platform = "meta" | "google_ads" | "linkedin"

export interface AdAccount {
  id: string
  user_id: string
  client_id: string
  platform: Platform
  platform_account_id: string
  platform_user_id: string | null
  account_name: string | null
  currency: string
  is_active: boolean
  connected_at: string
  last_synced_at: string | null
  platform_account_data: unknown
  access_token: string | null
  access_token_iv: string | null
  access_token_tag: string | null
  refresh_token: string | null
  refresh_token_iv: string | null
  refresh_token_tag: string | null
  token_expires_at: string | null
  created_at: string
}

export interface CreateAdAccountInput {
  user_id: string
  client_id: string
  platform: Platform
  platform_account_id: string
  platform_user_id?: string | null
  account_name?: string | null
  currency?: string
  is_active?: boolean
  connected_at?: string
  last_synced_at?: string | null
  platform_account_data?: unknown
  access_token?: string | null
  access_token_iv?: string | null
  access_token_tag?: string | null
  refresh_token?: string | null
  refresh_token_iv?: string | null
  refresh_token_tag?: string | null
  token_expires_at?: string | null
}

export interface AdAccountsRepository {
  create(input: CreateAdAccountInput): Promise<AdAccount>
  findByUserId(userId: string): Promise<AdAccount[]>
  findByUserAndClient(userId: string, clientId: string): Promise<AdAccount[]>
  findByUserClientAndPlatform(
    userId: string,
    clientId: string,
    platform: Platform
  ): Promise<AdAccount | null>
  update(userId: string, id: string, updates: Partial<AdAccount>): Promise<AdAccount>
  delete(userId: string, id: string): Promise<void>
}
