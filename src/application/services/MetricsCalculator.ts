/**
 * MetricsCalculator - Independent service that calculates metrics from raw data
 * This works with ANY data source (Plai, Meta, Google Ads, etc.)
 * Just provide raw data and it calculates all metrics
 */

export interface RawMetricsData {
  // Core metrics from any source
  spend?: number
  impressions?: number
  clicks?: number
  ctr?: number // Can be percentage (2.5) or decimal (0.025)
  
  // Conversion metrics
  conversions?: number
  revenue?: number
  total_sales?: number
  
  // Optional pre-calculated (will be recalculated if provided)
  cost_per_click?: number
  cost_per_conversion?: number
  cpm?: number
  reach?: number
}

export interface CalculatedMetrics {
  // Core metrics
  spend: number
  impressions: number
  clicks: number
  ctr: number // Always in decimal format (0.025 = 2.5%)
  
  // Conversion metrics
  conversions: number
  revenue: number
  total_sales: number
  profit?: number // Revenue - (conversions × product_cost), if product_cost is available
  
  // Calculated metrics
  cpa?: number // Cost Per Acquisition
  roa?: number // Return on Advertising (profit / spend if profit available, otherwise revenue / spend)
  cost_per_click?: number
  cost_per_conversion?: number
  cpm?: number // Cost Per 1000 Impressions
  reach?: number
  conversion_rate?: number // Percentage (0-100)
}

export interface ROACalculationOptions {
  product_price?: number // Selling price per unit
  product_cost?: number // Production cost per unit
}

export class MetricsCalculator {
  /**
   * Calculate all metrics from raw data
   * This is the ONLY place where calculations happen
   * Works with data from Plai, Meta, Google Ads, or any other source
   * 
   * @param rawData Raw metrics data from API
   * @param options Optional: product pricing for accurate ROA calculation
   */
  static calculateFromRaw(
    rawData: RawMetricsData,
    options?: ROACalculationOptions
  ): CalculatedMetrics {
    // Normalize inputs (handle missing values)
    const spend = rawData.spend || 0
    const impressions = rawData.impressions || 0
    const clicks = rawData.clicks || 0
    const conversions = rawData.conversions || 0
    
    // Calculate revenue: Prioritize API revenue (real data), then user-provided product_price
    // NEVER invent revenue data - only use what's provided
    let revenue = 0
    let totalSales = 0
    
    // Priority 1: Use revenue from API if available (real tracked data)
    if (rawData.revenue || rawData.total_sales) {
      revenue = rawData.revenue || rawData.total_sales || 0
      totalSales = rawData.total_sales || revenue || 0
    }
    // Priority 2: Calculate from user-provided product_price (if no API revenue)
    // This is still "real" because the user knows their product price
    else if (options?.product_price && conversions > 0) {
      revenue = conversions * options.product_price
      totalSales = revenue
    }
    // If neither exists, revenue stays 0 (we don't invent data)
    
    // Calculate profit if product_cost is provided
    let profit: number | undefined = undefined
    if (options?.product_cost !== undefined && conversions > 0) {
      const totalProductCost = conversions * options.product_cost
      profit = revenue - totalProductCost
    }
    
    // Normalize CTR (can come as percentage 2.5 or decimal 0.025)
    let ctr = rawData.ctr || 0
    if (ctr > 1) {
      // Assume it's a percentage, convert to decimal
      ctr = ctr / 100
    }
    
    // Calculate CPA (Cost Per Acquisition)
    const cpa = conversions > 0 ? spend / conversions : undefined
    
    // Calculate ROAS/ROA (Return on Ad Spend / Return on Advertising)
    // 
    // Two options:
    // 1. ROAS (Return on Ad Spend) = Revenue / Ad Spend
    //    - Measures: "For every $1 spent, I generated $X in sales"
    //    - Does NOT require product cost
    //    - This is what most ad platforms (Meta, Google Ads) show
    //
    // 2. ROA based on Profit = (Revenue - Product Costs) / Ad Spend  
    //    - Measures: "For every $1 spent, I generated $X in net profit"
    //    - REQUIRES product_cost to be accurate
    //    - More accurate for business profitability
    //
    // Priority: If profit is available (product_cost provided), use profit-based ROA
    //           Otherwise, use ROAS (revenue-based) - still useful and doesn't require product cost
    let roa: number | undefined = undefined
    if (spend > 0) {
      if (profit !== undefined && profit >= 0) {
        // ROA based on profit: (Revenue - Product Costs) / Ad Spend
        // This is TRUE profitability - what you actually earned after product costs
        roa = profit / spend
      } else if (revenue > 0) {
        // ROAS (Return on Ad Spend): Revenue / Ad Spend
        // This is what Meta/Google show - revenue generated per dollar spent
        // Still useful even without product cost
        roa = revenue / spend
      }
      // If no revenue and no profit, ROA stays undefined (can't calculate without data)
    }
    
    // Calculate CPC (Cost Per Click)
    const costPerClick = clicks > 0 ? spend / clicks : undefined
    
    // Calculate Cost Per Conversion (same as CPA)
    const costPerConversion = cpa
    
    // Calculate CPM (Cost Per 1000 Impressions)
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : undefined
    
    // Calculate Conversion Rate (percentage)
    const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0
    
    // Use reach if provided, otherwise undefined
    const reach = rawData.reach || undefined

    return {
      spend,
      impressions,
      clicks,
      ctr, // Always in decimal format
      conversions,
      revenue,
      total_sales: totalSales,
      profit,
      cpa,
      roa,
      cost_per_click: costPerClick,
      cost_per_conversion: costPerConversion,
      cpm,
      reach,
      conversion_rate: conversionRate,
    }
  }

