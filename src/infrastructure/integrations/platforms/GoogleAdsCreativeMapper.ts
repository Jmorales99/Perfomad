import type { AdCreative } from "./PlatformApiClient"

/**
 * Subset of AdCreative fields that this mapper populates.
 * creative_id is left for the caller to set.
 */
export type AdCreativeMedia = {
  type: AdCreative["type"]
  thumbnail_url: string | null
  image_url: string | null
  video_url?: string | null
  cards: AdCreative["cards"]
}

/**
 * Pure function: maps Google Ads ad data (from a GAQL response row) to
 * AdCreative media fields.
 *
 * Never throws — returns type "unknown" with null URLs when data is missing
 * or the ad type is not recognised (e.g. RSA, ETA, CALL_AD).
 *
 * Supports both camelCase (REST API default) and snake_case key names for
 * defensive compatibility.
 *
 * @param adType   Raw value from ad_group_ad.ad.type (e.g. "IMAGE_AD")
 * @param adData   The `ad` sub-object from the GAQL response row
 * @param assetMap Map of asset resource_name → { imageUrl?, youtubeId? }
 *                 built by the batch asset query (resolveAssets)
 */
export function buildAdCreativeFromRowData(
  adType: string,
  adData: Record<string, unknown> | null | undefined,
  assetMap: Map<string, { imageUrl?: string; youtubeId?: string }>
): AdCreativeMedia {
  const FALLBACK: AdCreativeMedia = {
    type: "unknown",
    image_url: null,
    thumbnail_url: null,
    video_url: null,
    cards: [],
  }

  if (!adData) return FALLBACK

  // Get field by camelCase or snake_case (whichever is present)
  const pick = (obj: Record<string, unknown>, cc: string, sc: string): unknown =>
    obj[cc] !== undefined && obj[cc] !== null ? obj[cc] : obj[sc]

  const type = (adType ?? "").toUpperCase()

  // ── IMAGE_AD: direct image URL ───────────────────────────────────────────────
  if (type === "IMAGE_AD") {
    const ia = pick(adData, "imageAd", "image_ad") as Record<string, unknown> | undefined
    if (ia) {
      const imageUrl = (pick(ia, "imageUrl", "image_url") as string | undefined) ?? null
      if (imageUrl) {
        return { type: "image", image_url: imageUrl, thumbnail_url: imageUrl, video_url: null, cards: [] }
      }
    }
  }

  // ── RESPONSIVE_DISPLAY_AD: images via asset batch resolution ─────────────────
  if (type === "RESPONSIVE_DISPLAY_AD") {
    const rda = pick(adData, "responsiveDisplayAd", "responsive_display_ad") as
      | Record<string, unknown>
      | undefined
    if (rda) {
      const mktImgs = ((pick(rda, "marketingImages", "marketing_images") as any[]) ?? [])
      const sqImgs  = ((pick(rda, "squareMarketingImages", "square_marketing_images") as any[]) ?? [])

      const allRefs = [...mktImgs, ...sqImgs]
        .map((img) =>
          img && typeof img === "object"
            ? ((img as any).asset as string | undefined) ?? ((img as any).resourceName as string | undefined)
            : undefined
        )
        .filter((r): r is string => typeof r === "string")

      const resolvedUrls = allRefs
        .map((ref) => assetMap.get(ref)?.imageUrl)
        .filter((u): u is string => typeof u === "string")

      if (resolvedUrls.length === 0) return FALLBACK

      if (resolvedUrls.length === 1) {
        return {
          type: "image",
          image_url: resolvedUrls[0],
          thumbnail_url: resolvedUrls[0],
          video_url: null,
          cards: [],
        }
      }

      // Multiple images → carousel (up to 8 cards)
      const cards = resolvedUrls
        .slice(0, 8)
        .map((url) => ({ thumbnail_url: url, link: null, name: null }))
      return {
        type: "carousel",
        image_url: resolvedUrls[0],
        thumbnail_url: resolvedUrls[0],
        video_url: null,
        cards,
      }
    }
  }

  // ── VIDEO_AD: YouTube ID via asset resolution ────────────────────────────────
  if (type === "VIDEO_AD") {
    const va = pick(adData, "videoAd", "video_ad") as Record<string, unknown> | undefined
    if (va) {
      const videoObj = pick(va, "video", "video") as Record<string, unknown> | undefined
      const assetRef = videoObj
        ? (pick(videoObj, "asset", "asset") as string | undefined)
        : undefined
      const youtubeId = assetRef ? assetMap.get(assetRef)?.youtubeId : undefined
      if (youtubeId) {
        return {
          type: "video",
          image_url: null,
          thumbnail_url: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
          video_url: `https://www.youtube.com/watch?v=${youtubeId}`,
          cards: [],
        }
      }
    }
  }

  return FALLBACK
}

/**
 * Collects all asset resource_name values referenced in an ad's media fields.
 * Supports VIDEO_AD and RESPONSIVE_DISPLAY_AD asset references.
 *
 * Exported for unit testing.
 */
export function collectAssetResourceNames(
  adData: Record<string, unknown> | null | undefined,
  out: Set<string>
): void {
  if (!adData) return

  const addRef = (obj: unknown): void => {
    if (typeof obj === "string" && obj.startsWith("customers/")) {
      out.add(obj)
      return
    }
    if (obj && typeof obj === "object") {
      const a = (obj as any).asset
      if (typeof a === "string" && a.startsWith("customers/")) out.add(a)
    }
  }

  // VIDEO_AD: video.asset
  const va = (adData as any).videoAd ?? (adData as any).video_ad
  if (va?.video) addRef(va.video)

  // RESPONSIVE_DISPLAY_AD: marketing_images and square_marketing_images
  const rda = (adData as any).responsiveDisplayAd ?? (adData as any).responsive_display_ad
  if (rda) {
    const mktImgs = rda.marketingImages ?? rda.marketing_images ?? []
    const sqImgs  = rda.squareMarketingImages ?? rda.square_marketing_images ?? []
    for (const img of [...mktImgs, ...sqImgs]) addRef(img)
  }
}
