import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/infrastructure/integrations/llm/ClaudeClient", () => ({
  ClaudeClient: vi.fn(),
  ClaudeNotConfiguredError: class extends Error {},
}))

import { AnalyzeCampaignOptimization } from "../AnalyzeCampaignOptimization"
import { OPTIMIZATION_OUTPUT_VERSION } from "../schemas/OptimizationOutput"
import type { OptimizationConfig } from "@/infrastructure/repositories/OptimizationConfigRepository"

function makeConfig(overrides: Partial<OptimizationConfig> = {}): OptimizationConfig {
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
    allowed_actions: [
      "pause_campaign",
      "resume_campaign",
      "adjust_budget",
      "flag_for_review",
    ],
    ...overrides,
  }
}

function makeCampaign(overrides: any = {}) {
  return {
    id: "campaign-1",
    user_id: "user-1",
    name: "Test Campaign",
    platforms: ["meta"],
    status: "active",
    spend_usd: 100,
    start_date: new Date(Date.now() - 10 * 86400000).toISOString(),
    objective: "OUTCOME_TRAFFIC",
    budget_usd: 50,
    ...overrides,
  }
}

function makeBuiltInput() {
  return {
    version: 1 as const,
    generated_at: new Date().toISOString(),
    campaign: {
      id: "campaign-1",
      name: "Test Campaign",
      platform: "meta" as const,
      objective: "OUTCOME_TRAFFIC",
      country: null,
      status: "active" as const,
      start_date: new Date(Date.now() - 10 * 86400000).toISOString(),
      days_active: 10,
    },
    budget: {
      local_daily: 50,
      local_lifetime: null,
      platform_daily: 50,
      platform_lifetime: null,
      source_of_truth: "platform" as const,
      drift_pct: 0,
      spend_total: 100,
      spend_period: 100,
      currency: "USD",
    },
    metrics_period: { since: "2025-01-01", until: "2025-01-30", days: 30 },
    metrics: {
      impressions: 1000,
      clicks: 25,
      spend: 100,
      reach: 800,
      ctr: 0.025,
      cpc: 4,
      cpm: 100,
      conversions: 5,
      revenue: 250,
      cpa: 20,
      roa: 2.5,
      conversion_rate: 20,
      frequency: 1.25,
    },
    policy: {
      allowed_actions: ["pause_campaign", "resume_campaign", "adjust_budget", "flag_for_review"] as Array<
        "pause_campaign" | "resume_campaign" | "adjust_budget" | "flag_for_review" | "informational"
      >,
      max_budget_adjust_pct: 25,
      min_days_before_action: 3,
      min_spend_before_action: 20,
      platform_support: "automatic" as const,
    },
  }
}

