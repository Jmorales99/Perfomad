import axios, { AxiosInstance } from "axios"
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

/**
 * Meta (Facebook/Instagram) Marketing API Client
 * Uses Facebook Marketing API v18+
 */
/**
 * Internal representation of a parsed Meta creative before enrichment.
 * Carries underscore-prefixed fields used by `enrichAdCreatives` to upgrade
 * thumbnails / resolve playback URLs. These fields never leave the client:
 * they are stripped from both the root creative and each card before the
 * `AdCreative` is returned.
 */
type RawCreativeCard = AdCreative["cards"][number] & {
  _image_hash?: string
  _video_id?: string
}
type RawCreative = Omit<AdCreative, "cards"> & {
  _video_id?: string
  _story_id?: string
  _image_hash?: string
  cards: RawCreativeCard[]
}
type RawAdDetail = Omit<AdDetail, "creative"> & { creative: RawCreative }

function summarizeTargeting(targeting: unknown): string | null {
  if (!targeting || typeof targeting !== "object") return null
  const t = targeting as Record<string, unknown>
  const parts: string[] = []
  const geo = t.geo_locations as Record<string, unknown> | undefined
  const countries = Array.isArray(geo?.countries) ? (geo?.countries as string[]) : []
  if (countries.length > 0) parts.push(`countries: ${countries.slice(0, 3).join(",")}`)
  if (typeof t.age_min === "number" || typeof t.age_max === "number") {
    parts.push(`age: ${t.age_min ?? "?"}-${t.age_max ?? "?"}`)
  }
  if (Array.isArray(t.genders) && (t.genders as unknown[]).length > 0) {
    parts.push(`genders: ${(t.genders as unknown[]).slice(0, 2).join(",")}`)
  }
  return parts.length > 0 ? parts.join(" | ") : null
}

export class MetaApiClient implements PlatformApiClient {
  private config: Required<Pick<PlatformClientConfig, "clientId" | "clientSecret" | "redirectUri">> & {
    apiVersion: string
  }
  private client: AxiosInstance

