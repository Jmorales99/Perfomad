import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { verifyUserAndSubscription } from "@/infrastructure/auth/verifySubscription"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { CreateCampaign } from "@/application/usecases/campaigns/CreateCampaign"
import { SyncCampaignMetrics } from "@/application/usecases/campaigns/SyncCampaignMetrics"
import { GetCampaignInsights } from "@/application/usecases/campaigns/GetCampaignInsights"
import { GetDashboardMetrics } from "@/application/usecases/campaigns/GetDashboardMetrics"
import { EnrichCampaignsWithMetrics } from "@/application/usecases/campaigns/EnrichCampaignsWithMetrics"
import { SyncCampaignBudgetFromPlatform } from "@/application/usecases/campaigns/SyncCampaignBudgetFromPlatform"
import {
  ListCampaignAdSets,
  ListAdSetAds,
} from "@/application/usecases/platforms/ListCampaignAdSets"
import { OptimizationConfigRepository } from "@/infrastructure/repositories/OptimizationConfigRepository"
import { OptimizationRepository } from "@/infrastructure/repositories/OptimizationRepository"
import { BenchmarksRepository } from "@/infrastructure/repositories/BenchmarksRepository"
import { ClaudeClient } from "@/infrastructure/integrations/llm/ClaudeClient"
import { BuildOptimizationInput } from "@/application/usecases/optimization/BuildOptimizationInput"
import { AnalyzeCampaignOptimization } from "@/application/usecases/optimization/AnalyzeCampaignOptimization"
import { ApplyOptimizationRecommendation } from "@/application/usecases/optimization/ApplyOptimizationRecommendation"
import { ListOptimizationRuns } from "@/application/usecases/optimization/ListOptimizationRuns"
import { GetLatestRecommendations } from "@/application/usecases/optimization/GetLatestRecommendations"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { createCampaignSchema } from "@/application/schemas/CreateCampaignSchema"

