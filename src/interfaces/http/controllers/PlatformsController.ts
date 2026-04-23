import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { SupabaseClientsRepository } from "@/infrastructure/repositories/SupabaseClientsRepository"
import { EnrichCampaignsWithMetrics } from "@/application/usecases/campaigns/EnrichCampaignsWithMetrics"
import { GetCampaignInsights } from "@/application/usecases/campaigns/GetCampaignInsights"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { StateManager } from "@/infrastructure/security/StateManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { CreateConnectionLink } from "@/application/usecases/adaccounts/CreateConnectionLink"
import { HandleOAuthCallback } from "@/application/usecases/adaccounts/HandleOAuthCallback"
import { SyncConnectedAccounts } from "@/application/usecases/adaccounts/SyncConnectedAccounts"
import { GetPlatformAccountMetrics } from "@/application/usecases/platforms/GetPlatformAccountMetrics"
import { GetPlatformCampaignMetrics } from "@/application/usecases/platforms/GetPlatformCampaignMetrics"
import { GetCampaignAds } from "@/application/usecases/platforms/GetCampaignAds"
import { ListTikTokAdvertisers } from "@/application/usecases/platforms/tiktok/ListTikTokAdvertisers"
import { SelectTikTokAdvertiser } from "@/application/usecases/platforms/tiktok/SelectTikTokAdvertiser"
import { DisconnectTikTok } from "@/application/usecases/platforms/tiktok/DisconnectTikTok"
import { ImportPlatformCampaign } from "@/application/usecases/campaigns/ImportPlatformCampaign"
import { env } from "@/config/env"
import { tokenErrorRequiresReconnect, reconnectErrorPayload } from "@/infrastructure/oauth/reconnectErrors"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

const VALID_PLATFORMS: Platform[] = ["meta", "google_ads", "linkedin", "tiktok"]

function parsePlatform(platform: string): Platform | null {
  return VALID_PLATFORMS.includes(platform as Platform) ? (platform as Platform) : null
}

/**
 * Responds with 422 when the error is a token/OAuth reconnection issue.
 * Returns true if a response was sent, false otherwise.
 *
 * Using 422 (not 401) to avoid triggering the frontend session-expiry
 * interceptor which would sign the user out of Supabase.
 */
function sendReconnectErrorIfNeeded(
  reply: any,
  err: Error,
  platform: string,
  adAccountId?: string
): boolean {
  if (!tokenErrorRequiresReconnect(err.message)) return false
  reply.code(422).send(reconnectErrorPayload(err, platform, adAccountId))
  return true
}