  constructor(config: PlatformClientConfig) {
    this.config = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      apiVersion: config.apiVersion || "v18.0",
    }

    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${this.config.apiVersion}`,
      timeout: 30000,
    })
  }

  getOAuthUrl(redirectUri: string, state: string): string {
    const scopes = [
      "ads_management",
      "ads_read",
      "business_management",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_ads",
    ]
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri || this.config.redirectUri,
      state,
      scope: scopes.join(","),
      response_type: "code",
    })

    return `https://www.facebook.com/${this.config.apiVersion}/dialog/oauth?${params.toString()}`
  }

  async exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
  }> {
    try {
      const { data } = await this.client.get("/oauth/access_token", {
        params: {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: redirectUri || this.config.redirectUri,
          code,
        },
      })

      // Meta returns long-lived tokens that can be exchanged for extended tokens
      // For now, we'll use the access token directly
      // The expires_in is in seconds
      return {
        accessToken: data.access_token,
        refreshToken: data.access_token, // Meta uses same token for refresh
        expiresIn: data.expires_in || 5184000, // Default 60 days if not specified
      }
    } catch (error: any) {
      throw new Error(`Failed to exchange code for token: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn: number
  }> {
    try {
      // Meta allows extending long-lived tokens
      const { data } = await this.client.get("/oauth/access_token", {
        params: {
          grant_type: "fb_exchange_token",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          fb_exchange_token: refreshToken,
        },
      })

      return {
        accessToken: data.access_token,
        refreshToken: data.access_token,
        expiresIn: data.expires_in || 5184000, // 60 days
      }
    } catch (error: any) {
      const graphError = error.response?.data?.error
      // Graph API error 190 means the token is expired/revoked and cannot be refreshed.
      // We propagate the code in the message so the reconnect helper can detect it.
      if (graphError?.code === 190 || graphError?.type === "OAuthException") {
        throw new Error(
          `invalid_grant: ${graphError.message ?? "Error validating access token"}. The user must reconnect their Meta account.`
        )
      }
      throw new Error(`Failed to refresh token: ${graphError?.message || error.message}`)
    }
  }

  async getAdAccounts(accessToken: string): Promise<Array<{
    id: string
    name: string
    currency?: string
    [key: string]: any
  }>> {
    try {
      // Get user's ad accounts
      const { data } = await this.client.get("/me/adaccounts", {
        params: {
          access_token: accessToken,
          fields: "id,name,account_id,currency,account_status",
        },
      })

      return (data.data || []).map((account: any) => ({
        id: account.account_id || account.id,
        name: account.name,
        currency: account.currency,
        account_status: account.account_status,
        raw: account,
      }))
    } catch (error: any) {
      throw new Error(`Failed to get ad accounts: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async createCampaign(
    params: {
      adAccountId: string
      name: string
      dailyBudget?: number
      lifetimeBudget?: number
      objective?: string
      status?: string
      startDate?: string
      endDate?: string | null
      [key: string]: any
    },
    accessToken: string
  ): Promise<{
    campaignId: string
    rawData: any
  }> {
    try {
      const campaignParams: any = {
        name: params.name,
        objective: params.objective || "OUTCOME_TRAFFIC",
        status: params.status || "PAUSED", // Always start paused for safety
        special_ad_categories: [],
      }

      // Budget: daily_budget or lifetime_budget (not both)
      if (params.dailyBudget) {
        campaignParams.daily_budget = params.dailyBudget * 100 // Meta expects cents
      } else if (params.lifetimeBudget) {
        campaignParams.lifetime_budget = params.lifetimeBudget * 100 // Meta expects cents
      }

      // Dates
      if (params.startDate) {
        campaignParams.start_time = params.startDate
      }
      if (params.endDate) {
        campaignParams.stop_time = params.endDate
      }

      const { data } = await this.client.post(
        `/${params.adAccountId}/campaigns`,
        campaignParams,
        {
          params: {
            access_token: accessToken,
          },
        }
      )

      // Fetch campaign details to get full data
      const campaignData = await this.getCampaignMetrics(data.id, accessToken)

      return {
        campaignId: data.id,
        rawData: campaignData,
      }
    } catch (error: any) {
      throw new Error(`Failed to create campaign: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async getCampaignMetrics(
    campaignId: string,
    accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<any> {
    try {
      const { data } = await this.client.get(`/${campaignId}`, {
        params: {
          access_token: accessToken,
          fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time",
        },
      })

      // Get lifetime insights with full field set for revenue/ROAS calculation
      const insightsData = await this.client.get(`/${campaignId}/insights`, {
        params: {
          access_token: accessToken,
          fields: "impressions,clicks,spend,ctr,reach,cpc,cpm,actions,action_values",
          date_preset: "lifetime",
        },
      }).catch(() => ({ data: { data: [] } }))

      const rawInsights = insightsData.data.data?.[0] || {}
      const purchaseTypes = new Set(["purchase", "offsite_conversion.fb_pixel_purchase"])
      const actions: Array<{ action_type: string; value: string }> = rawInsights.actions ?? []
      const actionValues: Array<{ action_type: string; value: string }> = rawInsights.action_values ?? []
      const conversions = actions
        .filter((a) => purchaseTypes.has(a.action_type))
        .reduce((s, a) => s + Number(a.value || 0), 0)
      const revenue = actionValues
        .filter((a) => purchaseTypes.has(a.action_type))
        .reduce((s, a) => s + Number(a.value || 0), 0)

      const insights = {
        impressions: parseInt(rawInsights.impressions ?? "0", 10),
        clicks: parseInt(rawInsights.clicks ?? "0", 10),
        spend: parseFloat(rawInsights.spend ?? "0"),
        ctr: parseFloat(rawInsights.ctr ?? "0"),
        reach: parseInt(rawInsights.reach ?? "0", 10),
        cpc: parseFloat(rawInsights.cpc ?? "0"),
        cpm: parseFloat(rawInsights.cpm ?? "0"),
        conversions,
        revenue,
      }

      return {
        ...data,
        metrics: insights,
      }
    } catch (error: any) {
      throw new Error(`Failed to get campaign metrics: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async getCampaignInsights(
    campaignId: string,
    accessToken: string,
    dateRange?: { startDate?: string; endDate?: string },
    _options?: { platformAccountId?: string }
  ): Promise<any> {

    try {
      const params: any = {
        access_token: accessToken,
        fields: "impressions,clicks,spend,ctr,reach,conversions,cpc,cpm,cpp,cost_per_conversion",
      }

      if (dateRange?.startDate && dateRange?.endDate) {
        params.time_range = JSON.stringify({
          since: dateRange.startDate,
          until: dateRange.endDate,
        })
      } else {
        params.date_preset = "lifetime"
      }

      const { data } = await this.client.get(`/${campaignId}/insights`, { params })

      return {
        insights: data.data || [],
        raw: data,
      }
    } catch (error: any) {
      throw new Error(`Failed to get campaign insights: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async updateCampaignStatus(
    campaignId: string,
    status: "ACTIVE" | "PAUSED" | "ARCHIVED",
    accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    try {
      await this.client.post(
        `/${campaignId}`,
        { status },
        {
          params: {
            access_token: accessToken,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to update campaign status: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async updateCampaignBudget(
    campaignId: string,
    budget: number,
    accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    try {
      // Meta expects budget in cents
      await this.client.post(
        `/${campaignId}`,
        { daily_budget: budget * 100 },
        {
          params: {
            access_token: accessToken,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to update campaign budget: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async listCampaigns(
    adAccountId: string,
    accessToken: string,
    limit = 25
  ): Promise<Array<{
    id: string
    name: string
    status: string
    effective_status?: string
    [key: string]: any
  }>> {
    try {
      const { data } = await this.client.get(`/${adAccountId}/campaigns`, {
        params: {
          access_token: accessToken,
          // effective_status reflects review + billing + hierarchy state;
          // downstream code prefers it over the raw user-configured `status`.
          fields: "id,name,status,effective_status,objective,start_time,stop_time",
          limit: String(limit),
        },
      })

      return (data.data || []).map((campaign: any) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        effective_status: campaign.effective_status,
        objective: campaign.objective,
        raw: campaign,
      }))
    } catch (error: any) {
      throw new Error(`Failed to list campaigns: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async getAccountInsights(
    platformAccountId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<AccountInsights> {
    try {
      // Meta requires the act_ prefix for account-level endpoints
      const accountPath = platformAccountId.startsWith("act_")
        ? platformAccountId
        : `act_${platformAccountId}`

      const params: Record<string, string> = {
        fields: "impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values",
        level: "account",
      }

      if (dateRange?.since && dateRange?.until) {
        params.time_range = JSON.stringify({ since: dateRange.since, until: dateRange.until })
      } else {
        params.date_preset = "last_30d"
      }

      const { data } = await this.client.get(`/${accountPath}/insights`, {
        params: { ...params, access_token: accessToken },
      })

      const row = (data.data as any[])?.[0] ?? {}

      return {
        impressions: parseInt(row.impressions ?? "0", 10),
        clicks: parseInt(row.clicks ?? "0", 10),
        spend: parseFloat(row.spend ?? "0"),
        ctr: parseFloat(row.ctr ?? "0"),
        cpc: parseFloat(row.cpc ?? "0"),
        cpm: parseFloat(row.cpm ?? "0"),
        reach: parseInt(row.reach ?? "0", 10),
        actions: (row.actions as Array<{ action_type: string; value: string }>) ?? [],
        action_values: (row.action_values as Array<{ action_type: string; value: string }>) ?? [],
      }
    } catch (error: any) {
      throw new Error(`Failed to get account insights: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Per-ad creative + metrics
  // ---------------------------------------------------------------------------

  /**
   * Returns all ads belonging to a campaign with their parsed creative metadata.
   * Fields requested include enough to determine type + preview URLs without downloading files.
   */
  async getCampaignAds(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<AdDetail[]> {
    try {
      const { data } = await this.client.get(`/${campaignId}/ads`, {
        params: {
          access_token: accessToken,
          fields: `id,name,status,effective_status,creative{${this.adCreativeFields()}}`,
          limit: "200",
        },
      })

      const rawAds = ((data.data as any[]) ?? []).map((ad: any) => ({
        ad_id: ad.id as string,
        name: (ad.name as string) ?? "",
        status: (ad.status as string) ?? "UNKNOWN",
        effective_status: (ad.effective_status as string) ?? "UNKNOWN",
        creative: this.extractCreative(ad.creative),
      }))

      return this.enrichAdCreatives(rawAds, accessToken, {
        platformAccountId: options?.platformAccountId,
      })
    } catch (error: any) {
      throw new Error(
        `Failed to get campaign ads: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  /**
   * Creative field selector shared by `getCampaignAds` and `listAdSetAds`.
   * Includes:
   * - `image_url` / `image_hash`            → full-res image when directly on the creative
   * - `effective_object_story_id`           → used to fetch full_picture for image/carousel ads
   * - `object_story_spec.video_data.video_id` → used to fetch video source + HD cover
   * - `asset_feed_spec.images`              → multi-asset carousels
   */
  private adCreativeFields(): string {
    return [
      "id",
      "thumbnail_url",
      "image_url",
      "image_hash",
      "effective_object_story_id",
      "object_story_spec{" +
        "video_data{video_id}," +
        "link_data{picture,link,child_attachments{" +
          "name,picture,link,image_hash,video_id,description,call_to_action" +
        "}}" +
        "}",
      // Meta rejects width/height on asset_feed_spec.images (#100 nonexisting field).
      "asset_feed_spec{" +
        "images{url,hash}," +
        "videos{video_id,thumbnail_url}" +
      "}",
    ].join(",")
  }

  /**
   * Enriches raw ad creatives in-place:
   *   1. Videos   → fetches `/{video_id}?fields=source,picture` (playback URL + HD cover).
   *   2. Story-based images/carousels → `/{story_id}?fields=full_picture` (full-res).
   *   3. Fallback → `/{creative_id}?fields=image_url,object_story_id`.
   * All errors are swallowed (enrichment is best-effort). Returns the cleaned list
   * without internal `_video_id` / `_story_id` temp fields.
   */
  private async enrichAdCreatives(
    rawAds: RawAdDetail[],
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<AdDetail[]> {
    const videoAds = rawAds.filter((ad) => !!ad.creative._video_id)
    const storyAds = rawAds.filter(
      (ad) => !!ad.creative._story_id && ad.creative.type !== "video"
    )
    const fallbackAds = rawAds.filter(
      (ad) =>
        !ad.creative._video_id &&
        !ad.creative._story_id &&
        !!ad.creative.creative_id
    )

    // Cards in carousel ads that carry a video id (carousel-with-videos).
    const videoCards: Array<{ card: RawCreativeCard; videoId: string }> = []
    for (const ad of rawAds) {
      for (const card of ad.creative.cards) {
        if (card._video_id) videoCards.push({ card, videoId: card._video_id })
      }
    }

    await Promise.all([
      ...videoAds.map(async (ad) => {
        try {
          const { data: vd } = await this.client.get(`/${ad.creative._video_id}`, {
            params: { access_token: accessToken, fields: "source,picture" },
          })
          if (vd.source) ad.creative.video_url = vd.source as string
          if (vd.picture) ad.creative.thumbnail_url = vd.picture as string
        } catch {
          /* Non-fatal */
        }
      }),

      ...storyAds.map(async (ad) => {
        try {
          const { data: sd } = await this.client.get(`/${ad.creative._story_id}`, {
            params: { access_token: accessToken, fields: "full_picture" },
          })
          if (sd.full_picture) {
            ad.creative.image_url = sd.full_picture as string
            ad.creative.thumbnail_url = sd.full_picture as string
          }
        } catch {
          /* Non-fatal */
        }
      }),

      ...fallbackAds.map(async (ad) => {
        try {
          const { data: cd } = await this.client.get(`/${ad.creative.creative_id}`, {
            params: { access_token: accessToken, fields: "image_url,object_story_id" },
          })
          if (cd.image_url) {
            ad.creative.image_url = cd.image_url as string
            ad.creative.thumbnail_url = cd.image_url as string
            return
          }
          if (cd.object_story_id) {
            const { data: sd } = await this.client.get(`/${cd.object_story_id}`, {
              params: { access_token: accessToken, fields: "full_picture" },
            })
            if (sd.full_picture) {
              ad.creative.image_url = sd.full_picture as string
              ad.creative.thumbnail_url = sd.full_picture as string
            }
          }
        } catch {
          /* Non-fatal */
        }
      }),

      // Carousel-with-video cards: fetch each video's source + HD cover.
      ...videoCards.map(async ({ card, videoId }) => {
        try {
          const { data: vd } = await this.client.get(`/${videoId}`, {
            params: { access_token: accessToken, fields: "source,picture" },
          })
          if (vd.source) card.video_url = vd.source as string
          if (vd.picture) card.thumbnail_url = vd.picture as string
        } catch {
          /* Non-fatal */
        }
      }),
    ])

    // ── Upgrade static images to original-resolution via /act_X/adimages ───────
    // The previous enrichment only yields `full_picture` (capped ~500px). When
    // we know the ad account id and have the raw `image_hash` — either at the
    // creative root or per carousel card — we can request the original upload
    // URL which is full resolution. We collect all hashes (ad-level + every
    // card-level) into a single map so a single batched request upgrades both.
    if (options?.platformAccountId) {
      const accountPath = options.platformAccountId.startsWith("act_")
        ? options.platformAccountId
        : `act_${options.platformAccountId}`

      type Target =
        | { kind: "ad"; ad: RawAdDetail }
        | { kind: "card"; card: RawCreativeCard }
      const targetsByHash = new Map<string, Target[]>()
      const pushTarget = (hash: string, target: Target) => {
        if (!targetsByHash.has(hash)) targetsByHash.set(hash, [])
        targetsByHash.get(hash)!.push(target)
      }

      for (const ad of rawAds) {
        // Ad-level hash (single image ads).
        if (ad.creative._image_hash && ad.creative.type !== "video") {
          pushTarget(ad.creative._image_hash, { kind: "ad", ad })
        }
        // Card-level hashes (carousel image cards).
        for (const card of ad.creative.cards) {
          if (card._image_hash) {
            pushTarget(card._image_hash, { kind: "card", card })
          }
        }
      }

      const hashes = Array.from(targetsByHash.keys())
      if (hashes.length > 0) {
        // Meta accepts up to ~50 hashes per call. Chunk to stay safe.
        const chunks: string[][] = []
        for (let i = 0; i < hashes.length; i += 25) chunks.push(hashes.slice(i, i + 25))

        await Promise.all(
          chunks.map(async (chunk) => {
            try {
              const { data: imgRes } = await this.client.get(`/${accountPath}/adimages`, {
                params: {
                  access_token: accessToken,
                  hashes: JSON.stringify(chunk),
                  fields: "hash,url,permalink_url,width,height",
                },
              })
              const list = (imgRes.data as any[]) ?? []
              for (const img of list) {
                const hash = img.hash as string | undefined
                const url = (img.url as string) ?? (img.permalink_url as string)
                if (!hash || !url) continue
                const targets = targetsByHash.get(hash) ?? []
                for (const t of targets) {
                  if (t.kind === "ad") {
                    t.ad.creative.image_url = url
                    t.ad.creative.thumbnail_url = url
                  } else {
                    t.card.image_url = url
                    t.card.thumbnail_url = url
                  }
                }
              }
            } catch {
              /* Non-fatal: fall back to whatever was set above */
            }
          })
        )
      }
    }

    return rawAds.map(({ creative, ...rest }) => {
      const { _video_id, _story_id, _image_hash, cards, ...cleanCreative } = creative
      void _video_id
      void _story_id
      void _image_hash
      const cleanCards = cards.map((c) => {
        const { _image_hash: _h, _video_id: _v, ...cleanCard } = c
        void _h
        void _v
        return cleanCard
      })
      return {
        ...rest,
        creative: { ...cleanCreative, cards: cleanCards } as AdDetail["creative"],
      }
    })
  }

  /**
   * Returns per-ad Insights (level=ad) filtered to one campaign.
   * Uses the account-level /insights endpoint with a campaign.id filter,
   * which is the most efficient way to get ad metrics for a specific campaign.
   */
  async getAdInsights(
    platformAccountId: string,
    campaignId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<AdInsightsRow[]> {
    try {
      const accountPath = platformAccountId.startsWith("act_")
        ? platformAccountId
        : `act_${platformAccountId}`

      const filtering = JSON.stringify([
        { field: "campaign.id", operator: "EQUAL", value: campaignId },
      ])

      const params: Record<string, string> = {
        level: "ad",
        filtering,
        fields: "ad_id,ad_name,impressions,clicks,spend,reach,ctr,cpc,cpm,actions,action_values",
        limit: "200",
        sort: "spend_descending",
      }

      if (dateRange?.since && dateRange?.until) {
        params.time_range = JSON.stringify({ since: dateRange.since, until: dateRange.until })
      } else {
        params.date_preset = "last_30d"
      }

      const { data } = await this.client.get(`/${accountPath}/insights`, {
        params: { ...params, access_token: accessToken },
      })

      return ((data.data as any[]) ?? []).map((row: any): AdInsightsRow => ({
        ad_id: (row.ad_id as string) ?? "",
        impressions: parseInt(row.impressions ?? "0", 10),
        clicks: parseInt(row.clicks ?? "0", 10),
        spend: parseFloat(row.spend ?? "0"),
        reach: parseInt(row.reach ?? "0", 10),
        ctr: parseFloat(row.ctr ?? "0"),
        cpc: parseFloat(row.cpc ?? "0"),
        cpm: parseFloat(row.cpm ?? "0"),
        actions: (row.actions as Array<{ action_type: string; value: string }>) ?? [],
        action_values: (row.action_values as Array<{ action_type: string; value: string }>) ?? [],
      }))
    } catch (error: any) {
      throw new Error(
        `Failed to get ad insights: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parses the raw creative object returned by the Meta API into a typed AdCreative.
   * Derives creative type from object_story_spec fields; never throws.
   *
   * Returned creative may carry temporary underscore-prefixed fields used by
   * `enrichAdCreatives` to upgrade thumbnails and resolve playback URLs:
   * - `_video_id`/`_story_id`/`_image_hash` on the root creative.
   * - `_image_hash`/`_video_id` on each carousel card.
   * These fields are stripped before the creative leaves the client.
   */
  private extractCreative(creative: any): RawCreative {
    if (!creative) {
      return { creative_id: "", type: "unknown", thumbnail_url: null, image_url: null, cards: [] }
    }

    const spec = creative.object_story_spec
    let type: AdCreative["type"] = "unknown"
    let thumbnail_url: string | null = (creative.thumbnail_url as string) ?? null
    const rootImageUrl: string | null   = (creative.image_url as string) ?? null
    // effective_object_story_id lets us fetch full_picture for image/carousel ads
    const storyId: string | undefined   = (creative.effective_object_story_id as string) ?? undefined
    const imageHash: string | undefined = (creative.image_hash as string) ?? undefined
    let image_url: string | null = null
    let cards: RawCreative["cards"] = []
    let _video_id: string | undefined
    let _story_id: string | undefined

    if (spec?.video_data) {
      type = "video"
      _video_id = (spec.video_data.video_id as string) ?? undefined
      // thumbnail_url will be replaced by /{video_id}.picture enrichment
    } else if ((spec?.link_data?.child_attachments as any[])?.length > 0) {
      type = "carousel"
      cards = (spec.link_data.child_attachments as any[]).map((att) => ({
        thumbnail_url: (att.picture as string) ?? null,
        image_url: null,
        video_url: null,
        link: (att.link as string) ?? null,
        name: (att.name as string) ?? null,
        _image_hash: (att.image_hash as string) ?? undefined,
        _video_id: (att.video_id as string) ?? undefined,
      }))
      thumbnail_url = thumbnail_url ?? cards[0]?.thumbnail_url ?? null
      _story_id = storyId
    } else if (creative.asset_feed_spec) {
      type = "carousel"
      const images: any[] = creative.asset_feed_spec.images ?? []
      const videos: any[] = creative.asset_feed_spec.videos ?? []
      if (images.length > 0 || videos.length > 0) {
        const imageCards: RawCreative["cards"] = images.map((img) => ({
          thumbnail_url: (img.url as string) ?? null,
          image_url: (img.url as string) ?? null,
          video_url: null,
          link: null,
          name: null,
          _image_hash: (img.hash as string) ?? undefined,
        }))
        const videoCards: RawCreative["cards"] = videos.map((vid) => ({
          thumbnail_url: (vid.thumbnail_url as string) ?? null,
          image_url: null,
          video_url: null,
          link: null,
          name: null,
          _video_id: (vid.video_id as string) ?? undefined,
        }))
        cards = [...imageCards, ...videoCards]
        thumbnail_url = thumbnail_url ?? cards[0]?.thumbnail_url ?? null
      }
      _story_id = storyId
    } else if (spec?.link_data) {
      type = "image"
      image_url = (spec.link_data.picture as string) ?? rootImageUrl ?? null
      thumbnail_url = thumbnail_url ?? image_url
      _story_id = storyId
    } else if (creative.image_hash || rootImageUrl) {
      type = "image"
      image_url = rootImageUrl
      thumbnail_url = thumbnail_url ?? image_url
      _story_id = storyId
    }

    return {
      creative_id: (creative.id as string) ?? "",
      type,
      thumbnail_url,
      image_url,
      cards,
      ...(_video_id ? { _video_id } : {}),
      ...(_story_id ? { _story_id } : {}),
      ...(imageHash ? { _image_hash: imageHash } : {}),
    }
  }

  async getAdAccountCampaignInsights(
    platformAccountId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<CampaignInsightsRow[]> {
    try {
      const accountPath = platformAccountId.startsWith("act_")
        ? platformAccountId
        : `act_${platformAccountId}`

      const params: Record<string, string> = {
        level: "campaign",
        fields: "campaign_id,campaign_name,impressions,clicks,spend,reach,ctr,cpc,cpm,actions,action_values",
        limit: "200",
        // Sort server-side by spend descending so the most expensive campaigns come first.
        sort: "spend_descending",
      }

      if (dateRange?.since && dateRange?.until) {
        params.time_range = JSON.stringify({ since: dateRange.since, until: dateRange.until })
      } else {
        params.date_preset = "last_30d"
      }

      // Fetch insights and campaign statuses in parallel.
      // The insights endpoint does not return status; listCampaigns does.
      const [insightsResponse, campaignList] = await Promise.all([
        this.client.get(`/${accountPath}/insights`, {
          params: { ...params, access_token: accessToken },
        }),
        this.listCampaigns(accountPath, accessToken, 500).catch(
          () => [] as Array<{ id: string; status: string; effective_status?: string }>
        ),
      ])

      // Prefer effective_status (reflects review/billing/hierarchy) over
      // raw `status` (just what the user configured).
      const statusMap = new Map<string, string>(
        campaignList.map((c) => [
          c.id,
          this.normalizeMetaStatus(c.effective_status ?? c.status),
        ])
      )

      return ((insightsResponse.data.data as any[]) ?? []).map((row: any): CampaignInsightsRow => ({
        campaign_id: (row.campaign_id as string) ?? "",
        name: (row.campaign_name as string) ?? "",
        impressions: parseInt(row.impressions ?? "0", 10),
        clicks: parseInt(row.clicks ?? "0", 10),
        spend: parseFloat(row.spend ?? "0"),
        reach: parseInt(row.reach ?? "0", 10),
        ctr: parseFloat(row.ctr ?? "0"),
        cpc: parseFloat(row.cpc ?? "0"),
        cpm: parseFloat(row.cpm ?? "0"),
        status: statusMap.get(row.campaign_id as string) ?? "unknown",
        actions: (row.actions as Array<{ action_type: string; value: string }>) ?? [],
        action_values: (row.action_values as Array<{ action_type: string; value: string }>) ?? [],
      }))
    } catch (error: any) {
      throw new Error(
        `Failed to get campaign insights: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Budget + hierarchy (drift detection + ad set view)
  // ---------------------------------------------------------------------------

  async getCampaignBudget(
    campaignId: string,
    accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<CampaignBudgetSnapshot> {
    try {
      const { data } = await this.client.get(`/${campaignId}`, {
        params: {
          access_token: accessToken,
          fields: "id,name,status,daily_budget,lifetime_budget,spend_cap,start_time,stop_time",
        },
      })

      const insightsResp = await this.client
        .get(`/${campaignId}/insights`, {
          params: {
            access_token: accessToken,
            fields: "spend",
            date_preset: "lifetime",
          },
        })
        .catch(() => ({ data: { data: [] } as any }))

      const spend = parseFloat(insightsResp.data?.data?.[0]?.spend ?? "0")

      let startDate: string | null = null
      if (data.start_time) {
        try {
          startDate = new Date(data.start_time).toISOString()
        } catch {
          // ignore invalid date
        }
      }

      return {
        campaign_id: String(data.id ?? campaignId),
        name: data.name ?? null,
        // Meta returns daily_budget / lifetime_budget in cents; convert to units.
        daily_budget: data.daily_budget ? Number(data.daily_budget) / 100 : null,
        lifetime_budget: data.lifetime_budget ? Number(data.lifetime_budget) / 100 : null,
        spend_to_date: Number.isFinite(spend) ? spend : null,
        status: this.normalizeMetaStatus(data.status),
        start_date: startDate,
        raw: data,
      }
    } catch (error: any) {
      throw new Error(
        `Failed to get campaign budget: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  async listCampaignAdSets(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string; dateRange?: { since: string; until: string } }
  ): Promise<AdSetSummary[]> {
    try {
      const { data } = await this.client.get(`/${campaignId}/adsets`, {
        params: {
          access_token: accessToken,
          fields:
            "id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting",
          limit: "100",
        },
      })

      const adsets: AdSetSummary[] = ((data.data as any[]) ?? []).map((a) => ({
        adset_id: String(a.id ?? ""),
        name: (a.name as string) ?? "",
        status: this.normalizeMetaStatus(a.status),
        daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null,
        optimization_goal: (a.optimization_goal as string) ?? null,
        targeting_summary: summarizeTargeting(a.targeting),
        raw: a,
      }))

      if (!options?.platformAccountId || adsets.length === 0) {
        return adsets
      }

      const accountPath = options.platformAccountId.startsWith("act_")
        ? options.platformAccountId
        : `act_${options.platformAccountId}`

      const params: Record<string, string> = {
        level: "adset",
        filtering: JSON.stringify([
          { field: "campaign.id", operator: "EQUAL", value: campaignId },
        ]),
        fields: "adset_id,impressions,clicks,spend,ctr",
        limit: "100",
      }
      if (options.dateRange?.since && options.dateRange?.until) {
        params.time_range = JSON.stringify(options.dateRange)
      } else {
        params.date_preset = "last_30d"
      }

      const { data: insights } = await this.client
        .get(`/${accountPath}/insights`, {
          params: { ...params, access_token: accessToken },
        })
        .catch(() => ({ data: { data: [] as any[] } }))

      const byId = new Map<string, any>()
      for (const row of ((insights as any).data ?? []) as any[]) {
        byId.set(String(row.adset_id ?? ""), row)
      }

      for (const a of adsets) {
        const m = byId.get(a.adset_id)
        if (!m) continue
        a.impressions = parseInt(m.impressions ?? "0", 10)
        a.clicks = parseInt(m.clicks ?? "0", 10)
        a.spend = parseFloat(m.spend ?? "0")
        a.ctr = parseFloat(m.ctr ?? "0")
      }

      return adsets
    } catch (error: any) {
      throw new Error(
        `Failed to list ad sets: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  async listAdSetAds(
    adSetId: string,
    accessToken: string,
    options?: { platformAccountId?: string; campaignId?: string }
  ): Promise<AdDetail[]> {
    try {
      const { data } = await this.client.get(`/${adSetId}/ads`, {
        params: {
          access_token: accessToken,
          fields: `id,name,status,effective_status,creative{${this.adCreativeFields()}}`,
          limit: "100",
        },
      })

      const rawAds = ((data.data as any[]) ?? []).map((ad: any) => ({
        ad_id: ad.id as string,
        name: (ad.name as string) ?? "",
        status: (ad.status as string) ?? "UNKNOWN",
        effective_status: (ad.effective_status as string) ?? "UNKNOWN",
        creative: this.extractCreative(ad.creative),
      }))

      return this.enrichAdCreatives(rawAds, accessToken, {
        platformAccountId: options?.platformAccountId,
      })
    } catch (error: any) {
      throw new Error(
        `Failed to list ad set ads: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  async getCampaignDailyInsights(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string; since?: string; until?: string }
  ): Promise<DailyInsightsRow[]> {
    try {
      const params: Record<string, string> = {
        access_token: accessToken,
        fields: "date_start,impressions,clicks,spend,reach,ctr,cpc,cpm,actions,action_values",
        time_increment: "1",
        level: "campaign",
        limit: "365",
      }

      if (options?.since && options?.until) {
        params.time_range = JSON.stringify({ since: options.since, until: options.until })
      } else {
        params.date_preset = "lifetime"
      }

      const { data } = await this.client.get(`/${campaignId}/insights`, { params })

      return ((data.data as any[]) ?? []).map((row: any): DailyInsightsRow => {
        const actions: Array<{ action_type: string; value: string }> = row.actions ?? []
        const actionValues: Array<{ action_type: string; value: string }> = row.action_values ?? []

        const purchaseTypes = new Set([
          "purchase",
          "offsite_conversion.fb_pixel_purchase",
        ])
        const conversions = actions
          .filter((a) => purchaseTypes.has(a.action_type))
          .reduce((s, a) => s + Number(a.value || 0), 0)
        const revenue = actionValues
          .filter((a) => purchaseTypes.has(a.action_type))
          .reduce((s, a) => s + Number(a.value || 0), 0)

        return {
          date: (row.date_start as string) ?? "",
          impressions: parseInt(row.impressions ?? "0", 10),
          clicks: parseInt(row.clicks ?? "0", 10),
          spend: parseFloat(row.spend ?? "0"),
          reach: parseInt(row.reach ?? "0", 10),
          ctr: parseFloat(row.ctr ?? "0"),
          cpc: parseFloat(row.cpc ?? "0"),
          cpm: parseFloat(row.cpm ?? "0"),
          conversions,
          revenue,
          actions,
          action_values: actionValues,
        }
      })
    } catch (error: any) {
      throw new Error(
        `Failed to get campaign daily insights: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  async updateAdStatus(
    adId: string,
    status: "ACTIVE" | "PAUSED",
    accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    try {
      await this.client.post(
        `/${adId}`,
        { status },
        { params: { access_token: accessToken } }
      )
    } catch (error: any) {
      throw new Error(
        `Failed to update ad status: ${error.response?.data?.error?.message || error.message}`
      )
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Pages
  // ──────────────────────────────────────────────────────────────────────

  async getPages(accessToken: string): Promise<Array<{ id: string; name: string; access_token: string }>> {
    try {
      const { data } = await this.client.get("/me/accounts", {
        params: {
          access_token: accessToken,
          fields: "id,name,access_token",
          limit: 100,
        },
      })
      return (data.data ?? []) as Array<{ id: string; name: string; access_token: string }>
    } catch (error: any) {
      throw new Error(`Failed to get pages: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Ad Set
  // ──────────────────────────────────────────────────────────────────────

  async createAdSet(
    params: {
      adAccountId: string
      campaignId: string
      name: string
      dailyBudget?: number
      lifetimeBudget?: number
      billingEvent?: string
      optimizationGoal?: string
      bidStrategy?: string
      targeting?: {
        geo_locations?: { countries?: string[] }
        age_min?: number
        age_max?: number
        genders?: number[]
      }
      startTime?: string
      endTime?: string | null
      status?: string
    },
    accessToken: string
  ): Promise<{ adSetId: string }> {
    try {
      const body: any = {
        name: params.name,
        campaign_id: params.campaignId,
        billing_event: params.billingEvent || "IMPRESSIONS",
        optimization_goal: params.optimizationGoal || "REACH",
        bid_strategy: params.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
        status: params.status || "PAUSED",
      }
      if (params.dailyBudget) {
        body.daily_budget = Math.round(params.dailyBudget * 100)
      } else if (params.lifetimeBudget) {
        body.lifetime_budget = Math.round(params.lifetimeBudget * 100)
      }
      if (params.targeting) {
        body.targeting = params.targeting
      }
      if (params.startTime) body.start_time = params.startTime
      if (params.endTime) body.end_time = params.endTime

      const { data } = await this.client.post(`/${params.adAccountId}/adsets`, body, {
        params: { access_token: accessToken },
      })
      return { adSetId: data.id as string }
    } catch (error: any) {
      throw new Error(`Failed to create ad set: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async deleteAdSet(adSetId: string, accessToken: string): Promise<void> {
    try {
      await this.client.delete(`/${adSetId}`, { params: { access_token: accessToken } })
    } catch (error: any) {
      console.warn(`[MetaApiClient] deleteAdSet(${adSetId}) failed (best-effort):`, error.message)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Media upload
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Upload an image (Buffer) to a Meta ad account.
   * Returns the image hash needed to reference it in an ad creative.
   */
  async uploadAdImage(
    adAccountId: string,
    imageBuffer: Buffer,
    filename: string,
    accessToken: string
  ): Promise<{ imageHash: string }> {
    try {
      const FormData = (await import("form-data")).default
      const form = new FormData()
      form.append("filename", imageBuffer, { filename, contentType: "image/jpeg" })
      form.append("access_token", accessToken)

      const { data } = await this.client.post(`/${adAccountId}/adimages`, form, {
        headers: form.getHeaders(),
      })
      const hashes = data.images
      const hash = Object.values(hashes as Record<string, { hash: string }>)[0]?.hash
      if (!hash) throw new Error("No hash returned from adimages endpoint")
      return { imageHash: hash }
    } catch (error: any) {
      throw new Error(`Failed to upload ad image: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  /**
   * Upload a video (Buffer) to a Meta ad account.
   * Returns the video_id needed for video-based creatives.
   */
  async uploadAdVideo(
    adAccountId: string,
    videoBuffer: Buffer,
    filename: string,
    accessToken: string
  ): Promise<{ videoId: string }> {
    try {
      const FormData = (await import("form-data")).default
      const form = new FormData()
      form.append("source", videoBuffer, { filename, contentType: "video/mp4" })
      form.append("access_token", accessToken)

      const { data } = await this.client.post(`/${adAccountId}/advideos`, form, {
        headers: form.getHeaders(),
        timeout: 120_000, // videos can be large
      })
      if (!data.id) throw new Error("No video_id returned from advideos endpoint")
      return { videoId: data.id as string }
    } catch (error: any) {
      throw new Error(`Failed to upload ad video: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Ad Creative
  // ──────────────────────────────────────────────────────────────────────

  async createAdCreative(
    params: {
      adAccountId: string
      name: string
      pageId: string
      imageHash?: string
      videoId?: string
      link: string
      headline: string
      primaryText: string
      description?: string
      cta?: string
    },
    accessToken: string
  ): Promise<{ creativeId: string }> {
    try {
      const linkData: any = {
        link: params.link,
        message: params.primaryText,
        name: params.headline,
        call_to_action: {
          type: params.cta || "LEARN_MORE",
          value: { link: params.link },
        },
      }
      if (params.description) linkData.description = params.description
      if (params.imageHash) linkData.image_hash = params.imageHash

      const objectStorySpec: any = {
        page_id: params.pageId,
        link_data: linkData,
      }

      if (params.videoId) {
        objectStorySpec.video_data = {
          video_id: params.videoId,
          call_to_action: {
            type: params.cta || "LEARN_MORE",
            value: { link: params.link },
          },
          title: params.headline,
          message: params.primaryText,
        }
        delete objectStorySpec.link_data
      }

      const body: any = {
        name: params.name,
        object_story_spec: objectStorySpec,
      }

      const { data } = await this.client.post(`/${params.adAccountId}/adcreatives`, body, {
        params: { access_token: accessToken },
      })
      return { creativeId: data.id as string }
    } catch (error: any) {
      throw new Error(`Failed to create ad creative: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async deleteAdCreative(creativeId: string, accessToken: string): Promise<void> {
    try {
      await this.client.delete(`/${creativeId}`, { params: { access_token: accessToken } })
    } catch (error: any) {
      console.warn(`[MetaApiClient] deleteAdCreative(${creativeId}) failed (best-effort):`, error.message)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Ad
  // ──────────────────────────────────────────────────────────────────────

  async createAd(
    params: {
      adAccountId: string
      name: string
      adSetId: string
      creativeId: string
      status?: string
    },
    accessToken: string
  ): Promise<{ adId: string }> {
    try {
      const body = {
        name: params.name,
        adset_id: params.adSetId,
        creative: { creative_id: params.creativeId },
        status: params.status || "PAUSED",
      }
      const { data } = await this.client.post(`/${params.adAccountId}/ads`, body, {
        params: { access_token: accessToken },
      })
      return { adId: data.id as string }
    } catch (error: any) {
      throw new Error(`Failed to create ad: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  async deleteAd(adId: string, accessToken: string): Promise<void> {
    try {
      await this.client.delete(`/${adId}`, { params: { access_token: accessToken } })
    } catch (error: any) {
      console.warn(`[MetaApiClient] deleteAd(${adId}) failed (best-effort):`, error.message)
    }
  }

  async deleteCampaign(campaignId: string, accessToken: string): Promise<void> {
    try {
      await this.client.delete(`/${campaignId}`, { params: { access_token: accessToken } })
    } catch (error: any) {
      console.warn(`[MetaApiClient] deleteCampaign(${campaignId}) failed (best-effort):`, error.message)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Ad Preview
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Generate a preview embed for a given ad creative.
   * @param adFormat e.g. "DESKTOP_FEED_STANDARD" | "MOBILE_FEED_STANDARD" | "INSTAGRAM_STANDARD"
   */
  async generateAdPreview(
    creativeId: string,
    adFormat: string,
    accessToken: string
  ): Promise<{ body: string }> {
    try {
      const { data } = await this.client.get(`/${creativeId}/previews`, {
        params: {
          access_token: accessToken,
          ad_format: adFormat,
        },
      })
      const body = (data.data?.[0]?.body as string) ?? ""
      return { body }
    } catch (error: any) {
      throw new Error(`Failed to generate ad preview: ${error.response?.data?.error?.message || error.message}`)
    }
  }

  /**
   * Maps Meta campaign/adset `status` or `effective_status` to a normalized
   * internal bucket. `effective_status` is preferred because it reflects
   * review/billing/hierarchy state (not just what the user configured).
   */
  private normalizeMetaStatus(status: string | undefined): string {
    switch ((status ?? "").toUpperCase()) {
      case "ACTIVE":
      case "IN_PROCESS":  // pending review/approval — will deliver once approved
      case "PREAPPROVED":
        return "active"
      case "PAUSED":
      case "CAMPAIGN_PAUSED": // effective_status when parent campaign is paused
      case "ADSET_PAUSED":    // effective_status when parent ad set is paused
        return "paused"
      case "WITH_ISSUES":           // policy/billing block — not delivering
      case "PENDING_REVIEW":
      case "PENDING_BILLING_INFO":
      case "DISAPPROVED":
        return "issues"
      case "ARCHIVED":
      case "DELETED":
        return "removed"
      default:
        return "unknown"
    }
  }
}
