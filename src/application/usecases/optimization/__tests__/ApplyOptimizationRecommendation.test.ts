import { describe, it, expect, vi, beforeEach } from "vitest"
import { ApplyOptimizationRecommendation } from "../ApplyOptimizationRecommendation"
import type { OptimizationConfig } from "@/infrastructure/repositories/OptimizationConfigRepository"

vi.mock("@/infrastructure/integrations/platforms/PlatformApiClientFactory", () => ({
  PlatformApiClientFactory: { createClient: vi.fn() },
}))

vi.mock("@/infrastructure/integrations/TokenManager", () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
  })),
}))

vi.mock("@/infrastructure/security/AuditLogger", () => ({
  AuditLogger: vi.fn().mockImplementation(() => ({
    logPlatformApiCall: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"

function makeConfig(): OptimizationConfig {
  return {
    id: "default",
    mvp_actions_enabled: true,
    auto_apply_policy: "off",
    budget_drift_threshold_pct: 5,
    analysis_cache_ttl_hours: 12,
    max_budget_adjust_pct: 25,
    min_days_before_action: 3,
    min_spend_before_action: 20,
    analyze_rate_limit_per_hour: 10,
    llm_model: "claude-sonnet-4-5",
    llm_max_tokens: 2000,
    prompt_version: "v1",
    allowed_actions: ["pause_campaign", "resume_campaign", "adjust_budget", "flag_for_review"],
  }
}

function makeRecommendation(overrides: any = {}) {
  return {
    id: "rec-1",
    run_id: "run-1",
    campaign_id: "campaign-1",
    user_id: "user-1",
    external_id: "r1",
    action_type: "pause_campaign",
    priority: "high",
    title: "Pause it",
    rationale: "Bad ROI",
    expected_impact: "Stop bleeding",
    params: {},
    requires_confirmation: true,
    confidence: 0.8,
    applicable_to_platform: true,
    platform_support: "automatic" as const,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeCampaign(overrides: any = {}) {
  return {
    id: "campaign-1",
    user_id: "user-1",
    client_id: "client-1",
    name: "Test",
    platforms: ["meta"],
    platform_campaign_id: { meta: "120000000" },
    budget_amount: 50,
    currency: "USD",
    budget_local_daily: 50,
    status: "active",
    ...overrides,
  }
}

describe("ApplyOptimizationRecommendation", () => {
  let useCase: ApplyOptimizationRecommendation
  let mockCampaignsRepo: any
  let mockAdAccountsRepo: any
  let mockOptimizationRepo: any
  let mockConfigRepo: any
  let mockPlatformClient: any

  beforeEach(() => {
    mockPlatformClient = {
      updateCampaignStatus: vi.fn().mockResolvedValue(undefined),
      updateCampaignBudget: vi.fn().mockResolvedValue(undefined),
      refreshAccessToken: vi.fn(),
    }
    vi.mocked(PlatformApiClientFactory.createClient).mockReturnValue(mockPlatformClient)

    mockCampaignsRepo = {
      findById: vi.fn().mockResolvedValue(makeCampaign()),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mockAdAccountsRepo = {
      findByUserClientAndPlatform: vi.fn().mockResolvedValue({
        id: "ad-1",
        platform_account_id: "act_1",
        access_token: "x",
        refresh_token: "y",
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      }),
    }
    mockOptimizationRepo = {
      findRecommendationById: vi.fn().mockResolvedValue(makeRecommendation()),
      upsertDecision: vi.fn().mockResolvedValue({
        id: "decision-1",
        recommendation_id: "rec-1",
        campaign_id: "campaign-1",
        user_id: "user-1",
        decision: "accept",
        override_params: null,
        notes: null,
        created_at: new Date().toISOString(),
      }),
      findExecutionByKey: vi.fn().mockResolvedValue(null),
      createExecution: vi.fn().mockImplementation(async (e: any) => ({
        id: "exec-1",
        ...e,
        started_at: new Date().toISOString(),
      })),
    }
    mockConfigRepo = { get: vi.fn().mockResolvedValue(makeConfig()) }

    useCase = new ApplyOptimizationRecommendation(
      mockCampaignsRepo,
      mockAdAccountsRepo,
      mockOptimizationRepo,
      mockConfigRepo
    )
  })

  it("happy path: accepts pause_campaign and updates Meta", async () => {
    const result = await useCase.execute({
      userId: "user-1",
      campaignId: "campaign-1",
      recommendationId: "rec-1",
      decision: "accept",
    })

    expect(result.status).toBe("succeeded")
    expect(mockPlatformClient.updateCampaignStatus).toHaveBeenCalledWith(
      "120000000",
      "PAUSED",
      "access-token",
      { platformAccountId: "act_1" }
    )
    expect(mockCampaignsRepo.update).toHaveBeenCalledWith(
      "user-1",
      "campaign-1",
      expect.objectContaining({ status: "paused" })
    )
  })

  it("returns rejected without calling platform when decision = reject", async () => {
    const result = await useCase.execute({
      userId: "user-1",
      campaignId: "campaign-1",
      recommendationId: "rec-1",
      decision: "reject",
    })

    expect(result.status).toBe("rejected")
    expect(mockPlatformClient.updateCampaignStatus).not.toHaveBeenCalled()
  })

  it("returns idempotent_replay on second apply with same execution_key", async () => {
    mockOptimizationRepo.findExecutionByKey.mockResolvedValue({
      id: "exec-existing",
      status: "succeeded",
      platform: "meta",
      action_type: "pause_campaign",
      error_message: null,
    })

    const result = await useCase.execute({
      userId: "user-1",
      campaignId: "campaign-1",
      recommendationId: "rec-1",
      decision: "accept",
    })

    expect(result.idempotent_replay).toBe(true)
    expect(result.status).toBe("succeeded")
    expect(mockPlatformClient.updateCampaignStatus).not.toHaveBeenCalled()
  })

  it("returns unsupported for tiktok and skips platform call", async () => {
    mockCampaignsRepo.findById.mockResolvedValue(
      makeCampaign({ platforms: ["tiktok"], platform_campaign_id: { tiktok: "tt-1" } })
    )

    const result = await useCase.execute({
      userId: "user-1",
      campaignId: "campaign-1",
      recommendationId: "rec-1",
      decision: "accept",
    })

    expect(result.status).toBe("unsupported")
    expect(result.platform).toBe("tiktok")
    expect(mockPlatformClient.updateCampaignStatus).not.toHaveBeenCalled()
    expect(mockOptimizationRepo.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unsupported", platform: "tiktok" })
    )
  })

  it("throws when action_type is not in allowed_actions whitelist", async () => {
    mockOptimizationRepo.findRecommendationById.mockResolvedValue(
      makeRecommendation({ action_type: "create_new_campaign" })
    )

    await expect(
      useCase.execute({
        userId: "user-1",
        campaignId: "campaign-1",
        recommendationId: "rec-1",
        decision: "accept",
      })
    ).rejects.toThrow(/not currently allowed/)
  })

  it("returns skipped for informational/flag_for_review without platform call", async () => {
    mockOptimizationRepo.findRecommendationById.mockResolvedValue(
      makeRecommendation({ action_type: "flag_for_review" })
    )

    const result = await useCase.execute({
      userId: "user-1",
      campaignId: "campaign-1",
      recommendationId: "rec-1",
      decision: "accept",
    })

    expect(result.status).toBe("skipped")
    expect(mockPlatformClient.updateCampaignStatus).not.toHaveBeenCalled()
  })

  it("computes new budget honoring the 25% cap when delta_pct is excessive", async () => {
    mockOptimizationRepo.findRecommendationById.mockResolvedValue(
      makeRecommendation({ action_type: "adjust_budget", params: { delta_pct: 200 } })
    )

    await useCase.execute({
      userId: "user-1",
      campaignId: "campaign-1",
      recommendationId: "rec-1",
      decision: "accept",
    })

    expect(mockPlatformClient.updateCampaignBudget).toHaveBeenCalledOnce()
    const [, newBudget, , opts] = mockPlatformClient.updateCampaignBudget.mock.calls[0] as [
      string,
      number,
      string,
      { platformAccountId?: string },
    ]
    expect(opts).toEqual({ platformAccountId: "act_1" })
    expect(newBudget).toBeCloseTo(50 * 1.25, 2)
  })
})
