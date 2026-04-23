import { describe, it, expect, vi, beforeEach } from "vitest"
import { SyncCampaignBudgetFromPlatform } from "../SyncCampaignBudgetFromPlatform"
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

describe("SyncCampaignBudgetFromPlatform", () => {
  let useCase: SyncCampaignBudgetFromPlatform
  let mockCampaignsRepo: any
  let mockAdAccountsRepo: any
  let mockConfigRepo: any
  let mockClient: any

  beforeEach(() => {
    mockClient = {
      getCampaignBudget: vi.fn().mockResolvedValue({
        daily_budget: 100,
        lifetime_budget: null,
        spend_to_date: 250,
        status: "ACTIVE",
      }),
      refreshAccessToken: vi.fn(),
    }
    vi.mocked(PlatformApiClientFactory.createClient).mockReturnValue(mockClient)

    mockCampaignsRepo = {
      findById: vi.fn().mockResolvedValue({
        id: "campaign-1",
        user_id: "user-1",
        client_id: "client-1",
        platforms: ["meta"],
        platform_campaign_id: { meta: "120000000" },
        budget_local_daily: 100,
        budget_usd: 100,
        budget_source_of_truth: "local",
      }),
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
    mockConfigRepo = { get: vi.fn().mockResolvedValue(makeConfig()) }

    useCase = new SyncCampaignBudgetFromPlatform(
      mockCampaignsRepo,
      mockAdAccountsRepo,
      mockConfigRepo
    )
  })

  it("marks budget as in_sync when local matches platform", async () => {
    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.budget_sync_status).toBe("in_sync")
    expect(result.drift_pct).toBe(0)
    expect(result.platform_daily).toBe(100)
    expect(mockCampaignsRepo.update).toHaveBeenCalledWith(
      "user-1",
      "campaign-1",
      expect.objectContaining({ budget_sync_status: "in_sync" })
    )
  })

  it("marks budget as drifted when difference exceeds 5%", async () => {
    mockClient.getCampaignBudget.mockResolvedValue({
      daily_budget: 80,
      lifetime_budget: null,
      spend_to_date: 100,
      status: "ACTIVE",
    })

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.budget_sync_status).toBe("drifted")
    expect(result.drift_pct).toBeGreaterThan(5)
    expect(mockCampaignsRepo.update).toHaveBeenCalledWith(
      "user-1",
      "campaign-1",
      expect.objectContaining({ budget_sync_status: "drifted" })
    )
  })

  it("promotes platform as source of truth when promoteToSourceOfTruth=true", async () => {
    mockClient.getCampaignBudget.mockResolvedValue({
      daily_budget: 80,
      lifetime_budget: null,
      spend_to_date: 100,
      status: "ACTIVE",
    })

    const result = await useCase.execute("user-1", "campaign-1", {
      promoteToSourceOfTruth: true,
    })

    expect(result.source_of_truth).toBe("platform")
    expect(result.budget_sync_status).toBe("in_sync")
    expect(result.local_daily).toBe(80)
    expect(mockCampaignsRepo.update).toHaveBeenCalledWith(
      "user-1",
      "campaign-1",
      expect.objectContaining({
        budget_source_of_truth: "platform",
        budget_local_daily: 80,
        budget_usd: 80,
      })
    )
  })

  it("returns error status when platform API throws", async () => {
    mockClient.getCampaignBudget.mockRejectedValue(new Error("network down"))

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.budget_sync_status).toBe("error")
    expect(result.error).toMatch(/network down/)
    expect(result.platform_daily).toBeNull()
  })

  it("returns error when campaign is not linked to platform", async () => {
    mockCampaignsRepo.findById.mockResolvedValue({
      id: "campaign-1",
      client_id: "client-1",
      platforms: ["meta"],
      platform_campaign_id: null,
      budget_local_daily: 100,
    })

    const result = await useCase.execute("user-1", "campaign-1")

    expect(result.budget_sync_status).toBe("error")
    expect(result.error).toBe("not_linked")
    expect(mockClient.getCampaignBudget).not.toHaveBeenCalled()
  })
})
