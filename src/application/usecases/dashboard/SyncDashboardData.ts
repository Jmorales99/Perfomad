import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { tokenErrorRequiresReconnect } from "@/infrastructure/oauth/reconnectErrors"
import type { AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import type { DashboardSnapshotsRepository } from "@/infrastructure/repositories/DashboardSnapshotsRepository"
import type { ConsolidatedDashboardResult, IntegrationError } from "./GetConsolidatedDashboard"

/** Platforms that have real API implementations (not stubs). */
const SUPPORTED_PLATFORMS = new Set(["meta", "google_ads"])

/**
 * Fetches live metrics and campaign data from all connected ad platforms
 * for a given user+client, then upserts the results into dashboard_snapshots.
 *
 * - Only platforms in SUPPORTED_PLATFORMS are fetched; others are silently skipped.
 * - Runs all account fetches in parallel for speed.
 * - Returns the same shape as GetConsolidatedDashboard so the frontend can
 *   update immediately after sync without a second round-trip.
 */
export class SyncDashboardData {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private snapshotsRepo: DashboardSnapshotsRepository,
    private tokenManager: TokenManager,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(
    userId: string,
    clientId: string,
    dateRange?: { since: string; until: string }
  ): Promise<ConsolidatedDashboardResult> {
    // Validate brand ownership
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    // Build default date range (last 30 days)
    const until = dateRange?.until ?? new Date().toISOString().slice(0, 10)
    const since = dateRange?.since ?? (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.toISOString().slice(0, 10)
    })()
    const effectiveDateRange = { since, until }

    // Get all active ad accounts for this client
    const adAccounts = await this.adAccountsRepo.findByUserAndClient(userId, clientId)
    const supportedAccounts = adAccounts.filter(
      (a) => a.is_active && SUPPORTED_PLATFORMS.has(a.platform)
    )

    // Fetch from each platform account in parallel
    const results = await Promise.allSettled(
      supportedAccounts.map(async (account) => {
        const platformClient = PlatformApiClientFactory.createClient(account.platform as any)

        const accessToken = await this.tokenManager.getValidAccessToken(
          account,
          (refreshToken) => platformClient.refreshAccessToken(refreshToken)
        )

        const [accountMetrics, platformCampaigns] = await Promise.all([
          platformClient.getAccountInsights(
            account.platform_account_id,
            accessToken,
            effectiveDateRange
          ),
          platformClient.getAdAccountCampaignInsights(
            account.platform_account_id,
            accessToken,
            effectiveDateRange
          ),
        ])

        await this.snapshotsRepo.upsert({
          user_id: userId,
          client_id: clientId,
          platform: account.platform,
          ad_account_id: account.id,
          account_metrics: accountMetrics,
          platform_campaigns: platformCampaigns,
          date_range_since: effectiveDateRange.since,
          date_range_until: effectiveDateRange.until,
        })

        return { account, accountMetrics, platformCampaigns }
      })
    )

    // Collect per-account errors and classify token failures for the frontend
    const integrationErrors: IntegrationError[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "rejected") {
        const account = supportedAccounts[i]
        const message: string = result.reason?.message ?? String(result.reason)
        console.error("[SyncDashboardData] Failed to sync account:", message)
        integrationErrors.push({
          platform: account.platform,
          ad_account_id: account.id,
          message,
          requires_reconnection: tokenErrorRequiresReconnect(message),
          code: tokenErrorRequiresReconnect(message) ? "oauth_reconnect_required" : undefined,
        })
      }
    }

    // Read fresh snapshots and return consolidated view
    const snapshots = await this.snapshotsRepo.findByUserAndClient(userId, clientId)
    const consolidated = buildConsolidated(snapshots)
    if (integrationErrors.length > 0) {
      consolidated.integration_errors = integrationErrors
    }
    return consolidated
  }
}

/**
 * Shared helper — builds the ConsolidatedDashboardResult from raw snapshots.
 * Exported so GetConsolidatedDashboard can reuse the same logic.
 */
