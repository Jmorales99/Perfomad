import { PlatformApiClientFactory } from "@/infrastructure/services/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/services/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import type { AdAccountsRepository, AdAccount, Platform } from "@/domain/repositories/AdAccountsRepository"

export class SyncConnectedAccounts {
  constructor(
    private adAccountsRepo: AdAccountsRepository,
    private tokenManager: TokenManager,
    private auditLogger: AuditLogger
  ) {}

  async execute(userId: string, clientId: string): Promise<AdAccount[]> {
    const accounts = await this.adAccountsRepo.findByUserAndClient(userId, clientId)
    if (accounts.length === 0) return []

    const accountsByPlatform = new Map<Platform, AdAccount[]>()
    for (const account of accounts) {
      if (!accountsByPlatform.has(account.platform)) {
        accountsByPlatform.set(account.platform, [])
      }
      accountsByPlatform.get(account.platform)!.push(account)
    }

    const syncedAccounts: AdAccount[] = []
    for (const [platform, platformAccounts] of accountsByPlatform.entries()) {
      try {
        const client = PlatformApiClientFactory.createClient(platform)
        for (const account of platformAccounts) {
          try {
            const accessToken = await this.tokenManager.getValidAccessToken(
              account,
              async (refreshToken: string) => client.refreshAccessToken(refreshToken)
            )
            const platformAdAccounts = await client.getAdAccounts(accessToken)
            for (const platformAccount of platformAdAccounts) {
              if (platformAccount.id === account.platform_account_id) {
                const updated = await this.adAccountsRepo.update(userId, account.id, {
                  account_name: platformAccount.name,
                  currency: platformAccount.currency ?? account.currency,
                  platform_account_data: platformAccount,
                  last_synced_at: new Date().toISOString(),
                  is_active: true,
                })
                syncedAccounts.push(updated)
                break
              }
            }
            await this.auditLogger.logPlatformApiCall(platform, "getAdAccounts", true, userId, account.id)
          } catch (error: unknown) {
            await this.auditLogger.logPlatformApiCall(
              platform,
              "getAdAccounts",
              false,
              userId,
              account.id,
              error instanceof Error ? error : new Error(String(error))
            )
          }
        }
      } catch {
        // Continue with other platforms
      }
    }

    return syncedAccounts.length > 0 ? syncedAccounts : accounts
  }
}
