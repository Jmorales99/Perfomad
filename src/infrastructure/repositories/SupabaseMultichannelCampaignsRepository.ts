import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export type MultichannelCampaignStatus =
  | "draft"
  | "publishing"
  | "active"
  | "paused"
  | "partial_failed"
  | "completed"
  | "archived"

export interface MultichannelCampaign {
  id: string
  user_id: string
  client_id: string
  name: string
  objective?: string | null
  status: MultichannelCampaignStatus
  total_budget_usd?: number | null
  currency: string
  platforms: string[]
  start_date?: string | null
  end_date?: string | null
  created_by: string
  created_at: string
  updated_at: string
  published_at?: string | null
  archived_at?: string | null
}

export interface CreateMultichannelCampaignInput {
  userId: string
  clientId: string
  name: string
  objective?: string
  status?: MultichannelCampaignStatus
  totalBudgetUsd?: number
  currency?: string
  platforms: string[]
  startDate?: string
  endDate?: string
}

export class SupabaseMultichannelCampaignsRepository {
  async create(input: CreateMultichannelCampaignInput): Promise<MultichannelCampaign> {
    const { data, error } = await supabaseAdmin
      .from("multichannel_campaigns")
      .insert({
        user_id: input.userId,
        client_id: input.clientId,
        name: input.name,
        objective: input.objective ?? null,
        status: input.status ?? "draft",
        total_budget_usd: input.totalBudgetUsd ?? null,
        currency: input.currency ?? "USD",
        platforms: input.platforms,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        created_by: input.userId,
      })
      .select()
      .single()

    if (error) throw error
    return data as MultichannelCampaign
  }

  async listByUserAndClient(userId: string, clientId: string): Promise<MultichannelCampaign[]> {
    const { data, error } = await supabaseAdmin
      .from("multichannel_campaigns")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })

    if (error) throw error
    return (data ?? []) as MultichannelCampaign[]
  }

  async findById(userId: string, id: string): Promise<MultichannelCampaign | null> {
    const { data, error } = await supabaseAdmin
      .from("multichannel_campaigns")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle()

    if (error) throw error
    return data as MultichannelCampaign | null
  }

  async update(
    userId: string,
    id: string,
    updates: Partial<Pick<MultichannelCampaign, "status" | "published_at" | "archived_at" | "name" | "objective" | "total_budget_usd" | "platforms" | "start_date" | "end_date">>
  ): Promise<MultichannelCampaign> {
    const { data, error } = await supabaseAdmin
      .from("multichannel_campaigns")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single()

    if (error) throw error
    return data as MultichannelCampaign
  }

  async findCampaignByMultichannelId(multichannelCampaignId: string): Promise<{ id: string; platform_campaign_id: any; platforms: string[]; platform_status: any } | null> {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("id, platform_campaign_id, platforms, platform_status")
      .eq("multichannel_campaign_id", multichannelCampaignId)
      .maybeSingle()

    if (error) throw error
    return data
  }
}
