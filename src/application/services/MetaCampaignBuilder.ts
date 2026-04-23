import { MetaApiClient } from "@/infrastructure/integrations/platforms/MetaApiClient"
import { createClient } from "@supabase/supabase-js"
import { env } from "@/config/env"

export interface MetaBuildInput {
  adAccountId: string
  pageId: string
  campaign: {
    campaignId: string // already created externally by CreateCampaign use case
    name: string
  }
  adSet: {
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
  }
  creative: {
    headline: string
    primaryText: string
    description?: string
    cta?: string
    link: string
  }
  /** Supabase Storage public URL or signed URL for the media asset */
  mediaUrl: string
  mediaType: "image" | "video"
  mediaFilename?: string
}

export interface MetaBuildResult {
  adSetId: string
  creativeId: string
  adId: string
}

interface PartialBuild {
  adSetId?: string
  creativeId?: string
  adId?: string
}

/**
 * Orchestrates the full Meta ad hierarchy below the Campaign level:
 * AdSet → media upload → AdCreative → Ad
 *
 * On any failure, performs best-effort synchronous rollback in reverse order.
 */
export class MetaCampaignBuilder {
  constructor(private readonly client: MetaApiClient) {}

  async build(input: MetaBuildInput, accessToken: string): Promise<MetaBuildResult> {
    const partial: PartialBuild = {}

    try {
      // 1. Ad Set
      const { adSetId } = await this.client.createAdSet(
        {
          adAccountId: input.adAccountId,
          campaignId: input.campaign.campaignId,
          name: input.adSet.name,
          dailyBudget: input.adSet.dailyBudget,
          lifetimeBudget: input.adSet.lifetimeBudget,
          billingEvent: input.adSet.billingEvent,
          optimizationGoal: input.adSet.optimizationGoal,
          bidStrategy: input.adSet.bidStrategy,
          targeting: input.adSet.targeting,
          startTime: input.adSet.startTime,
          endTime: input.adSet.endTime,
          status: "PAUSED",
        },
        accessToken
      )
      partial.adSetId = adSetId

      // 2. Download media from Supabase Storage and upload to Meta
      const mediaBuffer = await this.downloadBuffer(input.mediaUrl)
      const filename = input.mediaFilename || (input.mediaType === "video" ? "ad.mp4" : "ad.jpg")

      let imageHash: string | undefined
      let videoId: string | undefined

      if (input.mediaType === "image") {
        const result = await this.client.uploadAdImage(input.adAccountId, mediaBuffer, filename, accessToken)
        imageHash = result.imageHash
      } else {
        const result = await this.client.uploadAdVideo(input.adAccountId, mediaBuffer, filename, accessToken)
        videoId = result.videoId
      }

      // 3. Ad Creative
      const { creativeId } = await this.client.createAdCreative(
        {
          adAccountId: input.adAccountId,
          name: `${input.campaign.name} — Creative`,
          pageId: input.pageId,
          imageHash,
          videoId,
          link: input.creative.link,
          headline: input.creative.headline,
          primaryText: input.creative.primaryText,
          description: input.creative.description,
          cta: input.creative.cta,
        },
        accessToken
      )
      partial.creativeId = creativeId

      // 4. Ad
      const { adId } = await this.client.createAd(
        {
          adAccountId: input.adAccountId,
          name: `${input.campaign.name} — Ad`,
          adSetId,
          creativeId,
          status: "PAUSED",
        },
        accessToken
      )
      partial.adId = adId

      return { adSetId, creativeId, adId }
    } catch (err) {
      await this.rollback(partial, accessToken)
      throw err
    }
  }

  /** Generate a preview HTML embed for the given creative. */
  async generatePreview(
    creativeId: string,
    adFormat: string,
    accessToken: string
  ): Promise<{ body: string }> {
    return this.client.generateAdPreview(creativeId, adFormat, accessToken)
  }

  private async rollback(partial: PartialBuild, accessToken: string): Promise<void> {
    if (partial.adId) await this.client.deleteAd(partial.adId, accessToken)
    if (partial.creativeId) await this.client.deleteAdCreative(partial.creativeId, accessToken)
    if (partial.adSetId) await this.client.deleteAdSet(partial.adSetId, accessToken)
  }

  private async downloadBuffer(url: string): Promise<Buffer> {
    // Detect signed Supabase URLs vs absolute URLs
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? (env as any).SUPABASE_SECRET_KEY ?? ""
    const supabase = createClient(env.SUPABASE_URL, serviceKey)

    if (url.startsWith(env.SUPABASE_URL)) {
      // Extract storage path: everything after /storage/v1/object/sign/ or /public/
      const match = url.match(/\/storage\/v1\/object\/(?:sign|public)\/[^/]+\/(.+?)(?:\?|$)/)
      if (match) {
        const path = decodeURIComponent(match[1])
        // Determine bucket from URL segment before path
        const bucketMatch = url.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\//)
        const bucket = bucketMatch?.[1] ?? "perfomad-images"
        const { data, error } = await supabase.storage.from(bucket).download(path)
        if (error || !data) throw new Error(`Failed to download media from Supabase: ${error?.message}`)
        const arrayBuffer = await data.arrayBuffer()
        return Buffer.from(arrayBuffer)
      }
    }

    // Fallback: generic HTTP fetch
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Failed to download media: ${resp.status} ${resp.statusText}`)
    const arrayBuffer = await resp.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
