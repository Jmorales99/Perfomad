import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { OptimizationRepository } from "@/infrastructure/repositories/OptimizationRepository"

export class ListOptimizationRuns {
  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly optimizationRepo: OptimizationRepository
  ) {}

  async execute(userId: string, campaignId: string, limit = 20) {
    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaign not found")

    const runs = await this.optimizationRepo.listRuns(campaignId, userId, limit)
    return runs.map((r) => ({
      id: r.id,
      status: r.status,
      model: r.model,
      prompt_version: r.prompt_version,
      summary: r.summary,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      latency_ms: r.latency_ms,
      error_message: r.error_message,
      created_at: r.created_at,
    }))
  }
}
