import type {
  SupabaseCampaignsRepository,
  Campaign,
} from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type {
  SupabaseAdAccountsRepository,
  Platform,
} from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import type { PlatformApiClient } from "@/infrastructure/integrations/platforms/PlatformApiClient"
import { isReconnectRequired } from "@/infrastructure/integrations/platforms/OAuthErrorDetector"

export interface ImportPlatformCampaignInput {
  userId: string
  platform: Platform
  platformCampaignId: string
  /** The brand/client this campaign should belong to. */
  clientId: string
  /**
   * Optional explicit ad account (useful when the user has multiple ad
   * accounts on the same platform for the same client). If omitted, picks
   * the first active one matching {user, client, platform}.
   */
  adAccountId?: string
}

export interface ImportPlatformCampaignResult {
  campaign: Campaign
  /** `true` when a new row was inserted, `false` when an existing row was reused. */
  imported: boolean
  /** Set when the historical backfill failed — campaign was imported but has no metrics yet. */
  backfillError?: string
}

interface BackfillTotals {
  rowCount: number
  totalSpend: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  totalReach: number
}

/**
 * Imports an existing platform-native campaign (one created in Meta Ads
 * Manager or Google Ads UI, not through Perfomad) into the local `campaigns`
 * table so it can be optimized via the AI pipeline.
 *
 * Idempotent: calling twice with the same (userId, platform, platformCampaignId)
 * reuses the existing row. On subsequent calls for already-imported campaigns
 * the `start_date` is repaired if the platform provides the actual start date
 * and it differs from what is stored locally.
 */
