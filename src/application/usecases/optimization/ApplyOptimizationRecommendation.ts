import crypto from "node:crypto"
import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import type { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { OptimizationRepository } from "@/infrastructure/repositories/OptimizationRepository"
import type { OptimizationConfigRepository } from "@/infrastructure/repositories/OptimizationConfigRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

export type ApplyDecision = "accept" | "reject"

export interface ApplyParams {
  userId: string
  campaignId: string
  recommendationId: string
  decision: ApplyDecision
  overrideParams?: Record<string, unknown>
  notes?: string
}

export interface ApplyResult {
  decision_id: string
  execution_id: string | null
  status:
    | "succeeded"
    | "failed"
    | "manual_required"
    | "unsupported"
    | "skipped"
    | "rejected"
  platform: string | null
  action_type: string
  message: string
  idempotent_replay: boolean
}

export class ApplyOptimizationRecommendation {
  private tokenManager = new TokenManager()
  private auditLogger = new AuditLogger()

  constructor(
    private readonly campaignsRepo: SupabaseCampaignsRepository,
    private readonly adAccountsRepo: SupabaseAdAccountsRepository,
    private readonly optimizationRepo: OptimizationRepository,
    private readonly configRepo: OptimizationConfigRepository
  ) {}

  async execute(params: ApplyParams): Promise<ApplyResult> {
    const { userId, campaignId, recommendationId, decision } = params

    const recommendation = await this.optimizationRepo.findRecommendationById(
      recommendationId,
      userId
    )
    if (!recommendation || recommendation.campaign_id !== campaignId) {
      throw new Error("Recommendation not found")
    }

    const campaign = await this.campaignsRepo.findById(userId, campaignId)
    if (!campaign) throw new Error("Campaign not found")

    const config = await this.configRepo.get()

    if (
      decision === "accept" &&
      recommendation.action_type !== "informational" &&
      recommendation.action_type !== "flag_for_review" &&
      recommendation.action_type !== "flag_creative" &&
      !config.allowed_actions.includes(recommendation.action_type) &&
      recommendation.action_type !== "pause_ad"
    ) {
      throw new Error(
        `Action "${recommendation.action_type}" is not currently allowed by policy.`
      )
    }

    const savedDecision = await this.optimizationRepo.upsertDecision({
      recommendation_id: recommendation.id,
      campaign_id: campaignId,
      user_id: userId,
      decision,
      override_params: params.overrideParams ?? null,
      notes: params.notes ?? null,
    })

    if (decision === "reject") {
      return {
        decision_id: savedDecision.id,
        execution_id: null,
        status: "rejected",
        platform: null,
        action_type: recommendation.action_type,
        message: "Recomendacion descartada.",
        idempotent_replay: false,
      }
    }

    if (
      recommendation.action_type === "informational" ||
      recommendation.action_type === "flag_for_review" ||
      recommendation.action_type === "flag_creative"
    ) {
      return {
        decision_id: savedDecision.id,
        execution_id: null,
        status: "skipped",
        platform: null,
        action_type: recommendation.action_type,
        message: "Recomendacion informativa: no requiere ejecucion.",
        idempotent_replay: false,
      }
    }

    const platforms = Array.isArray(campaign.platforms) ? campaign.platforms : []
    const primaryPlatform = (platforms[0] || "meta") as Platform

    const executionKey = buildExecutionKey({
      recommendationId: recommendation.id,
      decisionId: savedDecision.id,
      actionType: recommendation.action_type,
      overrideParams: params.overrideParams ?? null,
    })

    const existing = await this.optimizationRepo.findExecutionByKey(executionKey)
    if (existing) {
      const mappedStatus: ApplyResult["status"] =
        existing.status === "pending" ? "failed" : existing.status
      return {
        decision_id: savedDecision.id,
        execution_id: existing.id,
        status: mappedStatus,
        platform: existing.platform,
        action_type: existing.action_type,
        message:
          existing.status === "succeeded"
            ? "Accion ya aplicada previamente (idempotente)."
            : existing.error_message || `Ejecucion previa: ${existing.status}`,
        idempotent_replay: true,
      }
    }

    if (primaryPlatform === "tiktok") {
      const execution = await this.optimizationRepo.createExecution({
        decision_id: savedDecision.id,
        recommendation_id: recommendation.id,
        campaign_id: campaignId,
        user_id: userId,
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        status: "unsupported",
        execution_key: executionKey,
        request_payload: { params: recommendation.params },
        response_payload: { reason: "platform_not_supported_yet" },
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      return {
        decision_id: savedDecision.id,
        execution_id: execution.id,
        status: "unsupported",
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        message:
          "TikTok aun no soporta aplicar optimizaciones automaticas. Realiza el cambio manualmente en TikTok Ads Manager.",
        idempotent_replay: false,
      }
    }

    const platformCampaignId = resolvePlatformCampaignId(campaign, primaryPlatform)
    if (!platformCampaignId) {
      const execution = await this.optimizationRepo.createExecution({
        decision_id: savedDecision.id,
        recommendation_id: recommendation.id,
        campaign_id: campaignId,
        user_id: userId,
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        status: "manual_required",
        execution_key: executionKey,
        error_message: "Campaign is not linked to a platform campaign id",
        completed_at: new Date().toISOString(),
      })
      return {
        decision_id: savedDecision.id,
        execution_id: execution.id,
        status: "manual_required",
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        message:
          "La campania no esta vinculada a la plataforma. Aplica el cambio manualmente.",
        idempotent_replay: false,
      }
    }

    const adAccount = await this.adAccountsRepo.findByUserClientAndPlatform(
      userId,
      (campaign as any).client_id,
      primaryPlatform
    )
    if (!adAccount) {
      const execution = await this.optimizationRepo.createExecution({
        decision_id: savedDecision.id,
        recommendation_id: recommendation.id,
        campaign_id: campaignId,
        user_id: userId,
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        status: "failed",
        execution_key: executionKey,
        error_message: "No active ad account for platform",
        completed_at: new Date().toISOString(),
      })
      return {
        decision_id: savedDecision.id,
        execution_id: execution.id,
        status: "failed",
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        message: "No hay una cuenta publicitaria activa para esta plataforma.",
        idempotent_replay: false,
      }
    }

    const client = PlatformApiClientFactory.createClient(primaryPlatform)
    const accessToken = await this.tokenManager.getValidAccessToken(
      adAccount as any,
      async (refreshToken) => client.refreshAccessToken(refreshToken)
    )

    const overrideParams = params.overrideParams ?? {}

    try {
      let responsePayload: Record<string, unknown> = {}
      if (recommendation.action_type === "pause_campaign") {
        await client.updateCampaignStatus(platformCampaignId, "PAUSED", accessToken, {
          platformAccountId: adAccount.platform_account_id,
        })
        responsePayload = { status: "PAUSED" }
        await this.campaignsRepo.update(userId, campaignId, { status: "paused" } as any)
      } else if (recommendation.action_type === "resume_campaign") {
        await client.updateCampaignStatus(platformCampaignId, "ACTIVE", accessToken, {
          platformAccountId: adAccount.platform_account_id,
        })
        responsePayload = { status: "ACTIVE" }
        await this.campaignsRepo.update(userId, campaignId, { status: "active" } as any)
      } else if (recommendation.action_type === "adjust_budget") {
        const { newBudget, context } = computeNewBudget(
          campaign,
          recommendation.params,
          overrideParams,
          config.max_budget_adjust_pct
        )
        if (newBudget === null) {
          throw new Error("Cannot compute new budget: missing current daily budget.")
        }
        await client.updateCampaignBudget(platformCampaignId, newBudget, accessToken, {
          platformAccountId: adAccount.platform_account_id,
        })
        responsePayload = { new_budget: newBudget, ...context }
        await this.campaignsRepo.update(userId, campaignId, {
          budget_amount: newBudget,
          budget_local_daily: newBudget,
        } as any)
      } else if (recommendation.action_type === "pause_ad") {
        const adId = (recommendation.params as any).ad_id as string | undefined
        if (!adId) throw new Error("pause_ad recommendation is missing ad_id in params")
        await client.updateAdStatus(adId, "PAUSED", accessToken, {
          platformAccountId: adAccount.platform_account_id,
        })
        responsePayload = { ad_id: adId, status: "PAUSED" }
      } else {
        throw new Error(`Unsupported action_type: ${recommendation.action_type}`)
      }

      await this.auditLogger.logPlatformApiCall(
        primaryPlatform,
        `optimization.${recommendation.action_type}`,
        true,
        userId,
        adAccount.id
      )

      const execution = await this.optimizationRepo.createExecution({
        decision_id: savedDecision.id,
        recommendation_id: recommendation.id,
        campaign_id: campaignId,
        user_id: userId,
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        status: "succeeded",
        execution_key: executionKey,
        request_payload: { params: recommendation.params, overrideParams },
        response_payload: responsePayload,
        completed_at: new Date().toISOString(),
      })

      return {
        decision_id: savedDecision.id,
        execution_id: execution.id,
        status: "succeeded",
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        message: "Accion aplicada exitosamente en la plataforma.",
        idempotent_replay: false,
      }
    } catch (err: any) {
      await this.auditLogger.logPlatformApiCall(
        primaryPlatform,
        `optimization.${recommendation.action_type}`,
        false,
        userId,
        adAccount.id,
        err
      )

      const errorMessage = redact(err?.message || String(err)).slice(0, 500)
      const isUnsupported = /not implemented|not supported/i.test(errorMessage)
      const status: "failed" | "manual_required" = isUnsupported
        ? "manual_required"
        : "failed"

      const execution = await this.optimizationRepo.createExecution({
        decision_id: savedDecision.id,
        recommendation_id: recommendation.id,
        campaign_id: campaignId,
        user_id: userId,
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        status,
        execution_key: executionKey,
        request_payload: { params: recommendation.params, overrideParams },
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })

      return {
        decision_id: savedDecision.id,
        execution_id: execution.id,
        status,
        platform: primaryPlatform,
        action_type: recommendation.action_type,
        message:
          status === "manual_required"
            ? "La plataforma aun no soporta aplicar este cambio automaticamente."
            : "No se pudo aplicar la accion. Revisa los logs para mas detalle.",
        idempotent_replay: false,
      }
    }
  }
}

function resolvePlatformCampaignId(campaign: any, platform: string): string | null {
  const field = campaign.platform_campaign_id
  if (!field) return null
  try {
    const parsed = typeof field === "string" ? JSON.parse(field) : field
    return parsed?.[platform] ?? null
  } catch {
    return null
  }
}

function computeNewBudget(
  campaign: any,
  recommendationParams: Record<string, unknown>,
  overrideParams: Record<string, unknown>,
  maxAdjustPct: number
): { newBudget: number | null; context: Record<string, unknown> } {
  const currentDaily =
    Number(campaign.budget_platform_daily) ||
    Number(campaign.budget_local_daily) ||
    Number((campaign as any).budget_amount) ||
    null

  const explicitNewBudget =
    typeof overrideParams.new_budget === "number"
      ? overrideParams.new_budget
      : typeof recommendationParams.new_budget === "number"
        ? (recommendationParams.new_budget as number)
        : null

  if (explicitNewBudget !== null && explicitNewBudget > 0) {
    const base = currentDaily ?? explicitNewBudget
    const pctDiff = base > 0 ? ((explicitNewBudget - base) / base) * 100 : 0
    if (Math.abs(pctDiff) > maxAdjustPct) {
      const capped = base * (1 + Math.sign(pctDiff) * (maxAdjustPct / 100))
      return {
        newBudget: round2(capped),
        context: {
          clamped_from: explicitNewBudget,
          max_adjust_pct: maxAdjustPct,
          base_budget: base,
        },
      }
    }
    return { newBudget: round2(explicitNewBudget), context: { base_budget: base } }
  }

  const deltaPctRaw =
    typeof overrideParams.delta_pct === "number"
      ? overrideParams.delta_pct
      : typeof recommendationParams.delta_pct === "number"
        ? (recommendationParams.delta_pct as number)
        : null

  if (deltaPctRaw === null || currentDaily === null) {
    return { newBudget: null, context: { reason: "missing_delta_or_base" } }
  }

  const deltaPct = Math.max(-maxAdjustPct, Math.min(maxAdjustPct, deltaPctRaw))
  const newBudget = currentDaily * (1 + deltaPct / 100)
  return {
    newBudget: round2(newBudget),
    context: { base_budget: currentDaily, delta_pct: deltaPct },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function buildExecutionKey(params: {
  recommendationId: string
  decisionId: string
  actionType: string
  overrideParams: Record<string, unknown> | null
}): string {
  const payload = JSON.stringify({
    r: params.recommendationId,
    a: params.actionType,
    o: params.overrideParams ?? {},
  })
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 48)
}

function redact(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/(access_token|refresh_token|api_key|secret)[=:]\s*['"]?[A-Za-z0-9._~-]+['"]?/gi, "$1=***")
}
