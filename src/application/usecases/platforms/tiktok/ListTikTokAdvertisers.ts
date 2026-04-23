import type { AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import { getTiktokPayloadFromRow, TIKTOK_PENDING_PLATFORM_ACCOUNT_ID } from "@/domain/tiktok/TikTokConnection"

export interface ListTikTokAdvertisersResult {
  advertisers: Array<{ id: string; name: string; currency?: string }>
  selectionPending: boolean
  isConnected: boolean
}

/**
 * Returns authorized TikTok advertisers stored after OAuth (from platform_account_data).
 */
export class ListTikTokAdvertisers {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(userId: string, clientId: string): Promise<ListTikTokAdvertisersResult> {
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    const row = await this.adAccountsRepo.findByUserClientAndPlatform(userId, clientId, "tiktok", {
      includeInactive: true,
    })
    if (!row) {
      return { advertisers: [], selectionPending: false, isConnected: false }
    }

    const payload = getTiktokPayloadFromRow(row.platform_account_data)
    const advertisers = payload?.authorizedAdvertisers ?? []
    const selectionPending = payload?.selectionPending === true
    const isConnected = row.is_active && row.platform_account_id !== TIKTOK_PENDING_PLATFORM_ACCOUNT_ID

    return {
      advertisers,
      selectionPending,
      isConnected: !!isConnected,
    }
  }
}