  /**
   * Calculate metrics from stored raw data (from database)
   */
  static calculateFromStored(
    rawDataJson: any,
    options?: ROACalculationOptions
  ): CalculatedMetrics {
    // Handle if rawDataJson is already parsed or a string
    const rawData: RawMetricsData = 
      typeof rawDataJson === 'string' 
        ? JSON.parse(rawDataJson) 
        : rawDataJson

    return this.calculateFromRaw(rawData, options)
  }

  /**
   * Aggregate metrics from multiple platforms
   */
  static aggregateMetrics(platformMetrics: CalculatedMetrics[]): CalculatedMetrics {
    const aggregated: CalculatedMetrics = {
      spend: 0,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      conversions: 0,
      revenue: 0,
      total_sales: 0,
    }

    // Sum all metrics
    platformMetrics.forEach((metrics) => {
      aggregated.spend += metrics.spend || 0
      aggregated.impressions += metrics.impressions || 0
      aggregated.clicks += metrics.clicks || 0
      aggregated.conversions += metrics.conversions || 0
      aggregated.revenue += metrics.revenue || 0
      aggregated.total_sales += metrics.total_sales || 0
    })

    // Recalculate derived metrics from aggregated totals
    aggregated.ctr = aggregated.impressions > 0 
      ? aggregated.clicks / aggregated.impressions 
      : 0

    aggregated.cpa = aggregated.conversions > 0 
      ? aggregated.spend / aggregated.conversions 
      : undefined

    aggregated.roa = aggregated.spend > 0 
      ? aggregated.revenue / aggregated.spend 
      : undefined

    aggregated.cost_per_click = aggregated.clicks > 0 
      ? aggregated.spend / aggregated.clicks 
      : undefined

    aggregated.cost_per_conversion = aggregated.cpa

    aggregated.cpm = aggregated.impressions > 0 
      ? (aggregated.spend / aggregated.impressions) * 1000 
      : undefined

    aggregated.conversion_rate = aggregated.clicks > 0 
      ? (aggregated.conversions / aggregated.clicks) * 100 
      : 0

    return aggregated
  }
}