export async function PlatformsController(app: FastifyInstance) {
  const campaignsRepo = new SupabaseCampaignsRepository()
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const clientsRepo = new SupabaseClientsRepository()
  const metricsHistoryRepo = new CampaignMetricsHistoryRepository()
  const stateManager = new StateManager()
  const tokenManager = new TokenManager()
  const auditLogger = new AuditLogger()
  const createConnectionLink = new CreateConnectionLink(stateManager, clientsRepo)
  const handleOAuthCallback = new HandleOAuthCallback(stateManager, tokenManager, auditLogger, adAccountsRepo)
  const syncConnectedAccounts = new SyncConnectedAccounts(adAccountsRepo, tokenManager, auditLogger)
  const enrichCampaignsWithMetrics = new EnrichCampaignsWithMetrics(campaignsRepo)
  const getCampaignInsights = new GetCampaignInsights(campaignsRepo, metricsHistoryRepo)
  const getPlatformAccountMetrics = new GetPlatformAccountMetrics(adAccountsRepo, tokenManager, clientsRepo)
  const getPlatformCampaignMetrics = new GetPlatformCampaignMetrics(adAccountsRepo, tokenManager, clientsRepo)
  const getCampaignAds = new GetCampaignAds(adAccountsRepo, tokenManager, clientsRepo)
  const listTikTokAdvertisers = new ListTikTokAdvertisers(adAccountsRepo, clientsRepo)
  const selectTikTokAdvertiser = new SelectTikTokAdvertiser(adAccountsRepo, clientsRepo)
  const disconnectTikTok = new DisconnectTikTok(adAccountsRepo, clientsRepo)
  const importPlatformCampaign = new ImportPlatformCampaign(campaignsRepo, adAccountsRepo, metricsHistoryRepo)

  // 🔗 POST /platforms/:platform/connect-link — get OAuth URL for connecting an account (requires clientId)
  app.post("/platforms/:platform/connect-link", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { platform } = req.params as { platform: string }
      const body = (req.body as { clientId?: string; redirect_uri?: string }) ?? {}
      const clientId = body.clientId ?? (req.body as { client_id?: string }).client_id
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({ error: "Invalid platform", message: `Platform must be one of: ${VALID_PLATFORMS.join(", ")}` })
      }
      // returnTo = frontend URL to land on after OAuth completes (stored in state, NOT sent to the provider)
      const returnTo = body.redirect_uri ?? (req.body as { redirectUri?: string }).redirectUri
      const url = await createConnectionLink.execute(user.id, clientId, platformKey, returnTo)
      return reply.send({ url })
    } catch (err: unknown) {
      req.log.error(err)
      const message = err instanceof Error ? err.message : "Failed to create connection link"
      return reply.code(400).send({ error: message })
    }
  })

  // 🔗 GET /platforms/:platform/callback — OAuth callback (no auth; code + state from provider)
  // Redirects to frontend with only generic params: connect=success|error&platform=... (no tokens, no raw errors).
  // The destination URL comes from oauth_states.redirect_uri (stored as RETURN_TO during connect-link).
  const CALLBACK_ERROR_MESSAGE = "Connection failed. Try again."
  const DEFAULT_RETURN_PATH = "/settings?tab=integrations"

  /**
   * Sanitizes a returnTo URL to prevent open-redirect attacks.
   * Allows only URLs whose origin matches FRONTEND_URL (or localhost in any env).
   */
  function sanitizeReturnTo(url: string | undefined, frontendBase: string): string | null {
    if (!url) return null
    try {
      const target = new URL(url)
      const allowed = new URL(frontendBase)
      if (
        target.origin === allowed.origin ||
        target.hostname === "localhost" ||
        target.hostname === "127.0.0.1"
      ) {
        return target.toString()
      }
    } catch {
      // malformed URL — discard
    }
    return null
  }

  app.get("/platforms/:platform/callback", async (req, reply) => {
    const base = process.env.FRONTEND_URL ?? "http://localhost:5173"
    const fallbackBase = `${base}${DEFAULT_RETURN_PATH}`
    const CALLBACK_ERROR = `${fallbackBase}&connect=error&message=${encodeURIComponent(CALLBACK_ERROR_MESSAGE)}`

    try {
      const { platform } = req.params as { platform: string }
      const query = req.query as {
        code?: string
        auth_code?: string
        state?: string
        error?: string
        error_description?: string
      }

      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.redirect(`${base}/settings?error=invalid_platform`, 302)
      }

      if (query.error) {
        const msg = query.error_description || query.error || CALLBACK_ERROR_MESSAGE
        const tiktokErrFallback =
          platformKey === "tiktok" ? sanitizeReturnTo(env.TIKTOK_FRONTEND_ERROR_URL, base) : null
        const errTarget = tiktokErrFallback ?? fallbackBase
        const sep = errTarget.includes("?") ? "&" : "?"
        return reply.redirect(
          `${errTarget}${sep}connect=error&message=${encodeURIComponent(msg)}&platform=${encodeURIComponent(platform)}`,
          302
        )
      }

      const code = query.code ?? query.auth_code
      const state = query.state
      if (!code || !state) {
        return reply.redirect(`${base}/settings?error=missing_code_or_state`, 302)
      }

      const result = await handleOAuthCallback.execute(code, state, platformKey, req.ip, req.headers["user-agent"])

      const tiktokSuccessFallback =
        platformKey === "tiktok" ? sanitizeReturnTo(env.TIKTOK_FRONTEND_SUCCESS_URL, base) : null
      const tiktokErrorFallback =
        platformKey === "tiktok" ? sanitizeReturnTo(env.TIKTOK_FRONTEND_ERROR_URL, base) : null

      const safeReturnTo =
        sanitizeReturnTo(result.returnToUrl, base) ??
        (result.success ? tiktokSuccessFallback : tiktokErrorFallback) ??
        fallbackBase
      const sep = safeReturnTo.includes("?") ? "&" : "?"

      if (result.success) {
        return reply.redirect(`${safeReturnTo}${sep}connect=success&platform=${platform}`, 302)
      }
      return reply.redirect(
        `${safeReturnTo}${sep}connect=error&message=${encodeURIComponent(result.error ?? CALLBACK_ERROR_MESSAGE)}`,
        302
      )
    } catch (err: unknown) {
      req.log.error(err)
      return reply.redirect(CALLBACK_ERROR, 302)
    }
  })

  // TikTok: list authorized advertisers (after OAuth, before or after selecting one)
  app.get("/platforms/tiktok/advertisers", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const clientId = (req.query as { clientId?: string }).clientId
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }
      const result = await listTikTokAdvertisers.execute(user.id, clientId)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      const message = err instanceof Error ? err.message : "Failed to list TikTok advertisers"
      return reply.code(400).send({ error: message })
    }
  })

  app.post("/platforms/tiktok/select-advertiser", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const body = (req.body as { clientId?: string; advertiserId?: string }) ?? {}
      const clientId = body.clientId ?? (req.body as { client_id?: string }).client_id
      const advertiserId = body.advertiserId ?? (req.body as { advertiser_id?: string }).advertiser_id
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }
      if (!advertiserId || typeof advertiserId !== "string") {
        return reply.code(400).send({ error: "advertiserId is required" })
      }
      const result = await selectTikTokAdvertiser.execute(user.id, clientId, advertiserId)
      return reply.send({ ok: true, ...result })
    } catch (err: unknown) {
      req.log.error(err)
      const message = err instanceof Error ? err.message : "Failed to select advertiser"
      return reply.code(400).send({ error: message })
    }
  })

  app.post("/platforms/tiktok/disconnect", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const body = (req.body as { clientId?: string }) ?? {}
      const clientId = body.clientId ?? (req.body as { client_id?: string }).client_id
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }
      const result = await disconnectTikTok.execute(user.id, clientId)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      const message = err instanceof Error ? err.message : "Failed to disconnect TikTok"
      return reply.code(400).send({ error: message })
    }
  })

  // 🔄 POST /platforms/:platform/sync-accounts — sync connected accounts for a client
  app.post("/platforms/:platform/sync-accounts", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { platform } = req.params as { platform: string }
      const body = (req.body as { clientId?: string }) ?? {}
      const clientId = body.clientId ?? (req.body as { client_id?: string }).client_id
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({ error: "Invalid platform" })
      }
      const accounts = await syncConnectedAccounts.execute(user.id, clientId)
      const forPlatform = accounts.filter((a) => a.platform === platformKey)
      return reply.send({ synced: forPlatform.length, accounts: forPlatform })
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Failed to sync accounts" })
    }
  })

  // 📥 POST /platforms/:platform/campaigns/:platformCampaignId/import
  //    Idempotently imports a platform-native campaign into the local
  //    `campaigns` table so it can be optimized. Returns the internal UUID
  //    the frontend needs to navigate to /optimize/:id.
  app.post("/platforms/:platform/campaigns/:platformCampaignId/import", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { platform, platformCampaignId } = req.params as {
        platform: string
        platformCampaignId: string
      }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({ error: "Invalid platform" })
      }
      if (!platformCampaignId) {
        return reply.code(400).send({ error: "platformCampaignId is required" })
      }
      const body = (req.body as { clientId?: string; adAccountId?: string }) ?? {}
      const clientId = body.clientId ?? (req.body as { client_id?: string }).client_id
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }

      const result = await importPlatformCampaign.execute({
        userId: user.id,
        platform: platformKey,
        platformCampaignId,
        clientId,
        adAccountId: body.adAccountId,
      })

      return reply.send({
        id: result.campaign.id,
        imported: result.imported,
      })
    } catch (err: unknown) {
      req.log.error(err)
      const msg = err instanceof Error ? err.message : "Failed to import campaign"
      return reply.code(400).send({ error: msg })
    }
  })

  // 📊 GET /platforms/:platform/metrics?clientId=&adAccountId=&since=&until=
  // Returns real account-level insights from the platform API.
  // clientId   — required. The brand (public.clients row) that owns the ad account.
  // adAccountId — platform_account_id (e.g. Meta's "act_123456" or "123456"). Optional when
  //               the brand has exactly one connected account; required otherwise.
  // since/until — YYYY-MM-DD. Default: last 30 days.
  app.get("/platforms/:platform/metrics", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
        })
      }

      const query = req.query as {
        clientId?: string
        adAccountId?: string
        since?: string
        until?: string
      }

      const clientId = query.clientId
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId query param is required" })
      }

      const dateRange =
        query.since && query.until
          ? { since: query.since, until: query.until }
          : undefined

      const result = await getPlatformAccountMetrics.execute(
        user.id,
        clientId,
        platformKey,
        query.adAccountId,
        dateRange
      )

      const { account, metrics, dateRange: effectiveDateRange } = result

      // Derive convenience fields from raw action arrays
      const purchases = metrics.actions.filter((a) => a.action_type === "purchase")
      const totalConversions = purchases.reduce((sum, a) => sum + parseInt(a.value, 10), 0)
      const totalRevenue = metrics.action_values
        .filter((a) => a.action_type === "purchase")
        .reduce((sum, a) => sum + parseFloat(a.value), 0)
      const roas = metrics.spend > 0 ? totalRevenue / metrics.spend : undefined
      const cpa = totalConversions > 0 ? metrics.spend / totalConversions : undefined

      return reply.send({
        platform,
        adAccountId: account.platform_account_id,
        accountName: account.account_name,
        currency: account.currency,
        dateRange: effectiveDateRange,
        summary: {
          connected_accounts: 1,
          is_connected: true,
          total_spend: metrics.spend,
        },
        metrics: {
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          reach: metrics.reach,
          spend: metrics.spend,
          ctr: metrics.ctr,
          cpc: metrics.cpc,
          cpm: metrics.cpm,
          conversions: totalConversions,
          revenue: totalRevenue,
          cpa,
          roas,
          actions: metrics.actions,
          action_values: metrics.action_values,
        },
      })
    } catch (err: any) {
      req.log.error(err)
      const { platform } = req.params as { platform: string }
      if (err instanceof Error && sendReconnectErrorIfNeeded(reply, err, platform)) return
      const status = err.message?.includes("not found") || err.message?.includes("not belong") ? 404
        : err.message?.includes("Specify adAccountId") || err.message?.includes("clientId") ? 400
        : 500
      return reply.code(status).send({ error: err.message || "Error fetching platform metrics" })
    }
  })

  // 💡 Get insights for a specific platform
  app.get("/platforms/:platform/insights", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }

      // Validate platform
      const validPlatforms: Platform[] = ["meta", "google_ads", "linkedin", "tiktok"]
      if (!validPlatforms.includes(platform as Platform)) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${validPlatforms.join(", ")}`,
        })
      }

      // Get all campaigns for this platform
      const campaigns = await campaignsRepo.listByUser(user.id)
      const platformCampaigns = campaigns.filter((c) =>
        Array.isArray(c.platforms)
          ? c.platforms.includes(platform as Platform)
          : c.platforms === platform
      )

      // Get insights for all campaigns in this platform
      const allInsights = await Promise.all(
        platformCampaigns.map((campaign) =>
          getCampaignInsights.execute(user.id, campaign.id).catch((err) => {
            req.log.error({ err, campaignId: campaign.id }, "Error getting insights for campaign")
            return null
          })
        )
      )

      // Aggregate insights
      const validInsights = allInsights.filter(Boolean) as any[]
      const allRecommendations = validInsights.flatMap((insight) => insight.recommendations || [])
      const allTrends = validInsights.flatMap((insight) => insight.trends || [])

      // Count priority levels
      const priorityCounts = {
        high: allRecommendations.filter((r) => r.priority === "high").length,
        medium: allRecommendations.filter((r) => r.priority === "medium").length,
        low: allRecommendations.filter((r) => r.priority === "low").length,
      }

      return reply.send({
        platform,
        summary: {
          total_campaigns: platformCampaigns.length,
          campaigns_with_insights: validInsights.length,
          total_recommendations: allRecommendations.length,
          priority_breakdown: priorityCounts,
        },
        recommendations: allRecommendations.slice(0, 10), // Top 10
        trends: allTrends.slice(0, 5), // Top 5 trends
        campaign_insights: validInsights.map((insight, index) => ({
          campaign_id: platformCampaigns[index].id,
          campaign_name: platformCampaigns[index].name,
          ...insight,
        })),
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener insights de la plataforma",
      })
    }
  })

  // 📈 Get summary across all platforms
  app.get("/platforms/summary", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const platforms: Platform[] = ["meta", "google_ads", "linkedin", "tiktok"]
      const campaigns = await enrichCampaignsWithMetrics.execute(user.id)
      const adAccounts = await adAccountsRepo.findByUserId(user.id)

      // Group ad accounts by platform
      const accountsByPlatform = new Map<Platform, number>()
      adAccounts.forEach((acc) => {
        accountsByPlatform.set(acc.platform, (accountsByPlatform.get(acc.platform) || 0) + 1)
      })

      // Calculate metrics per platform
      const platformSummaries = await Promise.all(
        platforms.map(async (platform) => {
          const platformCampaigns = campaigns.filter((c) =>
            Array.isArray(c.platforms)
              ? c.platforms.includes(platform)
              : c.platforms === platform
          )

          let totalImpressions = 0
          let totalClicks = 0
          let totalConversions = 0
          let totalRevenue = 0
          let totalSpend = 0

          platformCampaigns.forEach((campaign) => {
            totalSpend += campaign.spend_usd || 0

            if (campaign.mock_stats) {
              const stats = campaign.mock_stats as any
              if (typeof stats === "object" && !Array.isArray(stats) && platform in stats) {
                const platformStats = stats[platform]
                if (platformStats && typeof platformStats === "object") {
                  totalImpressions += platformStats.impressions || 0
                  totalClicks += platformStats.clicks || 0
                  totalConversions += platformStats.conversions || 0
                  totalRevenue += platformStats.revenue || 0
                }
              } else if (typeof stats === "object" && !Array.isArray(stats)) {
                // Flat structure - include if campaign has this platform
                totalImpressions += stats.impressions || 0
                totalClicks += stats.clicks || 0
                totalConversions += stats.conversions || 0
                totalRevenue += stats.revenue || 0
              }
            }
          })

          const roa = totalSpend > 0 ? totalRevenue / totalSpend : undefined
          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0

          return {
            platform,
            connected_accounts: accountsByPlatform.get(platform) || 0,
            total_campaigns: platformCampaigns.length,
            active_campaigns: platformCampaigns.filter((c) => c.status === "active").length,
            metrics: {
              impressions: totalImpressions,
              clicks: totalClicks,
              conversions: totalConversions,
              revenue: totalRevenue,
              spend: totalSpend,
              roa,
              ctr,
            },
            is_connected: (accountsByPlatform.get(platform) || 0) > 0,
          }
        })
      )

      return reply.send({
        platforms: platformSummaries,
        total_platforms_connected: platformSummaries.filter((p) => p.is_connected).length,
        total_campaigns_across_platforms: campaigns.length,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener resumen de plataformas",
      })
    }
  })

  // 🔄 Sync campaigns from platform API
  app.post("/platforms/:platform/sync-campaigns", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }

      // Validate platform
      const validPlatforms: Platform[] = ["meta", "google_ads", "linkedin", "tiktok"]
      if (!validPlatforms.includes(platform as Platform)) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${validPlatforms.join(", ")}`,
        })
      }

      // Get connected account for this platform
      const adAccount = await adAccountsRepo.findByUserAndPlatform(user.id, platform as Platform)
      if (!adAccount) {
        return reply.code(404).send({
          error: "No connected account",
          message: `No ${platform} account connected. Please connect your account first.`,
        })
      }

      // Get valid access token (handles decryption and refresh if needed)
      // Tokens MUST be encrypted - no plaintext support
      let accessToken: string
      try {
        accessToken = await tokenManager.getValidAccessToken(
          adAccount,
          async (refreshToken: string) => {
            const client = PlatformApiClientFactory.createClient(platform as Platform)
            return await client.refreshAccessToken(refreshToken)
          }
        )
      } catch (error: any) {
        req.log.error({ error: error.message, accountId: adAccount.id }, "Failed to get access token")
        return reply.code(422).send(reconnectErrorPayload(error instanceof Error ? error : new Error(error.message), platform as string, adAccount.id))
      }

      // Get platform client
      const client = PlatformApiClientFactory.createClient(platform as Platform)

      // List campaigns from platform API
      const platformCampaigns = await client.listCampaigns(adAccount.platform_account_id, accessToken)

      // Get metrics for each campaign
      const campaignsWithMetrics = await Promise.all(
        platformCampaigns.map(async (campaign) => {
          try {
            const metrics = await client.getCampaignMetrics(campaign.id, accessToken, {
              platformAccountId: adAccount.platform_account_id,
            })
            return {
              ...campaign,
              metrics: metrics.metrics || {},
              raw_data: metrics,
            }
          } catch (error: any) {
            req.log.warn({ error: error.message, campaignId: campaign.id }, "Failed to get metrics for campaign")
            return {
              ...campaign,
              metrics: {},
              raw_data: campaign.raw,
            }
          }
        })
      )

      return reply.send({
        platform,
        account_id: adAccount.platform_account_id,
        account_name: adAccount.account_name,
        campaigns: campaignsWithMetrics,
        total: campaignsWithMetrics.length,
        synced_at: new Date().toISOString(),
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al sincronizar campañas de la plataforma",
      })
    }
  })

  // 📋 GET /platforms/:platform/accounts?clientId=
  // Returns all connected ad accounts for the given brand + platform.
  // clientId — required. Only accounts that belong to this brand are returned.
  app.get("/platforms/:platform/accounts", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
        })
      }

      const query = req.query as { clientId?: string }
      const clientId = query.clientId
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId query param is required" })
      }

      // Validate brand ownership
      const brand = await clientsRepo.getById(user.id, clientId)
      if (!brand) {
        return reply.code(404).send({ error: "Brand not found or does not belong to this user" })
      }

      const allForClient = await adAccountsRepo.findByUserAndClient(user.id, clientId)
      const accounts = allForClient
        .filter((a) => a.platform === platformKey)
        .map((a) => ({
          id: a.id,
          platform_account_id: a.platform_account_id,
          account_name: a.account_name,
          currency: a.currency,
          is_active: a.is_active,
          connected_at: a.connected_at,
          last_synced_at: a.last_synced_at,
        }))

      return reply.send({ platform, clientId, accounts })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({ error: err.message || "Error fetching platform accounts" })
    }
  })

  // 📄 GET /platforms/meta/pages?clientId=
  // Returns Facebook Pages available for the authenticated Meta ad account.
  // Pages are stored in platform_account_data.pages during OAuth callback.
  app.get("/platforms/meta/pages", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const query = req.query as { clientId?: string }
      const clientId = query.clientId
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId query param is required" })
      }

      const brand = await clientsRepo.getById(user.id, clientId)
      if (!brand) {
        return reply.code(404).send({ error: "Brand not found or does not belong to this user" })
      }

      const accounts = await adAccountsRepo.findByUserAndClient(user.id, clientId)
      const metaAccount = accounts.find((a) => a.platform === "meta" && a.is_active)
      if (!metaAccount) {
        return reply.code(404).send({ error: "No active Meta ad account found for this brand" })
      }

      const pages: Array<{ id: string; name: string }> =
        (metaAccount.platform_account_data as any)?.pages ?? []

      return reply.send({ pages })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({ error: err.message || "Error fetching Meta pages" })
    }
  })

  // 📈 GET /platforms/:platform/campaigns?clientId=&adAccountId=&since=&until=
  // Returns per-campaign Insights (level=campaign) for all campaigns under the given
  // ad account, ordered by spend descending.
  // clientId    — required.
  // adAccountId — platform_account_id (act_xxx or raw id). Auto-resolved if brand has 1 account.
  // since/until — YYYY-MM-DD. Default: last 30 days.
  app.get("/platforms/:platform/campaigns", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
        })
      }

      const query = req.query as {
        clientId?: string
        adAccountId?: string
        since?: string
        until?: string
      }

      const clientId = query.clientId
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId query param is required" })
      }

      // Validate YYYY-MM-DD format for date params when supplied
      const dateRe = /^\d{4}-\d{2}-\d{2}$/
      if (query.since && !dateRe.test(query.since)) {
        return reply.code(400).send({ error: "since must be in YYYY-MM-DD format" })
      }
      if (query.until && !dateRe.test(query.until)) {
        return reply.code(400).send({ error: "until must be in YYYY-MM-DD format" })
      }

      const dateRange =
        query.since && query.until
          ? { since: query.since, until: query.until }
          : undefined

      const result = await getPlatformCampaignMetrics.execute(
        user.id,
        clientId,
        platformKey,
        query.adAccountId,
        dateRange
      )

      return reply.send({
        platform,
        clientId,
        adAccountId: result.account.platform_account_id,
        accountName: result.account.account_name,
        currency: result.account.currency,
        dateRange: result.dateRange,
        campaigns: result.campaigns,
      })
    } catch (err: any) {
      req.log.error(err)
      const { platform } = req.params as { platform: string }
      if (err instanceof Error && sendReconnectErrorIfNeeded(reply, err, platform)) return
      const status = err.message?.includes("not found") || err.message?.includes("not belong") ? 404
        : err.message?.includes("Specify adAccountId") || err.message?.includes("clientId") ? 400
        : 500
      return reply.code(status).send({ error: err.message || "Error fetching campaign metrics" })
    }
  })

  // 🎨 GET /platforms/:platform/campaigns/:campaignId/ads
  //        ?clientId=&adAccountId=&since=YYYY-MM-DD&until=YYYY-MM-DD
  // Returns all ads in a campaign with creative previews (URLs only) and per-ad metrics.
  // clientId    — required.
  // adAccountId — platform_account_id. Auto-resolved when brand has exactly 1 connected account.
  // since/until — YYYY-MM-DD. Default: last 30 days.
  app.get("/platforms/:platform/campaigns/:campaignId/ads", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform, campaignId } = req.params as { platform: string; campaignId: string }
      const platformKey = parsePlatform(platform)
      if (!platformKey) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
        })
      }

      if (!campaignId || typeof campaignId !== "string") {
        return reply.code(400).send({ error: "campaignId path param is required" })
      }

      const query = req.query as {
        clientId?: string
        adAccountId?: string
        since?: string
        until?: string
      }

      const clientId = query.clientId
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId query param is required" })
      }

      const dateRe = /^\d{4}-\d{2}-\d{2}$/
      if (query.since && !dateRe.test(query.since)) {
        return reply.code(400).send({ error: "since must be in YYYY-MM-DD format" })
      }
      if (query.until && !dateRe.test(query.until)) {
        return reply.code(400).send({ error: "until must be in YYYY-MM-DD format" })
      }

      const dateRange =
        query.since && query.until ? { since: query.since, until: query.until } : undefined

      const result = await getCampaignAds.execute(
        user.id,
        clientId,
        platformKey,
        campaignId,
        query.adAccountId,
        dateRange
      )

      return reply.send({
        platform,
        clientId,
        adAccountId: result.account.platform_account_id,
        accountName: result.account.account_name,
        currency: result.account.currency,
        campaignId: result.campaignId,
        dateRange: result.dateRange,
        ads: result.ads,
      })
    } catch (err: any) {
      req.log.error(err)
      const { platform } = req.params as { platform: string }
      if (err instanceof Error && sendReconnectErrorIfNeeded(reply, err, platform)) return
      const status =
        err.message?.includes("not found") || err.message?.includes("not belong")
          ? 404
          : err.message?.includes("Specify adAccountId") || err.message?.includes("clientId")
            ? 400
            : 500
      return reply.code(status).send({ error: err.message || "Error fetching campaign ads" })
    }
  })
}
