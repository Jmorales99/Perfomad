import { describe, it, expect, vi, beforeEach } from "vitest"
import { BuildOptimizationInput } from "../BuildOptimizationInput"
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
    allowed_actions: ["pause_campaign", "resume_campaign", "adjust_budget", "flag_for_review"],
    ...overrides,
  }
}

function makeCampaign(overrides: any = {}): any {
  return {
    id: "campaign-1",
    user_id: "user-1",
    name: "Test Campaign",
    platforms: ["meta"],
    status: "active",
    spend_amount: 100,
    start_date: new Date(Date.now() - 10 * 86400000).toISOString(),
    objective: "OUTCOME_TRAFFIC",
    budget_amount: 50,
    currency: "USD",
    budget_local_daily: 50,
    ...overrides,
  }
}

function makeHistoryRow(overrides: any = {}): any {
  return {
    campaign_id: "campaign-1",
    recorded_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    spend: 100,
    impressions: 1000,
    clicks: 25,
    ctr: 0.025,
    conversions: 5,
    revenue: 250,
    reach: 800,
    ...overrides,
  }
}

describe("BuildOptimizationInput", () => {
  let useCase: BuildOptimizationInput
  let mockMetricsHistoryRepo: any
  let mockBenchmarksRepo: any

  beforeEach(() => {
    mockMetricsHistoryRepo = {
      getHistory: vi.fn().mockResolvedValue([makeHistoryRow()]),
    }
    mockBenchmarksRepo = {
      getLatestForSegment: vi.fn().mockResolvedValue({
        version: null,
        segment: null,
        metrics: {},
      }),
    }
    useCase = new BuildOptimizationInput({
      metricsHistoryRepo: mockMetricsHistoryRepo,
      benchmarksRepo: mockBenchmarksRepo,
      adAccountsRepo: { findByUserClientAndPlatform: vi.fn().mockResolvedValue(null) } as any,
    })
  })

  it("returns insufficient_data when days_active < min_days", async () => {
    const result = await useCase.execute({
      campaign: makeCampaign({
        start_date: new Date(Date.now() - 1 * 86400000).toISOString(),
      }),
      platformSupport: "automatic",
      config: makeConfig({ min_days_before_action: 3 }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("insufficient_data")
      expect(result.details.days_active).toBeLessThan(3)
    }
  })

  it("returns insufficient_data when spend < min_spend", async () => {
    mockMetricsHistoryRepo.getHistory.mockResolvedValue([makeHistoryRow({ spend: 5, impressions: 100, clicks: 2 })])
    const result = await useCase.execute({
      campaign: makeCampaign({ spend_amount: 5 }),
      platformSupport: "automatic",
      config: makeConfig({ min_spend_before_action: 50 }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.details.spend).toBeLessThan(50)
    }
  })

  it("builds a valid OptimizationInput v1 when minimums are met", async () => {
    const result = await useCase.execute({
      campaign: makeCampaign(),
      platformSupport: "automatic",
      config: makeConfig(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input.version).toBe("v1")
      expect(result.input.campaign.platform).toBe("meta")
      expect(result.input.metrics.spend).toBe(100)
      expect(result.input.policy.allowed_actions).toContain("pause_campaign")
      expect(result.input.policy.max_budget_adjust_pct).toBe(25)
      expect(result.input.policy.platform_support).toBe("automatic")
    }
  })

  it("omits benchmarks block when no segment data is available", async () => {
    const result = await useCase.execute({
      campaign: makeCampaign(),
      platformSupport: "automatic",
      config: makeConfig(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input.benchmarks).toBeUndefined()
    }
  })

  it("includes benchmarks block when segment data exists", async () => {
    mockBenchmarksRepo.getLatestForSegment.mockResolvedValue({
      version: 1,
      segment: { platform: "meta", spend_tier: "s" },
      metrics: {
        ctr: { p25: 0.01, p50: 0.02, p75: 0.04, p90: 0.06, sample_size: 100 },
      },
    })

    const result = await useCase.execute({
      campaign: makeCampaign(),
      platformSupport: "automatic",
      config: makeConfig(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input.benchmarks).toBeDefined()
      expect(result.input.benchmarks?.metrics?.ctr?.p50).toBe(0.02)
    }
  })
})
