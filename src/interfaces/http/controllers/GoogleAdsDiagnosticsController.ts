import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { GoogleAdsApiClient } from "@/infrastructure/integrations/platforms/GoogleAdsApiClient"
import { env } from "@/config/env"

/**
 * Diagnostic endpoint for Google Ads integration — development only.
 *
 * Exposes raw GAQL responses so you can verify:
 * - What keys Google returns (camelCase vs snake_case)
 * - Whether image/asset URLs are populated
 * - Whether PMax asset_group_asset queries work
 * - Whether error fields reveal why media is missing
 *
 * Never register this in production.
 */
export async function GoogleAdsDiagnosticsController(app: FastifyInstance) {
  /**
   * GET /v1/platforms/google_ads/diagnose
   *
   * Query params:
   *   campaignId   — platform campaign id in "customerId:numericId" format
   *   adAccountId  — platform_account_id of the connected Google Ads account
   *
   * Returns raw GAQL responses (max 2 rows each) plus error details so you
   * can see exactly what Google is returning before any mapping layer.
   */
  app.get("/platforms/google_ads/diagnose", async (request, reply) => {
    const user = await verifyUser(request, reply)
    if (!user) return

    const { campaignId, adAccountId } = request.query as {
      campaignId?: string
      adAccountId?: string
    }

    if (!campaignId || !adAccountId) {
      return reply.status(400).send({
        error: "campaignId and adAccountId query params are required",
        example: "/v1/platforms/google_ads/diagnose?campaignId=1234567890:21817907402&adAccountId=1234567890",
      })
    }

    const adAccountsRepo = new SupabaseAdAccountsRepository()
    const tokenManager = new TokenManager()

    // Find the ad account row for this user — match ignoring dashes/spaces
    const accounts = await adAccountsRepo.findByUserId(user.id)
    const normalize = (s: string) => s.replace(/[-\s]/g, "")
    const account = accounts.find(
      (a) =>
        a.platform === "google_ads" &&
        normalize(a.platform_account_id ?? "") === normalize(adAccountId)
    ) ?? accounts.find((a) => a.platform === "google_ads")

    if (!account) {
      const googleAccounts = accounts.filter((a) => a.platform === "google_ads")
      return reply.status(404).send({
        error: `No google_ads account found for this user`,
        available_google_ads_account_ids: googleAccounts.map((a) => a.platform_account_id),
      })
    }

    // Create client with debug enabled regardless of env var
    const client = new GoogleAdsApiClient({
      clientId: env.GOOGLE_ADS_CLIENT_ID || "",
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || "",
      redirectUri: env.GOOGLE_ADS_REDIRECT_URI || "",
      developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      apiVersion: env.GOOGLE_ADS_API_VERSION,
      loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "",
      debug: true,
    })

    const accessToken = await tokenManager.getValidAccessToken(
      account as any,
      async (refresh) => client.refreshAccessToken(refresh)
    )

    // Parse campaignId into customerId and numericId
    const [customerId, campaignNumericId] = campaignId.includes(":")
      ? campaignId.split(":", 2)
      : [adAccountId.replace(/-/g, ""), campaignId]

    const result: Record<string, any> = {
      customerId,
      campaignNumericId,
      loginCustomerIdConfigured: !!env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    }

    // 1. Campaign type
    try {
      const channelType = await client.getCampaignAdvertisingChannelTypePublic(
        customerId,
        campaignNumericId,
        accessToken
      )
      result.campaign_type = channelType || "(empty — campaign not found or no access)"
    } catch (err: any) {
      result.campaign_type_error = err?.response?.data?.error ?? err?.message
    }

    // 2. ad_group_ad query WITH media fields (first 2 rows)
    try {
      const rows = await client.rawGaqlSearch(
        customerId,
        `SELECT
           ad_group.id,
           ad_group.name,
           ad_group_ad.ad.id,
           ad_group_ad.ad.type,
           ad_group_ad.status,
           ad_group_ad.ad.image_ad.image_url,
           ad_group_ad.ad.responsive_display_ad.marketing_images,
           ad_group_ad.ad.responsive_display_ad.square_marketing_images,
           ad_group_ad.ad.video_ad.video.asset
         FROM ad_group_ad
         WHERE campaign.id = ${campaignNumericId}
           AND ad_group_ad.status != 'REMOVED'
         LIMIT 2`,
        accessToken
      )
      result.ad_group_ad_raw = rows
      result.ad_group_ad_count = rows.length
    } catch (err: any) {
      result.ad_group_ad_error = {
        status: err?.response?.status,
        detail: err?.response?.data?.error ?? err?.message,
      }
    }

    // 3. asset_group_asset query for PMax (first 5 rows)
    try {
      const rows = await client.rawGaqlSearch(
        customerId,
        `SELECT
           asset_group.id,
           asset_group.name,
           asset_group.status,
           asset_group_asset.asset,
           asset_group_asset.field_type
         FROM asset_group_asset
         WHERE campaign.id = ${campaignNumericId}
           AND asset_group_asset.status != 'REMOVED'
         LIMIT 20`,
        accessToken
      )
      result.asset_group_asset_raw = rows
      result.asset_group_asset_count = rows.length
    } catch (err: any) {
      result.asset_group_asset_error = {
        status: err?.response?.status,
        detail: err?.response?.data?.error ?? err?.message,
      }
    }

    // 4. Resolve a sample IMAGE asset from asset_group_asset (prefer image over text)
    const IMAGE_FIELD_TYPES = new Set([
      "MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "PORTRAIT_MARKETING_IMAGE",
      "LOGO", "LANDSCAPE_LOGO",
    ])
    if (Array.isArray(result.asset_group_asset_raw) && result.asset_group_asset_raw.length > 0) {
      const imageRow = result.asset_group_asset_raw.find((r: any) => {
        const ft: string = r?.assetGroupAsset?.fieldType ?? r?.asset_group_asset?.field_type ?? ""
        return IMAGE_FIELD_TYPES.has(ft)
      }) ?? result.asset_group_asset_raw[0]
      const firstRow = imageRow
      const assetRef: string =
        firstRow?.assetGroupAsset?.asset ??
        firstRow?.asset_group_asset?.asset ??
        ""

      if (assetRef) {
        result.sample_asset_ref = assetRef
        try {
          const assetRows = await client.rawGaqlSearch(
            customerId,
            `SELECT
               asset.resource_name,
               asset.type,
               asset.image_asset.full_size.url,
               asset.image_asset.full_size.width_pixels,
               asset.image_asset.full_size.height_pixels,
               asset.youtube_video_asset.youtube_video_id,
               asset.text_asset.text
             FROM asset
             WHERE asset.resource_name = '${assetRef}'
             LIMIT 1`,
            accessToken
          )
          result.sample_asset_resolved = assetRows[0] ?? null
        } catch (err: any) {
          result.sample_asset_resolve_error = {
            status: err?.response?.status,
            detail: err?.response?.data?.error ?? err?.message,
          }
        }
      }
    }

    // 5. If ad_group_ad returned rows, also try resolving a sample marketing_image asset
    if (Array.isArray(result.ad_group_ad_raw) && result.ad_group_ad_raw.length > 0) {
      const firstAd = result.ad_group_ad_raw[0]
      const adData = firstAd?.adGroupAd?.ad ?? firstAd?.ad_group_ad?.ad ?? {}
      const rda = adData?.responsiveDisplayAd ?? adData?.responsive_display_ad
      const mktImgs = rda?.marketingImages ?? rda?.marketing_images ?? []
      const firstImgRef: string =
        typeof mktImgs[0] === "string"
          ? mktImgs[0]
          : (mktImgs[0]?.asset ?? mktImgs[0]?.resourceName ?? "")

      if (firstImgRef) {
        result.sample_rda_asset_ref = firstImgRef
        try {
          const assetRows = await client.rawGaqlSearch(
            customerId,
            `SELECT
               asset.resource_name,
               asset.image_asset.full_size.url
             FROM asset
             WHERE asset.resource_name = '${firstImgRef}'
             LIMIT 1`,
            accessToken
          )
          result.sample_rda_asset_resolved = assetRows[0] ?? null
        } catch (err: any) {
          result.sample_rda_asset_resolve_error = err?.message
        }
      }
    }

    // 6. shopping_setting.merchant_id (correct field prefix: campaign.shopping_setting.merchant_id)
    let merchantId = ""
    try {
      const settingRows = await client.rawGaqlSearch(
        customerId,
        `SELECT campaign.shopping_setting.merchant_id
         FROM campaign
         WHERE campaign.id = ${campaignNumericId}
         LIMIT 1`,
        accessToken
      )
      merchantId =
        settingRows[0]?.campaign?.shoppingSetting?.merchantId?.toString() ??
        settingRows[0]?.campaign?.shopping_setting?.merchant_id?.toString() ??
        ""
      result.shopping_merchant_id = merchantId || null
      result.shopping_setting_raw = settingRows[0] ?? null
    } catch (err: any) {
      result.shopping_setting_error = {
        status: err?.response?.status,
        detail: err?.response?.data?.error ?? err?.message,
      }
    }

    // 7. shopping_product — first without merchant filter, then with if we have the id
    try {
      const whereClause = merchantId
        ? `WHERE shopping_product.merchant_center_id = ${merchantId} AND shopping_product.status = 'APPROVED'`
        : ""
      const productRows = await client.rawGaqlSearch(
        customerId,
        `SELECT
           shopping_product.resource_name,
           shopping_product.item_id,
           shopping_product.title,
           shopping_product.price_micros,
           shopping_product.currency_code,
           shopping_product.status,
           shopping_product.merchant_center_id,
           shopping_product.channel,
           shopping_product.feed_label,
           shopping_product.language_code
         FROM shopping_product
         ${whereClause}
         LIMIT 5`,
        accessToken
      )
      result.shopping_products_raw = productRows
      result.shopping_products_count = productRows.length
    } catch (err: any) {
      result.shopping_products_error = {
        status: err?.response?.status,
        detail: err?.response?.data?.error ?? err?.message,
      }
    }

    return reply.send(result)
  })
}
