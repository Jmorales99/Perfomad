import { describe, it, expect, vi, beforeEach } from "vitest"
import { GetDashboardMetrics } from "../GetDashboardMetrics"
import type { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCampaign(overrides: Partial<ReturnType<typeof baseCampaign>> = {}) {
  return { ...baseCampaign(), ...overrides }
}

function baseCampaign() {
  return {
    id: "camp-1",
    user_id: "user-1",
    client_id: "client-1",
    name: "Test Campaign",
    platforms: ["meta"] as ("meta" | "google_ads" | "linkedin" | "tiktok")[],
    budget_usd: 1000,
    spend_usd: 200,
    status: "active" as "active" | "paused" | "completed",
    start_date: "2024-01-01T00:00:00Z",
    end_date: null,
    created_at: "2024-01-01T00:00:00Z",
    mock_stats: null as any,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GetDashboardMetrics", () => {
  let repo: SupabaseCampaignsRepository
  let useCase: GetDashboardMetrics

  beforeEach(() => {
    repo = {
      listByUser: vi.fn().mockResolvedValue([]),
      listByUserAndClient: vi.fn().mockResolvedValue([]),
    } as unknown as SupabaseCampaignsRepository

    useCase = new GetDashboardMetrics(repo)
  })

  it("returns zeroes when no campaigns exist", async () => {
    const result = await useCase.execute("user-1", [])

    expect(result.summary.total_campaigns).toBe(0)
    expect(result.summary.total_spend).toBe(0)
    expect(result.metrics.average_ctr).toBe(0)
    expect(result.metrics.total_clicks).toBe(0)
    expect(result.recent_campaigns).toHaveLength(0)
    expect(result.platform_distribution).toEqual({})
  })

  it("counts campaigns by status", async () => {
    const campaigns = [
      makeCampaign({ id: "1", status: "active" }),
      makeCampaign({ id: "2", status: "active" }),
      makeCampaign({ id: "3", status: "paused" }),
      makeCampaign({ id: "4", status: "completed" }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.summary.total_campaigns).toBe(4)
    expect(result.summary.active_campaigns).toBe(2)
    expect(result.summary.paused_campaigns).toBe(1)
    expect(result.summary.completed_campaigns).toBe(1)
  })

  it("aggregates spend and budget across campaigns", async () => {
    const campaigns = [
      makeCampaign({ id: "1", spend_usd: 100, budget_usd: 500 }),
      makeCampaign({ id: "2", spend_usd: 200, budget_usd: 1000 }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.summary.total_spend).toBe(300)
    expect(result.summary.total_budget).toBe(1500)
    expect(result.summary.budget_utilization).toBeCloseTo(20, 0)
  })

  it("aggregates impressions and clicks from flat mock_stats", async () => {
    const campaigns = [
      makeCampaign({
        id: "1",
        mock_stats: { spend: 100, impressions: 10000, clicks: 200, ctr: 0.02 },
      }),
      makeCampaign({
        id: "2",
        mock_stats: { spend: 50, impressions: 5000, clicks: 100, ctr: 0.02 },
      }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.metrics.total_impressions).toBe(15000)
    expect(result.metrics.total_clicks).toBe(300)
    expect(result.metrics.average_ctr).toBeCloseTo(2, 0) // 300/15000 * 100 = 2%
  })

  it("aggregates metrics from per-platform mock_stats", async () => {
    const campaigns = [
      makeCampaign({
        id: "1",
        platforms: ["meta", "google_ads"],
        mock_stats: {
          meta: { spend: 100, impressions: 8000, clicks: 160, conversions: 10, revenue: 500 },
          google_ads: { spend: 50, impressions: 4000, clicks: 80, conversions: 5, revenue: 200 },
        } as any,
      }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.metrics.total_impressions).toBe(12000)
    expect(result.metrics.total_clicks).toBe(240)
    expect(result.metrics.total_conversions).toBe(15)
  })

  it("calculates CTR as percentage (clicks / impressions * 100)", async () => {
    const campaigns = [
      makeCampaign({
        id: "1",
        mock_stats: { spend: 100, impressions: 1000, clicks: 50, ctr: 0.05 },
      }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.metrics.average_ctr).toBeCloseTo(5, 1)
  })

  it("calculates platform_distribution from campaign platforms", async () => {
    const campaigns = [
      makeCampaign({ id: "1", platforms: ["meta", "google_ads"] }),
      makeCampaign({ id: "2", platforms: ["meta"] }),
      makeCampaign({ id: "3", platforms: ["tiktok"] }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.platform_distribution.meta).toBe(2)
    expect(result.platform_distribution.google_ads).toBe(1)
    expect(result.platform_distribution.tiktok).toBe(1)
    expect(result.platform_distribution.linkedin).toBeUndefined()
  })

  it("limits recent_campaigns to 5 and sorts by created_at descending", async () => {
    const campaigns = Array.from({ length: 8 }, (_, i) =>
      makeCampaign({
        id: `camp-${i}`,
        name: `Campaign ${i}`,
        created_at: new Date(2024, 0, i + 1).toISOString(),
      })
    )

    const result = await useCase.execute("user-1", campaigns)

    expect(result.recent_campaigns).toHaveLength(5)
    expect(result.recent_campaigns[0].name).toBe("Campaign 7") // newest first
  })

  it("handles campaigns without mock_stats gracefully", async () => {
    const campaigns = [
      makeCampaign({ id: "1", mock_stats: undefined as any }),
      makeCampaign({ id: "2", mock_stats: null as any }),
    ]

    const result = await useCase.execute("user-1", campaigns)

    expect(result.metrics.total_impressions).toBe(0)
    expect(result.metrics.total_clicks).toBe(0)
  })

  it("does not call repo when pre-enriched campaigns are passed", async () => {
    const campaigns = [makeCampaign()]
    await useCase.execute("user-1", campaigns)

    expect(repo.listByUser).not.toHaveBeenCalled()
    expect(repo.listByUserAndClient).not.toHaveBeenCalled()
  })

  it("calls listByUserAndClient when clientId is provided and no campaigns pre-passed", async () => {
    const enrichMock = { execute: vi.fn().mockResolvedValue([]) }
    const repoWithEnrich = new GetDashboardMetrics(repo, enrichMock as any)

    await repoWithEnrich.execute("user-1", undefined, "client-1")

    expect(enrichMock.execute).toHaveBeenCalledWith("user-1", "client-1")
  })
})
