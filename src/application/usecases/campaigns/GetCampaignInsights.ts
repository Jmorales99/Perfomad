import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"
import { MetricsCalculator } from "@/application/services/MetricsCalculator"

export class GetCampaignInsights {
  constructor(
    private campaignsRepo: SupabaseCampaignsRepository,
    private metricsHistoryRepo: CampaignMetricsHistoryRepository,
    private plaiApi: PlaiApiClient
  ) {}

  async execute(userId: string, campaignId: string, useStoredData: boolean = true) {
    // 1. Get campaign from database
    const campaign = await this.campaignsRepo.findById(userId, campaignId)

    if (!campaign) {
      throw new Error("Campaign not found")
    }

    console.log("GetCampaignInsights: Campaign found", { campaignId, hasMockStats: !!campaign.mock_stats, hasMockCampaignId: !!campaign.mock_campaign_id })

    // 2. Try to use stored insights first (if enabled and available)
    if (useStoredData) {
      const storedInsights = await this.metricsHistoryRepo.getInsights(campaignId)
      
      if (storedInsights && !storedInsights.is_stale) {
        // Check if insights are fresh (less than 24 hours old)
        const isStale = await this.metricsHistoryRepo.areInsightsStale(campaignId, 24)
        
        if (!isStale) {
          // Ensure insights_data is not null or empty - if it is, regenerate it
          const insights = (storedInsights.insights_data && Object.keys(storedInsights.insights_data).length > 0) 
            ? storedInsights.insights_data 
            : this.generateInsightsData(campaign)
          
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            insights: insights,
            recommendations: storedInsights.recommendations || this.generateMockRecommendations(campaign),
            data_source: storedInsights.data_source,
            from_cache: true,
          }
        }
      }
    }

    // 3. If no stored insights or stale, fetch from Plai
    if (campaign.mock_campaign_id) {
      try {
        // Parse Plai campaign IDs (stored as JSON)
        let plaiCampaignIds: Record<string, string>
        try {
          plaiCampaignIds =
            typeof campaign.mock_campaign_id === "string"
              ? JSON.parse(campaign.mock_campaign_id)
              : campaign.mock_campaign_id
        } catch {
          // Legacy format - single campaign ID
          const insights = await this.plaiApi.getCampaignInsights({
            userId,
            campaignId: campaign.mock_campaign_id as string,
          })
          
          const recommendations = this.generateRecommendations(campaign, insights)
          
          // Store insights for future use
          await this.metricsHistoryRepo.storeInsights({
            campaign_id: campaignId,
            insights_data: insights,
            recommendations,
            data_source: "plai_api",
            is_stale: false,
          })
          
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            insights,
            recommendations,
            data_source: "plai_api",
            from_cache: false,
          }
        }

        // Multi-platform format - get insights for first platform (or aggregate)
        const firstPlatform = Object.keys(plaiCampaignIds)[0]
        const firstCampaignId = plaiCampaignIds[firstPlatform]

        const insights = await this.plaiApi.getCampaignInsights({
          userId,
          campaignId: firstCampaignId,
        })

        const recommendations = this.generateRecommendations(campaign, insights)
        
        // Store insights for future use
        await this.metricsHistoryRepo.storeInsights({
          campaign_id: campaignId,
          insights_data: insights,
          recommendations,
          data_source: "plai_api",
          is_stale: false,
        })

        return {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          insights,
          recommendations,
          data_source: "plai_api",
          from_cache: false,
        }
      } catch (error: any) {
        // If Plai API fails, try to use stored insights even if stale
        const storedInsights = await this.metricsHistoryRepo.getInsights(campaignId)
        if (storedInsights) {
          // Ensure insights_data is not null or empty - if it is, regenerate it
          const insights = (storedInsights.insights_data && Object.keys(storedInsights.insights_data).length > 0) 
            ? storedInsights.insights_data 
            : this.generateInsightsData(campaign)
          
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            insights: insights,
            recommendations: storedInsights.recommendations || this.generateMockRecommendations(campaign),
            data_source: storedInsights.data_source,
            from_cache: true,
            note: "Using cached data - Plai API unavailable",
          }
        }
        
