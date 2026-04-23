import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { SyncConnectedAccounts } from "@/application/usecases/adaccounts/SyncConnectedAccounts"
import { SyncCampaignMetrics } from "@/application/usecases/campaigns/SyncCampaignMetrics"

export interface SyncCampaignDetail {
  campaign_id: string
  campaign_name: string
  status: "synced" | "failed" | "skipped"
  error?: string
}

export interface SyncClientDataResult {
  synced_at: string
  duration_ms: number
  accounts: {
    total: number
    updated: number
    errors: number
  }
  campaigns: {
    total: number
    synced: number
    failed: number
    skipped: number
    details: SyncCampaignDetail[]
  }
}

const BATCH_SIZE = 5

export class SyncClientData {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private adAccountsRepo: SupabaseAdAccountsRepository,
    private metricsHistoryRepo: CampaignMetricsHistoryRepository,
    private syncConnectedAccounts: SyncConnectedAccounts,
    private syncCampaignMetrics: SyncCampaignMetrics
  ) {}

  async execute(userId: string, clientId: string): Promise<SyncClientDataResult> {
    const startedAt = Date.now()

    // 1. Sync ad accounts (refresh tokens + metadata)
    let accountsUpdated = 0
    let accountErrors = 0
    let totalAccounts = 0
    try {
      const before = await this.adAccountsRepo.findByUserAndClient(userId, clientId)
      totalAccounts = before.length
      const synced = await this.syncConnectedAccounts.execute(userId, clientId)
      accountsUpdated = synced.length
    } catch {
      accountErrors = 1
    }

    // 2. List all campaigns for this client
    const campaigns = await this.campaignsRepo.listByUserAndClient(userId, clientId)

    // 3. Separate syncable campaigns from those without a platform link
    const syncable = campaigns.filter(
      (c) => !!(c as any).platform_campaign_id || !!(c as any).mock_campaign_id
    )
    const skipped = campaigns.filter(
      (c) => !(c as any).platform_campaign_id && !(c as any).mock_campaign_id
    )

    const details: SyncCampaignDetail[] = skipped.map((c) => ({
      campaign_id: c.id,
      campaign_name: c.name,
      status: "skipped",
    }))

    // 4. Sync in batches of BATCH_SIZE to avoid platform rate limits
    for (let i = 0; i < syncable.length; i += BATCH_SIZE) {
      const batch = syncable.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map((c) => this.syncCampaignMetrics.execute(userId, c.id))
      )
      for (let j = 0; j < batch.length; j++) {
        const campaign = batch[j]
        const result = results[j]
        if (result.status === "fulfilled") {
          details.push({ campaign_id: campaign.id, campaign_name: campaign.name, status: "synced" })
        } else {
          details.push({
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            status: "failed",
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          })
        }
      }
    }

    const synced = details.filter((d) => d.status === "synced").length
    const failed = details.filter((d) => d.status === "failed").length
    const skippedCount = details.filter((d) => d.status === "skipped").length

    return {
      synced_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      accounts: {
        total: totalAccounts,
        updated: accountsUpdated,
        errors: accountErrors,
      },
      campaigns: {
        total: campaigns.length,
        synced,
        failed,
        skipped: skippedCount,
        details,
      },
    }
  }
}
