import { SupabaseMultichannelCampaignsRepository } from "@/infrastructure/repositories/SupabaseMultichannelCampaignsRepository"
import type { MultichannelCampaign } from "@/infrastructure/repositories/SupabaseMultichannelCampaignsRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export type StatusAction = "pause" | "resume"

export interface PlatformStatusResult {
  platform: string
  status: "paused" | "active" | "failed"
  error?: string
}

export interface UpdateMultichannelCampaignStatusResult {
  multichannelCampaign: MultichannelCampaign
  byPlatform: PlatformStatusResult[]
}

function toPlatformAction(action: StatusAction): "PAUSED" | "ACTIVE" {
  return action === "pause" ? "PAUSED" : "ACTIVE"
}

function deriveGlobalStatus(byPlatform: PlatformStatusResult[]): string {
  const hasActive = byPlatform.some((p) => p.status === "active")
  const hasPaused = byPlatform.some((p) => p.status === "paused")
  const hasFailed = byPlatform.some((p) => p.status === "failed")
  if (hasActive && (hasPaused || hasFailed)) return "partial_failed"
  if (hasPaused && !hasActive && !hasFailed) return "paused"
  if (hasActive && !hasPaused && !hasFailed) return "active"
  return "partial_failed"
}

export class UpdateMultichannelCampaignStatus {
  private mcRepo: SupabaseMultichannelCampaignsRepository
  private adAccountsRepo: SupabaseAdAccountsRepository
  private tokenManager: TokenManager

  constructor() {
    this.mcRepo = new SupabaseMultichannelCampaignsRepository()
    this.adAccountsRepo = new SupabaseAdAccountsRepository()
    this.tokenManager = new TokenManager()
  }

  async execute(
    userId: string,
    multichannelCampaignId: string,
    action: StatusAction,
    /** If provided, only update this specific platform. Otherwise update all. */
    targetPlatform?: string
  ): Promise<UpdateMultichannelCampaignStatusResult> {
    const parent = await this.mcRepo.findById(userId, multichannelCampaignId)
    if (!parent) throw new Error("Multichannel campaign not found")

    const campaignRow = await this.mcRepo.findCampaignByMultichannelId(multichannelCampaignId)
    if (!campaignRow) throw new Error("No linked campaign found for this multichannel campaign")

    const platformsToUpdate = targetPlatform
      ? campaignRow.platforms.filter((p) => p === targetPlatform)
      : campaignRow.platforms

    const platformStatus: Record<string, string> = { ...(campaignRow.platform_status ?? {}) }
    const byPlatform: PlatformStatusResult[] = []

    await Promise.allSettled(
      platformsToUpdate.map(async (platform) => {
        const platformCampaignId = (campaignRow.platform_campaign_id ?? {})[platform]
        if (!platformCampaignId) {
          byPlatform.push({ platform, status: "failed", error: "No platform campaign ID found" })
          platformStatus[platform] = "failed"
          return
        }

        try {
          const adAccount = await this.adAccountsRepo.findByUserClientAndPlatform(
            userId,
            parent.client_id,
            platform as any
          )
          if (!adAccount) throw new Error(`No active ad account for platform ${platform}`)

          const client = PlatformApiClientFactory.createClient(platform as any)
          const accessToken = await this.tokenManager.getValidAccessToken(
            adAccount as any,
            async (rt: string) => client.refreshAccessToken(rt)
          )

          await client.updateCampaignStatus(
            platformCampaignId,
            toPlatformAction(action),
            accessToken,
            { platformAccountId: adAccount.platform_account_id }
          )

          const newStatus = action === "pause" ? "paused" : "active"
          byPlatform.push({ platform, status: newStatus })
          platformStatus[platform] = newStatus
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          byPlatform.push({ platform, status: "failed", error: msg })
          platformStatus[platform] = "failed"
        }
      })
    )

    // Update platform_status on campaigns row
    await supabaseAdmin
      .from("campaigns")
      .update({ platform_status: platformStatus })
      .eq("id", campaignRow.id)

    // Derive new global status
    const allStatuses: PlatformStatusResult[] = campaignRow.platforms.map((p) => {
      const existing = byPlatform.find((b) => b.platform === p)
      if (existing) return existing
      const s = (platformStatus[p] ?? "active") as "active" | "paused" | "failed"
      return { platform: p, status: s }
    })
    const globalStatus = deriveGlobalStatus(allStatuses)

    const updatedParent = await this.mcRepo.update(userId, multichannelCampaignId, {
      status: globalStatus as any,
    })

    return { multichannelCampaign: updatedParent, byPlatform }
  }
}
