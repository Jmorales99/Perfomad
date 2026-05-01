import { describe, it, expect, vi, beforeEach } from "vitest"
import { GetDashboardMetrics } from "@/application/usecases/campaigns/GetDashboardMetrics"
import { EnrichCampaignsWithMetrics } from "@/application/usecases/campaigns/EnrichCampaignsWithMetrics"

/**
 * Dashboard logic unit tests.
 *
 * Integration-style tests against the full Fastify app would require mocking
 * Supabase auth which involves network calls, so we validate the use-case
 * composition logic here instead.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCampaign(overrides: Record<string, any> = {}) {
  return {
    id: "camp-1",
    user_id: "user-1",
    client_id: "client-1",
    name: "Test Campaign",
    platforms: ["meta"],
    budget_amount: 1000,
    spend_amount: 100,
    currency: "USD",
    status: "active",
    start_date: "2024-01-01T00:00:00Z",
    end_date: null,
    created_at: "2024-01-01T00:00:00Z",
    cached_metrics: { spend: 100, impressions: 5000, clicks: 100, ctr: 0.02, conversions: 10, revenue: 500, total_sales: 500 },
    ...overrides,
  }
}

// ── platform-summary aggregation logic ────────────────────────────────────────

describe("platform-summary aggregation (controller logic extracted)", () => {
  it("assigns campaigns to correct platforms", () => {
    const campaigns = [
      makeCampaign({ id: "1", platforms: ["meta"] }),
      makeCampaign({ id: "2", platforms: ["google_ads"] }),
      makeCampaign({ id: "3", platforms: ["meta", "google_ads"] }),
    ]

    const platforms = ["meta", "google_ads", "linkedin", "tiktok"]
    const summaries = platforms.map((platform) => {
      const platformCampaigns = campaigns.filter((c) =>
        Array.isArray(c.platforms) ? c.platforms.includes(platform) : c.platforms === platform
      )
      return { platform, count: platformCampaigns.length }
    })

    expect(summaries.find((s) => s.platform === "meta")?.count).toBe(2)
    expect(summaries.find((s) => s.platform === "google_ads")?.count).toBe(2)
    expect(summaries.find((s) => s.platform === "linkedin")?.count).toBe(0)
    expect(summaries.find((s) => s.platform === "tiktok")?.count).toBe(0)
  })

  it("aggregates flat cached_metrics for a platform", () => {
    const campaigns = [
      makeCampaign({
        id: "1",
        platforms: ["meta"],
        spend_amount: 100,
        cached_metrics: { spend: 100, impressions: 5000, clicks: 100, ctr: 0.02, conversions: 10, revenue: 500 },
      }),
      makeCampaign({
        id: "2",
        platforms: ["meta"],
        spend_amount: 50,
        cached_metrics: { spend: 50, impressions: 2000, clicks: 40, ctr: 0.02, conversions: 4, revenue: 200 },
      }),
    ]

    const platform = "meta"
    let totalImpressions = 0
    let totalClicks = 0
    let totalRevenue = 0
    let totalSpend = 0

    campaigns
      .filter((c) => c.platforms.includes(platform))
      .forEach((campaign) => {
        totalSpend += campaign.spend_amount || 0
        if (campaign.cached_metrics) {
          const stats = campaign.cached_metrics as any
          if (!(platform in stats)) {
            totalImpressions += stats.impressions || 0
            totalClicks += stats.clicks || 0
            totalRevenue += stats.revenue || 0
          }
        }
      })

    expect(totalSpend).toBe(150)
    expect(totalImpressions).toBe(7000)
    expect(totalClicks).toBe(140)
    expect(totalRevenue).toBe(700)
  })

  it("extracts per-platform metrics when cached_metrics has platform keys", () => {
    const campaign = makeCampaign({
      id: "1",
      platforms: ["meta", "google_ads"],
      spend_amount: 150,
      cached_metrics: {
        meta: { spend: 100, impressions: 8000, clicks: 160, conversions: 10, revenue: 500 },
        google_ads: { spend: 50, impressions: 4000, clicks: 80, conversions: 5, revenue: 200 },
      },
    })

    const stats = campaign.cached_metrics as any
    const metaStats = stats["meta"]
    const googleStats = stats["google_ads"]

    expect(metaStats.impressions).toBe(8000)
    expect(googleStats.impressions).toBe(4000)
  })

  it("returns is_connected=false for platforms with no ad accounts", () => {
    const accountsByPlatform = new Map<string, number>([
      ["meta", 1],
      ["google_ads", 2],
    ])

    const platforms = ["meta", "google_ads", "linkedin", "tiktok"]
    const connected = platforms.map((p) => ({
      platform: p,
      is_connected: (accountsByPlatform.get(p) || 0) > 0,
    }))

    expect(connected.find((c) => c.platform === "meta")?.is_connected).toBe(true)
    expect(connected.find((c) => c.platform === "linkedin")?.is_connected).toBe(false)
    expect(connected.find((c) => c.platform === "tiktok")?.is_connected).toBe(false)
  })
})

// ── GetDashboardMetrics + EnrichCampaignsWithMetrics integration ───────────────

describe("GetDashboardMetrics + client_id filtering", () => {
  it("passes clientId through to EnrichCampaignsWithMetrics", async () => {
    const enrichMock = { execute: vi.fn().mockResolvedValue([makeCampaign()]) }
    const repoMock = { listByUser: vi.fn(), listByUserAndClient: vi.fn() } as any
    const dashboardMetrics = new GetDashboardMetrics(repoMock, enrichMock as any)

    await dashboardMetrics.execute("user-1", undefined, "client-99")

    expect(enrichMock.execute).toHaveBeenCalledWith("user-1", "client-99")
  })

  it("does not apply client filter when clientId is absent", async () => {
    const enrichMock = { execute: vi.fn().mockResolvedValue([]) }
    const repoMock = { listByUser: vi.fn(), listByUserAndClient: vi.fn() } as any
    const dashboardMetrics = new GetDashboardMetrics(repoMock, enrichMock as any)

    await dashboardMetrics.execute("user-1", undefined, undefined)

    expect(enrichMock.execute).toHaveBeenCalledWith("user-1", undefined)
  })

  it("uses pre-enriched campaigns when passed, skipping repo calls", async () => {
    const enrichMock = { execute: vi.fn() }
    const repoMock = { listByUser: vi.fn(), listByUserAndClient: vi.fn() } as any
    const dashboardMetrics = new GetDashboardMetrics(repoMock, enrichMock as any)

    const campaigns = [makeCampaign()]
    await dashboardMetrics.execute("user-1", campaigns, "client-1")

    expect(enrichMock.execute).not.toHaveBeenCalled()
    expect(repoMock.listByUser).not.toHaveBeenCalled()
  })
})
