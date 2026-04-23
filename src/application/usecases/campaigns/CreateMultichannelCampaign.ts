import { SupabaseMultichannelCampaignsRepository } from "@/infrastructure/repositories/SupabaseMultichannelCampaignsRepository"
import type { MultichannelCampaign } from "@/infrastructure/repositories/SupabaseMultichannelCampaignsRepository"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { Campaign } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { SupabaseClientsRepository } from "@/infrastructure/repositories/SupabaseClientsRepository"
import { CreateCampaign } from "@/application/usecases/campaigns/CreateCampaign"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export interface PlatformBudgetInput {
  platform: Platform
  budget: { type: "daily" | "lifetime"; amount: number }
}

export interface CreateMultichannelCampaignInput {
  userId: string
  clientId: string
  name: string
  objective?: string
  totalBudgetUsd?: number
  startDate?: string
  endDate?: string
  platforms: PlatformBudgetInput[]
  // Shared campaign fields delegated to CreateCampaign
  billingEvent?: string
  bidStrategy?: string
  specialAdCategories?: string[]
  targeting?: {
    geoCountries?: string[]
    ageMin?: number
    ageMax?: number
    genders?: string[]
  }
  creative?: {
    pageId?: string
    mediaUrl?: string
    mediaType?: "image" | "video"
    mediaFilename?: string
    headline: string
    primaryText: string
    description?: string
    cta?: string
    link: string
  }
  productPrice?: number
  productCost?: number
}

export interface CreateMultichannelCampaignResult {
  multichannelCampaign: MultichannelCampaign
  campaign: Campaign
  errors: Record<string, string>
}

function derivePlatformStatus(
  platformCampaignIds: Record<string, string>,
  errors: Record<string, string>,
  platforms: string[]
): Record<string, string> {
  const status: Record<string, string> = {}
  for (const p of platforms) {
    if (errors[p]) {
      status[p] = "failed"
    } else if (platformCampaignIds[p]) {
      status[p] = "active"
    } else {
      status[p] = "pending"
    }
  }
  return status
}

function deriveGlobalStatus(platformStatus: Record<string, string>): string {
  const values = Object.values(platformStatus)
  if (values.length === 0) return "draft"
  const hasActive = values.some((v) => v === "active")
  const hasFailed = values.some((v) => v === "failed")
  if (hasActive && hasFailed) return "partial_failed"
  if (hasActive) return "active"
  if (hasFailed) return "partial_failed"
  return "draft"
}

export class CreateMultichannelCampaign {
  private mcRepo: SupabaseMultichannelCampaignsRepository
  private campaignsRepo: SupabaseCampaignsRepository
  private adAccountsRepo: SupabaseAdAccountsRepository
  private clientsRepo: SupabaseClientsRepository

  constructor() {
    this.mcRepo = new SupabaseMultichannelCampaignsRepository()
    this.campaignsRepo = new SupabaseCampaignsRepository()
    this.adAccountsRepo = new SupabaseAdAccountsRepository()
    this.clientsRepo = new SupabaseClientsRepository()
  }

  async execute(input: CreateMultichannelCampaignInput): Promise<CreateMultichannelCampaignResult> {
    // 1. Verify client ownership
    const client = await this.clientsRepo.getById(input.userId, input.clientId)
    if (!client) throw new Error("Client not found or does not belong to this user")

    const platformNames = input.platforms.map((p) => p.platform)

    // 2. Build per-platform budget map for CreateCampaign
    const platformBudgets: Record<string, { budget_type: "daily" | "lifetime"; amount: number }> = {}
    for (const pb of input.platforms) {
      platformBudgets[pb.platform] = { budget_type: pb.budget.type, amount: pb.budget.amount }
    }

    // 3. Create the parent row (status: draft while publishing)
    const parent = await this.mcRepo.create({
      userId: input.userId,
      clientId: input.clientId,
      name: input.name,
      objective: input.objective,
      status: "publishing",
      totalBudgetUsd: input.totalBudgetUsd,
      platforms: platformNames,
      startDate: input.startDate,
      endDate: input.endDate,
    })

    // 4. Delegate platform creation to existing CreateCampaign
    const createCampaign = new CreateCampaign(this.campaignsRepo, this.adAccountsRepo)
    const campaignResult = await createCampaign.execute({
      userId: input.userId,
      clientId: input.clientId,
      name: input.name,
      platforms: platformNames as Platform[],
      objective: input.objective,
      platformBudgets,
      billingEvent: input.billingEvent,
      bidStrategy: input.bidStrategy,
      specialAdCategories: input.specialAdCategories,
      startDate: input.startDate,
      endDate: input.endDate,
      targeting: input.targeting,
      creative: input.creative,
      productPrice: input.productPrice,
      productCost: input.productCost,
    })

    const errors: Record<string, string> = (campaignResult as any)._errors ?? {}

    // 5. Link the campaign to the parent and set platform_status
    const platformCampaignIds: Record<string, string> = (campaignResult as any).platform_campaign_id ?? {}
    const platformStatus = derivePlatformStatus(platformCampaignIds, errors, platformNames)

    await supabaseAdmin
      .from("campaigns")
      .update({
        multichannel_campaign_id: parent.id,
        platform_status: platformStatus,
      })
      .eq("id", campaignResult.id)
      .eq("user_id", input.userId)

    const updatedCampaign = { ...campaignResult, multichannel_campaign_id: parent.id, platform_status: platformStatus }

    // 6. Update parent status and published_at
    const globalStatus = deriveGlobalStatus(platformStatus)
    const updatedParent = await this.mcRepo.update(input.userId, parent.id, {
      status: globalStatus as any,
      published_at: new Date().toISOString(),
    })

    return {
      multichannelCampaign: updatedParent,
      campaign: updatedCampaign,
      errors,
    }
  }
}
