import axios, { type AxiosInstance, isAxiosError } from "axios"
import type {
  AccountInsights,
  AdCreative,
  AdDetail,
  AdInsightsRow,
  AdSetSummary,
  CampaignBudgetSnapshot,
  CampaignInsightsRow,
  DailyInsightsRow,
  PlatformApiClient,
  PlatformClientConfig,
} from "./PlatformApiClient"

const DEFAULT_API_BASE = "https://business-api.tiktok.com"
const OAUTH_ACCESS_TOKEN_PATH = "/open_api/v1.3/oauth2/access_token/"
const OAUTH_REFRESH_TOKEN_PATH = "/open_api/v1.3/oauth2/refresh_token/"
const OAUTH_ADVERTISER_GET_PATH = "/open_api/v1.3/oauth2/advertiser/get/"

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface TikTokTokenExchangeResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  /** Seconds until refresh_token expires, when TikTok returns refresh_token_expires_in */
  refreshTokenExpiresIn?: number
  /** Raw advertiser ids from token response when advertiser/get is not used */
  advertiserIdsFromToken?: string[]
}

type TikTokEnvelope<T> = { code: number; message: string; data?: T; request_id?: string }

/**
 * TikTok Marketing API — Advertiser OAuth and minimal PlatformApiClient surface.
 * Campaign/metrics methods are stubs until reporting is implemented.
 */
export class TikTokApiClient implements PlatformApiClient {
  private readonly appId: string
  private readonly secret: string
  private readonly redirectUri: string
  private readonly advertiserAuthUrl: string
  private readonly http: AxiosInstance

  constructor(config: PlatformClientConfig & { advertiserAuthUrl?: string; apiBaseUrl?: string }) {
    this.appId = config.clientId
    this.secret = config.clientSecret
    this.redirectUri = config.redirectUri
    this.advertiserAuthUrl = config.advertiserAuthUrl || "https://ads.tiktok.com/marketing_api/auth"
    const base = (config.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "")
    this.http = axios.create({
      baseURL: base,
      timeout: 45_000,
      headers: { "Content-Type": "application/json" },
    })
  }

  getOAuthUrl(redirectUri: string, state: string): string {
    let u: URL
    try {
      u = new URL(this.advertiserAuthUrl)
    } catch {
      u = new URL("https://ads.tiktok.com/marketing_api/auth")
    }
    const redir = redirectUri || this.redirectUri
    u.searchParams.set("app_id", this.appId)
    u.searchParams.set("redirect_uri", redir)
    u.searchParams.set("state", state)
    return u.toString()
  }

  /**
   * Exchange authorization code for tokens (TikTok uses `auth_code` in the JSON body).
   */
  async exchangeAuthCodeForTokens(authCode: string): Promise<TikTokTokenExchangeResult> {
    const raw = await this.postWithRetry<TikTokEnvelope<Record<string, unknown>>>(OAUTH_ACCESS_TOKEN_PATH, {
      app_id: this.appId,
      secret: this.secret,
      auth_code: authCode,
    })
    const data = raw.data
    if (!data) {
      throw new Error(raw.message || "TikTok token exchange returned no data")
    }
    const accessToken = String(data.access_token ?? "")
    if (!accessToken) {
      throw new Error("TikTok token exchange missing access_token")
    }
    const refreshToken = String(data.refresh_token ?? "")
    const expiresIn = Number(data.expires_in ?? 3600)
    const refreshTokenExpiresIn =
      data.refresh_token_expires_in !== undefined && data.refresh_token_expires_in !== null
        ? Number(data.refresh_token_expires_in)
        : undefined
    const advertiserIdsFromToken = Array.isArray(data.advertiser_ids)
      ? (data.advertiser_ids as unknown[]).map((x) => String(x))
      : undefined
    return {
      accessToken,
      refreshToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
      refreshTokenExpiresIn,
      advertiserIdsFromToken,
    }
  }

