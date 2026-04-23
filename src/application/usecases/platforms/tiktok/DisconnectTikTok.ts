import type { AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"

/**
 * Deactivates TikTok for the brand and clears encrypted tokens (connection row kept for audit).
 */
export class DisconnectTikTok {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(userId: string, clientId: string): Promise<{ disconnected: boolean }> {
    const brand = await this.clientsRepo.getById(userId, clientId)
    if (!brand) {
      throw new Error("Brand not found or does not belong to this user")
    }

    const row = await this.adAccountsRepo.findByUserClientAndPlatform(userId, clientId, "tiktok", {
      includeInactive: true,
    })
    if (!row) {
      return { disconnected: false }
    }

    await this.adAccountsRepo.update(userId, row.id, {
      is_active: false,
      access_token: null,
      access_token_iv: null,
      access_token_tag: null,
      refresh_token: null,
      refresh_token_iv: null,
      refresh_token_tag: null,
      token_expires_at: null,
      last_synced_at: new Date().toISOString(),
    })

    return { disconnected: true }
  }
}
