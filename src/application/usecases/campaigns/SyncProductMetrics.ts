import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import type { ProductMetricsRepository } from "@/domain/repositories/ProductMetricsRepository"
import type { ProductMetricRow } from "@/domain/repositories/ProductMetricsRepository"

export class SyncProductMetrics {
  private tokenManager = new TokenManager()
  private adAccountsRepo = new SupabaseAdAccountsRepository()

  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private productMetricsRepo: ProductMetricsRepository
  ) {}

  async execute(
    userId: string,
    campaignId: string,
    options?: { since?: string; until?: string }
  ): Promise<{ synced: number; platform: string }[]> {
    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaña no encontrada")

    const campaignIdField = (campaign as any).platform_campaign_id
    if (!campaignIdField) throw new Error("La campaña no está vinculada a ninguna plataforma")

    let platformCampaignIds: Record<string, string>
    try {
      platformCampaignIds =
        typeof campaignIdField === "string" ? JSON.parse(campaignIdField) : campaignIdField
    } catch {
      throw new Error("Invalid platform_campaign_id format")
    }

    const adAccounts = await this.adAccountsRepo.findByUserId(userId)
    const adAccountsByPlatform = new Map(adAccounts.map((a) => [a.platform, a]))

    const results: { synced: number; platform: string }[] = []

    for (const [platform, platformCampaignId] of Object.entries(platformCampaignIds)) {
      const adAccount = adAccountsByPlatform.get(platform as Platform)
      if (!adAccount) continue

      const client = PlatformApiClientFactory.createClient(platform as Platform)
      const accessToken = await this.tokenManager.getValidAccessToken(
        adAccount as any,
        (rt) => client.refreshAccessToken(rt)
      )

      const rows = await client.getProductInsights(
        adAccount.platform_account_id,
        accessToken,
        {
          campaignId: platformCampaignId,
          since: options?.since,
          until: options?.until,
        }
      )

      if (rows.length === 0) {
        results.push({ synced: 0, platform })
        continue
      }

      const today = new Date().toISOString().slice(0, 10)
      const toUpsert: ProductMetricRow[] = rows.map((r) => ({
        user_id: userId,
        client_id: (campaign as any).client_id,
        ad_account_id: adAccount.id,
        campaign_id: campaignId,
        platform,
        product_id: r.product_id,
        product_title: r.product_title ?? null,
        image_url: r.image_url ?? null,
        recorded_at: options?.until ?? today,
        impressions: r.impressions,
        clicks: r.clicks,
        spend: r.spend,
        conversions: r.conversions,
        revenue: r.revenue,
        ctr: r.ctr,
        cpc: r.cpc,
        roas: r.roas,
        raw: r.raw,
      }))

      await this.productMetricsRepo.upsertRows(toUpsert)
      results.push({ synced: rows.length, platform })
    }

    return results
  }
}
