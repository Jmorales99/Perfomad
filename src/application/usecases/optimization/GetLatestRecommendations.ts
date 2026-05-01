import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { OptimizationRepository } from "@/infrastructure/repositories/OptimizationRepository"

export interface LatestRecommendationsResult {
  run_id: string | null
  status: string | null
  prompt_version: string | null
  summary: {
    overall_health: string
    headline: string
    health_score?: number
    health_score_criteria?: Record<string, number>
    health_trend?: { direction: string; delta_pts?: number | null }
    alerts?: Array<{ urgency: string; type: string; message: string }>
    next_step?: string
  } | null
  generated_at: string | null
  recommendations: Array<{
    id: string
    external_id: string
    action_type: string
    priority: string
    title: string
    rationale: string | null
    expected_impact: string | null
    params: Record<string, unknown>
    requires_confirmation: boolean
    confidence: number | null
    platform_support: string
    latest_decision: { id: string; decision: "accept" | "reject" | "defer"; created_at: string } | null
    latest_execution_status: "pending" | "succeeded" | "failed" | "manual_required" | "unsupported" | "skipped" | null
  }>
}

export class GetLatestRecommendations {
  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly optimizationRepo: OptimizationRepository
  ) {}

  async execute(userId: string, campaignId: string): Promise<LatestRecommendationsResult> {
    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaign not found")

    const latest = await this.optimizationRepo.getLatestSucceededRun(campaignId, userId)
    if (!latest) {
      return {
        run_id: null,
        status: null,
        prompt_version: null,
        summary: null,
        generated_at: null,
        recommendations: [],
      }
    }

    const recs = await this.optimizationRepo.listRecommendationsByRun(latest.id)
    const recIds = recs.map((r) => r.id)
    const decisionsByRec = await this.optimizationRepo.listDecisionsByRecommendationIds(recIds)
    const decisionIds = [...decisionsByRec.values()].map((d) => d.id)
    const executionsByDecision = await this.optimizationRepo.listLatestExecutionsByDecisionIds(decisionIds)

    const recommendations = recs.map((r) => {
      const decision = decisionsByRec.get(r.id) ?? null
      const execution = decision ? (executionsByDecision.get(decision.id) ?? null) : null
      return {
        id: r.id,
        external_id: r.external_id,
        action_type: r.action_type,
        priority: r.priority,
        title: r.title,
        rationale: r.rationale,
        expected_impact: r.expected_impact,
        params: r.params,
        requires_confirmation: r.requires_confirmation,
        confidence: r.confidence,
        platform_support: r.platform_support,
        latest_decision: decision
          ? { id: decision.id, decision: decision.decision, created_at: decision.created_at }
          : null,
        latest_execution_status: execution?.status ?? null,
      }
    })

    return {
      run_id: latest.id,
      status: latest.status,
      prompt_version: latest.prompt_version ?? null,
      summary: latest.summary,
      generated_at: latest.created_at,
      recommendations,
    }
  }
}
