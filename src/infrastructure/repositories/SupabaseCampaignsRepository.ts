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
  spend_usd: number
  status: "active" | "paused" | "completed"
  start_date: string
  end_date: string | null
  created_at: string
  number?: number
  images?: CampaignImage[]
}

export class SupabaseCampaignsRepository {
  // ✅ Listar campañas con imágenes firmadas y adaptadas
  async listByUser(userId: string): Promise<Campaign[]> {
    const { data, error } = await supabaseClient
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) throw error

    const campaigns = data as Campaign[]

    for (const c of campaigns) {
      const { data: imgs } = await supabaseClient
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
            .createSignedUrl(img.file_path, 60 * 60) // 1h
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

  // ✅ Crear campaña con múltiples plataformas e imágenes
  async create(
    campaign: Omit<Campaign, "id" | "created_at" | "images"> & { images?: { path: string }[] }
  ) {
    const { data: lastCampaign, error: fetchError } = await supabaseClient
      .from("campaigns")
      .select("number")
      .eq("user_id", campaign.user_id)
      .order("number", { ascending: false })
      .limit(1)
      .single()

    if (fetchError && fetchError.code !== "PGRST116") throw fetchError
    const nextNumber = (lastCampaign?.number ?? 0) + 1

    const { data, error } = await supabaseClient
      .from("campaigns")
      .insert({
        user_id: campaign.user_id,
        name: campaign.name,
        platforms: campaign.platforms,
        description: campaign.description || "",
        budget_usd: campaign.budget_usd ?? 0,
        spend_usd: 0,
        status: campaign.status ?? "active",
        start_date: campaign.start_date ?? new Date().toISOString(),
        end_date: campaign.end_date ?? null,
        number: nextNumber,
      })
      .select()
      .single()

    if (error) throw error

    const created = data as Campaign

    if (campaign.images?.length) {
      const { error: imgError } = await supabaseClient
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

  // ✅ Actualizar campaña e imágenes asociadas
  async update(userId: string, id: string, updates: Partial<Campaign> & { images?: { path: string }[] }) {
    const { images, ...campaignData } = updates

    const { data, error } = await supabaseClient
      .from("campaigns")
      .update(campaignData)
      .eq("user_id", userId)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    if (images && Array.isArray(images)) {
      await supabaseClient.from("campaign_images").delete().eq("campaign_id", id)

      if (images.length > 0) {
        const { error: imgError } = await supabaseClient.from("campaign_images").insert(
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
    const { error } = await supabaseClient
      .from("campaigns")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)

    if (error) throw error
    return true
  }
}
