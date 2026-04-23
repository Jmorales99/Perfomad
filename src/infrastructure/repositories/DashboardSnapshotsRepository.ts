import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { AccountInsights, CampaignInsightsRow } from "@/infrastructure/integrations/platforms/PlatformApiClient"

export interface DashboardSnapshot {
  id: string
  user_id: string
  client_id: string
  platform: string
  ad_account_id: string
  account_metrics: AccountInsights
  platform_campaigns: CampaignInsightsRow[]
  synced_at: string
  date_range_since: string | null
  date_range_until: string | null
}

export interface UpsertSnapshotInput {
  user_id: string
  client_id: string
  platform: string
  ad_account_id: string
  account_metrics: AccountInsights
  platform_campaigns: CampaignInsightsRow[]
  date_range_since: string
  date_range_until: string
}

export class DashboardSnapshotsRepository {
  async upsert(input: UpsertSnapshotInput): Promise<DashboardSnapshot> {
    const { data, error } = await supabaseAdmin
      .from("dashboard_snapshots")
      .upsert(
        {
          user_id: input.user_id,
          client_id: input.client_id,
          platform: input.platform,
          ad_account_id: input.ad_account_id,
          account_metrics: input.account_metrics,
          platform_campaigns: input.platform_campaigns,
          synced_at: new Date().toISOString(),
          date_range_since: input.date_range_since,
          date_range_until: input.date_range_until,
        },
        { onConflict: "user_id,client_id,ad_account_id" }
      )
      .select()
      .single()

    if (error) throw error
    return data as DashboardSnapshot
  }

  async findByUserAndClient(userId: string, clientId: string): Promise<DashboardSnapshot[]> {
    const { data, error } = await supabaseAdmin
      .from("dashboard_snapshots")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .order("synced_at", { ascending: false })

    if (error) throw error
    return (data ?? []) as DashboardSnapshot[]
  }

  async findByUserClientAndPlatform(
    userId: string,
    clientId: string,
    platform: string
  ): Promise<DashboardSnapshot[]> {
    const { data, error } = await supabaseAdmin
      .from("dashboard_snapshots")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("platform", platform)
      .order("synced_at", { ascending: false })

    if (error) throw error
    return (data ?? []) as DashboardSnapshot[]
  }
}
