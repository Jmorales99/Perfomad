import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock infra deps so env validation never fires ─────────────────────────────
vi.mock("@/infrastructure/db/supabaseClient", () => ({ supabaseAdmin: {} }))
vi.mock("@/config/env", () => ({ env: { NODE_ENV: "test", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x", TOKEN_ENCRYPTION_KEY: "x" } }))
vi.mock("@/infrastructure/integrations/platforms/PlatformApiClientFactory")

import { SyncDashboardData } from "../SyncDashboardData"
import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import type { AccountInsights } from "@/infrastructure/integrations/platforms/PlatformApiClient"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsights(overrides: Partial<AccountInsights> = {}): AccountInsights {
  return {
    impressions: 1000,
    clicks: 50,
    spend: 200,
    ctr: 5,
    cpc: 4,
    cpm: 200,
    reach: 900,
    actions: [],
    action_values: [],
    ...overrides,
  }
}

function makeAdAccount(platform: string) {
  return {
    id: `acc-${platform}`,
    user_id: "user-1",
    client_id: "client-1",
    platform,
    platform_account_id: `pid-${platform}`,
    is_active: true,
    account_name: `${platform} account`,
    currency: "USD",
    connected_at: "2024-01-01T00:00:00Z",
    last_synced_at: null,
    platform_account_data: null,
    access_token: "enc",
    access_token_iv: "iv",
    access_token_tag: "tag",
    refresh_token: null,
    refresh_token_iv: null,
    refresh_token_tag: null,
    token_expires_at: null,
    created_at: "2024-01-01T00:00:00Z",
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SyncDashboardData", () => {
  let adAccountsRepo: any
  let snapshotsRepo: any
  let tokenManager: any
  let clientsRepo: any
  let mockPlatformClient: any
  let useCase: SyncDashboardData

  beforeEach(() => {
    mockPlatformClient = {
      getAccountInsights: vi.fn().mockResolvedValue(makeInsights()),
      getAdAccountCampaignInsights: vi.fn().mockResolvedValue([]),
      refreshAccessToken: vi.fn(),
    }

    vi.mocked(PlatformApiClientFactory.createClient).mockReturnValue(mockPlatformClient)

    adAccountsRepo = {
      findByUserAndClient: vi.fn(),
    }

    snapshotsRepo = {
      upsert: vi.fn(),
      findByUserAndClient: vi.fn().mockResolvedValue([]),
    }

    tokenManager = {
      getValidAccessToken: vi.fn().mockResolvedValue("access-token-decrypted"),
    }

    clientsRepo = {
      getById: vi.fn().mockResolvedValue({ id: "client-1", user_id: "user-1", name: "Test Brand" }),
    }

    useCase = new SyncDashboardData(adAccountsRepo, snapshotsRepo, tokenManager, clientsRepo)
  })

  it("throws when brand not found", async () => {
    clientsRepo.getById.mockResolvedValue(null)

    await expect(useCase.execute("user-1", "client-1")).rejects.toThrow("Brand not found")
  })

  it("skips unsupported platforms (linkedin, tiktok) silently", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([
      makeAdAccount("linkedin"),
      makeAdAccount("tiktok"),
    ])

    await useCase.execute("user-1", "client-1")

    expect(mockPlatformClient.getAccountInsights).not.toHaveBeenCalled()
    expect(snapshotsRepo.upsert).not.toHaveBeenCalled()
  })

  it("calls getAccountInsights and getAdAccountCampaignInsights for meta accounts", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("meta")])

    await useCase.execute("user-1", "client-1")

    expect(mockPlatformClient.getAccountInsights).toHaveBeenCalledOnce()
    expect(mockPlatformClient.getAdAccountCampaignInsights).toHaveBeenCalledOnce()
  })

  it("upserts snapshot to the repository after fetching", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("google_ads")])
    const campaignRow = {
      campaign_id: "cid1",
      name: "Test Campaign",
      spend: 100,
      impressions: 500,
      clicks: 25,
      reach: 400,
      ctr: 5,
      cpc: 4,
      cpm: 200,
      status: "active",
      actions: [],
      action_values: [],
    }
    mockPlatformClient.getAdAccountCampaignInsights.mockResolvedValue([campaignRow])

    await useCase.execute("user-1", "client-1")

    expect(snapshotsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        client_id: "client-1",
        platform: "google_ads",
        ad_account_id: "acc-google_ads",
        platform_campaigns: [campaignRow],
      })
    )
  })

  it("status field is preserved from campaign row in the upsert payload", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("meta")])
    const rows = [
      { campaign_id: "c1", name: "Active", spend: 200, impressions: 1000, clicks: 40, reach: 900, ctr: 4, cpc: 5, cpm: 200, status: "active", actions: [], action_values: [] },
      { campaign_id: "c2", name: "Paused", spend: 50, impressions: 500, clicks: 10, reach: 400, ctr: 2, cpc: 5, cpm: 100, status: "paused", actions: [], action_values: [] },
    ]
    mockPlatformClient.getAdAccountCampaignInsights.mockResolvedValue(rows)

    await useCase.execute("user-1", "client-1")

    const upsertArg = snapshotsRepo.upsert.mock.calls[0][0]
    expect(upsertArg.platform_campaigns[0].status).toBe("active")
    expect(upsertArg.platform_campaigns[1].status).toBe("paused")
  })

  it("processes multiple supported platforms in parallel", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([
      makeAdAccount("meta"),
      makeAdAccount("google_ads"),
    ])

    await useCase.execute("user-1", "client-1")

    expect(snapshotsRepo.upsert).toHaveBeenCalledTimes(2)
  })

  it("continues syncing other accounts if one fails", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([
      makeAdAccount("meta"),
      makeAdAccount("google_ads"),
    ])

    // First account throws
    mockPlatformClient.getAccountInsights
      .mockRejectedValueOnce(new Error("Meta API down"))
      .mockResolvedValueOnce(makeInsights({ spend: 150 }))

    // Should not throw
    await expect(useCase.execute("user-1", "client-1")).resolves.not.toThrow()

    // Only the successful one is upserted
    expect(snapshotsRepo.upsert).toHaveBeenCalledTimes(1)
  })

  it("uses provided dateRange for API calls", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("meta")])

    await useCase.execute("user-1", "client-1", { since: "2024-01-01", until: "2024-01-31" })

    expect(mockPlatformClient.getAccountInsights).toHaveBeenCalledWith(
      "pid-meta",
      "access-token-decrypted",
      { since: "2024-01-01", until: "2024-01-31" }
    )
  })

  it("reads back fresh snapshots to build consolidated result", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("meta")])
    snapshotsRepo.findByUserAndClient.mockResolvedValue([
      {
        id: "snap-1",
        user_id: "user-1",
        client_id: "client-1",
        platform: "meta",
        ad_account_id: "acc-meta",
        account_metrics: makeInsights({ spend: 300 }),
        platform_campaigns: [],
        synced_at: new Date().toISOString(),
        date_range_since: "2024-01-01",
        date_range_until: "2024-01-31",
      },
    ])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.needs_sync).toBe(false)
    expect(result.totals.spend).toBe(300)
  })

  it("surfaces integration_errors when getValidAccessToken rejects with invalid_grant", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("google_ads")])
    tokenManager.getValidAccessToken.mockRejectedValue(
      new Error("Failed to refresh token for account acc-google_ads: invalid_grant: Token has been expired or revoked.")
    )

    const result = await useCase.execute("user-1", "client-1")

    expect(result.integration_errors).toHaveLength(1)
    expect(result.integration_errors![0].platform).toBe("google_ads")
    expect(result.integration_errors![0].requires_reconnection).toBe(true)
    expect(result.integration_errors![0].code).toBe("oauth_reconnect_required")
  })

  it("marks integration_errors as requires_reconnection false for non-oauth failures", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("meta")])
    mockPlatformClient.getAccountInsights.mockRejectedValue(new Error("Network timeout"))

    const result = await useCase.execute("user-1", "client-1")

    expect(result.integration_errors).toHaveLength(1)
    expect(result.integration_errors![0].requires_reconnection).toBe(false)
    expect(result.integration_errors![0].code).toBeUndefined()
  })

  it("returns no integration_errors field when all accounts sync successfully", async () => {
    adAccountsRepo.findByUserAndClient.mockResolvedValue([makeAdAccount("meta")])

    const result = await useCase.execute("user-1", "client-1")

    expect(result.integration_errors).toBeUndefined()
  })
})
