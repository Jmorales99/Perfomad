import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock supabase and env to prevent side-effects during import
vi.mock("@/infrastructure/db/supabaseClient", () => ({
  supabaseAdmin: {},
  supabaseClient: {},
}))
vi.mock("@/config/env", () => ({
  env: {
    SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    NODE_ENV: "development",
  },
}))
vi.mock("@/infrastructure/integrations/TokenManager", () => ({
  TokenManager: vi.fn().mockImplementation(() => ({})),
}))
vi.mock("@/infrastructure/repositories/SupabaseAdAccountsRepository", () => ({
  SupabaseAdAccountsRepository: vi.fn().mockImplementation(() => ({
    findByUserId: vi.fn().mockResolvedValue([]),
  })),
}))

import { EnrichCampaignsWithMetrics } from "../EnrichCampaignsWithMetrics"
import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCampaign(overrides: Record<string, any> = {}) {
  return {
    id: "camp-1",
    user_id: "user-1",
    client_id: "client-1",
    name: "Test Campaign",
    platforms: ["meta"],
    budget_amount: 1000,
    spend_amount: 0,
    currency: "USD",
    status: "active",
    start_date: "2024-01-01T00:00:00Z",
    end_date: null,
    created_at: "2024-01-01T00:00:00Z",
    cached_metrics: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EnrichCampaignsWithMetrics", () => {
  let repo: SupabaseCampaignsRepository
  let useCase: EnrichCampaignsWithMetrics

  beforeEach(() => {
    repo = {
      listByUser: vi.fn().mockResolvedValue([]),
      listByUserAndClient: vi.fn().mockResolvedValue([]),
    } as unknown as SupabaseCampaignsRepository

    useCase = new EnrichCampaignsWithMetrics(repo)
  })

  it("returns empty array when no campaigns exist", async () => {
    const result = await useCase.execute("user-1")
    expect(result).toEqual([])
    expect(repo.listByUser).toHaveBeenCalledWith("user-1")
  })

  it("calls listByUserAndClient when clientId is provided", async () => {
    await useCase.execute("user-1", "client-1")
    expect(repo.listByUserAndClient).toHaveBeenCalledWith("user-1", "client-1")
    expect(repo.listByUser).not.toHaveBeenCalled()
  })

  it("passes through flat cached_metrics unchanged", async () => {
    const stats = { spend: 100, impressions: 5000, clicks: 100, ctr: 0.02 }
    vi.mocked(repo.listByUser).mockResolvedValue([makeCampaign({ cached_metrics: stats })] as any)

    const result = await useCase.execute("user-1")

    expect(result[0].cached_metrics).toEqual(stats)
    expect((result[0] as any).spend_amount).toBe(100)
  })

  it("aggregates per-platform cached_metrics into a flat object", async () => {
    const perPlatformStats = {
      meta: { spend: 100, impressions: 8000, clicks: 160, conversions: 10, revenue: 500, total_sales: 500 },
      google_ads: { spend: 50, impressions: 4000, clicks: 80, conversions: 5, revenue: 200, total_sales: 200 },
    }
    vi.mocked(repo.listByUser).mockResolvedValue([
      makeCampaign({ platforms: ["meta", "google_ads"], cached_metrics: perPlatformStats }),
    ] as any)

    const result = await useCase.execute("user-1")

    const stats = result[0].cached_metrics as any
    expect(stats.spend).toBe(150)
    expect(stats.impressions).toBe(12000)
    expect(stats.clicks).toBe(240)
    expect(stats.conversions).toBe(15)
    expect(stats.revenue).toBe(700)
    expect(stats.total_sales).toBe(700)
    expect((result[0] as any).spend_amount).toBe(150)
  })

  it("derives CTR correctly when aggregating per-platform stats", async () => {
    const perPlatformStats = {
      meta: { spend: 50, impressions: 1000, clicks: 20 },
      google_ads: { spend: 50, impressions: 1000, clicks: 30 },
    }
    vi.mocked(repo.listByUser).mockResolvedValue([
      makeCampaign({ platforms: ["meta", "google_ads"], cached_metrics: perPlatformStats }),
    ] as any)

    const result = await useCase.execute("user-1")

    const stats = result[0].cached_metrics as any
    // 50 clicks / 2000 impressions = 0.025
    expect(stats.ctr).toBeCloseTo(0.025, 3)
  })

  it("returns campaign as-is when cached_metrics is null", async () => {
    const campaign = makeCampaign({ cached_metrics: null, spend_amount: 42 })
    vi.mocked(repo.listByUser).mockResolvedValue([campaign] as any)

    const result = await useCase.execute("user-1")

    expect(result[0].cached_metrics).toBeNull()
    expect((result[0] as any).spend_amount).toBe(42)
  })
})
