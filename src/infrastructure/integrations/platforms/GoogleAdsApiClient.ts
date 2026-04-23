import axios from "axios"
import type {
  AccountInsights,
  AdDetail,
  AdInsightsRow,
  AdSetSummary,
  CampaignBudgetSnapshot,
  CampaignInsightsRow,
  DailyInsightsRow,
  PlatformApiClient,
  PlatformClientConfig,
} from "./PlatformApiClient"
import { buildAdCreativeFromRowData, collectAssetResourceNames } from "./GoogleAdsCreativeMapper"

/**
 * Google Ads API Client — REST implementation using GAQL (Google Ads Query Language).
 *
 * API version: v23 (released Jan 2026, sunset Feb 2027).
 * Endpoint base: https://googleads.googleapis.com/v23
 *
 * KNOWN LIMITATIONS:
 * - reach: Google Ads has no "reach" metric equivalent to Meta. Always 0.
 * - Creative previews: Supported for IMAGE_AD (direct URL), RESPONSIVE_DISPLAY_AD
 *   (via asset batch GAQL), and VIDEO_AD (YouTube thumbnail). RSA/ETA are text-only.
 *   Media enrichment is best-effort: if the combined GAQL query fails for the current
 *   API version, ads are returned with text only (no error to the caller).
 * - PMax: Performance Max campaigns use asset groups, not ad_group_ad. getCampaignAds
 *   returns [] for PMax — the frontend shows an informative empty state.
 * - MCC (Manager Accounts): accounts accessible only through a MCC require the
 *   login-customer-id header. In the current implementation those accounts are
 *   skipped during discovery. Full MCC support is a future enhancement.
 * - Mutations: createCampaign, updateCampaignStatus, updateCampaignBudget are not
 *   implemented in this phase.
 * - Developer Token: requires Google approval for production access. In test mode
 *   it only works with Google Ads test accounts.
 *
 * SECURITY:
 * - Tokens are NEVER returned to the frontend. They are decrypted only in memory,
 *   used for the API call, and discarded.
 * - The developer-token header is sent only in server-to-Google requests.
 * - Errors from Google (including invalid_grant) are wrapped and re-thrown without
 *   leaking raw OAuth details.
 */
export class GoogleAdsApiClient implements PlatformApiClient {
  private config: Required<Pick<PlatformClientConfig, "clientId" | "clientSecret" | "redirectUri">> & {
    developerToken: string
    apiVersion: string
  }