export async function CampaignsController(app: FastifyInstance) {
  const campaignsRepo = new SupabaseCampaignsRepository()
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const createCampaign = new CreateCampaign(campaignsRepo, adAccountsRepo)
  const metricsHistoryRepo = new CampaignMetricsHistoryRepository()
  const syncCampaignMetrics = new SyncCampaignMetrics(campaignsRepo, metricsHistoryRepo)
  const getCampaignInsights = new GetCampaignInsights(campaignsRepo, metricsHistoryRepo)
  const enrichCampaignsWithMetrics = new EnrichCampaignsWithMetrics(campaignsRepo)
  const getDashboardMetrics = new GetDashboardMetrics(campaignsRepo, enrichCampaignsWithMetrics)

  // Optimization + budget sync + ad sets use cases
  const optimizationConfigRepo = new OptimizationConfigRepository()
  const optimizationRepo = new OptimizationRepository()
  const benchmarksRepo = new BenchmarksRepository()
  const claudeClient = new ClaudeClient()
  const buildOptimizationInput = new BuildOptimizationInput({
    metricsHistoryRepo,
    benchmarksRepo,
    adAccountsRepo,
  })
  const analyzeCampaignOptimization = new AnalyzeCampaignOptimization(
    campaignsRepo,
    optimizationRepo,
    optimizationConfigRepo,
    buildOptimizationInput,
    claudeClient
  )
  const applyOptimizationRecommendation = new ApplyOptimizationRecommendation(
    campaignsRepo,
    adAccountsRepo,
    optimizationRepo,
    optimizationConfigRepo
  )
  const listOptimizationRuns = new ListOptimizationRuns(campaignsRepo, optimizationRepo)
  const getLatestRecommendations = new GetLatestRecommendations(
    campaignsRepo,
    optimizationRepo
  )
  const syncBudgetFromPlatform = new SyncCampaignBudgetFromPlatform(
    campaignsRepo,
    adAccountsRepo,
    optimizationConfigRepo
  )
  const listCampaignAdSets = new ListCampaignAdSets(campaignsRepo, adAccountsRepo)
  const listAdSetAds = new ListAdSetAds(campaignsRepo, adAccountsRepo)

  // 📦 Listar campañas (solo lectura, no requiere suscripción)
  // Enriquecidas automáticamente con métricas
  app.get("/campaigns", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { client_id } = req.query as { client_id?: string }

      req.log.info({ userId: user.id, clientId: client_id }, "Fetching campaigns for user")

      // Enrich campaigns with metrics (optionally filtered by client/brand)
      const campaigns = await enrichCampaignsWithMetrics.execute(user.id, client_id)

      req.log.info({ userId: user.id, count: campaigns.length }, "Campaigns fetched successfully")

      return reply.send(campaigns)
    } catch (err) {
      req.log.error({ err }, "Error al listar campañas")
      return reply.code(500).send({ error: "Error al listar campañas" })
    }
  })

  // 📋 Verificar si el usuario puede crear campañas
  app.get("/campaigns/can-create", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      // Get user's ad accounts
      const adAccounts = await adAccountsRepo.findByUserId(user.id)
      const activeAccounts = adAccounts.filter((acc) => acc.is_active)

      // Check subscription
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("has_active_subscription")
        .eq("id", user.id)
        .maybeSingle()

      const canCreate = activeAccounts.length > 0 && profile?.has_active_subscription

      return reply.send({
        can_create: canCreate,
        has_subscription: profile?.has_active_subscription || false,
        ad_accounts_count: activeAccounts.length,
        ad_accounts: activeAccounts.map((acc) => ({
          platform: acc.platform,
          account_name: acc.account_name,
          is_active: acc.is_active,
        })),
        missing_requirements: [
          !profile?.has_active_subscription && "Suscripción activa",
          activeAccounts.length === 0 && "Cuentas de publicidad conectadas",
        ].filter(Boolean),
        message: canCreate
          ? "Puedes crear campañas"
          : "No puedes crear campañas. Verifica tus suscripción y cuentas de publicidad.",
      })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al verificar estado" })
    }
  })

  // 🆕 Crear campaña (REQUIERE SUSCRIPCIÓN ACTIVA Y CUENTAS CONECTADAS)
  // Rate-limited to 5/min per-IP to prevent accidental floods from the wizard.
  app.post(
    "/campaigns",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
    try {
      // Verificar usuario Y suscripción activa
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      // Check subscription
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("has_active_subscription")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.has_active_subscription) {
        return reply.code(400).send({
          error: "Suscripción no activa",
          message: "Por favor, activa tu suscripción primero",
        })
      }

      // Validate the shape with zod (strict types + coerce + refinements).
      // Budget exclusivity and date coherence are enforced inside the schema.
      const parseResult = createCampaignSchema.safeParse(req.body)
      if (!parseResult.success) {
        const first = parseResult.error.issues[0]
        return reply.code(400).send({
          error: "invalid_body",
          message: first?.message || "Datos de campaña inválidos",
          field: first?.path?.join(".") || undefined,
          issues: parseResult.error.issues,
        })
      }
      const body = parseResult.data

      // Phase A: LinkedIn and TikTok creation flows are not implemented yet
      // (Phase D). Fail explicitly so the UI doesn't silently partial-create.
      const unsupportedForCreation = body.platforms.filter(
        (p) => p === "linkedin" || p === "tiktok"
      )
      if (unsupportedForCreation.length > 0) {
        return reply.code(400).send({
          error: "PLATFORM_NOT_SUPPORTED",
          message: `La creación en ${unsupportedForCreation.join(", ")} aún no está disponible. Por ahora selecciona Meta y/o Google Ads.`,
          unsupported_platforms: unsupportedForCreation,
        })
      }

      // Check if user has connected accounts for the selected platforms
      const adAccounts = await adAccountsRepo.findByUserId(user.id)
      const activeAdAccounts = adAccounts.filter((acc) => acc.is_active)
      const missingPlatforms = body.platforms.filter(
        (platform) => !activeAdAccounts.some((acc) => acc.platform === platform)
      )

      if (missingPlatforms.length > 0) {
        const platformNames: Record<string, string> = {
          meta: "Meta (Facebook/Instagram)",
          google_ads: "Google Ads",
          linkedin: "LinkedIn Ads",
          tiktok: "TikTok Ads",
        }

        const missingNames = missingPlatforms.map((p) => platformNames[p] || p)

        return reply.code(400).send({
          error: "MISSING_PLATFORM_ACCOUNTS",
          message: `⚠️ Cuentas de publicidad no conectadas`,
          title: "Cuentas requeridas para esta plataforma",
          details: `Para crear campañas en ${missingNames.join(" o ")}, primero debes conectar tu cuenta de publicidad.`,
          missing_platforms: missingPlatforms,
          missing_platform_names: missingNames,
          action_required: `Conecta tu cuenta de ${missingNames[0]}`,
          help_url: "/subscription/accounts",
          action_button_text: "Conectar cuentas ahora",
          show_popup: true,
        })
      }

      if (activeAdAccounts.length === 0) {
        return reply.code(400).send({
          error: "NO_AD_ACCOUNTS",
          message: "⚠️ No tienes cuentas de publicidad conectadas",
          title: "Cuentas de publicidad requeridas",
          details: "Para crear campañas, primero debes conectar al menos una cuenta de publicidad.",
          action_required: "Conecta tus cuentas de publicidad",
          help_url: "/subscription/accounts",
          action_button_text: "Conectar cuentas ahora",
          show_popup: true,
        })
      }

      const campaign = await createCampaign.execute({
        userId: user.id,
        clientId: body.client_id,
        name: body.name,
        platforms: body.platforms as Platform[],
        description: body.description,

        budgetUsd: body.budget_usd,
        lifetimeBudget: body.lifetime_budget,
        platformBudgets: body.platform_budgets as any,

        objective: body.objective,
        billingEvent: body.billing_event,
        bidStrategy: body.bid_strategy,
        status: body.status,
        specialAdCategories: body.special_ad_categories,

        startDate: body.start_date,
        endDate: body.end_date,

        metaSettings: body.meta_settings,

        targeting: body.targeting
          ? {
              geoCountries: body.targeting.geo_countries,
              ageMin: body.targeting.age_min,
              ageMax: body.targeting.age_max,
              genders: body.targeting.genders,
            }
          : undefined,

        creative: body.creative
          ? {
              pageId: body.creative.page_id,
              mediaUrl: body.creative.media_url,
              mediaType: body.creative.media_type as "image" | "video" | undefined,
              mediaFilename: body.creative.media_filename,
              headline: body.creative.headline,
              primaryText: body.creative.primary_text,
              description: body.creative.description,
              cta: body.creative.cta,
              link: body.creative.link,
            }
          : undefined,

        productPrice: body.product_price,
        productCost: body.product_cost,
      })

      // Partial-success handling: if CreateCampaign attached _errors it means
      // at least one platform failed. Respond with 207 Multi-Status so the
      // frontend can distinguish "complete success" from "partial success".
      const errors = (campaign as { _errors?: Record<string, string> })._errors
      if (errors && Object.keys(errors).length > 0) {
        const successes = body.platforms.filter((p) => !errors[p])
        if (successes.length === 0) {
          // All platforms failed → treat as server-side failure but still
          // return the local row (it was saved) so the user can retry later.
          return reply.code(502).send({
            error: "ALL_PLATFORMS_FAILED",
            message: "No pudimos publicar la campaña en ninguna plataforma",
            campaign,
            failures: Object.entries(errors).map(([platform, message]) => ({
              platform,
              message,
            })),
          })
        }
        return reply.code(207).send({
          campaign,
          successes,
          failures: Object.entries(errors).map(([platform, message]) => ({
            platform,
            message,
          })),
        })
      }

      return reply.code(201).send(campaign)
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al crear campaña",
      })
    }
    }
  )

  // 🔍 Lookup internal campaign by platform-native ID (must be before /:id)
  app.get("/campaigns/by-platform-id", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { platform, platformCampaignId } = req.query as {
        platform?: string
        platformCampaignId?: string
      }
      if (!platform || !platformCampaignId) {
        return reply.code(400).send({ error: "platform y platformCampaignId son requeridos" })
      }
      const campaign = await campaignsRepo.findByPlatformCampaignId(
        user.id,
        platform,
        platformCampaignId
      )
      return reply.send({
        imported: !!campaign,
        campaign_id: campaign?.id ?? null,
        campaign_name: campaign?.name ?? null,
      })
    } catch (err: any) {
      req.log.error({ err }, "Error buscando campaña por platform ID")
      return reply.code(500).send({ error: "Error al buscar campaña" })
    }
  })

  // 📋 Get single campaign by ID (for details page)
  app.get("/campaigns/:id", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }

      const campaign = await campaignsRepo.findById(user.id, id)
      if (!campaign) {
        return reply.code(404).send({ error: "Campaña no encontrada" })
      }

      // Enrich with metrics like the list endpoint does
      const enrichedCampaign = await enrichCampaignsWithMetrics.execute(user.id)
      const foundCampaign = enrichedCampaign.find((c) => c.id === id)
      
      if (!foundCampaign) {
        return reply.code(404).send({ error: "Campaña no encontrada" })
      }

      return reply.send(foundCampaign)
    } catch (err: any) {
      req.log.error({ err }, "Error al obtener campaña")
      return reply.code(500).send({ error: "Error al obtener campaña" })
    }
  })

  // 📈 Obtener métricas (solo lectura, no requiere suscripción)
  app.get("/campaigns/:id/overview", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }

      const campaign = await campaignsRepo.findById(user.id, id)
      if (!campaign) {
        return reply.code(404).send({ error: "Campaña no encontrada" })
      }

      // If campaign has metrics stored locally, return them
      // Handle both per-platform and flat structures
      if (campaign.mock_stats) {
        let metrics = campaign.mock_stats
        
        // Check if it's per-platform structure (e.g., {"meta": {...}})
        if (typeof metrics === 'object' && !Array.isArray(metrics)) {
          const platforms = ['meta', 'google_ads', 'linkedin', 'tiktok']
          const hasPlatformKeys = platforms.some(p => metrics && typeof metrics === 'object' && p in metrics)
          
          if (hasPlatformKeys) {
            // Per-platform structure - aggregate or use first platform for overview
            const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
            const firstPlatform = Object.keys(metrics)[0]
            const platformMetrics = (metrics as Record<string, any>)[firstPlatform]
            
            // If platform metrics are already calculated, use them directly
            // Otherwise, calculate from raw data if available
            const rawDataField = (campaign as any).raw_data_platform || (campaign as any).raw_data_plai
            if (rawDataField && typeof rawDataField === 'object') {
              const rawData = rawDataField[firstPlatform] || rawDataField
              metrics = MetricsCalculator.calculateFromRaw(rawData)
            } else {
              metrics = platformMetrics || metrics
            }
          }
        }
        
        return reply.send({
          id: campaign.id,
          name: campaign.name,
          metrics,
          synced: true,
        })
      }

      // Otherwise, try to calculate from stored raw data
      const campaignIdField = (campaign as any).platform_campaign_id || (campaign as any).mock_campaign_id
      if (campaignIdField) {
        try {
          const rawDataField = (campaign as any).raw_data_platform || (campaign as any).raw_data_plai
          if (rawDataField) {
            // Calculate from stored RAW data
            const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
            const rawData = typeof rawDataField === 'string' 
              ? JSON.parse(rawDataField) 
              : rawDataField
            
            // Check if multi-platform or single
            if (typeof rawData === 'object' && !Array.isArray(rawData) && Object.keys(rawData).some(k => ['meta', 'google_ads', 'linkedin', 'tiktok'].includes(k))) {
              // Multi-platform format
              const allMetrics: Record<string, any> = {}
              for (const [platform, platformRawData] of Object.entries(rawData)) {
                allMetrics[platform] = MetricsCalculator.calculateFromRaw(platformRawData as any)
              }
              
              return reply.send({
                id: campaign.id,
                name: campaign.name,
                metrics: allMetrics,
                synced: true,
                from_stored: true,
              })
            } else {
              // Single platform or flat structure
              const calculated = MetricsCalculator.calculateFromRaw(rawData)
              return reply.send({
                id: campaign.id,
                name: campaign.name,
                metrics: calculated,
                synced: true,
                from_stored: true,
              })
            }
          }
        } catch (err: any) {
          req.log.error({ err }, "Error calculating metrics from stored data")
        }
      }

      return reply.send({
        id: campaign.id,
        name: campaign.name,
        metrics: null,
        message: "No hay métricas disponibles",
      })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al obtener métricas" })
    }
  })

  // 🔄 Sincronizar métricas desde plataformas
  app.post("/campaigns/:id/sync", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }

      req.log.info({ userId: user.id, campaignId: id }, "Starting campaign metrics sync")

      const updated = await syncCampaignMetrics.execute(user.id, id)

      req.log.info({ userId: user.id, campaignId: id }, "Campaign metrics synced successfully")

      return reply.send({
        message: "Métricas sincronizadas correctamente",
        campaign: updated,
      })
    } catch (err: any) {
      req.log.error({ err, message: err.message, stack: err.stack }, "Error syncing campaign metrics")
      return reply.code(500).send({
        error: err.message || "Error al sincronizar métricas",
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      })
    }
  })

  // ✏️ Actualizar campaña (REQUIERE SUSCRIPCIÓN ACTIVA)
  app.patch("/campaigns/:id", async (req, reply) => {
    try {
      // Verificar usuario Y suscripción activa
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return // verifyUserAndSubscription ya envió la respuesta de error

      const { id } = req.params as { id: string }
      const body = req.body as Partial<{
        name: string
        platforms: ("meta" | "google_ads" | "linkedin" | "tiktok")[]
        description: string
        budget_usd: number
        status: "active" | "paused" | "completed"
        start_date: string
        end_date: string | null
      }>

      // Verificar que la campaña pertenece al usuario
      const existingCampaign = await campaignsRepo.findById(user.id, id)
      if (!existingCampaign) {
        return reply.code(404).send({ error: "Campaña no encontrada" })
      }

      // Update local campaign
      const updated = await campaignsRepo.update(user.id, id, body)

      // TODO: Sync status/budget updates to platform APIs if needed
      // For now, we only update locally. Platform sync can be added later

      return reply.send(updated)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al actualizar campaña" })
    }
  })

  // 🗑️ Eliminar campaña (REQUIERE SUSCRIPCIÓN ACTIVA)
  app.delete("/campaigns/:id", async (req, reply) => {
    try {
      // Verificar usuario Y suscripción activa
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return // verifyUserAndSubscription ya envió la respuesta de error

      const { id } = req.params as { id: string }

      // Verificar que la campaña pertenece al usuario
      const existingCampaign = await campaignsRepo.findById(user.id, id)
      if (!existingCampaign) {
        return reply.code(404).send({ error: "Campaña no encontrada" })
      }

      await campaignsRepo.delete(user.id, id)
      return reply.code(204).send()
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al eliminar campaña" })
    }
  })

  // 📊 Obtener insights y recomendaciones de optimización (solo lectura, no requiere suscripción)
  app.get("/campaigns/:id/insights", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }

      const insights = await getCampaignInsights.execute(user.id, id)
      return reply.send(insights)
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener insights",
      })
    }
  })

  // 📈 Obtener métricas del dashboard (solo lectura, no requiere suscripción)
  // Consolidates metrics from all platforms
  app.get("/dashboard/metrics", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { client_id } = req.query as { client_id?: string }

      // Enrich campaigns before passing them to GetDashboardMetrics (optionally by client)
      const enrichedCampaigns = await enrichCampaignsWithMetrics.execute(user.id, client_id)
      const metrics = await getDashboardMetrics.execute(user.id, enrichedCampaigns, client_id)
      return reply.send(metrics)
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener métricas del dashboard",
      })
    }
  })

  // 📊 Obtener resumen de plataformas del dashboard
  app.get("/dashboard/platform-summary", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { client_id } = req.query as { client_id?: string }

      // Use the platforms summary endpoint logic
      const platforms: Platform[] = ["meta", "google_ads", "linkedin", "tiktok"]
      const campaigns = await enrichCampaignsWithMetrics.execute(user.id, client_id)
      const adAccountsRepo = new SupabaseAdAccountsRepository()
      const adAccounts = client_id
        ? await adAccountsRepo.findByUserAndClient(user.id, client_id)
        : await adAccountsRepo.findByUserId(user.id)

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
        error: err.message || "Error al obtener resumen de plataformas del dashboard",
      })
    }
  })

  // 📊 Obtener historial de ventas para gráficos
  app.get("/campaigns/:id/sales-history", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const { days = "30" } = req.query as { days?: string }

      // Calculate date range
      const daysBack = parseInt(days) || 30
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - daysBack)
      startDate.setHours(0, 0, 0, 0)

      // Get sales history from metrics history
      const history = await metricsHistoryRepo.getHistory(id, {
        startDate: startDate.toISOString(),
        limit: 100, // Limit to prevent too much data
      })

      // Transform to chart-friendly format
      const salesData = history
        .sort((a, b) => {
          const dateA = new Date(a.recorded_at || 0).getTime()
          const dateB = new Date(b.recorded_at || 0).getTime()
          return dateA - dateB
        })
        .map((snapshot) => ({
          date: snapshot.recorded_at || new Date().toISOString(),
          total_sales: snapshot.total_sales || snapshot.revenue || 0,
          revenue: snapshot.revenue || 0,
          conversions: snapshot.conversions || 0,
          spend: snapshot.spend || 0,
          cpa: snapshot.cpa || undefined,
          roa: snapshot.roa || undefined,
        }))

      // Calculate improvement percentage (first value vs last value)
      let improvement = null
      if (salesData.length > 1) {
        const firstSales = salesData[0].total_sales
        const lastSales = salesData[salesData.length - 1].total_sales
        if (firstSales > 0) {
          improvement = ((lastSales - firstSales) / firstSales) * 100
        } else if (lastSales > 0) {
          improvement = 100 // Infinite improvement from 0
        }
      }

      return reply.send({
        data: salesData,
        improvement,
        period_days: daysBack,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener historial de ventas",
      })
    }
  })

  // 📊 Obtener historial de ventas agregado para dashboard/homepage
  app.get("/dashboard/sales-history", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const {
        days = "30",
        campaign_ids,
        platforms,
        client_id,
      } = req.query as {
        days?: string
        campaign_ids?: string // Comma-separated campaign IDs
        platforms?: string    // Comma-separated platforms (meta,google_ads,linkedin,tiktok)
        client_id?: string
      }

      // Calculate date range
      const daysBack = parseInt(days) || 30
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - daysBack)
      startDate.setHours(0, 0, 0, 0)

      // Get campaigns for user, optionally filtered by client/brand
      let campaigns = client_id
        ? await campaignsRepo.listByUserAndClient(user.id, client_id)
        : await campaignsRepo.listByUser(user.id)
      
      // Filter by campaign IDs if provided
      if (campaign_ids) {
        const filterIds = campaign_ids.split(",").map((id) => id.trim())
        campaigns = campaigns.filter((c) => filterIds.includes(c.id))
      }
      
      // Filter by platforms if provided
      if (platforms) {
        const filterPlatforms = platforms.split(",").map((p) => p.trim())
        campaigns = campaigns.filter((c) => {
          const campaignPlatforms = Array.isArray(c.platforms) ? c.platforms : [c.platforms || "meta"]
          return campaignPlatforms.some((p) => filterPlatforms.includes(p))
        })
      }
      
      const campaignIds = campaigns.map((c) => c.id)

      if (campaignIds.length === 0) {
        return reply.send({
          data: [],
          improvement: null,
          period_days: daysBack,
        })
      }

      // Get all history for all campaigns in a single query (optimized)
      const allHistory = await metricsHistoryRepo.getHistoryForMultipleCampaigns(campaignIds, {
        startDate: startDate.toISOString(),
        platforms: platforms ? platforms.split(",").map((p) => p.trim()) : undefined,
      })

      // Group by date and aggregate
      const salesByDate: Record<string, { total_sales: number; revenue: number; conversions: number; spend: number }> = {}
      
      allHistory.forEach((snapshot) => {
        const date = new Date(snapshot.recorded_at || 0).toISOString().split("T")[0] // YYYY-MM-DD
        if (!salesByDate[date]) {
          salesByDate[date] = {
            total_sales: 0,
            revenue: 0,
            conversions: 0,
            spend: 0,
          }
        }
        salesByDate[date].total_sales += snapshot.total_sales || snapshot.revenue || 0
        salesByDate[date].revenue += snapshot.revenue || 0
        salesByDate[date].conversions += snapshot.conversions || 0
        salesByDate[date].spend += snapshot.spend || 0
      })

      // Transform to chart-friendly format
      const salesData = Object.entries(salesByDate)
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, totals]) => ({
          date: new Date(date).toISOString(),
          total_sales: totals.total_sales,
          revenue: totals.revenue,
          conversions: totals.conversions,
          spend: totals.spend,
          cpa: totals.conversions > 0 ? totals.spend / totals.conversions : undefined,
          roa: totals.spend > 0 ? totals.revenue / totals.spend : undefined,
        }))

      // Calculate improvement percentage
      let improvement = null
      if (salesData.length > 1) {
        const firstSales = salesData[0].total_sales
        const lastSales = salesData[salesData.length - 1].total_sales
        if (firstSales > 0) {
          improvement = ((lastSales - firstSales) / firstSales) * 100
        } else if (lastSales > 0) {
          improvement = 100
        }
      }

      return reply.send({
        data: salesData,
        improvement,
        period_days: daysBack,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener historial de ventas",
      })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AI OPTIMIZATION (Claude) — analyze, apply, runs, latest recommendations
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/campaigns/:id/optimize/analyze", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }

      const result = await analyzeCampaignOptimization.execute(user.id, id)
      return reply.send(result)
    } catch (err: any) {
      const status = err.message === "Campaign not found" ? 404
        : err.message?.includes("rate_limit") ? 429
        : 500
      req.log.error({ err, campaignId: (req.params as any).id }, "optimize/analyze failed")
      return reply.code(status).send({
        error: err.message || "Error al analizar campaña con IA",
      })
    }
  })

  app.post("/campaigns/:id/optimize/apply", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const body = req.body as {
        recommendation_id: string
        decision: "accept" | "reject"
        override_params?: Record<string, unknown>
        notes?: string
      }

      if (!body?.recommendation_id || !body?.decision) {
        return reply.code(400).send({
          error: "recommendation_id y decision son requeridos",
        })
      }
      if (body.decision !== "accept" && body.decision !== "reject") {
        return reply.code(400).send({ error: "decision debe ser 'accept' o 'reject'" })
      }

      const result = await applyOptimizationRecommendation.execute({
        userId: user.id,
        campaignId: id,
        recommendationId: body.recommendation_id,
        decision: body.decision,
        overrideParams: body.override_params,
        notes: body.notes,
      })
      return reply.send(result)
    } catch (err: any) {
      const status = err.message === "Campaign not found" ? 404 : 500
      req.log.error({ err, campaignId: (req.params as any).id }, "optimize/apply failed")
      return reply.code(status).send({
        error: err.message || "Error al aplicar recomendación",
      })
    }
  })

  app.get("/campaigns/:id/optimize/runs", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const { limit } = req.query as { limit?: string }
      const parsed = limit ? Math.min(50, Math.max(1, parseInt(limit, 10) || 20)) : 20

      const runs = await listOptimizationRuns.execute(user.id, id, parsed)
      return reply.send({ runs })
    } catch (err: any) {
      const status = err.message === "Campaign not found" ? 404 : 500
      req.log.error({ err, campaignId: (req.params as any).id }, "optimize/runs failed")
      return reply.code(status).send({
        error: err.message || "Error al obtener historial de optimizaciones",
      })
    }
  })

  app.get("/campaigns/:id/optimize/recommendations/latest", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const result = await getLatestRecommendations.execute(user.id, id)
      return reply.send(result)
    } catch (err: any) {
      const status = err.message === "Campaign not found" ? 404 : 500
      req.log.error({ err, campaignId: (req.params as any).id }, "optimize/recommendations/latest failed")
      return reply.code(status).send({
        error: err.message || "Error al obtener recomendaciones",
      })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BUDGET SYNC — platform as source of truth
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/campaigns/:id/budget/sync-from-platform", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const body = (req.body ?? {}) as { promote?: boolean }

      const result = await syncBudgetFromPlatform.execute(user.id, id, {
        promoteToSourceOfTruth: !!body.promote,
      })
      return reply.send(result)
    } catch (err: any) {
      req.log.error({ err }, "Error syncing campaign budget from platform")
      return reply.code(500).send({
        error: err.message || "Error al sincronizar presupuesto",
      })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AD SETS / AD GROUPS — hierarchical creatives view
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/campaigns/:id/adsets", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const { since, until, clientId, platform } = req.query as {
        since?: string
        until?: string
        clientId?: string
        platform?: string
      }
      const dateRange = since && until ? { since, until } : undefined

      const result = await listCampaignAdSets.execute(user.id, id, {
        dateRange,
        clientId,
        platform: platform as any,
      })
      return reply.send(result)
    } catch (err: any) {
      req.log.error({ err }, "Error listing campaign ad sets")
      return reply.code(500).send({
        error: err.message || "Error al obtener ad sets de la campaña",
      })
    }
  })

  app.get("/campaigns/:id/adsets/:adsetId/ads", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id, adsetId } = req.params as { id: string; adsetId: string }
      const { clientId, platform } = req.query as {
        clientId?: string
        platform?: string
      }

      const result = await listAdSetAds.execute(user.id, id, adsetId, {
        clientId,
        platform: platform as any,
      })
      return reply.send(result)
    } catch (err: any) {
      req.log.error({ err }, "Error listing ads for ad set")
      return reply.code(500).send({
        error: err.message || "Error al obtener anuncios del ad set",
      })
    }
  })
}