describe("AnalyzeCampaignOptimization", () => {
  let useCase: AnalyzeCampaignOptimization
  let mockCampaignsRepo: any
  let mockOptimizationRepo: any
  let mockConfigRepo: any
  let mockBuilder: any
  let mockClaudeClient: any

  beforeEach(() => {
    mockCampaignsRepo = {
      findById: vi.fn().mockResolvedValue(makeCampaign()),
    }
    mockOptimizationRepo = {
      countRecentRunsForUser: vi.fn().mockResolvedValue(0),
      findFreshRunByHash: vi.fn().mockResolvedValue(null),
      listRecommendationsByRun: vi.fn().mockResolvedValue([]),
      createRun: vi.fn().mockImplementation(async (run: any) => ({
        id: "run-1",
        ...run,
        created_at: new Date().toISOString(),
      })),
      insertRecommendations: vi.fn().mockImplementation(async (recs: any[]) =>
        recs.map((r, i) => ({
          id: `rec-${i + 1}`,
          ...r,
          created_at: new Date().toISOString(),
        }))
      ),
    }
    mockConfigRepo = { get: vi.fn().mockResolvedValue(makeConfig()) }
    mockBuilder = {
      execute: vi.fn().mockResolvedValue({ ok: true, input: makeBuiltInput() }),
    }
    mockClaudeClient = {
      isConfigured: vi.fn().mockReturnValue(true),
      analyzeCampaign: vi.fn().mockResolvedValue({
        rawText: "{}",
        parsedJson: {
          version: OPTIMIZATION_OUTPUT_VERSION,
          summary: { overall_health: "good", headline: "Looks fine" },
          recommendations: [
            {
              id: "r1",
              action_type: "adjust_budget",
              priority: "medium",
              title: "Increase budget by 10%",
              rationale: "ROAS is high",
              expected_impact: "+5% conversions",
              params: { delta_pct: 10 },
              requires_confirmation: true,
              confidence: 0.7,
            },
          ],
          meta: {},
        },
        model: "claude-sonnet-4-5",
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1234,
      }),
    }

    useCase = new AnalyzeCampaignOptimization(
      mockCampaignsRepo,
      mockOptimizationRepo,
      mockConfigRepo,
      mockBuilder,
      mockClaudeClient
    )
  })

  it("happy path: calls Claude and persists run + recommendation", async () => {
    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.status).toBe("succeeded")
    expect(result.cached).toBe(false)
    expect(mockClaudeClient.analyzeCampaign).toHaveBeenCalledOnce()
    expect(mockOptimizationRepo.createRun).toHaveBeenCalledOnce()
    expect(mockOptimizationRepo.insertRecommendations).toHaveBeenCalledOnce()
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].action_type).toBe("adjust_budget")
  })

  it("returns insufficient_data without calling LLM when builder rejects", async () => {
    mockBuilder.execute.mockResolvedValue({
      ok: false,
      reason: "insufficient_data",
      details: { days_active: 1, spend: 5, min_days: 3, min_spend: 20 },
    })

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.status).toBe("insufficient_data")
    expect(result.insufficient_data).toEqual({
      days_active: 1,
      spend: 5,
      min_days: 3,
      min_spend: 20,
    })
    expect(mockClaudeClient.analyzeCampaign).not.toHaveBeenCalled()
    expect(mockOptimizationRepo.insertRecommendations).not.toHaveBeenCalled()
  })

  it("returns cached run without calling LLM on cache hit", async () => {
    mockOptimizationRepo.findFreshRunByHash.mockResolvedValue({
      id: "cached-run",
      summary: { overall_health: "good", headline: "Cached" },
    })
    mockOptimizationRepo.listRecommendationsByRun.mockResolvedValue([
      {
        id: "rec-cached",
        external_id: "r1",
        action_type: "flag_for_review",
        priority: "low",
        title: "Cached rec",
        rationale: null,
        expected_impact: null,
        params: {},
        requires_confirmation: true,
        confidence: 0.5,
        platform_support: "automatic",
      },
    ])

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.cached).toBe(true)
    expect(result.run_id).toBe("cached-run")
    expect(mockClaudeClient.analyzeCampaign).not.toHaveBeenCalled()
  })

  it("falls back gracefully when Claude returns invalid JSON shape", async () => {
    mockClaudeClient.analyzeCampaign.mockResolvedValue({
      rawText: "garbage",
      parsedJson: { not_a_valid: "structure" },
      model: "claude-sonnet-4-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 10,
    })

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.status).toBe("failed")
    expect(mockOptimizationRepo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: "invalid_llm_response" })
    )
  })

  it("returns failed without calling LLM when ANTHROPIC_API_KEY missing", async () => {
    mockClaudeClient.isConfigured.mockReturnValue(false)

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.status).toBe("failed")
    expect(mockClaudeClient.analyzeCampaign).not.toHaveBeenCalled()
    expect(result.error_message).toMatch(/ANTHROPIC_API_KEY/)
  })

  it("throws when rate limit is exceeded", async () => {
    mockOptimizationRepo.countRecentRunsForUser.mockResolvedValue(10)

    await expect(useCase.execute("user-1", "campaign-1")).rejects.toThrow(/Rate limit/)
    expect(mockClaudeClient.analyzeCampaign).not.toHaveBeenCalled()
  })

  it("clamps adjust_budget delta_pct to max_budget_adjust_pct", async () => {
    mockClaudeClient.analyzeCampaign.mockResolvedValue({
      rawText: "{}",
      parsedJson: {
        version: OPTIMIZATION_OUTPUT_VERSION,
        summary: { overall_health: "warning", headline: "Aggressive" },
        recommendations: [
          {
            id: "r1",
            action_type: "adjust_budget",
            priority: "high",
            title: "Bump 80%",
            rationale: "test",
            expected_impact: "test",
            params: { delta_pct: 80 },
            requires_confirmation: true,
            confidence: 0.9,
          },
        ],
        meta: {},
      },
      model: "claude-sonnet-4-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    })

    await useCase.execute("user-1", "campaign-1")

    const insertCall = mockOptimizationRepo.insertRecommendations.mock.calls[0][0]
    expect(insertCall[0].params.delta_pct).toBe(25)
  })
})
