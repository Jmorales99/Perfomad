import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { MetricsCalculator } from "@/application/services/MetricsCalculator"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export class GetCampaignInsights {
  private tokenManager: TokenManager
  private auditLogger: AuditLogger
  private adAccountsRepo: SupabaseAdAccountsRepository

  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private metricsHistoryRepo: CampaignMetricsHistoryRepository
  ) {
    this.tokenManager = new TokenManager()
    this.auditLogger = new AuditLogger()
    this.adAccountsRepo = new SupabaseAdAccountsRepository()
  }

  async execute(userId: string, campaignId: string, useStoredData: boolean = true) {
    // 1. Get campaign from database
    const campaign = await this.campaignsRepo.findById(userId, campaignId)

    if (!campaign) {
      throw new Error("Campaign not found")
    }

    console.log("GetCampaignInsights: Campaign found", { campaignId, hasMockStats: !!campaign.cached_metrics })

    // 2. Try to use stored insights first (if enabled and available)
    if (useStoredData) {
      const storedInsights = await this.metricsHistoryRepo.getInsights(campaignId)

      if (storedInsights && !storedInsights.is_stale) {
        const isStale = await this.metricsHistoryRepo.areInsightsStale(campaignId, 24)

        if (!isStale) {
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            insights: storedInsights.insights_data || null,
            recommendations: storedInsights.recommendations || [],
            data_source: storedInsights.data_source,
            from_cache: true,
          }
        }
      }
    }

    // 3. If no stored insights or stale, fetch from platform APIs
    const campaignIdField = (campaign as any).platform_campaign_id

    if (campaignIdField) {
      try {
        // Parse platform campaign IDs (stored as JSON)
        let platformCampaignIds: Record<string, string>
        try {
          platformCampaignIds =
            typeof campaignIdField === "string"
              ? JSON.parse(campaignIdField)
              : campaignIdField
        } catch {
          throw new Error("Invalid platform campaign IDs format")
        }

        // Get user's ad accounts for token access
        const adAccounts = await this.adAccountsRepo.findByUserId(userId)
        const adAccountsByPlatform = new Map<Platform, typeof adAccounts[0]>()
        for (const account of adAccounts) {
          adAccountsByPlatform.set(account.platform, account)
        }

        // Get insights from first platform (or could aggregate)
        const firstPlatform = Object.keys(platformCampaignIds)[0] as Platform
        const firstCampaignId = platformCampaignIds[firstPlatform]

        // Get ad account for this platform
        const adAccount = adAccountsByPlatform.get(firstPlatform)
        if (!adAccount) {
          throw new Error(`No ad account found for platform ${firstPlatform}`)
        }

        // Get platform client
        const client = PlatformApiClientFactory.createClient(firstPlatform)

        // Get valid access token
        const accessToken = await this.tokenManager.getValidAccessToken(
          adAccount as any,
          async (refreshToken: string) => {
            return await client.refreshAccessToken(refreshToken)
          }
        )

        // Fetch insights from platform API
        const platformInsights = await client.getCampaignInsights(
          firstCampaignId,
          accessToken,
          undefined, // dateRange - could be passed as parameter
          { platformAccountId: adAccount.platform_account_id }
        )

        // Format insights data
        const insights = {
          platform: firstPlatform,
          insights: platformInsights.insights || [],
          raw: platformInsights.raw || platformInsights,
        }

        const recommendations = this.generateRecommendations(campaign, insights)
        
        // Store insights for future use
        await this.metricsHistoryRepo.storeInsights({
          campaign_id: campaignId,
          insights_data: insights,
          recommendations,
          data_source: "platform_api",
          is_stale: false,
        })

        // Log successful fetch
        await this.auditLogger.logPlatformApiCall(
          firstPlatform,
          "getCampaignInsights",
          true,
          userId,
          adAccount.id
        )

        return {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          insights,
          recommendations,
          data_source: "platform_api",
          from_cache: false,
        }
      } catch (error: any) {
        // Platform API failed — fall back to stale cached insights if available
        const storedInsights = await this.metricsHistoryRepo.getInsights(campaignId)
        if (storedInsights) {
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            insights: storedInsights.insights_data || null,
            recommendations: storedInsights.recommendations || [],
            data_source: storedInsights.data_source,
            from_cache: true,
            note: "Using cached data - Platform API unavailable",
          }
        }

        return {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          insights: null,
          recommendations: [],
          data_source: "no_data",
          from_cache: false,
          note: "No hay datos disponibles. La API de la plataforma no responde y no hay datos en caché.",
        }
      }
    }

    // 4. No platform campaign ID — return stored insights or no_data
    const storedInsights = await this.metricsHistoryRepo.getInsights(campaignId)
    if (storedInsights) {
      return {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        insights: storedInsights.insights_data || null,
        recommendations: storedInsights.recommendations || [],
        data_source: storedInsights.data_source,
        from_cache: true,
      }
    }

    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      insights: null,
      recommendations: [],
      data_source: "no_data",
      from_cache: false,
      note: "No hay datos disponibles. Sincroniza la campaña para obtener métricas.",
    }
  }

  private generateRecommendations(campaign: any, insights: any): any[] {
    const recommendations: any[] = []

    // Try to get calculated metrics from stored raw data first
    let calculatedMetrics: any = null
    
    const rawDataField = (campaign as any).raw_data_platform
    if (rawDataField) {
      try {
        const rawData = typeof rawDataField === 'string' 
          ? JSON.parse(rawDataField) 
          : rawDataField
        
        // If multi-platform, aggregate or use first platform
        if (typeof rawData === 'object' && !Array.isArray(rawData)) {
          const firstPlatform = Object.keys(rawData)[0]
          calculatedMetrics = MetricsCalculator.calculateFromRaw(rawData[firstPlatform])
        } else {
          calculatedMetrics = MetricsCalculator.calculateFromRaw(rawData)
        }
      } catch (error) {
        console.error("Error calculating from raw_data_platform:", error)
      }
    }
    
    // Option 2: Use insights stats
    if (!calculatedMetrics) {
      const stats = insights?.stats || insights || {}
      calculatedMetrics = MetricsCalculator.calculateFromRaw({
        spend: stats?.spend || (campaign as any).spend_amount || 0,
        impressions: stats?.impressions || 0,
        clicks: stats?.clicks || 0,
        ctr: stats?.ctr || 0,
        conversions: stats?.conversions || 0,
        revenue: stats?.revenue || stats?.total_sales || 0,
        total_sales: stats?.total_sales || stats?.revenue || 0,
        reach: stats?.reach || 0,
      })
    }

    // Use calculated metrics
    const {
      spend,
      clicks,
      impressions,
      ctr,
      conversions,
      cpa,
      roa,
      cost_per_click: cpc,
      cpm,
      reach,
      conversion_rate: conversionRate,
    } = calculatedMetrics

    const qualityRanking = insights?.stats?.quality_ranking || insights?.quality_ranking || "AVERAGE"
    const conversionRateRanking = insights?.stats?.conversion_rate_ranking || insights?.conversion_rate_ranking || "AVERAGE"

    // High Priority Recommendations
    if (ctr < 0.02 && impressions > 1000) {
      recommendations.push({
        type: "ctr_low",
        priority: "high",
        title: "CTR bajo detectado",
        description: `Tu CTR actual es ${(ctr * 100).toFixed(2)}%, por debajo del promedio de la industria (2-3%). Esto indica que tus anuncios no están atrayendo suficiente atención.`,
        action: "Mejorar creatividades y ajustar targeting",
        impact: "Alto impacto en el rendimiento",
        estimatedImprovement: "Aumentar CTR podría mejorar el ROI en un 15-25%",
      })
    }

    if (cpc > 2 && clicks > 50) {
      recommendations.push({
        type: "cpc_high",
        priority: "high",
        title: "Costo por clic elevado",
        description: `Tu CPC promedio es $${cpc.toFixed(2)}, lo cual es superior al promedio. Esto puede estar reduciendo tu ROI.`,
        action: "Optimizar pujas y mejorar relevancia del anuncio",
        impact: "Alto impacto en costos",
        estimatedImprovement: "Reducir CPC podría ahorrar hasta un 30% en costos",
      })
    }

    if (conversionRate < 1 && conversions > 0) {
      recommendations.push({
        type: "conversion_rate_low",
        priority: "high",
        title: "Tasa de conversión baja",
        description: `Tu tasa de conversión es ${conversionRate.toFixed(2)}%, lo cual está por debajo del promedio. Solo ${conversions} de ${clicks} clics resultaron en conversiones.`,
        action: "Optimizar landing page y mejorar relevancia del mensaje",
        impact: "Alto impacto en ROI",
        estimatedImprovement: "Mejorar la tasa de conversión podría duplicar tus resultados",
      })
    }

    // CPA recommendations
    if (cpa !== undefined && cpa > 50 && conversions > 0) {
      recommendations.push({
        type: "cpa_high",
        priority: "high",
        title: "Costo por adquisición (CPA) elevado",
        description: `Tu CPA es $${cpa.toFixed(2)}, lo cual está por encima del promedio. Esto significa que cada conversión te está costando más de lo deseable.`,
        action: "Optimizar targeting y mejorar calidad del anuncio para reducir costos",
        impact: "Alto impacto en rentabilidad",
        estimatedImprovement: "Reducir CPA podría mejorar la rentabilidad en un 20-40%",
      })
    }

    // ROA recommendations
    if (roa !== undefined) {
      if (roa < 1) {
        recommendations.push({
          type: "roa_low",
          priority: "high",
          title: "ROA (Retorno sobre Publicidad) bajo",
          description: `Tu ROA es ${roa.toFixed(2)}, lo que significa que estás generando $${roa.toFixed(2)} por cada $1 invertido. Un ROA menor a 1 indica pérdidas.`,
          action: "Revisar estrategia de campaña, mejorar targeting o ajustar presupuesto",
          impact: "Alto impacto en rentabilidad",
          estimatedImprovement: "Mejorar ROA a 2-3x aumentaría significativamente las ganancias",
        })
      } else if (roa >= 3) {
        recommendations.push({
          type: "roa_excellent",
          priority: "low",
          title: "ROA excelente",
          description: `Tu ROA es ${roa.toFixed(2)}, lo que significa que estás generando $${roa.toFixed(2)} por cada $1 invertido. ¡Excelente rendimiento!`,
          action: "Considera aumentar el presupuesto para escalar estos resultados",
          impact: "Oportunidad de crecimiento",
          estimatedImprovement: "Aumentar presupuesto podría multiplicar los ingresos",
        })
      }
    }

    // Medium Priority Recommendations
    if (cpm > 15 && impressions > 5000) {
      recommendations.push({
        type: "cpm_high",
        priority: "medium",
        title: "CPM elevado",
        description: `Tu CPM es $${cpm.toFixed(2)}, lo cual es superior al promedio. Esto significa que estás pagando más por cada 1000 impresiones.`,
        action: "Refinar audiencia y mejorar relevancia del anuncio",
        impact: "Impacto medio en costos",
        estimatedImprovement: "Reducir CPM podría mejorar la eficiencia en un 20%",
      })
    }

    if ((campaign as any).budget_amount > 0 && spend / (campaign as any).budget_amount > 0.9) {
      recommendations.push({
        type: "budget_high",
        priority: "medium",
        title: "Presupuesto casi agotado",
        description: `Has gastado ${((spend / (campaign as any).budget_amount) * 100).toFixed(0)}% de tu presupuesto. La campaña podría detenerse pronto.`,
        action: "Aumentar presupuesto o pausar campaña",
        impact: "Impacto medio en continuidad",
        estimatedImprovement: "Aumentar presupuesto permitiría continuar generando resultados",
      })
    }

    if (qualityRanking === "BELOW_AVERAGE") {
      recommendations.push({
        type: "quality_low",
        priority: "medium",
        title: "Calidad del anuncio por debajo del promedio",
        description: `La calidad de tu anuncio está clasificada como "Por debajo del promedio". Esto puede estar afectando tu alcance y costos.`,
        action: "Mejorar relevancia del anuncio y experiencia del usuario",
        impact: "Impacto medio en alcance y costos",
        estimatedImprovement: "Mejorar la calidad podría reducir costos en un 15-20%",
      })
    }

    if (reach > 0 && impressions / reach > 3) {
      recommendations.push({
        type: "frequency_high",
        priority: "medium",
        title: "Frecuencia de visualización alta",
        description: `Estás mostrando el anuncio ${(impressions / reach).toFixed(1)} veces en promedio a cada persona. Una frecuencia alta puede causar fatiga del anuncio.`,
        action: "Rotar creatividades o ajustar audiencia",
        impact: "Impacto medio en engagement",
        estimatedImprovement: "Reducir frecuencia podría mejorar el CTR",
      })
    }

    // Low Priority / Positive Recommendations
    if (conversionRateRanking === "ABOVE_AVERAGE" && qualityRanking === "ABOVE_AVERAGE") {
      recommendations.push({
        type: "performance_excellent",
        priority: "low",
        title: "Rendimiento excelente",
        description: `Tu campaña está funcionando muy bien. Tanto la calidad como la tasa de conversión están por encima del promedio.`,
        action: "Considera aumentar el presupuesto para escalar resultados",
        impact: "Oportunidad de crecimiento",
        estimatedImprovement: "Aumentar presupuesto podría multiplicar tus resultados",
      })
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: "performance_good",
        priority: "low",
        title: "Rendimiento estable",
        description: "Tu campaña está funcionando bien. Continúa monitoreando las métricas y ajusta según sea necesario.",
        action: "Mantener estrategia actual y monitorear",
        impact: "Mantenimiento",
        estimatedImprovement: "Pequeños ajustes podrían mejorar el rendimiento",
      })
    }

    return recommendations
  }

}

