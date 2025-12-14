import { supabaseClient, supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export interface CampaignImage {
  id: string
  path: string
  signed_url?: string
}

export interface Campaign {
  id: string
  user_id: string
  platforms: ("meta" | "google_ads" | "linkedin")[]
  name: string
  description?: string
  budget_usd: number
  lifetime_budget?: number // Alternative to daily budget
  spend_usd: number
  status: "active" | "paused" | "completed"
  start_date: string
  end_date: string | null
  created_at: string
  number?: number
  images?: CampaignImage[]
  mock_campaign_id?: string
  last_synced_at?: string
  sync_status?: "pending" | "syncing" | "synced" | "error"
  raw_data_plai?: any // Raw API response from Plai (or any source)
  
  // Meta/Facebook Ads specific fields
  objective?: string // OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_ENGAGEMENT, etc.
  billing_event?: string // IMPRESSIONS, LINK_CLICKS, etc.
  bid_strategy?: string // LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
  special_ad_categories?: string[] // ['HOUSING', 'EMPLOYMENT', 'CREDIT']
  
  // Product pricing (for accurate ROA calculation)
  product_price?: number // Selling price per product unit
  product_cost?: number // Production cost per product unit (optional)
  
  // Platform-specific settings (JSONB for flexibility)
  platform_settings?: {
    meta?: {
      promoted_object?: any
      [key: string]: any
    }
    google_ads?: {
      [key: string]: any
    }
    linkedin?: {
      [key: string]: any
    }
  }
  
  mock_stats?: {
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

export class SupabaseCampaignsRepository {
  // ✅ Listar campañas
  async listByUser(userId: string): Promise<Campaign[]> {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching campaigns:", error)
      throw error
    }

    const campaigns = (data || []) as Campaign[]

    for (const c of campaigns) {
      const { data: imgs } = await supabaseAdmin
        .from("campaign_images")
        .select("id, file_path")
        .eq("campaign_id", c.id)
        .limit(6)

      if (!imgs?.length) {
        c.images = []
        continue
      }

      const signed = await Promise.all(
        imgs.map(async (img) => {
          const { data: signedUrl } = await supabaseAdmin.storage
            .from("campaign-images")
            .createSignedUrl(img.file_path, 60 * 60)
          return {
            id: img.id,
            path: img.file_path,
            signed_url: signedUrl?.signedUrl,
          }
        })
      )

      c.images = signed
    }

    return campaigns
  }

  // ✅ Crear campaña (ahora permite mock_campaign_id y mock_stats)
  async create(
    campaign: Omit<Campaign, "id" | "created_at" | "images"> & {
      images?: { path: string }[]
    }
  ) {
    const { data: lastCampaign, error: fetchError } = await supabaseAdmin
      .from("campaigns")
      .select("number")
      .eq("user_id", campaign.user_id)
      .order("number", { ascending: false })
      .limit(1)
      .single()

    if (fetchError && fetchError.code !== "PGRST116") throw fetchError
    const nextNumber = (lastCampaign?.number ?? 0) + 1

    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .insert({
        user_id: campaign.user_id,
        name: campaign.name,
        platforms: campaign.platforms,
        description: campaign.description || "",
        budget_usd: campaign.budget_usd ?? 0,
        lifetime_budget: campaign.lifetime_budget ?? null,
        spend_usd: 0,
        status: campaign.status ?? "active",
        start_date: campaign.start_date ?? new Date().toISOString(),
        end_date: campaign.end_date ?? null,
        number: nextNumber,
        // Meta/Facebook Ads specific fields
        objective: campaign.objective ?? null,
        billing_event: campaign.billing_event ?? null,
        bid_strategy: campaign.bid_strategy ?? null,
        special_ad_categories: campaign.special_ad_categories ?? null,
        // Platform-specific settings
        platform_settings: campaign.platform_settings ?? null,
        // Plai integration
        mock_campaign_id: campaign.mock_campaign_id ?? null,
        mock_stats: campaign.mock_stats ?? null,
      })
      .select()
      .maybeSingle()

    if (error) throw error

    const created = data as Campaign

    if (campaign.images?.length) {
      const { error: imgError } = await supabaseAdmin
        .from("campaign_images")
        .insert(
          campaign.images.map((img) => ({
            campaign_id: created.id,
            file_path: img.path,
          }))
        )
      if (imgError) console.error("Error guardando imágenes:", imgError)
    }

    return created
  }

  // ✅ Actualizar campaña (permite mock_campaign_id y mock_stats)
  async update(
    userId: string,
    id: string,
    updates: Partial<Campaign> & { images?: { path: string }[] }
  ) {
    const { images, ...campaignData } = updates

    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .update(campaignData)
      .eq("user_id", userId)
      .eq("id", id)
      .select()
      .maybeSingle()

    if (error) throw error

    if (images && Array.isArray(images)) {
      await supabaseAdmin.from("campaign_images").delete().eq("campaign_id", id)

      if (images.length > 0) {
        const { error: imgError } = await supabaseAdmin.from("campaign_images").insert(
          images.map((img) => ({
            campaign_id: id,
            file_path: img.path,
          }))
        )
        if (imgError) console.error("Error actualizando imágenes:", imgError)
      }
    }

    return data as Campaign
  }

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from("campaigns")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)

    if (error) throw error
    return true
  }


  async findById(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    return data as Campaign | null
  }
}