export class ImportPlatformCampaign {
  private tokenManager = new TokenManager()

  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private adAccountsRepo: SupabaseAdAccountsRepository,
    private metricsRepo: CampaignMetricsHistoryRepository
  ) {}

  async execute(
    input: ImportPlatformCampaignInput
  ): Promise<ImportPlatformCampaignResult> {
    // 1. Idempotency check — keep the existing row if already imported.
    const existing = await this.campaignsRepo.findByPlatformCampaignId(
      input.userId,
      input.platform,
      input.platformCampaignId
    )

    // 2. Resolve the ad account. We attempt this even for existing campaigns
    //    so we can repair start_date on re-import calls.
    const adAccount = await this.adAccountsRepo.findByUserClientAndPlatform(
      input.userId,
      input.clientId,
      input.platform
    )

    if (!adAccount) {
      // No account — nothing we can fetch from platform. Return existing if any.
      if (existing) return { campaign: existing, imported: false }
      throw new Error(
        `No active ${input.platform} ad account found for this client`
      )
    }

    // Mismatch guard only applies to new imports (existing rows are already locked in).
    if (!existing && input.adAccountId && adAccount.platform_account_id !== input.adAccountId) {
      throw new Error(
        "Provided adAccountId does not belong to this client on this platform"
      )
    }

    // 3. Fetch live metadata from the platform. Best-effort: failures produce
    //    a stub / leave existing data intact rather than crashing.
    let name = `Campaña importada ${input.platformCampaignId}`
    let status: Campaign["status"] = "active"
    let objective: string | null = null
    let dailyBudget: number | null = null
    let lifetimeBudget: number | null = null
    let platformStartDate: string | null = null

    try {
      const client = PlatformApiClientFactory.createClient(input.platform)
      const accessToken = await this.tokenManager.getValidAccessToken(
        adAccount as any,
        async (refreshToken: string) => client.refreshAccessToken(refreshToken)
      )

      const [list, budget] = await Promise.all([
        client
          .listCampaigns(adAccount.platform_account_id, accessToken)
          .catch(() => [] as Array<{ id: string; name: string; status: string; [key: string]: any }>),
        client
          .getCampaignBudget(input.platformCampaignId, accessToken, {
            platformAccountId: adAccount.platform_account_id,
          })
          .catch(() => null),
      ])

      const hit = list.find((c) => c.id === input.platformCampaignId)
      if (hit?.name) name = hit.name
      if (hit?.objective) objective = hit.objective

      if (budget) {
        // Use budget.name as fallback when listCampaigns() missed the entry (pagination)
        if (!hit?.name && budget.name) name = budget.name
        dailyBudget = budget.daily_budget
        lifetimeBudget = budget.lifetime_budget
        const raw = (budget.status ?? "").toUpperCase()
        status = raw === "PAUSED" ? "paused" : "active"
        // getCampaignBudget fetches directly by campaign ID (no pagination risk),
        // so it is the reliable source for start_date.
        if (budget.start_date) {
          platformStartDate = budget.start_date
        }
      }
    } catch (err) {
      console.warn(
        `[ImportPlatformCampaign] Platform metadata fetch failed for ${input.platform}/${input.platformCampaignId}:`,
        (err as Error).message
      )
    }

    // 4. If already imported, repair start_date when the platform provides a
    //    more accurate value (common for campaigns imported before this fix).
    if (existing) {
      const isImported = (existing as any).source === "imported"
      if (isImported && platformStartDate && existing.start_date !== platformStartDate) {
        const updated = await this.campaignsRepo.update(input.userId, existing.id, {
          start_date: platformStartDate,
        })
        return { campaign: updated ?? existing, imported: false }
      }
      return { campaign: existing, imported: false }
    }

    // 5. Insert with source='imported', using the real platform start date.
    const created = await this.campaignsRepo.createImported({
      userId: input.userId,
      clientId: input.clientId,
      platform: input.platform,
      platformCampaignId: input.platformCampaignId,
      name,
      objective,
      status,
      budget_usd: dailyBudget,
      lifetime_budget: lifetimeBudget,
      start_date: platformStartDate,
    })

    // 6. Backfill historical daily metrics so the optimizer has context immediately.
    //    Awaited — failures surface to the caller; campaign is still marked imported.
    let backfillTotals: BackfillTotals = { rowCount: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0, totalRevenue: 0, totalReach: 0 }
    try {
      const client = PlatformApiClientFactory.createClient(input.platform)
      const tok = await this.tokenManager.getValidAccessToken(
        adAccount as any,
        async (rt: string) => client.refreshAccessToken(rt)
      )
      backfillTotals = await this.backfillMetricsHistory(
        created, input.platform, input.platformCampaignId, adAccount, client, tok, platformStartDate
      )
    } catch (err) {
      console.warn("[ImportPlatformCampaign] Backfill failed:", (err as Error).message)
      const connStatus = isReconnectRequired(err) ? "reconnect_required" : "error"
      await this.adAccountsRepo.markConnectionStatus(adAccount.user_id, adAccount.id, connStatus).catch(() => {})
      await this.campaignsRepo.update(input.userId, created.id, { sync_status: "backfill_failed" } as any)
      return { campaign: created, imported: true, backfillError: (err as Error).message }
    }

    // 7. Update campaign row with real lifetime totals derived from the backfill.
    if (backfillTotals.rowCount > 0) {
      const { totalSpend, totalImpressions, totalClicks, totalConversions, totalRevenue, totalReach } = backfillTotals
      const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0
      const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0
      const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
      const cpa = totalConversions > 0 ? totalSpend / totalConversions : undefined
      const roa = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : undefined

      const updated = await this.campaignsRepo.update(input.userId, created.id, {
        spend_usd: totalSpend,
        mock_stats: { spend: totalSpend, impressions: totalImpressions, clicks: totalClicks, ctr, cpc, cpm, conversions: totalConversions, revenue: totalRevenue, reach: totalReach, cpa, roa },
        last_synced_at: new Date().toISOString(),
        sync_status: "synced",
      } as any)
      return { campaign: updated ?? created, imported: true }
    }

    return { campaign: created, imported: true }
  }

  private async backfillMetricsHistory(
    campaign: Campaign,
    platform: Platform,
    _platformCampaignId: string,
    _adAccount: any,
    client: PlatformApiClient,
    accessToken: string,
    startDate: string | null
  ): Promise<BackfillTotals> {
    const since = startDate ? startDate.slice(0, 10) : undefined
    const until = new Date().toISOString().slice(0, 10)

    const dailyRows = await client.getCampaignDailyInsights(
      _platformCampaignId,
      accessToken,
      { platformAccountId: _adAccount.platform_account_id, since, until }
    )

    if (dailyRows.length === 0) {
      return { rowCount: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0, totalRevenue: 0, totalReach: 0 }
    }

    let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalConversions = 0, totalRevenue = 0, totalReach = 0

    const snapshots = dailyRows.map((row) => {
      totalSpend += row.spend
      totalImpressions += row.impressions
      totalClicks += row.clicks
      totalConversions += row.conversions
      totalRevenue += row.revenue
      totalReach += row.reach ?? 0
      const cpa = row.conversions > 0 ? row.spend / row.conversions : undefined
      const roa = row.spend > 0 && row.revenue > 0 ? row.revenue / row.spend : undefined
      return {
        campaign_id: campaign.id,
        platform,
        recorded_at: row.date + "T12:00:00.000Z",
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.ctr,
        conversions: row.conversions,
        revenue: row.revenue,
        reach: row.reach,
        cpa,
        roa,
        cost_per_click: row.cpc,
        cpm: row.cpm,
      }
    })

    await this.metricsRepo.bulkUpsertDailySnapshots(snapshots)
    console.info(`[ImportPlatformCampaign] Backfilled ${snapshots.length} days of metrics for campaign ${campaign.id}`)

    return { rowCount: snapshots.length, totalSpend, totalImpressions, totalClicks, totalConversions, totalRevenue, totalReach }
  }
}