        // Fallback to mock recommendations based on local data
        const mockRecommendations = this.generateMockRecommendations(campaign)
        
        // Generate insights data from campaign's stored metrics
        const insightsData = this.generateInsightsData(campaign)
        
        // Store calculated insights for offline access (wrap in try-catch so it doesn't fail the whole request)
        try {
          await this.metricsHistoryRepo.storeInsights({
            campaign_id: campaignId,
            insights_data: insightsData, // Include actual metrics data
            recommendations: mockRecommendations,
            data_source: "calculated",
            is_stale: true,
          })
        } catch (storeError) {
          console.error("Error storing insights:", storeError)
          // Continue - return insights even if storage failed
        }
        
        return {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          insights: insightsData, // Return the generated insights data
          recommendations: mockRecommendations,
          data_source: "calculated",
          from_cache: false,
          note: "Generated from local data - Plai API unavailable",
        }
      }
    }

    // 4. If no Plai campaign ID, use stored insights or generate mock recommendations
    const storedInsights = await this.metricsHistoryRepo.getInsights(campaignId)
    if (storedInsights) {
      // Ensure insights_data is not null or empty - if it is, regenerate it
      const insights = (storedInsights.insights_data && Object.keys(storedInsights.insights_data).length > 0) 
        ? storedInsights.insights_data 
        : this.generateInsightsData(campaign)
      
      return {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        insights: insights,
        recommendations: storedInsights.recommendations || this.generateMockRecommendations(campaign),
        data_source: storedInsights.data_source,
        from_cache: true,
      }
    }
    
    const mockRecommendations = this.generateMockRecommendations(campaign)
    
    // Generate insights data from campaign's stored metrics
    const insightsData = this.generateInsightsData(campaign)
    
    // Store calculated insights
    await this.metricsHistoryRepo.storeInsights({
      campaign_id: campaignId,
      insights_data: insightsData, // Include actual metrics data
      recommendations: mockRecommendations,
      data_source: "calculated",
      is_stale: false,
    })
    
    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      insights: insightsData, // Return the generated insights data
      recommendations: mockRecommendations,
      data_source: "calculated",
      from_cache: false,
    }
  }

  private generateRecommendations(campaign: any, insights: any): any[] {
    const recommendations: any[] = []

    // Try to get calculated metrics from stored raw data first
    let calculatedMetrics: any = null
    
    // Option 1: Calculate from stored raw_data_plai if available
    if (campaign.raw_data_plai) {
      try {
        const rawData = typeof campaign.raw_data_plai === 'string' 
          ? JSON.parse(campaign.raw_data_plai) 
          : campaign.raw_data_plai
        
        // If multi-platform, aggregate or use first platform
        if (typeof rawData === 'object' && !Array.isArray(rawData)) {
          const firstPlatform = Object.keys(rawData)[0]
          calculatedMetrics = MetricsCalculator.calculateFromRaw(rawData[firstPlatform])
        } else {
          calculatedMetrics = MetricsCalculator.calculateFromRaw(rawData)
        }
      } catch (error) {
        console.error("Error calculating from raw_data_plai:", error)
      }
    }
    
    // Option 2: Use insights stats
    if (!calculatedMetrics) {
      const stats = insights?.stats || insights || {}
      calculatedMetrics = MetricsCalculator.calculateFromRaw({
        spend: stats?.spend || campaign.spend_usd || 0,
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
      revenue,
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

    if (campaign.budget_usd > 0 && spend / campaign.budget_usd > 0.9) {
      recommendations.push({
        type: "budget_high",
        priority: "medium",
        title: "Presupuesto casi agotado",
        description: `Has gastado ${((spend / campaign.budget_usd) * 100).toFixed(0)}% de tu presupuesto. La campaña podría detenerse pronto.`,
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

  private generateMockRecommendations(campaign: any): any[] {
    const recommendations: any[] = []

    // Generate mock metrics based on campaign ID for analysis
    const mockStats = this.generateMockStats(campaign.id, campaign)
    const ctr = mockStats.ctr
    const cpc = mockStats.cost_per_click
    const spend = campaign.spend_usd || mockStats.spend
    const budget = campaign.budget_usd || 1000

    // Analyze mock metrics and generate recommendations
    if (ctr < 0.02) {
      recommendations.push({
        type: "ctr_low",
        priority: "high",
        title: "CTR bajo detectado",
        description: `Tu CTR actual es ${(ctr * 100).toFixed(2)}%, por debajo del promedio de la industria. Considera mejorar tus creatividades o ajustar tu targeting.`,
        action: "Mejorar creatividades y ajustar targeting",
        impact: "Alto impacto en el rendimiento",
        estimatedImprovement: "Aumentar CTR podría mejorar el ROI en un 15-25%",
      })
    }

    if (cpc > 2) {
      recommendations.push({
        type: "cpc_high",
        priority: "medium",
        title: "Costo por clic elevado",
        description: `Tu CPC es $${cpc.toFixed(2)}. Considera optimizar tus pujas o mejorar la relevancia de tus anuncios.`,
        action: "Optimizar pujas",
        impact: "Impacto medio en costos",
        estimatedImprovement: "Reducir CPC podría ahorrar hasta un 30% en costos",
      })
    }

    if (budget > 0 && spend / budget > 0.8) {
      recommendations.push({
        type: "budget_high",
        priority: "medium",
        title: "Presupuesto casi agotado",
        description: `Has gastado ${((spend / budget) * 100).toFixed(0)}% de tu presupuesto.`,
        action: "Revisar presupuesto",
        impact: "Impacto medio en continuidad",
        estimatedImprovement: "Aumentar presupuesto permitiría continuar generando resultados",
      })
    }

    if (campaign.status === "paused") {
      recommendations.push({
        type: "campaign_paused",
        priority: "low",
        title: "Campaña pausada",
        description: "Tu campaña está pausada. Reactívala cuando estés listo para continuar.",
        action: "Reactivar campaña",
        impact: "Mantenimiento",
        estimatedImprovement: "Reactivar la campaña reanudará la generación de resultados",
      })
    }

    return recommendations.length > 0
      ? recommendations
      : [
          {
            type: "performance_good",
            priority: "low",
            title: "Rendimiento estable",
            description: "Tu campaña está funcionando bien. Continúa monitoreando las métricas.",
            action: "Mantener estrategia actual",
            impact: "Mantenimiento",
            estimatedImprovement: "Pequeños ajustes podrían mejorar el rendimiento",
          },
        ]
  }

  // Generate consistent mock stats based on campaign ID
  private generateMockStats(campaignId: string, campaign?: any) {
    let hash = 0
    for (let i = 0; i < campaignId.length; i++) {
      const char = campaignId.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    const seed = Math.abs(hash) / 2147483647

    const conversions = Math.floor(seed * 100) + 5
    const spend = Number((seed * 1000).toFixed(2))
    
    // Calculate revenue ONLY if product_price is provided (real data from user)
    // DO NOT invent revenue - it should come from API or user input
    let revenue = 0
    let totalSales = 0
    if (campaign?.product_price && conversions > 0) {
      revenue = Number((conversions * campaign.product_price).toFixed(2))
      totalSales = revenue
    }
    
    // Calculate profit if product_cost is also provided
    let profit: number | undefined = undefined
    if (campaign?.product_cost !== undefined && conversions > 0 && revenue > 0) {
      const totalProductCost = conversions * campaign.product_cost
      profit = revenue - totalProductCost
    }
    
    // Calculate CPA (Cost Per Acquisition)
    const cpa = conversions > 0 ? Number((spend / conversions).toFixed(2)) : undefined
    
    // Calculate ROA (Return on Advertising)
    // If profit is available, use profit-based ROA (more accurate)
    // Otherwise, use revenue-based ROA if revenue exists
    let roa: number | undefined = undefined
    if (spend > 0) {
      if (profit !== undefined) {
        roa = Number((profit / spend).toFixed(2))
      } else if (revenue > 0) {
        roa = Number((revenue / spend).toFixed(2))
      }
    }

    return {
      impressions: Math.floor(seed * 50000) + 1000,
      clicks: Math.floor(seed * 2000) + 50,
      ctr: Number((seed * 5).toFixed(4)) / 100, // CTR as decimal (0.05 = 5%)
      spend,
      conversions,
      revenue,
      total_sales: totalSales,
      cpa,
      roa,
      cost_per_click: Number((seed * 3).toFixed(2)),
      cost_per_conversion: cpa,
      reach: Math.floor(seed * 30000) + 5000,
      cpm: Number((seed * 10 + 2).toFixed(2)),
    }
  }

  // Generate insights data object from campaign metrics
  private generateInsightsData(campaign: any): any {
    // Get metrics from mock_stats (could be per-platform or flat)
    let stats = campaign.mock_stats
    if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
      // Check if it's per-platform structure
      const platforms = ['meta', 'google_ads', 'linkedin']
      const hasPlatformKeys = platforms.some(p => stats && typeof stats === 'object' && p in stats)
      
      if (hasPlatformKeys) {
        // Per-platform - use first platform or aggregate
        const firstPlatform = Object.keys(stats)[0]
        stats = (stats as Record<string, any>)[firstPlatform] || {}
      }
    }

    // Build comprehensive insights data object
    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      platform: campaign.platforms?.[0] || 'unknown',
      status: campaign.status,
      
      // Metrics from campaign
      stats: stats || {
        spend: campaign.spend_usd || 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
      },
      
      // Budget information
      budget: {
        daily: campaign.budget_usd || 0,
        lifetime: campaign.lifetime_budget || null,
        spent: campaign.spend_usd || 0,
        remaining: (campaign.budget_usd || 0) - (campaign.spend_usd || 0),
        utilization_percent: campaign.budget_usd > 0 
          ? ((campaign.spend_usd || 0) / campaign.budget_usd * 100).toFixed(2)
          : 0,
      },
      
      // Campaign settings
      settings: {
        objective: campaign.objective || 'OUTCOME_TRAFFIC',
        billing_event: campaign.billing_event || 'IMPRESSIONS',
        bid_strategy: campaign.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
        status: campaign.status,
        special_ad_categories: campaign.special_ad_categories || [],
      },
      
      // Performance indicators
      performance: {
        is_active: campaign.status === 'active',
        has_budget_remaining: (campaign.budget_usd || 0) > (campaign.spend_usd || 0),
        efficiency_score: this.calculateEfficiencyScore(stats),
      },
      
      // Dates
      dates: {
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        created_at: campaign.created_at,
        last_synced_at: campaign.last_synced_at,
      },
      
      // Timestamp
      calculated_at: new Date().toISOString(),
    }
  }

  // Calculate an efficiency score (0-100) based on metrics
  private calculateEfficiencyScore(stats: any): number {
    if (!stats || typeof stats !== 'object') return 50 // Default middle score

    let score = 50 // Start at 50 (neutral)

    // CTR scoring (good CTR is 2-5%)
    if (stats.ctr !== undefined) {
      const ctrPercent = typeof stats.ctr === 'number' && stats.ctr < 1 
        ? stats.ctr * 100 
        : stats.ctr
      if (ctrPercent >= 2 && ctrPercent <= 5) {
        score += 15 // Good CTR
      } else if (ctrPercent < 1) {
        score -= 20 // Low CTR
      }
    }

    // CPC scoring (lower is better, but depends on industry)
    if (stats.cost_per_click !== undefined && stats.cost_per_click > 0) {
      if (stats.cost_per_click < 1) {
        score += 10 // Very efficient CPC
      } else if (stats.cost_per_click > 3) {
        score -= 15 // High CPC
      }
    }

    // ROA scoring (higher is better)
    if (stats.roa !== undefined && stats.roa > 0) {
      if (stats.roa >= 3) {
        score += 20 // Excellent ROA
      } else if (stats.roa >= 2) {
        score += 10 // Good ROA
      } else if (stats.roa < 1) {
        score -= 25 // Losing money
      }
    }

    // CPA scoring (lower is better)
    if (stats.cpa !== undefined && stats.cpa > 0) {
      if (stats.cpa < 20) {
        score += 10 // Good CPA
      } else if (stats.cpa > 50) {
        score -= 15 // High CPA
      }
    }

    // Ensure score stays within 0-100 range
    return Math.max(0, Math.min(100, Math.round(score)))
  }
}

