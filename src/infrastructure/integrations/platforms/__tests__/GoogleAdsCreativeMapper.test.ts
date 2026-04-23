import { describe, it, expect } from "vitest"
import {
  buildAdCreativeFromRowData,
  collectAssetResourceNames,
} from "../GoogleAdsCreativeMapper"

const EMPTY_MAP = new Map<string, { imageUrl?: string; youtubeId?: string }>()

// ── buildAdCreativeFromRowData ────────────────────────────────────────────────

describe("buildAdCreativeFromRowData", () => {
  it("returns type unknown for RSA (text only)", () => {
    const result = buildAdCreativeFromRowData(
      "RESPONSIVE_SEARCH_AD",
      { responsiveSearchAd: { headlines: [{ text: "Hello" }], descriptions: [] } },
      EMPTY_MAP
    )
    expect(result.type).toBe("unknown")
    expect(result.image_url).toBeNull()
    expect(result.thumbnail_url).toBeNull()
    expect(result.video_url).toBeNull()
    expect(result.cards).toHaveLength(0)
  })

  it("returns type unknown for null adData", () => {
    const result = buildAdCreativeFromRowData("IMAGE_AD", null, EMPTY_MAP)
    expect(result.type).toBe("unknown")
  })

  it("returns type unknown for undefined adData", () => {
    const result = buildAdCreativeFromRowData("IMAGE_AD", undefined, EMPTY_MAP)
    expect(result.type).toBe("unknown")
  })

  // ── IMAGE_AD ───────────────────────────────────────────────────────────────

  it("returns image type for IMAGE_AD with direct imageUrl (camelCase)", () => {
    const result = buildAdCreativeFromRowData(
      "IMAGE_AD",
      { imageAd: { imageUrl: "https://example.com/image.jpg" } },
      EMPTY_MAP
    )
    expect(result.type).toBe("image")
    expect(result.image_url).toBe("https://example.com/image.jpg")
    expect(result.thumbnail_url).toBe("https://example.com/image.jpg")
    expect(result.video_url).toBeNull()
  })

  it("handles snake_case field names (IMAGE_AD)", () => {
    const result = buildAdCreativeFromRowData(
      "IMAGE_AD",
      { image_ad: { image_url: "https://example.com/snake.jpg" } },
      EMPTY_MAP
    )
    expect(result.type).toBe("image")
    expect(result.image_url).toBe("https://example.com/snake.jpg")
  })

  it("returns unknown for IMAGE_AD with no URL", () => {
    const result = buildAdCreativeFromRowData(
      "IMAGE_AD",
      { imageAd: { imageUrl: null } },
      EMPTY_MAP
    )
    expect(result.type).toBe("unknown")
  })

  // ── VIDEO_AD ───────────────────────────────────────────────────────────────

  it("returns video type with YouTube thumbnail when asset is resolved", () => {
    const assetMap = new Map([
      ["customers/123/assets/456", { youtubeId: "abc123YT" }],
    ])
    const result = buildAdCreativeFromRowData(
      "VIDEO_AD",
      { videoAd: { video: { asset: "customers/123/assets/456" } } },
      assetMap
    )
    expect(result.type).toBe("video")
    expect(result.thumbnail_url).toBe("https://img.youtube.com/vi/abc123YT/hqdefault.jpg")
    expect(result.video_url).toBe("https://www.youtube.com/watch?v=abc123YT")
    expect(result.image_url).toBeNull()
  })

  it("returns unknown for VIDEO_AD when asset is not in map (partial failure)", () => {
    const result = buildAdCreativeFromRowData(
      "VIDEO_AD",
      { videoAd: { video: { asset: "customers/123/assets/missing" } } },
      EMPTY_MAP
    )
    expect(result.type).toBe("unknown")
  })

  // ── RESPONSIVE_DISPLAY_AD ──────────────────────────────────────────────────

  it("returns image type for RESPONSIVE_DISPLAY_AD with single resolved asset", () => {
    const assetMap = new Map([
      ["customers/123/assets/789", { imageUrl: "https://example.com/display.jpg" }],
    ])
    const result = buildAdCreativeFromRowData(
      "RESPONSIVE_DISPLAY_AD",
      {
        responsiveDisplayAd: {
          marketingImages: [{ asset: "customers/123/assets/789" }],
          squareMarketingImages: [],
        },
      },
      assetMap
    )
    expect(result.type).toBe("image")
    expect(result.image_url).toBe("https://example.com/display.jpg")
    expect(result.thumbnail_url).toBe("https://example.com/display.jpg")
    expect(result.cards).toHaveLength(0)
  })

  it("returns carousel for RESPONSIVE_DISPLAY_AD with multiple resolved assets", () => {
    const assetMap = new Map([
      ["customers/123/assets/1", { imageUrl: "https://example.com/img1.jpg" }],
      ["customers/123/assets/2", { imageUrl: "https://example.com/img2.jpg" }],
      ["customers/123/assets/3", { imageUrl: "https://example.com/img3.jpg" }],
    ])
    const result = buildAdCreativeFromRowData(
      "RESPONSIVE_DISPLAY_AD",
      {
        responsiveDisplayAd: {
          marketingImages: [
            { asset: "customers/123/assets/1" },
            { asset: "customers/123/assets/2" },
            { asset: "customers/123/assets/3" },
          ],
          squareMarketingImages: [],
        },
      },
      assetMap
    )
    expect(result.type).toBe("carousel")
    expect(result.cards).toHaveLength(3)
    expect(result.cards[0].thumbnail_url).toBe("https://example.com/img1.jpg")
    expect(result.image_url).toBe("https://example.com/img1.jpg")
  })

  it("returns unknown when RESPONSIVE_DISPLAY_AD assets are missing from map", () => {
    const result = buildAdCreativeFromRowData(
      "RESPONSIVE_DISPLAY_AD",
      {
        responsiveDisplayAd: {
          marketingImages: [{ asset: "customers/123/assets/gone" }],
          squareMarketingImages: [],
        },
      },
      EMPTY_MAP
    )
    expect(result.type).toBe("unknown")
    expect(result.image_url).toBeNull()
  })

  it("uses squareMarketingImages when marketingImages produces no URLs", () => {
    const assetMap = new Map([
      ["customers/123/assets/sq1", { imageUrl: "https://example.com/square.jpg" }],
    ])
    const result = buildAdCreativeFromRowData(
      "RESPONSIVE_DISPLAY_AD",
      {
        responsiveDisplayAd: {
          marketingImages: [],
          squareMarketingImages: [{ asset: "customers/123/assets/sq1" }],
        },
      },
      assetMap
    )
    expect(result.type).toBe("image")
    expect(result.image_url).toBe("https://example.com/square.jpg")
  })

  it("caps carousel cards at 8 even when more assets exist", () => {
    const entries = Array.from({ length: 10 }, (_, i) => [
      `customers/1/assets/${i}`,
      { imageUrl: `https://example.com/img${i}.jpg` },
    ] as [string, { imageUrl: string }])
    const assetMap = new Map(entries)
    const result = buildAdCreativeFromRowData(
      "RESPONSIVE_DISPLAY_AD",
      {
        responsiveDisplayAd: {
          marketingImages: entries.map(([asset]) => ({ asset })),
          squareMarketingImages: [],
        },
      },
      assetMap
    )
    expect(result.type).toBe("carousel")
    expect(result.cards.length).toBeLessThanOrEqual(8)
  })
})

