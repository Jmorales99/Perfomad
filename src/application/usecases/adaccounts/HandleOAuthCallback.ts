import { PlatformApiClientFactory } from "@/infrastructure/services/platforms/PlatformApiClientFactory"
import { StateManager } from "@/infrastructure/security/StateManager"
import { TokenManager } from "@/infrastructure/services/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import type { AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

export class HandleOAuthCallback {
  constructor(
    private stateManager: StateManager,
    private tokenManager: TokenManager,
    private auditLogger: AuditLogger,
    private adAccountsRepo: AdAccountsRepository
  ) {}

  async execute(
    code: string,
    state: string,
    platform: Platform,
    redirectUri?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    success: boolean
    accountId?: string
    error?: string
  }> {
    try {
      const stateData = await this.stateManager.validateStateForCallback(state)
      if (!stateData) {
        await this.auditLogger.logOAuthCallback(
          "",
          platform,
          false,
          ipAddress,
          userAgent,
          new Error("Invalid or expired state parameter")
        )
        return {
          success: false,
          error: "Invalid or expired authorization request. Please try again.",
        }
      }

      const { userId, clientId } = stateData
      await this.stateManager.invalidateState(state)

      const client = PlatformApiClientFactory.createClient(platform)
      const tokens = await client.exchangeCodeForToken(
        code,
        redirectUri ?? stateData.redirectUri ?? ""
      )

      const adAccounts = await client.getAdAccounts(tokens.accessToken)
      if (!adAccounts?.length) {
        await this.auditLogger.logOAuthCallback(userId, platform, false, ipAddress, userAgent, new Error("No ad accounts found"))
        return {
          success: false,
          error: "No ad accounts found for this platform account.",
        }
      }

      const createdAccounts: Awaited<ReturnType<AdAccountsRepository["create"]>>[] = []
      for (const adAccount of adAccounts) {
        const existing = await this.adAccountsRepo.findByUserClientAndPlatform(userId, clientId, platform)

        if (existing) {
          const encryptedAccess = this.tokenManager.encryptToken(tokens.accessToken, existing.id)
          const encryptedRefresh = this.tokenManager.encryptToken(tokens.refreshToken, existing.id)
          const expiresAt = new Date()
          expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expiresIn)

          const updated = await this.adAccountsRepo.update(userId, existing.id, {
            access_token: encryptedAccess.encrypted,
            access_token_iv: encryptedAccess.iv,
            access_token_tag: encryptedAccess.tag,
            refresh_token: encryptedRefresh.encrypted,
            refresh_token_iv: encryptedRefresh.iv,
            refresh_token_tag: encryptedRefresh.tag,
            token_expires_at: expiresAt.toISOString(),
            platform_account_id: adAccount.id,
            account_name: adAccount.name,
            currency: adAccount.currency ?? "USD",
            is_active: true,
            last_synced_at: new Date().toISOString(),
            platform_account_data: adAccount,
          })
          createdAccounts.push(updated)
        } else {
          const now = new Date().toISOString()
          const newAccount = await this.adAccountsRepo.create({
            user_id: userId,
            client_id: clientId,
            platform,
            platform_account_id: adAccount.id,
            account_name: adAccount.name,
            currency: adAccount.currency ?? "USD",
            is_active: true,
            connected_at: now,
            last_synced_at: now,
            platform_account_data: adAccount,
            access_token: null,
            refresh_token: null,
            token_expires_at: null,
            platform_user_id: null,
          })

          const encryptedAccess = this.tokenManager.encryptToken(tokens.accessToken, newAccount.id)
          const encryptedRefresh = this.tokenManager.encryptToken(tokens.refreshToken, newAccount.id)
          const expiresAt = new Date()
          expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expiresIn)

          const updated = await this.adAccountsRepo.update(userId, newAccount.id, {
            access_token: encryptedAccess.encrypted,
            access_token_iv: encryptedAccess.iv,
            access_token_tag: encryptedAccess.tag,
            refresh_token: encryptedRefresh.encrypted,
            refresh_token_iv: encryptedRefresh.iv,
            refresh_token_tag: encryptedRefresh.tag,
            token_expires_at: expiresAt.toISOString(),
          })
          createdAccounts.push(updated)
        }
      }

      await this.auditLogger.logOAuthCallback(userId, platform, true, ipAddress, userAgent)
      return {
        success: true,
        accountId: createdAccounts[0]?.id,
      }
    } catch (error: unknown) {
      await this.auditLogger.logOAuthCallback(
        "",
        platform,
        false,
        ipAddress,
        userAgent,
        error instanceof Error ? error : new Error(String(error))
      )
      return {
        success: false,
        error: "Failed to connect account. Please try again.",
      }
    }
  }
}
