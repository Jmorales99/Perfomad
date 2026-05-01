import crypto from "node:crypto"
import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { OptimizationRepository } from "@/infrastructure/repositories/OptimizationRepository"
import type { OptimizationConfigRepository } from "@/infrastructure/repositories/OptimizationConfigRepository"
import type { ClaudeClient } from "@/infrastructure/integrations/llm/ClaudeClient"
import { ClaudeNotConfiguredError } from "@/infrastructure/integrations/llm/ClaudeClient"
import type { BuildOptimizationInput } from "./BuildOptimizationInput"
import {
  buildFallbackOutput,
  optimizationOutputSchema,
  type OptimizationOutput,
  type RecommendationAction,
} from "./schemas/OptimizationOutput"
import type { OptimizationInput } from "./schemas/OptimizationInput"
import { selectPrompt } from "./schemas/systemPrompt"

export type PlatformSupport = "automatic" | "manual_required" | "unsupported"

export interface AnalyzeResult {
  run_id: string
  cached: boolean
  status: "succeeded" | "failed" | "insufficient_data"
  prompt_version: string | null
  summary: OptimizationOutput["summary"] | null
  alerts: OptimizationOutput["alerts"]
  next_step?: string
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
    platform_support: PlatformSupport
  }>
  insufficient_data?: {
    days_active: number
    spend: number
    min_days: number
    min_spend: number
  }
  error_message?: string
}

/**
 * End-to-end optimization analysis: builds input, checks cache, calls Claude,
 * validates the response, and persists run + recommendations.
 */
export class AnalyzeCampaignOptimization {
  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly optimizationRepo: OptimizationRepository,
    private readonly configRepo: OptimizationConfigRepository,
    private readonly builder: BuildOptimizationInput,
    private readonly claudeClient: ClaudeClient
  ) {}

  async execute(userId: string, campaignId: string): Promise<AnalyzeResult> {
    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) {
      throw new Error("Campaign not found")
    }

    const config = await this.configRepo.get()
    const platformSupport = resolvePlatformSupport(campaign)
    const selectedPromptVersion = selectPrompt(
      Array.isArray(campaign.platforms) ? campaign.platforms[0] : campaign.platforms,
      campaign.objective ?? null,
      (campaign as any).is_catalog ?? false
    ).version

    const recentRuns = await this.optimizationRepo.countRecentRunsForUser(userId, 1)
    if (recentRuns >= config.analyze_rate_limit_per_hour) {
      throw new Error(
        `Rate limit exceeded: max ${config.analyze_rate_limit_per_hour} analyses per hour`
      )
    }

    const buildResult = await this.builder.execute({
      campaign,
      platformSupport,
      config,
    })

    if (!buildResult.ok) {
      const run = await this.optimizationRepo.createRun({
        campaign_id: campaign.id,
        user_id: userId,
        input_hash: "insufficient_data",
        prompt_version: selectedPromptVersion,
        model: config.llm_model,
        status: "insufficient_data",
        raw_input: null,
        raw_output: null,
        summary: {
          overall_health: "warning",
          headline: "Datos insuficientes para generar recomendaciones automaticas.",
        },
      })
      return {
        run_id: run.id,
        cached: false,
        status: "insufficient_data",
        prompt_version: selectedPromptVersion,
        summary: run.summary as OptimizationOutput["summary"] | null,
        alerts: [],
        recommendations: [],
        insufficient_data: buildResult.details,
      }
    }

    const input = buildResult.input
    const inputHash = hashInput(input)

    const cached = await this.optimizationRepo.findFreshRunByHash(
      campaign.id,
      inputHash,
      config.analysis_cache_ttl_hours
    )
    if (cached) {
      const recs = await this.optimizationRepo.listRecommendationsByRun(cached.id)
      return {
        run_id: cached.id,
        cached: true,
        status: "succeeded",
        prompt_version: cached.prompt_version ?? null,
        summary: cached.summary as OptimizationOutput["summary"] | null,
        alerts: (cached.summary as any)?.alerts ?? [],
        next_step: (cached.summary as any)?.next_step,
        recommendations: recs.map((r) => ({
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
        })),
      }
    }

    if (!this.claudeClient.isConfigured()) {
      const run = await this.optimizationRepo.createRun({
        campaign_id: campaign.id,
        user_id: userId,
        input_hash: inputHash,
        prompt_version: selectedPromptVersion,
        model: config.llm_model,
        status: "failed",
        raw_input: input,
        error_message: "ANTHROPIC_API_KEY not configured",
      })
      return {
        run_id: run.id,
        cached: false,
        status: "failed",
        prompt_version: selectedPromptVersion,
        summary: null,
        alerts: [],
        recommendations: [],
        error_message:
          "Optimizacion IA no configurada. Falta ANTHROPIC_API_KEY en el backend.",
      }
    }

    let llmResult
    try {
      llmResult = await this.claudeClient.analyzeCampaign(input, {
        model: config.llm_model,
        maxTokens: config.llm_max_tokens,
        platform: input.campaign.platform,
        objective: input.campaign.objective ?? null,
      })
    } catch (err: any) {
      if (err instanceof ClaudeNotConfiguredError) {
        throw err
      }
      const run = await this.optimizationRepo.createRun({
        campaign_id: campaign.id,
        user_id: userId,
        input_hash: inputHash,
        prompt_version: selectedPromptVersion,
        model: config.llm_model,
        status: "failed",
        raw_input: input,
        error_message: redact(err?.message || String(err)).slice(0, 500),
      })
      return {
        run_id: run.id,
        cached: false,
        status: "failed",
        prompt_version: selectedPromptVersion,
        summary: null,
        alerts: [],
        recommendations: [],
        error_message: "El analisis IA fallo. Intenta de nuevo en unos minutos.",
      }
    }

    const parsed = optimizationOutputSchema.safeParse(llmResult.parsedJson)
    const validated: OptimizationOutput = parsed.success
      ? parsed.data
      : buildFallbackOutput(parsed.success ? "unknown" : parsed.error.issues[0]?.message ?? "invalid_shape")

    const runStatus: "succeeded" | "failed" = parsed.success ? "succeeded" : "failed"

    const run = await this.optimizationRepo.createRun({
      campaign_id: campaign.id,
      user_id: userId,
      input_hash: inputHash,
      prompt_version: llmResult.promptVersion,
      model: llmResult.model || config.llm_model,
      status: runStatus,
      raw_input: input,
      raw_output: { text: llmResult.rawText, parsed: llmResult.parsedJson },
      summary: {
        ...validated.summary,
        alerts: validated.alerts,
        next_step: validated.next_step,
      },
      input_tokens: llmResult.inputTokens,
      output_tokens: llmResult.outputTokens,
      latency_ms: llmResult.latencyMs,
      error_message: parsed.success ? null : "invalid_llm_response",
    })

    const sanitized = sanitizeRecommendations(
      validated.recommendations,
      input,
      platformSupport
    )

    const inserted = await this.optimizationRepo.insertRecommendations(
      sanitized.map((r) => ({
        run_id: run.id,
        campaign_id: campaign.id,
        user_id: userId,
        external_id: r.id,
        // "pause_ad" / "flag_creative" are valid Claude outputs but were added to
        // the DB CHECK constraint only in migration 014. Until that migration runs,
        // normalize them so the INSERT never violates the constraint.
        action_type: toDbActionType(r.action_type),
        priority: r.priority,
        title: r.title.slice(0, 200),
        rationale: (r.rationale || "").slice(0, 1000),
        expected_impact: (r.expected_impact || "").slice(0, 400),
        params: r.params ?? {},
        requires_confirmation: true,
        confidence: r.confidence ?? null,
        applicable_to_platform: r.action_type !== "informational",
        platform_support: platformSupportForAction(r.action_type, platformSupport),
        prompt_version: llmResult.promptVersion,
      }))
    )

    return {
      run_id: run.id,
      cached: false,
      status: runStatus,
      prompt_version: llmResult.promptVersion ?? null,
      summary: validated.summary,
      alerts: validated.alerts ?? [],
      next_step: validated.next_step,
      recommendations: inserted.map((r) => ({
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
      })),
    }
  }
}

