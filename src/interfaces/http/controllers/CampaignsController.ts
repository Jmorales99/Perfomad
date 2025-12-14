import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { verifyUserAndSubscription } from "@/infrastructure/auth/verifySubscription"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"
import { CreateCampaign } from "@/application/usecases/campaigns/CreateCampaign"
import { SyncCampaignMetrics } from "@/application/usecases/campaigns/SyncCampaignMetrics"
import { GetCampaignInsights } from "@/application/usecases/campaigns/GetCampaignInsights"
import { GetDashboardMetrics } from "@/application/usecases/campaigns/GetDashboardMetrics"
import { EnrichCampaignsWithMetrics } from "@/application/usecases/campaigns/EnrichCampaignsWithMetrics"

export async function CampaignsController(app: FastifyInstance) {
  const campaignsRepo = new SupabaseCampaignsRepository()
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const plaiApi = new PlaiApiClient()
  const createCampaign = new CreateCampaign(campaignsRepo, adAccountsRepo, plaiApi)
  const metricsHistoryRepo = new CampaignMetricsHistoryRepository()
  const syncCampaignMetrics = new SyncCampaignMetrics(campaignsRepo, metricsHistoryRepo, plaiApi)
  const getCampaignInsights = new GetCampaignInsights(campaignsRepo, metricsHistoryRepo, plaiApi)
  const enrichCampaignsWithMetrics = new EnrichCampaignsWithMetrics(campaignsRepo, plaiApi)
  const getDashboardMetrics = new GetDashboardMetrics(campaignsRepo, enrichCampaignsWithMetrics)

  // 📦 Listar campañas (solo lectura, no requiere suscripción)
  // Enriquecidas automáticamente con métricas del mock API
  app.get("/campaigns", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      
      req.log.info({ userId: user.id }, "Fetching campaigns for user")
      
      // Enrich campaigns with metrics from mock API
      const campaigns = await enrichCampaignsWithMetrics.execute(user.id)
      
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
        .select("has_active_subscription, plai_user_id")
        .eq("id", user.id)
        .maybeSingle()

      const canCreate = activeAccounts.length > 0 && profile?.has_active_subscription

      return reply.send({
        can_create: canCreate,
        has_subscription: profile?.has_active_subscription || false,
        has_plai_account: !!profile?.plai_user_id,
        ad_accounts_count: activeAccounts.length,
        ad_accounts: activeAccounts.map((acc) => ({
          platform: acc.platform,
          account_name: acc.account_name,
          is_active: acc.is_active,
        })),
        missing_requirements: [
          !profile?.has_active_subscription && "Suscripción activa",
          !profile?.plai_user_id && "Cuenta Plai vinculada",
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
  app.post("/campaigns", async (req, reply) => {
    try {
      // Verificar usuario Y suscripción activa
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      // Get plai_user_id from profile
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plai_user_id")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.plai_user_id) {
        return reply.code(400).send({
          error: "Cuenta Plai no vinculada",
          message: "Por favor, activa tu suscripción primero",
        })
      }

      const body = req.body as {
        name: string
        platforms: ("meta" | "google_ads" | "linkedin")[]
        description?: string
        
        // Budget Options
        budget_usd?: number // Daily budget
        lifetime_budget?: number // Alternative: lifetime budget
        
        // Campaign Settings (Meta/Facebook Ads realistic parameters)
        objective?: string // OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_ENGAGEMENT, etc.
        billing_event?: string // IMPRESSIONS, LINK_CLICKS, etc.
        bid_strategy?: string // LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
        status?: "ACTIVE" | "PAUSED"
        special_ad_categories?: string[] // HOUSING, EMPLOYMENT, CREDIT
        
        // Dates
        start_date?: string
        end_date?: string | null
        
        // Platform-specific settings
        meta_settings?: {
          promoted_object?: any
          [key: string]: any
        }
        
        // Product pricing (for accurate ROA calculation)
        product_price?: number // Selling price per product unit
        product_cost?: number // Production cost per product unit (optional)
      }

      if (!body.name || !body.platforms?.length) {
        return reply.code(400).send({ error: "Faltan campos obligatorios" })
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
        }
        
        const missingNames = missingPlatforms.map((p) => platformNames[p] || p)
        
        return reply.code(400).send({
          error: "MISSING_PLATFORM_ACCOUNTS", // Frontend can check this specific error code
          message: `⚠️ Cuentas de publicidad no conectadas`,
          title: "Cuentas requeridas para esta plataforma",
          details: `Para crear campañas en ${missingNames.join(" o ")}, primero debes conectar tu cuenta de publicidad.`,
          missing_platforms: missingPlatforms,
          missing_platform_names: missingNames,
          action_required: `Conecta tu cuenta de ${missingNames[0]}`,
          help_url: "/subscription/accounts",
          action_button_text: "Conectar cuentas ahora",
          show_popup: true, // Frontend can use this flag
        })
      }

      // Check if user has ANY ad accounts at all (for better messaging)
      if (activeAdAccounts.length === 0) {
        return reply.code(400).send({
          error: "NO_AD_ACCOUNTS", // Frontend can check this specific error code
          message: "⚠️ No tienes cuentas de publicidad conectadas",
          title: "Cuentas de publicidad requeridas",
          details: "Para crear campañas, primero debes conectar al menos una cuenta de publicidad.",
          action_required: "Conecta tus cuentas de publicidad",
          help_url: "/subscription/accounts",
          action_button_text: "Conectar cuentas ahora",
          show_popup: true, // Frontend can use this flag
        })
      }

      // Validate budget (must have daily OR lifetime, not both)
      if (body.budget_usd && body.lifetime_budget) {
        return reply.code(400).send({
          error: "Invalid budget",
          message: "Provide either budget_usd (daily) OR lifetime_budget, not both",
        })
      }

      if (!body.budget_usd && !body.lifetime_budget) {
        return reply.code(400).send({
          error: "Budget required",
          message: "Provide either budget_usd (daily) or lifetime_budget",
        })
      }

      const campaign = await createCampaign.execute({
        userId: user.id,
        plaiUserId: profile.plai_user_id,
        name: body.name,
        platforms: body.platforms,
        description: body.description,
        
        // Budget
        budgetUsd: body.budget_usd,
        lifetimeBudget: body.lifetime_budget,
        
        // Campaign Settings
        objective: body.objective,
        billingEvent: body.billing_event,
        bidStrategy: body.bid_strategy,
        status: body.status,
        specialAdCategories: body.special_ad_categories,
        
        // Dates
        startDate: body.start_date,
        endDate: body.end_date,
        
        // Platform-specific
        metaSettings: body.meta_settings,
        
        // Product pricing
        productPrice: body.product_price,
        productCost: body.product_cost,
      })

      return reply.code(201).send(campaign)
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al crear campaña",
      })
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
          const platforms = ['meta', 'google_ads', 'linkedin']
          const hasPlatformKeys = platforms.some(p => metrics && typeof metrics === 'object' && p in metrics)
          
          if (hasPlatformKeys) {
            // Per-platform structure - aggregate or use first platform for overview
            const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
            const firstPlatform = Object.keys(metrics)[0]
            const platformMetrics = (metrics as Record<string, any>)[firstPlatform]
            
            // If platform metrics are already calculated, use them directly
            // Otherwise, calculate from raw data if available
            if (campaign.raw_data_plai && typeof campaign.raw_data_plai === 'object') {
              const rawData = campaign.raw_data_plai[firstPlatform] || campaign.raw_data_plai
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

      // Otherwise, try to fetch from Plai
      if (campaign.mock_campaign_id) {
        try {
          let plaiCampaignIds: Record<string, string>
          try {
            plaiCampaignIds =
              typeof campaign.mock_campaign_id === "string"
                ? JSON.parse(campaign.mock_campaign_id)
                : campaign.mock_campaign_id
          } catch {
            // Legacy format - single campaign ID
            // Calculate from stored RAW data if available, otherwise fetch from Plai
            if (campaign.raw_data_plai) {
              const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
              const rawData = typeof campaign.raw_data_plai === 'string' 
                ? JSON.parse(campaign.raw_data_plai) 
                : campaign.raw_data_plai
              const calculated = MetricsCalculator.calculateFromRaw(rawData)
              return reply.send({
                id: campaign.id,
                name: campaign.name,
                metrics: calculated,
                synced: true,
                from_stored: true,
              })
            }
            
            const overview = await plaiApi.getCampaignOverview(campaign.mock_campaign_id as string)
            return reply.send({
              id: campaign.id,
              name: campaign.name,
              metrics: overview.metrics,
              synced: false,
            })
          }

          // Multi-platform format
          const allMetrics: Record<string, any> = {}
          if (campaign.raw_data_plai) {
            // Calculate from stored RAW data
            const { MetricsCalculator } = await import("@/application/services/MetricsCalculator")
            const rawData = typeof campaign.raw_data_plai === 'string' 
              ? JSON.parse(campaign.raw_data_plai) 
              : campaign.raw_data_plai
            
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
          }
          
          // Fallback: fetch from Plai
          for (const [platform, campaignId] of Object.entries(plaiCampaignIds)) {
            const overview = await plaiApi.getCampaignOverview(campaignId as string)
            allMetrics[platform] = overview.metrics
          }

          return reply.send({
            id: campaign.id,
            name: campaign.name,
            metrics: allMetrics,
            synced: false,
          })
        } catch (err: any) {
          req.log.error({ err }, "Error fetching metrics from Plai")
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

  // 🔄 Sincronizar métricas desde Plai
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
        platforms: ("meta" | "google_ads" | "linkedin")[]
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

      // Get plai_user_id for updates that need Plai sync
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plai_user_id")
        .eq("id", user.id)
        .maybeSingle()

      // Update local campaign
      const updated = await campaignsRepo.update(user.id, id, body)

      // If status is being updated and we have Plai campaign IDs, sync to Plai
      if (body.status && existingCampaign.mock_campaign_id && profile?.plai_user_id) {
        try {
          const statusMap: Record<string, "ACTIVE" | "PAUSED" | "ARCHIVED"> = {
            active: "ACTIVE",
            paused: "PAUSED",
            completed: "ARCHIVED",
          }
          const plaiStatus = statusMap[body.status] || "PAUSED"

          // Try to parse as JSON (multi-platform format)
          let plaiCampaignIds: Record<string, string> | null = null
          try {
            plaiCampaignIds =
              typeof existingCampaign.mock_campaign_id === "string"
                ? JSON.parse(existingCampaign.mock_campaign_id)
                : existingCampaign.mock_campaign_id
          } catch {
            // Legacy format - single campaign ID
            await plaiApi.updateCampaignStatus(
              profile.plai_user_id,
              existingCampaign.mock_campaign_id as string,
              plaiStatus
            )
            return reply.send(updated)
          }

          // Multi-platform format
          if (plaiCampaignIds) {
            for (const [platform, campaignId] of Object.entries(plaiCampaignIds)) {
              try {
                await plaiApi.updateCampaignStatus(
                  profile.plai_user_id,
                  campaignId as string,
                  plaiStatus
                )
              } catch (err: any) {
                req.log.error({ err }, `Failed to update status in ${platform}`)
              }
            }
          }
        } catch (err: any) {
          req.log.error({ err }, "Error syncing status to Plai")
          // Continue - local update succeeded
        }
      }

      // If budget is being updated, sync to Plai
      if (body.budget_usd !== undefined && existingCampaign.mock_campaign_id && profile?.plai_user_id) {
        try {
          // Try to parse as JSON (multi-platform format)
          let plaiCampaignIds: Record<string, string> | null = null
          try {
            plaiCampaignIds =
              typeof existingCampaign.mock_campaign_id === "string"
                ? JSON.parse(existingCampaign.mock_campaign_id)
                : existingCampaign.mock_campaign_id
          } catch {
            // Legacy format - single campaign ID
            await plaiApi.updateCampaignBudget(
              profile.plai_user_id,
              existingCampaign.mock_campaign_id as string,
              body.budget_usd
            )
            return reply.send(updated)
          }

          // Multi-platform format
          if (plaiCampaignIds) {
            for (const [platform, campaignId] of Object.entries(plaiCampaignIds)) {
              try {
                await plaiApi.updateCampaignBudget(
                  profile.plai_user_id,
                  campaignId as string,
                  body.budget_usd
                )
              } catch (err: any) {
                req.log.error({ err }, `Failed to update budget in ${platform}`)
              }
            }
          }
        } catch (err: any) {
          req.log.error({ err }, "Error syncing budget to Plai")
          // Continue - local update succeeded
        }
      }

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
  app.get("/dashboard/metrics", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const metrics = await getDashboardMetrics.execute(user.id)
      return reply.send(metrics)
    } catch (err: any) {
      req.log.error(err)
      return reply.code(500).send({
        error: err.message || "Error al obtener métricas del dashboard",
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
        platforms 
      } = req.query as { 
        days?: string
        campaign_ids?: string // Comma-separated campaign IDs
        platforms?: string // Comma-separated platforms (meta,google_ads,linkedin)
      }

      // Calculate date range
      const daysBack = parseInt(days) || 30
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - daysBack)
      startDate.setHours(0, 0, 0, 0)

      // Get all campaigns for the user
      let campaigns = await campaignsRepo.listByUser(user.id)
      
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
}
