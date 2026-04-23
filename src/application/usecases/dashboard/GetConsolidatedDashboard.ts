import type { DashboardSnapshotsRepository } from "@/infrastructure/repositories/DashboardSnapshotsRepository"
import { buildConsolidated } from "./SyncDashboardData"

export interface ConsolidatedCampaign {
  campaign_id: string
  name: string
  platform: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  roa: number | null
  /** Normalized campaign status: 'active' | 'paused' | 'removed' | 'unknown' */
  status?: string
}

export interface ConsolidatedPlatform {
  platform: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  roa: number | null
  campaigns: ConsolidatedCampaign[]
}

export interface ConsolidatedTotals {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  cpm: number
  roa: number | null
}

export interface IntegrationError {
  platform: string
  ad_account_id?: string
  message: string
  requires_reconnection: boolean
  code?: string
}

export interface ConsolidatedDashboardResult {
  needs_sync: boolean
  last_synced_at: string | null
  totals: ConsolidatedTotals
  platforms: ConsolidatedPlatform[]
  campaigns: ConsolidatedCampaign[]
  /** Present only after a sync attempt; lists platforms whose tokens need refreshing. */
  integration_errors?: IntegrationError[]
}

/**
 * Reads cached dashboard data from dashboard_snapshots and aggregates it.
 * Does NOT call any external platform APIs.
 *
 * If no snapshots exist (first time) → returns needs_sync: true so the
 * frontend knows to prompt the user to run a sync.
 */
export class GetConsolidatedDashboard {
  constructor(private snapshotsRepo: DashboardSnapshotsRepository) {}

  async execute(
    userId: string,
    clientId: string,
    platform?: string
  ): Promise<ConsolidatedDashboardResult> {
    const snapshots = platform
      ? await this.snapshotsRepo.findByUserClientAndPlatform(userId, clientId, platform)
      : await this.snapshotsRepo.findByUserAndClient(userId, clientId)

    return buildConsolidated(snapshots)
  }
}
