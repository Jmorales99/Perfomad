import axios, { AxiosInstance } from "axios"

export interface PlaiProfile {
  id: string
  email: string
  name: string
}

export interface PlaiConnectedAccount {
  id: string
  name: string
  platform: string
  accountId?: string
  currency?: string
  [key: string]: any
}

export interface PlaiCampaignCreate {
  campaign_id: string
  rawData?: any // RAW response from Plai API (source of truth)
  metrics: {
    spend: number
    impressions: number
    clicks: number
    ctr: number
    conversions?: number
    revenue?: number
    total_sales?: number
    cpa?: number
    roa?: number
    cost_per_click?: number
    cost_per_conversion?: number
    cpm?: number
    reach?: number
  }
}

export interface PlaiCampaignMetrics {
  spend: number
  impressions: number
  clicks: number
  ctr: number
  conversions?: number
  revenue?: number
  total_sales?: number
  cpa?: number
  roa?: number
  cost_per_click?: number
  cost_per_conversion?: number
  cpm?: number
  reach?: number
}

export class PlaiApiClient {
  private client: AxiosInstance

  constructor() {
    // Use production Plai API if configured, otherwise use mock API for development
    const apiUrl = process.env.PLAI_API_URL || process.env.MOCK_API_URL || "http://localhost:4001"
    const apiKey = process.env.PLAI_API_KEY || process.env.MOCK_API_KEY || "mock-key"
    const isProduction = !!process.env.PLAI_API_URL

    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    })

    // Log which API is being used
    if (isProduction) {
      console.log("🔗 Using PRODUCTION Plai API:", apiUrl)
    } else {
      console.log("🧪 Using MOCK Plai API:", apiUrl)
    }
  }

  // ========== PROFILE MANAGEMENT ==========

  async createProfile(email: string, name: string): Promise<string> {
    const { data } = await this.client.post("/auth/create_profile", {
      email,
      name,
    })
    return data.results.id
  }

  async getProfile(email: string): Promise<PlaiProfile | null> {
    try {
      const { data } = await this.client.post("/auth/get_profile", { email })
      if (!data.results.success || !data.results.user) return null
      return {
        id: data.results.user.userId,
        email: data.results.user.email,
        name: data.results.user.name,
      }
    } catch (error) {
      return null
    }
  }

  // ========== ACCOUNT CONNECTION ==========

  async createConnectionLink(
    userId: string,
    platform: "meta" | "google_ads" | "linkedin",
    redirectUri?: string,
    state?: string
  ): Promise<string> {
    const { data } = await this.client.post("/auth/create_link", {
      userId,
      platform: platform === "google_ads" ? "google" : platform,
      redirectUri,
      state,
    })
    return data.results.link
  }

  async getConnectedAccounts(userId: string): Promise<{
    facebookAds?: PlaiConnectedAccount[]
    linkedinAds?: PlaiConnectedAccount[]
    googleAds?: PlaiConnectedAccount[]
  }> {
    const { data } = await this.client.post("/auth/get_connected_accounts_data", {
      userId,
    })
    return data.results.connectedAccounts || {}
  }

  async connectAccountWithCredentials(
    userId: string,
    platform: "meta" | "google_ads" | "linkedin",
    credentials: {
      email: string
      password: string
    }
  ): Promise<{ success: boolean; accountId?: string }> {
    // Map platform: "meta" -> "facebook" for mock API (Plai uses "facebook" internally)
    const platformForPlai = platform === "meta" ? "facebook" : platform === "google_ads" ? "google" : platform
    
    const { data } = await this.client.post("/auth/connect_account", {
      userId,
      platform: platformForPlai,
      credentials,
    })
    return data.results || { success: false }
  }

  // ========== CAMPAIGN MANAGEMENT ==========

  async createCampaign(params: {
    ad_account_id: string
    name: string
    // Meta Campaign Parameters (realistic)
    objective?: string // OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_ENGAGEMENT, etc.
    daily_budget?: number
    lifetime_budget?: number // Alternative to daily_budget
    billing_event?: string // IMPRESSIONS, LINK_CLICKS, etc.
    bid_strategy?: string // LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
    status?: string // ACTIVE, PAUSED
    special_ad_categories?: string[] // HOUSING, EMPLOYMENT, CREDIT, etc.
    start_time?: string
    end_time?: string | null
    // Additional Meta parameters
    buying_type?: string // AUCTION (default)
    promoted_object?: any // For specific objectives
  }): Promise<PlaiCampaignCreate> {
    // Prepare realistic Meta campaign creation payload
    const campaignPayload: any = {
      ad_account_id: params.ad_account_id,
      name: params.name,
      objective: params.objective || "OUTCOME_TRAFFIC", // Meta standard objective
      status: params.status || "ACTIVE",
      buying_type: params.buying_type || "AUCTION",
      special_ad_categories: params.special_ad_categories || [],
    }

    // Budget: daily_budget OR lifetime_budget (not both)
    if (params.daily_budget) {
      campaignPayload.daily_budget = params.daily_budget
    } else if (params.lifetime_budget) {
      campaignPayload.lifetime_budget = params.lifetime_budget
    } else {
      // Default to daily budget if neither provided
      campaignPayload.daily_budget = 100
    }

    // Billing event (what you pay for)
    campaignPayload.billing_event = params.billing_event || "IMPRESSIONS"

    // Bid strategy
    campaignPayload.bid_strategy = params.bid_strategy || "LOWEST_COST_WITHOUT_CAP"

    // Dates
    campaignPayload.start_time = params.start_time || new Date().toISOString()
    if (params.end_time) {
      campaignPayload.end_time = params.end_time
    }

    // Promoted object (for specific objectives like OUTCOME_SALES)
    if (params.promoted_object) {
      campaignPayload.promoted_object = params.promoted_object
    }

    const { data } = await this.client.post("/meta/campaign/create", campaignPayload)

    // Get RAW data from Plai response (source of truth)
    const rawData = data.results.campaign?.stats || data.results.metrics || data.results || {}
    
    // For backward compatibility, also return calculated metrics
    // But prefer using rawData and MetricsCalculator in application layer
    const stats = rawData
    const spend = stats.spend || 0
    const conversions = stats.conversions || 0
    const revenue = stats.revenue || stats.total_sales || 0
    const totalSales = stats.total_sales || revenue || 0
    
    // Calculate CPA and ROA (for backward compatibility)
    const cpa = conversions > 0 ? spend / conversions : undefined
    const roa = spend > 0 ? revenue / spend : undefined

    return {
      campaign_id: data.results.campaign?.id || data.results.campaign_id,
      rawData: rawData, // Return RAW data (source of truth)
      metrics: {
        spend,
        impressions: stats.impressions || 0,
        clicks: stats.clicks || 0,
        ctr: stats.ctr || 0,
        conversions,
        revenue,
        total_sales: totalSales,
        cpa,
        roa,
        cost_per_click: stats.cost_per_click,
        cost_per_conversion: stats.cost_per_conversion || cpa,
        cpm: stats.cpm,
      },
    }
  }

  /**
   * Get RAW campaign overview from Plai API
   * Returns the raw response - NO calculations here!
   * Calculations are done by MetricsCalculator service
   */
  async getCampaignOverview(campaignId: string): Promise<{
    rawData: any // Raw response from Plai API
    metrics: PlaiCampaignMetrics // Calculated metrics (for backward compatibility)
  }> {
    try {
      const { data } = await this.client.get(`/meta/campaign/${campaignId}/overview`)

      if (!data || !data.results) {
        throw new Error(`No data returned from Plai API for campaign ${campaignId}`)
      }

      // Return RAW data - don't calculate here!
      // Store this raw data in database, then calculate metrics from it
      const rawData = data.results?.metrics || data.results?.overview || data.results || data || {}

      // Validate that we have at least some data
      if (!rawData || (typeof rawData === 'object' && Object.keys(rawData).length === 0)) {
        throw new Error(`Empty or invalid data returned from Plai API for campaign ${campaignId}`)
      }

      // For backward compatibility, also return calculated metrics
      // But prefer using rawData and MetricsCalculator
      const metrics: PlaiCampaignMetrics = {
        spend: rawData.spend || 0,
        impressions: rawData.impressions || 0,
        clicks: rawData.clicks || 0,
        ctr: rawData.ctr || 0,
        conversions: rawData.conversions,
        revenue: rawData.revenue || rawData.total_sales,
        total_sales: rawData.total_sales || rawData.revenue,
        cost_per_click: rawData.cost_per_click,
        cost_per_conversion: rawData.cost_per_conversion,
        cpm: rawData.cpm,
        reach: rawData.reach,
      }

      return {
        rawData, // Raw data to store in database
        metrics, // Calculated (for backward compatibility)
      }
    } catch (error: any) {
      console.error(`Error fetching campaign overview for ${campaignId}:`, error)
      if (error.response) {
        // Axios error with response
        throw new Error(
          `Error from Plai API: ${error.response.status} - ${error.response.data?.error || error.response.data?.message || error.message}`
        )
      }
      throw new Error(`Error fetching campaign overview: ${error.message || "Unknown error"}`)
    }
  }

  async getCampaignInsights(params: {
    userId: string
    campaignId: string
    startDate?: string
    endDate?: string
  }): Promise<any> {
    const { data } = await this.client.post("/meta/get_campaign_insights", {
      userId: params.userId,
      campaignId: params.campaignId,
      startDate: params.startDate,
      endDate: params.endDate,
    })
    return data.results.insights
  }

  async updateCampaignStatus(
    userId: string,
    campaignId: string,
    status: "ACTIVE" | "PAUSED" | "ARCHIVED"
  ): Promise<void> {
    await this.client.post("/meta/update_campaign_status", {
      userId,
      campaignId,
      status,
    })
  }

  async updateCampaignBudget(
    userId: string,
    campaignId: string,
    dailyBudget: number
  ): Promise<void> {
    await this.client.post("/meta/update_campaign_budget", {
      userId,
      campaignId,
      daily_budget: String(dailyBudget),
    })
  }

  async listCampaigns(userId: string): Promise<any[]> {
    const { data } = await this.client.post("/meta/get_campaigns_list", {
      userId,
    })
    return data.results.campaigns || []
  }
}
