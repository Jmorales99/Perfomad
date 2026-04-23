import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TikTokApiClient } from "@/infrastructure/integrations/platforms/TikTokApiClient"
import { StateManager } from "@/infrastructure/security/StateManager"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { env } from "@/config/env"
import {
  TIKTOK_PENDING_PLATFORM_ACCOUNT_ID,
  type TikTokPlatformAccountDataShape,
} from "@/domain/tiktok/TikTokConnection"
import type { AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

export class HandleOAuthCallback {
  constructor(
    private stateManager: StateManager,
    private tokenManager: TokenManager,
    private auditLogger: AuditLogger,
    private adAccountsRepo: AdAccountsRepository
  ) {}

  /**
   * @param returnToUrl  The frontend URL to redirect to after the flow completes.
   *                     Comes from oauth_states.redirect_uri (was stored as RETURN_TO).
   *                     undefined when the state is invalid/expired.
   */
  async execute(
    code: string,
    state: string,
    platform: Platform,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    success: boolean
    accountId?: string
    error?: string
    returnToUrl?: string
  }> {
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
        // No stateData → no returnToUrl; caller uses its default fallback.
      }
    }

    // returnToUrl is available for all paths from here on.
    const returnToUrl = stateData.redirectUri

    // Prevent using a Meta state on a Google callback (platform mismatch attack).
    if (stateData.platform !== platform) {
      await this.stateManager.invalidateState(state)
      await this.auditLogger.logOAuthCallback(
        stateData.userId,
        platform,
        false,
        ipAddress,
        userAgent,
        new Error("State platform mismatch")
      )
      return {
        success: false,
        error: "Invalid authorization request. Please try again.",
        returnToUrl,
      }
    }

    const { userId, clientId } = stateData

    // Mark used BEFORE exchanging code — prevents replay attacks.
    await this.stateManager.invalidateState(state)

    try {
      if (platform === "tiktok") {
        return await this.executeTikTokOAuth(userId, clientId, code, returnToUrl, ipAddress, userAgent)
      }

      const client = PlatformApiClientFactory.createClient(platform)

      // Pass "" so the platform client uses its configured redirectUri
      // (env.META_REDIRECT_URI etc.) — must match the URI registered in Meta/Google.
      const tokens = await client.exchangeCodeForToken(code, "")

      const adAccounts = await client.getAdAccounts(tokens.accessToken)

      // Meta: capture Facebook Pages for later use in creative building
      let metaPages: Array<{ id: string; name: string; access_token: string }> | undefined
      if (platform === "meta") {
        try {
          const { MetaApiClient } = await import("@/infrastructure/integrations/platforms/MetaApiClient")
          if (client instanceof MetaApiClient) {
            metaPages = await client.getPages(tokens.accessToken)
          }
        } catch {
          // Non-fatal — pages scope may not be granted yet (users connected before scope expansion)
        }
      }

      if (!adAccounts?.length) {
        await this.auditLogger.logOAuthCallback(userId, platform, false, ipAddress, userAgent, new Error("No ad accounts found"))
        return {
          success: false,
          error: "No ad accounts found for this platform account.",
          returnToUrl,
        }
      }

      const createdAccounts: Awaited<ReturnType<AdAccountsRepository["create"]>>[] = []
      for (const adAccount of adAccounts) {
        const existing = await this.adAccountsRepo.findByUserClientAndPlatform(userId, clientId, platform)

        if (existing) {
          const encryptedAccess = this.tokenManager.encryptToken(tokens.accessToken, existing.id)
          const expiresAt = new Date()
          expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expiresIn)

          const updates: Parameters<AdAccountsRepository["update"]>[2] = {
            access_token: encryptedAccess.encrypted,
            access_token_iv: encryptedAccess.iv,
            access_token_tag: encryptedAccess.tag,
            token_expires_at: expiresAt.toISOString(),
            platform_account_id: adAccount.id,
            account_name: adAccount.name,
            currency: adAccount.currency ?? "USD",
            is_active: true,
            last_synced_at: new Date().toISOString(),
            platform_account_data: {
              ...adAccount,
              ...(metaPages ? { pages: metaPages.map(({ id, name }) => ({ id, name })) } : {}),
            },
          }
          // Refresh token rotation: only overwrite if provider sent a new one.
          if (tokens.refreshToken) {
            const encryptedRefresh = this.tokenManager.encryptToken(tokens.refreshToken, existing.id)
            updates.refresh_token = encryptedRefresh.encrypted
            updates.refresh_token_iv = encryptedRefresh.iv
            updates.refresh_token_tag = encryptedRefresh.tag
          }

          const updated = await this.adAccountsRepo.update(userId, existing.id, updates)
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
            platform_account_data: {
              ...adAccount,
              ...(metaPages ? { pages: metaPages.map(({ id, name }) => ({ id, name })) } : {}),
            },
            access_token: null,
            refresh_token: null,
            token_expires_at: null,
            platform_user_id: null,
          })

          const encryptedAccess = this.tokenManager.encryptToken(tokens.accessToken, newAccount.id)
          const expiresAt = new Date()
          expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expiresIn)

          const updates: Parameters<AdAccountsRepository["update"]>[2] = {
            access_token: encryptedAccess.encrypted,
            access_token_iv: encryptedAccess.iv,
            access_token_tag: encryptedAccess.tag,
            token_expires_at: expiresAt.toISOString(),
          }
          if (tokens.refreshToken) {
            const encryptedRefresh = this.tokenManager.encryptToken(tokens.refreshToken, newAccount.id)
            updates.refresh_token = encryptedRefresh.encrypted
            updates.refresh_token_iv = encryptedRefresh.iv
            updates.refresh_token_tag = encryptedRefresh.tag
          }

          const updated = await this.adAccountsRepo.update(userId, newAccount.id, updates)
          createdAccounts.push(updated)
        }
      }

      await this.auditLogger.logOAuthCallback(userId, platform, true, ipAddress, userAgent)
      return {
        success: true,
        accountId: createdAccounts[0]?.id,
        returnToUrl,
      }
    } catch (error: unknown) {
      await this.auditLogger.logOAuthCallback(
        userId,
        platform,
        false,
        ipAddress,
        userAgent,
        error instanceof Error ? error : new Error(String(error))
      )
      return {
        success: false,
        error: "Failed to connect account. Please try again.",
        returnToUrl,
      }
    }
  }

  /**
   * TikTok: exchange code, list authorized advertisers, persist one inactive row until user selects advertiser.
   */
  private async executeTikTokOAuth(
    userId: string,
    clientId: string,
    code: string,
    returnToUrl: string | undefined,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    success: boolean
    accountId?: string
    error?: string
    returnToUrl?: string
  }> {
    try {
      const tiktok = PlatformApiClientFactory.createClient("tiktok") as unknown as TikTokApiClient
      const tokenResult = await tiktok.exchangeAuthCodeForTokens(code)

      let advertisers = await tiktok.getAuthorizedAdvertisers(tokenResult.accessToken).catch(() => [])
      if (advertisers.length === 0 && tokenResult.advertiserIdsFromToken?.length) {
        try {
          advertisers = await tiktok.enrichAdvertisersFromIds(
            tokenResult.accessToken,
            tokenResult.advertiserIdsFromToken
          )
        } catch {
          advertisers = tokenResult.advertiserIdsFromToken.map((id) => ({
            id,
            name: `Advertiser ${id}`,
            currency: "USD",
          }))
        }
      }

      if (!advertisers.length) {
        await this.auditLogger.logOAuthCallback(
          userId,
          "tiktok",
          false,
          ipAddress,
          userAgent,
          new Error("No TikTok advertisers found")
        )
        return {
          success: false,
          error: "No ad accounts found for this platform account.",
          returnToUrl,
        }
      }

      const refreshTokenExpiresAt =
        tokenResult.refreshTokenExpiresIn !== undefined
          ? new Date(Date.now() + tokenResult.refreshTokenExpiresIn * 1000).toISOString()
          : undefined

      const platformAccountData: TikTokPlatformAccountDataShape = {
        tiktok: {
          selectionPending: true,
          authorizedAdvertisers: advertisers.map((a) => ({
            id: a.id,
            name: a.name || `Advertiser ${a.id}`,
            currency: a.currency ?? "USD",
          })),
          refreshTokenExpiresAt,
          appId: env.TIKTOK_APP_ID,
          advertiserAuthUrl: env.TIKTOK_ADVERTISER_AUTH_URL,
          advertiserRedirectUri: env.TIKTOK_ADVERTISER_REDIRECT_URI,
        },
      }

      const now = new Date().toISOString()
      const expiresAt = new Date()
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenResult.expiresIn)

      const existing = await this.adAccountsRepo.findByUserClientAndPlatform(userId, clientId, "tiktok", {
        includeInactive: true,
      })

      if (existing) {
        const encryptedAccess = this.tokenManager.encryptToken(tokenResult.accessToken, existing.id)
        const updates: Parameters<AdAccountsRepository["update"]>[2] = {
          access_token: encryptedAccess.encrypted,
          access_token_iv: encryptedAccess.iv,
          access_token_tag: encryptedAccess.tag,
          token_expires_at: expiresAt.toISOString(),
          platform_account_id: TIKTOK_PENDING_PLATFORM_ACCOUNT_ID,
          account_name: "TikTok — select advertiser",
          currency: "USD",
          is_active: false,
          last_synced_at: now,
          platform_account_data: platformAccountData,
        }
        if (tokenResult.refreshToken) {
          const encryptedRefresh = this.tokenManager.encryptToken(tokenResult.refreshToken, existing.id)
          updates.refresh_token = encryptedRefresh.encrypted
          updates.refresh_token_iv = encryptedRefresh.iv
          updates.refresh_token_tag = encryptedRefresh.tag
        }
        const updated = await this.adAccountsRepo.update(userId, existing.id, updates)
        await this.auditLogger.logOAuthCallback(userId, "tiktok", true, ipAddress, userAgent)
        return { success: true, accountId: updated.id, returnToUrl }
      }

      const newAccount = await this.adAccountsRepo.create({
        user_id: userId,
        client_id: clientId,
        platform: "tiktok",
        platform_account_id: TIKTOK_PENDING_PLATFORM_ACCOUNT_ID,
        account_name: "TikTok — select advertiser",
        currency: "USD",
        is_active: false,
        connected_at: now,
        last_synced_at: now,
        platform_account_data: platformAccountData,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        platform_user_id: null,
      })

      const encryptedAccess = this.tokenManager.encryptToken(tokenResult.accessToken, newAccount.id)
      const upd: Parameters<AdAccountsRepository["update"]>[2] = {
        access_token: encryptedAccess.encrypted,
        access_token_iv: encryptedAccess.iv,
        access_token_tag: encryptedAccess.tag,
        token_expires_at: expiresAt.toISOString(),
      }
      if (tokenResult.refreshToken) {
        const encryptedRefresh = this.tokenManager.encryptToken(tokenResult.refreshToken, newAccount.id)
        upd.refresh_token = encryptedRefresh.encrypted
        upd.refresh_token_iv = encryptedRefresh.iv
        upd.refresh_token_tag = encryptedRefresh.tag
      }
      const updated = await this.adAccountsRepo.update(userId, newAccount.id, upd)
      await this.auditLogger.logOAuthCallback(userId, "tiktok", true, ipAddress, userAgent)
      return { success: true, accountId: updated.id, returnToUrl }
    } catch (error: unknown) {
      await this.auditLogger.logOAuthCallback(
        userId,
        "tiktok",
        false,
        ipAddress,
        userAgent,
        error instanceof Error ? error : new Error(String(error))
      )
      return {
        success: false,
        error: "Failed to connect account. Please try again.",
        returnToUrl,
      }
    }
  }
}