  async exchangeCodeForToken(
    code: string,
    _redirectUri: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const r = await this.exchangeAuthCodeForTokens(code)
    return {
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      expiresIn: r.expiresIn,
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn: number
  }> {
    const raw = await this.postWithRetry<TikTokEnvelope<Record<string, unknown>>>(OAUTH_REFRESH_TOKEN_PATH, {
      app_id: this.appId,
      secret: this.secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
    const data = raw.data
    if (!data) {
      throw new Error(raw.message || "TikTok refresh returned no data")
    }
    const accessToken = String(data.access_token ?? "")
    if (!accessToken) {
      throw new Error("TikTok refresh missing access_token")
    }
    const expiresIn = Number(data.expires_in ?? 3600)
    return {
      accessToken,
      refreshToken: data.refresh_token !== undefined ? String(data.refresh_token) : undefined,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
    }
  }

  /**
   * Advertisers the user authorized for this access token.
   */
  async getAuthorizedAdvertisers(accessToken: string): Promise<
    Array<{ id: string; name: string; currency?: string }>
  > {
    const fromApi = await this.fetchAdvertiserList(accessToken)
    if (fromApi.length > 0) return fromApi
    return []
  }

  async getAdAccounts(accessToken: string): Promise<
    Array<{ id: string; name: string; currency?: string; [key: string]: unknown }>
  > {
    return this.getAuthorizedAdvertisers(accessToken)
  }

  /**
   * Resolve minimal advertiser rows when only ids are returned from the token exchange.
   */
  async enrichAdvertisersFromIds(
    accessToken: string,
    ids: string[]
  ): Promise<Array<{ id: string; name: string; currency?: string }>> {
    if (!ids.length) return []
    const fromApi = await this.fetchAdvertiserList(accessToken)
    const byId = new Map(fromApi.map((a) => [a.id, a]))
    return ids.map((id) => {
      const found = byId.get(id)
      return found ?? { id, name: `Advertiser ${id}`, currency: "USD" }
    })
  }

  private async fetchAdvertiserList(
    accessToken: string
  ): Promise<Array<{ id: string; name: string; currency?: string }>> {
    const raw = await this.postWithRetry<TikTokEnvelope<{ list?: Array<Record<string, unknown>> }>>(
      OAUTH_ADVERTISER_GET_PATH,
      {},
      { "Access-Token": accessToken }
    )
    const list = raw.data?.list ?? []
    return list.map((row) => ({
      id: String(row.advertiser_id ?? row.id ?? ""),
      name: String(row.advertiser_name ?? row.name ?? ""),
      currency: row.currency ? String(row.currency) : "USD",
    })).filter((a) => a.id)
  }

  private async postWithRetry<T>(
    path: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    let lastMessage = "TikTok API request failed"
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data } = await this.http.post<T>(path, body, {
          headers: { ...extraHeaders },
        })
        const env = data as unknown as TikTokEnvelope<unknown>
        if (env.code !== 0) {
          lastMessage = env.message || `TikTok API error code ${env.code}`
          throw new Error(lastMessage)
        }
        return data
      } catch (err: unknown) {
        const status = isAxiosError(err) ? err.response?.status : undefined
        if (status === 429 || (status !== undefined && status >= 500)) {
          await sleep(300 * (attempt + 1))
          continue
        }
        if (err instanceof Error) throw err
        throw new Error(lastMessage)
      }
    }
    throw new Error(lastMessage)
  }

  private emptyInsights(): AccountInsights {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
      reach: 0,
      actions: [],
      action_values: [],
    }
  }

  async getAccountInsights(
    _platformAccountId: string,
    _accessToken: string,
    _dateRange?: { since: string; until: string }
  ): Promise<AccountInsights> {
    return this.emptyInsights()
  }

  async getAdAccountCampaignInsights(
    _platformAccountId: string,
    _accessToken: string,
    _dateRange?: { since: string; until: string }
  ): Promise<CampaignInsightsRow[]> {
    return []
  }

  async getCampaignAds(
    _campaignId: string,
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<AdDetail[]> {
    return []
  }

  async getAdInsights(
    _platformAccountId: string,
    _campaignId: string,
    _accessToken: string,
    _dateRange?: { since: string; until: string }
  ): Promise<AdInsightsRow[]> {
    return []
  }

  async createCampaign(
    _params: {
      adAccountId: string
      name: string
      dailyBudget?: number
      lifetimeBudget?: number
      objective?: string
      status?: string
      startDate?: string
      endDate?: string | null
      [key: string]: unknown
    },
    _accessToken: string
  ): Promise<{ campaignId: string; rawData: unknown }> {
    throw new Error("TikTok campaign creation is not implemented yet.")
  }

  async getCampaignMetrics(
    _campaignId: string,
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<unknown> {
    return {}
  }

  async getCampaignInsights(
    _campaignId: string,
    _accessToken: string,
    _dateRange?: { startDate?: string; endDate?: string },
    _options?: { platformAccountId?: string }
  ): Promise<unknown> {
    return {}
  }

  async updateCampaignStatus(
    _campaignId: string,
    _status: "ACTIVE" | "PAUSED" | "ARCHIVED",
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    throw new Error(
      "platform_not_supported_yet: TikTok campaign status update is not available yet. " +
        "Apply the change manually in TikTok Ads Manager."
    )
  }

  async updateCampaignBudget(
    _campaignId: string,
    _budget: number,
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    throw new Error(
      "platform_not_supported_yet: TikTok campaign budget update is not available yet. " +
        "Apply the change manually in TikTok Ads Manager."
    )
  }

  async listCampaigns(
    _adAccountId: string,
    _accessToken: string
  ): Promise<Array<{ id: string; name: string; status: string; [key: string]: unknown }>> {
    return []
  }

  async getCampaignBudget(
    campaignId: string,
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<CampaignBudgetSnapshot> {
    return {
      campaign_id: campaignId,
      daily_budget: null,
      lifetime_budget: null,
      spend_to_date: null,
      status: null,
    }
  }

  async listCampaignAdSets(
    _campaignId: string,
    _accessToken: string,
    _options?: { platformAccountId?: string; dateRange?: { since: string; until: string } }
  ): Promise<AdSetSummary[]> {
    return []
  }

  async listAdSetAds(
    _adSetId: string,
    _accessToken: string,
    _options?: { platformAccountId?: string; campaignId?: string }
  ): Promise<AdDetail[]> {
    return []
  }

  async getCampaignDailyInsights(
    _campaignId: string,
    _accessToken: string,
    _options?: { platformAccountId?: string; since?: string; until?: string }
  ): Promise<DailyInsightsRow[]> {
    return []
  }

  async updateAdStatus(
    _adId: string,
    _status: "ACTIVE" | "PAUSED",
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    throw new Error(
      "TikTok ad-level status updates are not implemented. Apply this change manually in TikTok Ads Manager."
    )
  }
}