export function buildConsolidated(
  snapshots: Awaited<ReturnType<DashboardSnapshotsRepository["findByUserAndClient"]>>
): ConsolidatedDashboardResult {
  if (snapshots.length === 0) {
    return {
      needs_sync: true,
      last_synced_at: null,
      totals: {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        roa: null,
      },
      platforms: [],
      campaigns: [],
    }
  }

  // Aggregate totals across all snapshots
  let totalSpend = 0
  let totalImpressions = 0
  let totalClicks = 0
  let totalConversions = 0
  let totalRevenue = 0

  const platformMap = new Map<
    string,
    {
      spend: number
      impressions: number
      clicks: number
      conversions: number
      revenue: number
      campaigns: ConsolidatedDashboardResult["campaigns"]
      account_name: string | null
    }
  >()

  for (const snap of snapshots) {
    const m = snap.account_metrics
    const conversions = (m.actions ?? [])
      .filter((a) => a.action_type === "purchase")
      .reduce((s, a) => s + parseInt(a.value, 10), 0)
    const revenue = (m.action_values ?? [])
      .filter((a) => a.action_type === "purchase")
      .reduce((s, a) => s + parseFloat(a.value), 0)

    totalSpend += m.spend ?? 0
    totalImpressions += m.impressions ?? 0
    totalClicks += m.clicks ?? 0
    totalConversions += conversions
    totalRevenue += revenue

    if (!platformMap.has(snap.platform)) {
      platformMap.set(snap.platform, {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        campaigns: [],
        account_name: null,
      })
    }
    const pData = platformMap.get(snap.platform)!
    pData.spend += m.spend ?? 0
    pData.impressions += m.impressions ?? 0
    pData.clicks += m.clicks ?? 0
    pData.conversions += conversions
    pData.revenue += revenue

    // Map external campaigns from this snapshot
    for (const c of snap.platform_campaigns ?? []) {
      const cConversions = (c.actions ?? [])
        .filter((a) => a.action_type === "purchase")
        .reduce((s, a) => s + parseInt(a.value, 10), 0)
      const cRevenue = (c.action_values ?? [])
        .filter((a) => a.action_type === "purchase")
        .reduce((s, a) => s + parseFloat(a.value), 0)

      pData.campaigns.push({
        campaign_id: c.campaign_id,
        name: c.name,
        platform: snap.platform,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: cConversions,
        revenue: cRevenue,
        ctr: c.ctr,
        cpc: c.cpc,
        roa: c.spend > 0 ? cRevenue / c.spend : null,
        status: c.status,
      })
    }
  }

  // Build per-platform summary array
  const platforms = Array.from(platformMap.entries()).map(([platform, data]) => ({
    platform,
    spend: data.spend,
    impressions: data.impressions,
    clicks: data.clicks,
    conversions: data.conversions,
    revenue: data.revenue,
    ctr: data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0,
    cpc: data.clicks > 0 ? data.spend / data.clicks : 0,
    roa: data.spend > 0 ? data.revenue / data.spend : null,
    campaigns: data.campaigns.sort((a, b) => b.spend - a.spend),
  }))

  // Unified campaign list across all platforms, ordered by spend desc
  const allCampaigns = platforms
    .flatMap((p) => p.campaigns)
    .sort((a, b) => b.spend - a.spend)

  const globalCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
  const globalCpc = totalClicks > 0 ? totalSpend / totalClicks : 0
  const globalCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0

  const lastSyncedAt = snapshots.reduce((max, s) => {
    return !max || s.synced_at > max ? s.synced_at : max
  }, null as string | null)

  return {
    needs_sync: false,
    last_synced_at: lastSyncedAt,
    totals: {
      spend: totalSpend,
      impressions: totalImpressions,
      clicks: totalClicks,
      conversions: totalConversions,
      revenue: totalRevenue,
      ctr: globalCtr,
      cpc: globalCpc,
      cpm: globalCpm,
      roa: totalSpend > 0 ? totalRevenue / totalSpend : null,
    },
    platforms,
    campaigns: allCampaigns,
  }
}