// ── collectAssetResourceNames ─────────────────────────────────────────────────

describe("collectAssetResourceNames", () => {
  it("collects responsive_display_ad marketingImages asset refs", () => {
    const out = new Set<string>()
    collectAssetResourceNames(
      {
        responsiveDisplayAd: {
          marketingImages: [{ asset: "customers/1/assets/A" }],
          squareMarketingImages: [{ asset: "customers/1/assets/B" }],
        },
      },
      out
    )
    expect(out.has("customers/1/assets/A")).toBe(true)
    expect(out.has("customers/1/assets/B")).toBe(true)
  })

  it("collects video_ad video.asset ref", () => {
    const out = new Set<string>()
    collectAssetResourceNames(
      { videoAd: { video: { asset: "customers/1/assets/V" } } },
      out
    )
    expect(out.has("customers/1/assets/V")).toBe(true)
  })

  it("handles snake_case keys (video_ad)", () => {
    const out = new Set<string>()
    collectAssetResourceNames(
      { video_ad: { video: { asset: "customers/2/assets/SN" } } },
      out
    )
    expect(out.has("customers/2/assets/SN")).toBe(true)
  })

  it("does not add strings that are not asset resource_names", () => {
    const out = new Set<string>()
    collectAssetResourceNames(
      { videoAd: { video: { asset: "not-a-resource-name" } } },
      out
    )
    // "not-a-resource-name" doesn't start with "customers/"
    expect(out.size).toBe(0)
  })

  it("handles null gracefully", () => {
    const out = new Set<string>()
    expect(() => collectAssetResourceNames(null, out)).not.toThrow()
    expect(out.size).toBe(0)
  })

  it("handles empty adData gracefully", () => {
    const out = new Set<string>()
    collectAssetResourceNames({}, out)
    expect(out.size).toBe(0)
  })
})
