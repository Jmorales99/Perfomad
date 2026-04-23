import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock infra deps so env validation never fires ─────────────────────────────
vi.mock("@/infrastructure/db/supabaseClient", () => ({ supabaseAdmin: {} }))
vi.mock("@/config/env", () => ({ env: { NODE_ENV: "test", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x", TOKEN_ENCRYPTION_KEY: "x" } }))

import { GetConsolidatedDashboard } from "../GetConsolidatedDashboard"
import type { DashboardSnapshotsRepository } from "@/infrastructure/repositories/DashboardSnapshotsRepository"
import type { AccountInsights } from "@/infrastructure/integrations/platforms/PlatformApiClient"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsights(overrides: Partial<AccountInsights> = {}): AccountInsights {
  return {
    impressions: 1000,
    clicks: 50,
    spend: 200,
    ctr: 5.0,
    cpc: 4.0,
    cpm: 200,
    reach: 900,
    actions: [],
    action_values: [],
    ...overrides,
  }
}

function makeSnapshot(platform: string, metrics: Partial<AccountInsights> = {}, campaigns: any[] = []) {
  return {
    id: `snap-${platform}`,
    user_id: "user-1",
    client_id: "client-1",
    platform,
    ad_account_id: `acc-${platform}`,
    account_metrics: makeInsights(metrics),
    platform_campaigns: campaigns,
    synced_at: "2024-03-01T10:00:00Z",
    date_range_since: "2024-02-01",
    date_range_until: "2024-03-01",
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GetConsolidatedDashboard", () => {
  let snapshotsRepo: any
  let useCase: GetConsolidatedDashboard

  beforeEach(() => {
    snapshotsRepo = {
      findByUserAndClient: vi.fn(),
      findByUserClientAndPlatform: vi.fn(),
      upsert: vi.fn(),
    }

    useCase = new GetConsolidatedDashboard(snapshotsRepo as any)
  })

  it("returns needs_sync=true and zero totals when no snapshots exist", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.needs_sync).toBe(true)
    expect(result.last_synced_at).toBeNull()
    expect(result.totals.spend).toBe(0)
    expect(result.campaigns).toHaveLength(0)
    expect(result.platforms).toHaveLength(0)
  })

  it("aggregates spend across multiple platform snapshots", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", { spend: 300 }),
      makeSnapshot("google_ads", { spend: 150 }),
    ])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.needs_sync).toBe(false)
    expect(result.totals.spend).toBe(450)
    expect(result.platforms).toHaveLength(2)
  })

  it("aggregates impressions and clicks correctly", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", { impressions: 2000, clicks: 100 }),
      makeSnapshot("google_ads", { impressions: 1000, clicks: 50 }),
    ])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.totals.impressions).toBe(3000)
    expect(result.totals.clicks).toBe(150)
  })

  it("computes global CTR from total impressions and clicks", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", { impressions: 1000, clicks: 50 }),
    ])

    const result = await useCase.execute("user-1", "client-1")
    // CTR = (50 / 1000) * 100 = 5
    expect(result.totals.ctr).toBeCloseTo(5.0)
  })

  it("computes ROA from purchase action_values", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", {
        spend: 100,
        action_values: [{ action_type: "purchase", value: "400" }],
      }),
    ])

    const result = await useCase.execute("user-1", "client-1")
    // ROA = revenue / spend = 400 / 100 = 4
    expect(result.totals.roa).toBeCloseTo(4.0)
  })

  it("returns roa=null when there is no spend", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", { spend: 0 }),
    ])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.totals.roa).toBeNull()
  })

  it("builds unified campaigns list ordered by spend desc", async () => {
    const lowSpend = { campaign_id: "c1", name: "Low spend", spend: 10, impressions: 100, clicks: 5, ctr: 5, cpc: 2, reach: 90, status: "paused", actions: [], action_values: [] }
    const highSpend = { campaign_id: "c2", name: "High spend", spend: 500, impressions: 5000, clicks: 200, ctr: 4, cpc: 2.5, reach: 4500, status: "active", actions: [], action_values: [] }
    const campaignsForMeta = [lowSpend, highSpend]
    ;(snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", {}, campaignsForMeta),
    ])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.campaigns[0].campaign_id).toBe("c2")
    expect(result.campaigns[1].campaign_id).toBe("c1")
    expect(result.campaigns[0].platform).toBe("meta")
  })

  it("propagates campaign status through buildConsolidated", async () => {
    const activeCampaign = { campaign_id: "c1", name: "Active", spend: 100, impressions: 1000, clicks: 50, ctr: 5, cpc: 2, reach: 900, status: "active", actions: [], action_values: [] }
    const pausedCampaign = { campaign_id: "c2", name: "Paused", spend: 50, impressions: 500, clicks: 10, ctr: 2, cpc: 5, reach: 400, status: "paused", actions: [], action_values: [] }
    ;(snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", {}, [activeCampaign, pausedCampaign]),
    ])

    const result = await useCase.execute("user-1", "client-1")

    const resultActive = result.campaigns.find((c) => c.campaign_id === "c1")
    const resultPaused = result.campaigns.find((c) => c.campaign_id === "c2")

    expect(resultActive?.status).toBe("active")
    expect(resultPaused?.status).toBe("paused")
  })

  it("filters by platform when platform arg is provided", async () => {
    (snapshotsRepo as any).findByUserClientAndPlatform.mockResolvedValue([
      makeSnapshot("google_ads", { spend: 75 }),
    ])

    const result = await useCase.execute("user-1", "client-1", "google_ads")

    expect((snapshotsRepo as any).findByUserClientAndPlatform).toHaveBeenCalledWith("user-1", "client-1", "google_ads")
    expect(result.totals.spend).toBe(75)
    expect(result.platforms[0].platform).toBe("google_ads")
  })

  it("returns the most recent synced_at as last_synced_at", async () => {
    (snapshotsRepo as any).findByUserAndClient.mockResolvedValue([
      makeSnapshot("meta", {}),
      { ...makeSnapshot("google_ads", {}), synced_at: "2024-03-15T12:00:00Z" },
    ])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.last_synced_at).toBe("2024-03-15T12:00:00Z")
  })
})