  constructor(config: PlatformClientConfig) {
    this.config = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      developerToken: config.developerToken || "",
      apiVersion: config.apiVersion || "v23",
    }
  }

  // ── OAuth ────────────────────────────────────────────────────────────────────

  getOAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri || this.config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/adwords",
      state,
      access_type: "offline",
      // Force consent screen so Google always returns a refresh_token.
      prompt: "consent",
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  async exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      const { data } = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: redirectUri || this.config.redirectUri,
          grant_type: "authorization_code",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )

      // Google returns a refresh_token only on the first authorization or when
      // prompt=consent is used. If it is missing the connection cannot be refreshed.
      if (!data.refresh_token) {
        throw new Error(
          "Google did not return a refresh token. " +
          "The user may need to revoke access at https://myaccount.google.com/permissions and reconnect."
        )
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
      }
    } catch (err: any) {
      // Preserve the original error if it was already ours.
      if (err.message?.includes("refresh token")) throw err
      const detail = err.response?.data?.error_description || err.response?.data?.error || err.message
      throw new Error(`Failed to exchange code for token: ${detail}`)
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn: number
  }> {
    try {
      const { data } = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )

      return {
        accessToken: data.access_token,
        // Google rarely rotates refresh tokens; keep the existing one if absent.
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
      }
    } catch (err: any) {
      const googleError = err.response?.data?.error
      const detail = err.response?.data?.error_description || googleError || err.message
      // Propagate invalid_grant explicitly so callers can detect token revocation.
      if (googleError === "invalid_grant") {
        throw new Error(`invalid_grant: ${detail}. The user must reconnect their Google Ads account.`)
      }
      throw new Error(`Failed to refresh token: ${detail}`)
    }
  }

  // ── Account discovery ────────────────────────────────────────────────────────

  /**
   * Lists all Google Ads customer accounts accessible to the authenticated user.
   * Calls listAccessibleCustomers first to get resource names, then fetches details
   * for each one using GAQL. Accounts that cannot be accessed (e.g. under a MCC
   * without login-customer-id) are silently skipped.
   */
  async getAdAccounts(accessToken: string): Promise<Array<{
    id: string
    name: string
    currency?: string
    [key: string]: any
  }>> {
    // Step 1: get the list of accessible customer resource names.
    const { data: listData } = await axios.get(
      `https://googleads.googleapis.com/${this.config.apiVersion}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": this.config.developerToken,
        },
        timeout: 30000,
      }
    )

    const resourceNames: string[] = listData.resourceNames || []
    if (resourceNames.length === 0) return []

    // Step 2: fetch details for each customer using GAQL.
    const accounts: Array<{ id: string; name: string; currency?: string; [key: string]: any }> = []

    for (const resourceName of resourceNames) {
      const customerId = resourceName.replace("customers/", "")
      try {
        const results = await this.gaqlSearch(
          customerId,
          `SELECT customer.id, customer.descriptive_name, customer.currency_code,
                  customer.time_zone, customer.manager
           FROM customer
           LIMIT 1`,
          accessToken
        )

        const customer = results[0]?.customer
        if (!customer) continue

        accounts.push({
          id: String(customer.id ?? customerId),
          name: customer.descriptiveName || `Google Ads Account ${customerId}`,
          currency: customer.currencyCode || "USD",
          time_zone: customer.timeZone,
          is_manager: customer.manager ?? false,
          raw: customer,
        })
      } catch {
        // Skip accounts we cannot access (MCC children, suspended accounts, etc.)
      }
    }

    return accounts
  }

  // ── Metrics: account level ───────────────────────────────────────────────────

  async getAccountInsights(
    platformAccountId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<AccountInsights> {
    const { since, until } = this.resolveDateRange(dateRange)

    const results = await this.gaqlSearch(
      platformAccountId,
      `SELECT
         metrics.impressions,
         metrics.clicks,
         metrics.cost_micros,
         metrics.ctr,
         metrics.average_cpc,
         metrics.average_cpm,
         metrics.conversions,
         metrics.all_conversions,
         metrics.conversions_value,
         metrics.all_conversions_value
       FROM customer
       WHERE segments.date BETWEEN '${since}' AND '${until}'`,
      accessToken
    )

    // Results are segmented by date; aggregate all rows.
    let impressions = 0
    let clicks = 0
    let costMicros = 0
    let totalCtr = 0
    let totalAverageCpc = 0
    let totalAverageCpm = 0
    let conversions = 0
    let conversionsValue = 0
    const rowCount = results.length

    for (const row of results) {
      const m = row.metrics || {}
      impressions      += Number(m.impressions      ?? 0)
      clicks           += Number(m.clicks           ?? 0)
      costMicros       += Number(m.costMicros        ?? 0)
      totalCtr         += Number(m.ctr              ?? 0)
      totalAverageCpc  += Number(m.averageCpc        ?? 0)
      totalAverageCpm  += Number(m.averageCpm        ?? 0)
      conversions      += Number(m.conversions       ?? 0)
      conversionsValue += Number(m.conversionsValue  ?? 0)
    }

    const spend = this.parseMicros(costMicros)
    const cpc   = rowCount > 0 ? this.parseMicros(totalAverageCpc / rowCount) : 0
    const cpm   = rowCount > 0 ? this.parseMicros(totalAverageCpm / rowCount) : 0
    const ctr   = rowCount > 0 ? totalCtr / rowCount : 0

    // Map conversions to the actions/action_values format used by PlatformApiClient
    // so the existing use cases (which look for action_type) can process them.
    const actions: Array<{ action_type: string; value: string }> =
      conversions > 0 ? [{ action_type: "conversion", value: String(conversions) }] : []
    const action_values: Array<{ action_type: string; value: string }> =
      conversionsValue > 0 ? [{ action_type: "conversion", value: String(conversionsValue) }] : []

    return {
      impressions,
      clicks,
      spend,
      ctr,
      cpc,
      cpm,
      reach: 0,
      actions,
      action_values,
    }
  }

  // ── Metrics: campaign level ──────────────────────────────────────────────────

  async getAdAccountCampaignInsights(
    platformAccountId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<CampaignInsightsRow[]> {
    const { since, until } = this.resolveDateRange(dateRange)

    const results = await this.gaqlSearch(
      platformAccountId,
      `SELECT
         campaign.id,
         campaign.name,
         campaign.status,
         campaign.advertising_channel_type,
         metrics.impressions,
         metrics.clicks,
         metrics.cost_micros,
         metrics.ctr,
         metrics.average_cpc,
         metrics.average_cpm,
         metrics.conversions,
         metrics.conversions_value
       FROM campaign
       WHERE segments.date BETWEEN '${since}' AND '${until}'
         AND campaign.status != 'REMOVED'`,
      accessToken
    )

    // Aggregate by campaign.id (results are segmented by date).
    const byId = new Map<string, {
      campaign: any
      impressions: number
      clicks: number
      costMicros: number
      ctrSum: number
      cpcSum: number
      cpmSum: number
      conversions: number
      conversionsValue: number
      count: number
    }>()

    for (const row of results) {
      const c = row.campaign || {}
      const m = row.metrics  || {}
      const id = String(c.id ?? "")
      if (!id) continue

      const existing = byId.get(id)
      if (existing) {
        existing.impressions      += Number(m.impressions      ?? 0)
        existing.clicks           += Number(m.clicks           ?? 0)
        existing.costMicros       += Number(m.costMicros        ?? 0)
        existing.ctrSum           += Number(m.ctr              ?? 0)
        existing.cpcSum           += Number(m.averageCpc        ?? 0)
        existing.cpmSum           += Number(m.averageCpm        ?? 0)
        existing.conversions      += Number(m.conversions       ?? 0)
        existing.conversionsValue += Number(m.conversionsValue  ?? 0)
        existing.count            += 1
      } else {
        byId.set(id, {
          campaign: c,
          impressions:      Number(m.impressions      ?? 0),
          clicks:           Number(m.clicks           ?? 0),
          costMicros:       Number(m.costMicros        ?? 0),
          ctrSum:           Number(m.ctr              ?? 0),
          cpcSum:           Number(m.averageCpc        ?? 0),
          cpmSum:           Number(m.averageCpm        ?? 0),
          conversions:      Number(m.conversions       ?? 0),
          conversionsValue: Number(m.conversionsValue  ?? 0),
          count: 1,
        })
      }
    }

    const rows: CampaignInsightsRow[] = []
    for (const agg of byId.values()) {
      const spend = this.parseMicros(agg.costMicros)
      const conversions = agg.conversions
      const conversionsValue = agg.conversionsValue

      rows.push({
        campaign_id: String(agg.campaign.id ?? ""),
        name: agg.campaign.name || "",
        impressions: agg.impressions,
        clicks: agg.clicks,
        spend,
        reach: 0,
        ctr: agg.count > 0 ? agg.ctrSum / agg.count : 0,
        cpc: agg.count > 0 ? this.parseMicros(agg.cpcSum / agg.count) : 0,
        cpm: agg.count > 0 ? this.parseMicros(agg.cpmSum / agg.count) : 0,
        status: this.normalizeGoogleStatus(agg.campaign.status),
        actions: conversions > 0
          ? [{ action_type: "conversion", value: String(conversions) }]
          : [],
        action_values: conversionsValue > 0
          ? [{ action_type: "conversion", value: String(conversionsValue) }]
          : [],
      })
    }

    // Sort by spend descending (same as Meta).
    rows.sort((a, b) => b.spend - a.spend)
    return rows
  }

  // ── Ads: details + insights ──────────────────────────────────────────────────

  /**
   * Shared GAQL + asset resolution for ads under a campaign or a single ad group.
   * `whereSql` is the full `WHERE …` clause (including the `WHERE` keyword).
   */
  private async fetchAdGroupAdsWithCreativeMedia(
    customerId: string,
    accessToken: string,
    whereSql: string
  ): Promise<AdDetail[]> {
    const BASE_SELECT = `
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.status,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.expanded_text_ad.headline_part1,
      ad_group_ad.ad.expanded_text_ad.headline_part2,
      ad_group_ad.ad.expanded_text_ad.description`

    const MEDIA_SELECT = `,
      ad_group_ad.ad.image_ad.image_url,
      ad_group_ad.ad.responsive_display_ad.marketing_images,
      ad_group_ad.ad.responsive_display_ad.square_marketing_images,
      ad_group_ad.ad.video_ad.video.asset`

    let rawResults: any[]
    let hasMediaFields = false

    try {
      rawResults = await this.gaqlSearch(
        customerId,
        `SELECT ${BASE_SELECT}${MEDIA_SELECT} FROM ad_group_ad ${whereSql}`,
        accessToken
      )
      hasMediaFields = true
    } catch {
      console.warn("[GoogleAds] Media fields unavailable in this API version — returning text-only ads")
      rawResults = await this.gaqlSearch(
        customerId,
        `SELECT ${BASE_SELECT} FROM ad_group_ad ${whereSql}`,
        accessToken
      )
    }

    let assetMap = new Map<string, { imageUrl?: string; youtubeId?: string }>()
    if (hasMediaFields && rawResults.length > 0) {
      const assetResourceNames = new Set<string>()
      for (const row of rawResults) {
        const ad = row.adGroupAd?.ad ?? row.ad_group_ad?.ad ?? {}
        collectAssetResourceNames(ad, assetResourceNames)
      }

      if (assetResourceNames.size > 0) {
        try {
          assetMap = await this.resolveAssets(customerId, assetResourceNames, accessToken)
        } catch (err) {
          console.warn(
            "[GoogleAds] Asset resolution failed — images from assets unavailable:",
            err instanceof Error ? err.message : String(err)
          )
        }
      }
    }

    return rawResults.map((row): AdDetail => {
      const ad = row.adGroupAd?.ad ?? row.ad_group_ad?.ad ?? {}
      const status = row.adGroupAd?.status ?? row.ad_group_ad?.status ?? "UNKNOWN"

      const rsa = ad.responsiveSearchAd ?? ad.responsive_search_ad ?? {}
      const eta = ad.expandedTextAd ?? ad.expanded_text_ad ?? {}

      const headlines: string[] = ((rsa.headlines ?? []) as any[])
        .map((h: any) => h.text ?? "")
        .filter(Boolean)
      if (eta.headlinePart1 ?? eta.headline_part1) headlines.unshift(eta.headlinePart1 ?? eta.headline_part1)
      if (eta.headlinePart2 ?? eta.headline_part2) headlines.push(eta.headlinePart2 ?? eta.headline_part2)

      const descriptions: string[] = ((rsa.descriptions ?? []) as any[])
        .map((d: any) => d.text ?? "")
        .filter(Boolean)
      if (eta.description) descriptions.push(eta.description)

      const finalUrls: string[] = ad.finalUrls ?? ad.final_urls ?? []
      const adName = ad.name || headlines[0] || `Ad ${ad.id ?? ""}`

      const mediaInfo = hasMediaFields
        ? buildAdCreativeFromRowData(ad.type ?? "UNKNOWN", ad, assetMap)
        : { type: "unknown" as const, image_url: null, thumbnail_url: null, video_url: null, cards: [] }

      return {
        ad_id: String(ad.id ?? ""),
        name: adName,
        status,
        effective_status: status,
        creative: {
          creative_id: String(ad.id ?? ""),
          ...mediaInfo,
          ...(headlines.length > 0 && { headlines }),
          ...(descriptions.length > 0 && { descriptions }),
          ...(finalUrls.length > 0 && { final_urls: finalUrls }),
          ad_type: ad.type ?? "UNKNOWN",
        } as any,
      }
    })
  }

  /**
   * Returns ad details for all ads in a campaign including available creative media.
   *
   * Media is fetched in a combined GAQL query (text + image/video fields). If the
   * API rejects any media field for the current API version, the method falls back
   * to a text-only query so the caller always gets a valid list.
   *
   * Asset resource_names (from responsive display / video ads) are resolved in a
   * separate batch GAQL query against the asset resource. If that fails, ads are
   * returned with text only — never an error.
   *
   * PMax campaigns return [] because they do not use the ad_group_ad resource.
   *
   * campaignId MUST be in "customerId:numericCampaignId" format so this method
   * can POST to the correct customer endpoint.
   */
  async getCampaignAds(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<AdDetail[]> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )
    const whereSql = `WHERE campaign.id = ${campaignNumericId} AND ad_group_ad.status != 'REMOVED'`
    return this.fetchAdGroupAdsWithCreativeMedia(customerId, accessToken, whereSql)
  }

  /**
   * Batch-resolves asset resource_names to { imageUrl, youtubeId }.
   * Queries the `asset` resource in chunks of 20 to stay within GAQL limits.
   * A failing chunk is skipped (partial failure) — the returned map simply
   * omits those assets rather than throwing.
   */
  private async resolveAssets(
    customerId: string,
    resourceNames: Set<string>,
    accessToken: string
  ): Promise<Map<string, { imageUrl?: string; youtubeId?: string }>> {
    const result = new Map<string, { imageUrl?: string; youtubeId?: string }>()
    const all = Array.from(resourceNames)
    const CHUNK = 20

    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK)
      const inClause = chunk.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(", ")

      try {
        const rows = await this.gaqlSearch(
          customerId,
          `SELECT
             asset.resource_name,
             asset.image_asset.full_size.url,
             asset.youtube_video_asset.youtube_video_id
           FROM asset
           WHERE asset.resource_name IN (${inClause})`,
          accessToken
        )

        for (const row of rows) {
          const asset = row.asset ?? {}
          const resourceName: string = asset.resourceName ?? asset.resource_name
          if (!resourceName) continue

          const imageUrl: string | undefined =
            asset.imageAsset?.fullSize?.url ?? asset.image_asset?.full_size?.url
          const youtubeId: string | undefined =
            asset.youtubeVideoAsset?.youtubeVideoId ?? asset.youtube_video_asset?.youtube_video_id

          if (imageUrl || youtubeId) result.set(resourceName, { imageUrl, youtubeId })
        }
      } catch (err) {
        console.warn(
          "[GoogleAds] Asset chunk resolution failed:",
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    return result
  }

  async getAdInsights(
    platformAccountId: string,
    campaignId: string,
    accessToken: string,
    dateRange?: { since: string; until: string }
  ): Promise<AdInsightsRow[]> {
    const { since, until } = this.resolveDateRange(dateRange)
    // platformAccountId IS the customerId for Google Ads (strip dashes for REST URL).
    const customerId = this.normalizeGoogleCustomerId(platformAccountId)

    // campaignId might carry "customerId:numericId" prefix — strip to numeric only.
    const campaignNumericId = campaignId.includes(":")
      ? campaignId.split(":")[1]
      : campaignId

    const results = await this.gaqlSearch(
      customerId,
      `SELECT
         ad_group_ad.ad.id,
         metrics.impressions,
         metrics.clicks,
         metrics.cost_micros,
         metrics.ctr,
         metrics.average_cpc,
         metrics.average_cpm,
         metrics.conversions,
         metrics.conversions_value
       FROM ad_group_ad
       WHERE campaign.id = ${campaignNumericId}
         AND segments.date BETWEEN '${since}' AND '${until}'
         AND ad_group_ad.status != 'REMOVED'`,
      accessToken
    )

    // Aggregate by ad ID (results may be segmented by date).
    const byAdId = new Map<string, {
      impressions: number
      clicks: number
      costMicros: number
      ctrSum: number
      cpcSum: number
      cpmSum: number
      conversions: number
      conversionsValue: number
      count: number
    }>()

    for (const row of results) {
      const ad = row.adGroupAd?.ad || row.ad_group_ad?.ad || {}
      const m  = row.metrics || {}
      const id = String(ad.id ?? "")
      if (!id) continue

      const existing = byAdId.get(id)
      if (existing) {
        existing.impressions      += Number(m.impressions      ?? 0)
        existing.clicks           += Number(m.clicks           ?? 0)
        existing.costMicros       += Number(m.costMicros        ?? 0)
        existing.ctrSum           += Number(m.ctr              ?? 0)
        existing.cpcSum           += Number(m.averageCpc        ?? 0)
        existing.cpmSum           += Number(m.averageCpm        ?? 0)
        existing.conversions      += Number(m.conversions       ?? 0)
        existing.conversionsValue += Number(m.conversionsValue  ?? 0)
        existing.count            += 1
      } else {
        byAdId.set(id, {
          impressions:      Number(m.impressions      ?? 0),
          clicks:           Number(m.clicks           ?? 0),
          costMicros:       Number(m.costMicros        ?? 0),
          ctrSum:           Number(m.ctr              ?? 0),
          cpcSum:           Number(m.averageCpc        ?? 0),
          cpmSum:           Number(m.averageCpm        ?? 0),
          conversions:      Number(m.conversions       ?? 0),
          conversionsValue: Number(m.conversionsValue  ?? 0),
          count: 1,
        })
      }
    }

    const rows: AdInsightsRow[] = []
    for (const [adId, agg] of byAdId.entries()) {
      const spend = this.parseMicros(agg.costMicros)
      rows.push({
        ad_id: adId,
        impressions: agg.impressions,
        clicks: agg.clicks,
        spend,
        reach: 0,
        ctr: agg.count > 0 ? agg.ctrSum / agg.count : 0,
        cpc: agg.count > 0 ? this.parseMicros(agg.cpcSum / agg.count) : 0,
        cpm: agg.count > 0 ? this.parseMicros(agg.cpmSum / agg.count) : 0,
        actions: agg.conversions > 0
          ? [{ action_type: "conversion", value: String(agg.conversions) }]
          : [],
        action_values: agg.conversionsValue > 0
          ? [{ action_type: "conversion", value: String(agg.conversionsValue) }]
          : [],
      })
    }

    rows.sort((a, b) => b.spend - a.spend)
    return rows
  }

  // ── Campaign list + metrics (used by sync-campaigns and getCampaignMetrics) ──

  async listCampaigns(
    adAccountId: string,
    accessToken: string
  ): Promise<Array<{ id: string; name: string; status: string; [key: string]: any }>> {
    const results = await this.gaqlSearch(
      adAccountId,
      `SELECT
         campaign.id,
         campaign.name,
         campaign.status,
         campaign.advertising_channel_type,
         campaign.start_date,
         campaign.end_date
       FROM campaign
       WHERE campaign.status != 'REMOVED'
       ORDER BY campaign.id ASC`,
      accessToken
    )

    return results.map((row) => {
      const c = row.campaign || {}
      return {
        id: String(c.id ?? ""),
        name: c.name || "",
        status: c.status || "UNKNOWN",
        advertising_channel_type: c.advertisingChannelType || "",
        start_date: c.startDate || null,
        end_date: c.endDate || null,
        raw: c,
      }
    })
  }

  async getCampaignMetrics(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<any> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )

    const results = await this.gaqlSearch(
      customerId,
      `SELECT
         campaign.id,
         campaign.name,
         campaign.status,
         campaign.advertising_channel_type,
         metrics.impressions,
         metrics.clicks,
         metrics.cost_micros,
         metrics.ctr,
         metrics.average_cpc,
         metrics.conversions
       FROM campaign
       WHERE campaign.id = ${campaignNumericId}`,
      accessToken
    )

    if (results.length === 0) {
      return { id: campaignNumericId, name: "", status: "UNKNOWN", metrics: {} }
    }

    // Aggregate over all date rows returned.
    let impressions = 0, clicks = 0, costMicros = 0, conversions = 0
    const c = results[0].campaign || {}
    for (const row of results) {
      const m = row.metrics || {}
      impressions  += Number(m.impressions  ?? 0)
      clicks       += Number(m.clicks       ?? 0)
      costMicros   += Number(m.costMicros    ?? 0)
      conversions  += Number(m.conversions   ?? 0)
    }

    return {
      id: String(c.id ?? campaignNumericId),
      name: c.name || "",
      status: c.status || "UNKNOWN",
      advertising_channel_type: c.advertisingChannelType || "",
      metrics: {
        impressions,
        clicks,
        spend: this.parseMicros(costMicros),
        ctr: results[0].metrics?.ctr || 0,
        conversions,
      },
      raw: results[0],
    }
  }

  async getCampaignInsights(
    campaignId: string,
    accessToken: string,
    dateRange?: { startDate?: string; endDate?: string },
    options?: { platformAccountId?: string }
  ): Promise<any> {
    const since = dateRange?.startDate?.split("T")[0]
    const until = dateRange?.endDate?.split("T")[0]
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )

    let query = `SELECT
       campaign.id,
       campaign.name,
       metrics.impressions,
       metrics.clicks,
       metrics.cost_micros,
       metrics.ctr,
       metrics.average_cpc,
       metrics.conversions
     FROM campaign
     WHERE campaign.id = ${campaignNumericId}`

    if (since && until) {
      query += ` AND segments.date BETWEEN '${since}' AND '${until}'`
    }

    const results = await this.gaqlSearch(customerId, query, accessToken)

    return {
      insights: results,
      raw: { results },
    }
  }

  async updateCampaignStatus(
    campaignId: string,
    status: "ACTIVE" | "PAUSED" | "ARCHIVED",
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<void> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )
    const resourceName = `customers/${customerId}/campaigns/${campaignNumericId}`
    const gaStatus =
      status === "ACTIVE" ? "ENABLED" : status === "PAUSED" ? "PAUSED" : "REMOVED"

    await this.mutateCampaign(customerId, accessToken, {
      update: {
        resource_name: resourceName,
        status: gaStatus,
      },
      update_mask: "status",
    })
  }

  async updateCampaignBudget(
    campaignId: string,
    budget: number,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<void> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )

    // 1. Look up the campaign_budget resource name for this campaign.
    const campaignRows = await this.gaqlSearch(
      customerId,
      `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignNumericId} LIMIT 1`,
      accessToken
    )
    const budgetResource: string | undefined =
      campaignRows[0]?.campaign?.campaignBudget ?? campaignRows[0]?.campaign?.campaign_budget
    if (!budgetResource) {
      throw new Error("Google Ads campaign has no attached campaign_budget resource.")
    }

    const amountMicros = Math.round(Number(budget) * 1_000_000)

    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${this.normalizeGoogleCustomerId(customerId)}/campaignBudgets:mutate`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": this.config.developerToken,
      "Content-Type": "application/json",
    }

    await axios.post(
      url,
      {
        operations: [
          {
            update: {
              resource_name: budgetResource,
              amount_micros: amountMicros,
            },
            update_mask: "amount_micros",
          },
        ],
      },
      { headers, timeout: 30000 }
    )
  }

  async getCampaignBudget(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string }
  ): Promise<CampaignBudgetSnapshot> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )

    const rows = await this.gaqlSearch(
      customerId,
      `SELECT
         campaign.id,
         campaign.name,
         campaign.status,
         campaign.start_date,
         campaign_budget.amount_micros,
         campaign_budget.total_amount_micros,
         metrics.cost_micros
       FROM campaign
       WHERE campaign.id = ${campaignNumericId}`,
      accessToken
    )

    if (rows.length === 0) {
      return {
        campaign_id: campaignNumericId,
        daily_budget: null,
        lifetime_budget: null,
        spend_to_date: null,
        status: null,
      }
    }

    const first = rows[0]
    const budget = first.campaignBudget ?? first.campaign_budget ?? {}
    const amountMicros = Number(budget.amountMicros ?? budget.amount_micros ?? 0)
    const totalMicros = Number(budget.totalAmountMicros ?? budget.total_amount_micros ?? 0)

    let costMicros = 0
    for (const r of rows) {
      costMicros += Number(r.metrics?.costMicros ?? r.metrics?.cost_micros ?? 0)
    }

    let startDate: string | null = null
    const rawStartDate = first.campaign?.startDate ?? first.campaign?.start_date
    if (rawStartDate) {
      try {
        // Google Ads returns YYYY-MM-DD; convert to ISO 8601
        startDate = new Date(rawStartDate + "T00:00:00Z").toISOString()
      } catch {
        // ignore invalid date
      }
    }

    return {
      campaign_id: campaignNumericId,
      name: first.campaign?.name ?? null,
      daily_budget: amountMicros > 0 ? this.parseMicros(amountMicros) : null,
      lifetime_budget: totalMicros > 0 ? this.parseMicros(totalMicros) : null,
      spend_to_date: this.parseMicros(costMicros),
      status: this.normalizeGoogleStatus(first.campaign?.status),
      start_date: startDate,
      raw: first,
    }
  }

  async listCampaignAdSets(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string; dateRange?: { since: string; until: string } }
  ): Promise<AdSetSummary[]> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )
    const { since, until } = this.resolveDateRange(options?.dateRange)

    let rows: any[]
    try {
      rows = await this.gaqlSearch(
        customerId,
        `SELECT
           ad_group.id,
           ad_group.name,
           ad_group.status,
           ad_group.type,
           ad_group.cpc_bid_micros,
           campaign.bidding_strategy_type,
           campaign.advertising_channel_type,
           metrics.impressions,
           metrics.clicks,
           metrics.cost_micros,
           metrics.ctr
         FROM ad_group
         WHERE campaign.id = ${campaignNumericId}
           AND segments.date BETWEEN '${since}' AND '${until}'
           AND ad_group.status != 'REMOVED'`,
        accessToken
      )
    } catch {
      rows = await this.gaqlSearch(
        customerId,
        `SELECT
           ad_group.id,
           ad_group.name,
           ad_group.status,
           ad_group.type,
           ad_group.cpc_bid_micros,
           metrics.impressions,
           metrics.clicks,
           metrics.cost_micros,
           metrics.ctr
         FROM ad_group
         WHERE campaign.id = ${campaignNumericId}
           AND segments.date BETWEEN '${since}' AND '${until}'
           AND ad_group.status != 'REMOVED'`,
        accessToken
      )
    }

    const byId = new Map<
      string,
      {
        group: any
        impressions: number
        clicks: number
        costMicros: number
        ctrSum: number
        count: number
        campaignBidding?: string
        campaignChannel?: string
      }
    >()
    for (const row of rows) {
      const g = row.adGroup ?? row.ad_group ?? {}
      const c = row.campaign ?? {}
      const m = row.metrics ?? {}
      const id = String(g.id ?? "")
      if (!id) continue
      const existing = byId.get(id)
      const bidding = String(c.biddingStrategyType ?? c.bidding_strategy_type ?? "").trim()
      const channel = String(c.advertisingChannelType ?? c.advertising_channel_type ?? "").trim()
      if (existing) {
        existing.impressions += Number(m.impressions ?? 0)
        existing.clicks += Number(m.clicks ?? 0)
        existing.costMicros += Number(m.costMicros ?? m.cost_micros ?? 0)
        existing.ctrSum += Number(m.ctr ?? 0)
        existing.count += 1
        if (!existing.campaignBidding && bidding) existing.campaignBidding = bidding
        if (!existing.campaignChannel && channel) existing.campaignChannel = channel
      } else {
        byId.set(id, {
          group: g,
          impressions: Number(m.impressions ?? 0),
          clicks: Number(m.clicks ?? 0),
          costMicros: Number(m.costMicros ?? m.cost_micros ?? 0),
          ctrSum: Number(m.ctr ?? 0),
          count: 1,
          campaignBidding: bidding || undefined,
          campaignChannel: channel || undefined,
        })
      }
    }

    let dailyBudget: number | null = null
    let lifetimeBudget: number | null = null
    try {
      const snap = await this.getCampaignBudget(campaignId, accessToken, {
        platformAccountId: options?.platformAccountId,
      })
      dailyBudget = snap.daily_budget
      lifetimeBudget = snap.lifetime_budget
    } catch {
      // Budget optional — ad groups still useful without it.
    }

    const results: AdSetSummary[] = []
    for (const [id, agg] of byId.entries()) {
      const agType = String(agg.group.type ?? agg.group.adGroupType ?? "").trim()
      const cpcMicros = Number(agg.group.cpcBidMicros ?? agg.group.cpc_bid_micros ?? 0)
      const optParts = [agg.campaignChannel, agg.campaignBidding, agType].filter(Boolean)
      let optimization_goal = optParts.length > 0 ? optParts.join(" · ") : null
      if (cpcMicros > 0) {
        const cpcStr = this.parseMicros(cpcMicros).toFixed(2)
        optimization_goal = optimization_goal ? `${optimization_goal} · CPC ${cpcStr}` : `CPC ${cpcStr}`
      }

      results.push({
        adset_id: `${customerId}:${id}`,
        name: agg.group.name || `Ad group ${id}`,
        status: this.normalizeGoogleStatus(agg.group.status),
        budget_scope: "campaign",
        daily_budget: dailyBudget,
        lifetime_budget: lifetimeBudget,
        optimization_goal,
        targeting_summary:
          dailyBudget != null || lifetimeBudget != null
            ? "Presupuesto a nivel campaña (compartido entre ad groups)."
            : null,
        impressions: agg.impressions,
        clicks: agg.clicks,
        spend: this.parseMicros(agg.costMicros),
        ctr: agg.count > 0 ? agg.ctrSum / agg.count : 0,
        raw: agg.group,
      })
    }

    results.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    return results
  }

  async listAdSetAds(
    adSetId: string,
    accessToken: string,
    options?: { platformAccountId?: string; campaignId?: string }
  ): Promise<AdDetail[]> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      adSetId,
      options?.platformAccountId
    )
    const whereSql = `WHERE ad_group.id = ${campaignNumericId} AND ad_group_ad.status != 'REMOVED'`
    return this.fetchAdGroupAdsWithCreativeMedia(customerId, accessToken, whereSql)
  }

  async getCampaignDailyInsights(
    campaignId: string,
    accessToken: string,
    options?: { platformAccountId?: string; since?: string; until?: string }
  ): Promise<DailyInsightsRow[]> {
    const { customerId, campaignNumericId } = this.parseCampaignId(
      campaignId,
      options?.platformAccountId
    )

    const today = new Date().toISOString().slice(0, 10)
    const sinceDate = options?.since
      ? options.since.slice(0, 10)
      : (() => {
          const d = new Date()
          d.setFullYear(d.getFullYear() - 1)
          return d.toISOString().slice(0, 10)
        })()
    const untilDate = options?.until ? options.until.slice(0, 10) : today

    const results = await this.gaqlSearch(
      customerId,
      `SELECT
         segments.date,
         metrics.impressions,
         metrics.clicks,
         metrics.cost_micros,
         metrics.ctr,
         metrics.average_cpc,
         metrics.average_cpm,
         metrics.conversions,
         metrics.conversions_value
       FROM campaign
       WHERE campaign.id = ${campaignNumericId}
         AND segments.date BETWEEN '${sinceDate}' AND '${untilDate}'
       ORDER BY segments.date ASC`,
      accessToken
    )

    return results.map((row: any): DailyInsightsRow => {
      const m = row.metrics || {}
      const spend = this.parseMicros(m.costMicros ?? m.cost_micros)
      const conversions = Number(m.conversions ?? 0)
      const revenue = Number(m.conversionsValue ?? m.conversions_value ?? 0)
      const cpc = this.parseMicros(m.averageCpc ?? m.average_cpc)
      const cpm = this.parseMicros(m.averageCpm ?? m.average_cpm)

      return {
        date: (row.segments?.date as string) ?? "",
        impressions: Number(m.impressions ?? 0),
        clicks: Number(m.clicks ?? 0),
        spend,
        reach: 0,
        ctr: Number(m.ctr ?? 0),
        cpc,
        cpm,
        conversions,
        revenue,
        actions: conversions > 0 ? [{ action_type: "conversion", value: String(conversions) }] : [],
        action_values: revenue > 0 ? [{ action_type: "conversion", value: String(revenue) }] : [],
      }
    })
  }

  async updateAdStatus(
    _adId: string,
    _status: "ACTIVE" | "PAUSED",
    _accessToken: string,
    _options?: { platformAccountId?: string }
  ): Promise<void> {
    throw new Error(
      "Google Ads ad-level status updates are not implemented in this phase. " +
      "Apply this change manually in Google Ads Manager."
    )
  }

  private async mutateCampaign(
    customerId: string,
    accessToken: string,
    operation: Record<string, unknown>
  ): Promise<void> {
    const cid = this.normalizeGoogleCustomerId(customerId)
    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${cid}/campaigns:mutate`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": this.config.developerToken,
      "Content-Type": "application/json",
    }
    await axios.post(url, { operations: [operation] }, { headers, timeout: 30000 })
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
      [key: string]: any
    },
    _accessToken: string
  ): Promise<{ campaignId: string; rawData: any }> {
    throw new Error(
      "Google Ads campaign creation is not implemented in this phase. " +
      "Use the Google Ads UI or the google-ads-api library for mutations."
    )
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Executes a GAQL query against the Google Ads REST search endpoint and returns
   * the results array. Handles pagination automatically up to a reasonable limit.
   *
   * Headers sent per request (never exposed to the frontend):
   *   - Authorization: Bearer <access_token>
   *   - developer-token: <GOOGLE_ADS_DEVELOPER_TOKEN>
   *   - login-customer-id: <mccId>  (optional, for MCC-managed accounts)
   */
  private async gaqlSearch(
    customerId: string,
    query: string,
    accessToken: string,
    loginCustomerId?: string
  ): Promise<any[]> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": this.config.developerToken,
      "Content-Type": "application/json",
    }
    if (loginCustomerId) {
      headers["login-customer-id"] = loginCustomerId
    }

    const cid = this.normalizeGoogleCustomerId(customerId)
    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${cid}/googleAds:search`
    let allResults: any[] = []
    let pageToken: string | undefined

    do {
      const body: Record<string, any> = { query }
      if (pageToken) body.pageToken = pageToken

      const { data } = await axios.post(url, body, { headers, timeout: 30000 })
      const page: any[] = data.results || []
      allResults = allResults.concat(page)
      pageToken = data.nextPageToken || undefined
    } while (pageToken)

    return allResults
  }

  /**
   * Maps Google Ads campaign.status (or primary_status) to a normalized
   * internal bucket. Google's primary enum is smaller than Meta's, but we
   * future-proof for `primary_status` values (ELIGIBLE, PENDING, LIMITED,
   * MISCONFIGURED, NOT_ELIGIBLE, LEARNING, ENDED) in case we switch queries.
   */
  private normalizeGoogleStatus(status: string | undefined): string {
    switch ((status ?? "").toUpperCase()) {
      case "ENABLED":
      case "ELIGIBLE":
      case "LEARNING":
        return "active"
      case "PAUSED":
        return "paused"
      case "PENDING":
      case "MISCONFIGURED":
      case "NOT_ELIGIBLE":
      case "LIMITED":
        return "issues"
      case "REMOVED":
      case "ENDED":
        return "removed"
      default:
        return "unknown"
    }
  }

  /** Converts a micros integer (string or number) to a decimal currency value. */
  private parseMicros(micros: string | number | undefined): number {
    return (Number(micros) || 0) / 1_000_000
  }

  /**
   * Resolves a date range to YYYY-MM-DD strings.
   * Defaults to the last 30 days when not provided.
   */
  private resolveDateRange(dateRange?: { since: string; until: string }): { since: string; until: string } {
    if (dateRange?.since && dateRange?.until) return dateRange
    const until = new Date().toISOString().slice(0, 10)
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - 30)
    return { since: sinceDate.toISOString().slice(0, 10), until }
  }

  /** Strips dashes/spaces so "123-456-7890" works in customers/{id} URLs. */
  private normalizeGoogleCustomerId(raw: string): string {
    return String(raw).replace(/[-\s]/g, "")
  }

  /**
   * Parses a resource id for GAQL `customers/{customerId}/googleAds:search`.
   * Prefer canonical `customerId:numericId` (campaign or ad group id). If the id
   * has no colon, pass `platformAccountId` (our linked Google Ads account id).
   */
  private parseCampaignId(
    resourceId: string,
    platformAccountId?: string | null
  ): { customerId: string; campaignNumericId: string } {
    const trimmed = resourceId.trim()
    if (trimmed.includes(":")) {
      const [customerId, numericId] = trimmed.split(":", 2)
      return {
        customerId: this.normalizeGoogleCustomerId(customerId),
        campaignNumericId: numericId,
      }
    }
    if (platformAccountId) {
      return {
        customerId: this.normalizeGoogleCustomerId(platformAccountId),
        campaignNumericId: trimmed,
      }
    }
    // Legacy fallback (ambiguous — may 400); callers should pass platformAccountId.
    return {
      customerId: this.normalizeGoogleCustomerId(trimmed),
      campaignNumericId: trimmed,
    }
  }
}