function resolvePlatformSupport(campaign: any): PlatformSupport {
  const platforms: string[] = Array.isArray(campaign.platforms)
    ? campaign.platforms
    : [campaign.platforms || "meta"]
  const primary = platforms[0] || "meta"
  if (primary === "meta") return "automatic"
  if (primary === "google_ads") return "automatic"
  if (primary === "tiktok") return "unsupported"
  return "manual_required"
}

function platformSupportForAction(
  action: string,
  support: PlatformSupport
): PlatformSupport {
  if (action === "informational" || action === "flag_for_review" || action === "flag_creative") return "automatic"
  return support
}

function sanitizeRecommendations(
  recs: OptimizationOutput["recommendations"],
  input: OptimizationInput,
  _platformSupport: PlatformSupport
): OptimizationOutput["recommendations"] {
  const allowed = new Set(input.policy.allowed_actions)
  const maxAdjustPct = input.policy.max_budget_adjust_pct
  const sanitized: OptimizationOutput["recommendations"] = []
  const seenIds = new Set<string>()

  for (const r of recs.slice(0, 5)) {
    const id = seenIds.has(r.id) ? `${r.id}_${sanitized.length}` : r.id
    seenIds.add(id)

    let actionType = r.action_type
    if (!allowed.has(actionType)) {
      actionType = "flag_for_review"
    }

    const params = { ...(r.params || {}) }
    if (actionType === "pause_ad" && !params.ad_id) {
      // pause_ad without an ad_id is meaningless; demote to flag_creative.
      actionType = "flag_creative"
    }
    if (actionType === "adjust_budget") {
      if (typeof params.delta_pct === "number") {
        const clamped = Math.max(
          -maxAdjustPct,
          Math.min(maxAdjustPct, params.delta_pct)
        )
        params.delta_pct = Number(clamped.toFixed(2))
      } else if (typeof params.new_budget !== "number") {
        actionType = "flag_for_review"
      }
    }

    sanitized.push({
      ...r,
      id,
      action_type: actionType,
      requires_confirmation: true,
      params,
    })
  }

  return sanitized
}

function hashInput(input: OptimizationInput): string {
  const stable = {
    ...input,
    generated_at: undefined,
  }
  const json = JSON.stringify(stable)
  return crypto.createHash("sha256").update(json).digest("hex")
}

function redact(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/(access_token|refresh_token|api_key|secret)[=:]\s*['"]?[A-Za-z0-9._~-]+['"]?/gi, "$1=***")
}

const DB_SAFE_ACTION_TYPES = new Set([
  "pause_campaign",
  "resume_campaign",
  "adjust_budget",
  "flag_for_review",
  "informational",
  "pause_ad",
  "flag_creative",
])

function toDbActionType(actionType: string): RecommendationAction {
  return (DB_SAFE_ACTION_TYPES.has(actionType) ? actionType : "flag_for_review") as RecommendationAction
}
