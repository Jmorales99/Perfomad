import type { AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import { getTiktokPayloadFromRow, type TikTokPlatformAccountDataShape } from "@/domain/tiktok/TikTokConnection"

export class SelectTikTokAdvertiser {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(userId: string, clientId: string, advertiserId: string): Promise<{ accountId: string }> {
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    const row = await this.adAccountsRepo.findByUserClientAndPlatform(userId, clientId, "tiktok", {
      includeInactive: true,
    })
    if (!row) {
      throw new Error("No TikTok connection for this brand. Connect TikTok first.")
    }

    const payload = getTiktokPayloadFromRow(row.platform_account_data)
    if (!payload?.authorizedAdvertisers?.length) {
      throw new Error("No authorized advertisers found. Reconnect TikTok.")
    }

    const chosen = payload.authorizedAdvertisers.find((a) => a.id === advertiserId)
    if (!chosen) {
      throw new Error("Advertiser is not in the authorized list for this connection.")
    }

    const nextData: TikTokPlatformAccountDataShape = {
      tiktok: {
        ...payload,
        selectionPending: false,
        authorizedAdvertisers: payload.authorizedAdvertisers,
      },
    }

    const updated = await this.adAccountsRepo.update(userId, row.id, {
      platform_account_id: chosen.id,
      account_name: chosen.name,
      currency: chosen.currency ?? "USD",
      is_active: true,
      last_synced_at: new Date().toISOString(),
      platform_account_data: nextData,
    })

    return { accountId: updated.id }
  }
}
