import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { SupabaseClientsRepository } from "@/infrastructure/repositories/SupabaseClientsRepository"
import { EnrichCampaignsWithMetrics } from "@/application/usecases/campaigns/EnrichCampaignsWithMetrics"
import { GetCampaignInsights } from "@/application/usecases/campaigns/GetCampaignInsights"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlatformApiClientFactory } from "@/infrastructure/services/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/services/TokenManager"
import { StateManager } from "@/infrastructure/security/StateManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { CreateConnectionLink } from "@/application/usecases/adaccounts/CreateConnectionLink"
import { HandleOAuthCallback } from "@/application/usecases/adaccounts/HandleOAuthCallback"
import { SyncConnectedAccounts } from "@/application/usecases/adaccounts/SyncConnectedAccounts"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

const VALID_PLATFORMS: Platform[] = ["meta", "google_ads", "linkedin"]

function parsePlatform(platform: string): Platform | null {
  return VALID_PLATFORMS.includes(platform as Platform) ? (platform as Platform) : null
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
      const redirectUri = body.redirect_uri ?? (req.body as { redirectUri?: string }).redirectUri
      const url = await createConnectionLink.execute(user.id, clientId, platformKey, redirectUri)
      return reply.send({ url })
    } catch (err: unknown) {
      req.log.error(err)
      const message = err instanceof Error ? err.message : "Failed to create connection link"
      return reply.code(400).send({ error: message })
    }
  })

  // 🔗 GET /platforms/:platform/callback — OAuth callback (no auth; code + state from provider)
  app.get("/platforms/:platform/callback", async (req, reply) => {
    try {
      const { platform } = req.params as { platform: string }
      const query = req.query as { code?: string; state?: string; redirect_uri?: string }
      const { code, state, redirect_uri } = query
      const platformKey = parsePlatform(platform)
      const base = process.env.FRONTEND_URL ?? "http://localhost:5173"
      if (!platformKey) {
        return reply.redirect(`${base}/settings?error=invalid_platform`, 302)
      }
      if (!code || !state) {
        return reply.redirect(`${base}/settings?error=missing_code_or_state`, 302)
      }
      const result = await handleOAuthCallback.execute(code, state, platformKey, redirect_uri, req.ip, req.headers["user-agent"])
      if (result.success) {
        return reply.redirect(`${base}/settings?connect=success&platform=${platform}`, 302)
      }
      return reply.redirect(`${base}/settings?connect=error&message=${encodeURIComponent(result.error ?? "Unknown error")}`, 302)
    } catch (err: unknown) {
      req.log.error(err)
      const base = process.env.FRONTEND_URL ?? "http://localhost:5173"
      return reply.redirect(`${base}/settings?connect=error&message=${encodeURIComponent("Server error")}`, 302)
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

  // 📊 Get metrics for a specific platform
  app.get("/platforms/:platform/metrics", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }

      // Validate platform
      const validPlatforms: Platform[] = ["meta", "google_ads", "linkedin"]
      if (!validPlatforms.includes(platform as Platform)) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${validPlatforms.join(", ")}`,
        })
      }

      // Get all campaigns enriched with metrics
      const campaigns = await enrichCampaignsWithMetrics.execute(user.id)

      // Filter campaigns for this platform
      const platformCampaigns = campaigns.filter((c) =>
        Array.isArray(c.platforms)
          ? c.platforms.includes(platform as Platform)
          : c.platforms === platform
      )

      // Aggregate metrics for this platform
      let totalImpressions = 0
      let totalClicks = 0
      let totalConversions = 0
      let totalRevenue = 0
      let totalSales = 0
      let totalSpend = 0
      let totalBudget = 0

      platformCampaigns.forEach((campaign) => {
        // Add budget and spend
        totalSpend += campaign.spend_usd || 0
        totalBudget += campaign.budget_usd || 0

        // Get metrics from mock_stats (could be per-platform or flat)
        if (campaign.mock_stats) {
          const stats = campaign.mock_stats as any

          // Check if multi-platform format: { meta: {...}, google_ads: {...} }
          if (typeof stats === "object" && !Array.isArray(stats) && platform in stats) {
            const platformStats = stats[platform]
            if (platformStats && typeof platformStats === "object") {
              totalImpressions += platformStats.impressions || 0
              totalClicks += platformStats.clicks || 0
              totalConversions += platformStats.conversions || 0
              totalRevenue += platformStats.revenue || 0
              totalSales += platformStats.total_sales || platformStats.revenue || 0
            }
          } else if (typeof stats === "object" && !Array.isArray(stats)) {
            // Flat structure - use if campaign includes this platform
            totalImpressions += stats.impressions || 0
            totalClicks += stats.clicks || 0
            totalConversions += stats.conversions || 0
            totalRevenue += stats.revenue || 0
            totalSales += stats.total_sales || stats.revenue || 0
          }
        }
      })

      // Calculate derived metrics
      const averageCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
      const averageCPC = totalClicks > 0 ? totalSpend / totalClicks : 0
      const averageCPM = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
      const averageCPA = totalConversions > 0 ? totalSpend / totalConversions : undefined
      const overallROA = totalSpend > 0 ? totalRevenue / totalSpend : undefined

      // Get connected accounts for this platform
      const adAccount = await adAccountsRepo.findByUserAndPlatform(user.id, platform as Platform)
      const connectedAccountsCount = adAccount ? 1 : 0

      return reply.send({
        platform,
        summary: {
          total_campaigns: platformCampaigns.length,
          active_campaigns: platformCampaigns.filter((c) => c.status === "active").length,
          connected_accounts: connectedAccountsCount,
          is_connected: connectedAccountsCount > 0,
          total_spend: totalSpend,
          total_budget: totalBudget,
        },
        metrics: {
          impressions: totalImpressions,
          clicks: totalClicks,
          conversions: totalConversions,
          revenue: totalRevenue,
          sales: totalSales || totalRevenue,
          ctr: averageCTR,
          cpc: averageCPC,
          cpm: averageCPM,
          cpa: averageCPA,
          roa: overallROA,
        },
        campaigns: platformCampaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          spend_usd: c.spend_usd,
          budget_usd: c.budget_usd,
        })),
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener métricas de la plataforma",
      })
    }
  })

  // 💡 Get insights for a specific platform
  app.get("/platforms/:platform/insights", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }

      // Validate platform
      const validPlatforms: Platform[] = ["meta", "google_ads", "linkedin"]
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

      const platforms: Platform[] = ["meta", "google_ads", "linkedin"]
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
      const validPlatforms: Platform[] = ["meta", "google_ads", "linkedin"]
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
        
        // Check if error is due to missing encryption fields
        if (error.message.includes("not properly encrypted") || error.message.includes("Missing IV or tag")) {
          return reply.code(401).send({
            error: "Token not encrypted",
            message: "Your account tokens are not properly encrypted. Please disconnect and reconnect your account to fix this.",
            requires_reconnection: true,
          })
        }
        
        return reply.code(401).send({
          error: "Invalid token",
          message: error.message || "Access token is missing or invalid. Please reconnect your account.",
          requires_reconnection: true,
        })
      }

      // Get platform client
      const client = PlatformApiClientFactory.createClient(platform as Platform)

      // List campaigns from platform API
      const platformCampaigns = await client.listCampaigns(adAccount.platform_account_id, accessToken)

      // Get metrics for each campaign
      const campaignsWithMetrics = await Promise.all(
        platformCampaigns.map(async (campaign) => {
          try {
            const metrics = await client.getCampaignMetrics(campaign.id, accessToken)
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

  // 📋 Get connected accounts for a platform
  app.get("/platforms/:platform/accounts", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { platform } = req.params as { platform: string }

      // Validate platform
      const validPlatforms: Platform[] = ["meta", "google_ads", "linkedin"]
      if (!validPlatforms.includes(platform as Platform)) {
        return reply.code(400).send({
          error: "Invalid platform",
          message: `Platform must be one of: ${validPlatforms.join(", ")}`,
        })
      }

      // Get connected account
      const adAccount = await adAccountsRepo.findByUserAndPlatform(user.id, platform as Platform)

      if (!adAccount) {
        return reply.send({
          platform,
          is_connected: false,
          account: null,
        })
      }

      return reply.send({
        platform,
        is_connected: true,
        account: {
          id: adAccount.id,
          platform_account_id: adAccount.platform_account_id,
          account_name: adAccount.account_name,
          currency: adAccount.currency,
          connected_at: adAccount.connected_at,
          last_synced_at: adAccount.last_synced_at,
          is_active: adAccount.is_active,
        },
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener información de la cuenta",
      })
    }
  })
}
