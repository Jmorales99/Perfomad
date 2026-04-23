import { describe, it, expect, vi, beforeEach } from "vitest"
import { GetCampaignAds } from "../GetCampaignAds"
import type { AdAccountsRepository, Platform } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import type { TokenManager } from "@/infrastructure/integrations/TokenManager"

// ── Mock PlatformApiClientFactory ─────────────────────────────────────────────
vi.mock("@/infrastructure/integrations/platforms/PlatformApiClientFactory", () => ({
  PlatformApiClientFactory: {
    createClient: vi.fn(),
  },
}))

import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAccount(platform: Platform, platformAccountId: string) {
  return {
    id: "account-uuid-1",
    user_id: "user-1",
    client_id: "client-1",
    platform,
    platform_account_id: platformAccountId,
    is_active: true,
    account_name: "Test Account",
    currency: "USD",
    connected_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    access_token: "enc",
    access_token_iv: "iv",
    access_token_tag: "tag",
    refresh_token: "renc",
    refresh_token_iv: "riv",
    refresh_token_tag: "rtag",
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    platform_user_id: null,
    platform_account_data: null,
    connection_status: "connected" as const,
    created_at: new Date().toISOString(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GetCampaignAds — effectiveCampaignId", () => {
  let useCase: GetCampaignAds
  let mockAdAccountsRepo: AdAccountsRepository
  let mockTokenManager: TokenManager
  let mockClientsRepo: ClientsRepository
  let mockPlatformClient: any

  beforeEach(() => {
    mockPlatformClient = {
      getCampaignAds:     vi.fn().mockResolvedValue([]),
      getAdInsights:      vi.fn().mockResolvedValue([]),
      refreshAccessToken: vi.fn(),
    }
    vi.mocked(PlatformApiClientFactory.createClient).mockReturnValue(mockPlatformClient)

    mockAdAccountsRepo = {
      findByUserAndClient:         vi.fn().mockResolvedValue([makeAccount("google_ads", "1234567890")]),
      findByUserClientAndPlatform: vi.fn(),
      findByUserAndPlatform:       vi.fn(),
      create:                      vi.fn(),
      update:                      vi.fn(),
      findById:                    vi.fn(),
    } as unknown as AdAccountsRepository

    mockTokenManager = {
      getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
      encryptToken:        vi.fn(),
      decryptToken:        vi.fn(),
    } as unknown as TokenManager

    mockClientsRepo = {
      getById:    vi.fn().mockResolvedValue({ id: "client-1", name: "Brand", user_id: "user-1" }),
      listByUser: vi.fn(),
    } as unknown as ClientsRepository

    useCase = new GetCampaignAds(mockAdAccountsRepo, mockTokenManager, mockClientsRepo)
  })

  it("prefixes campaignId with platform_account_id for google_ads", async () => {
    await useCase.execute("user-1", "client-1", "google_ads", "9876543", undefined)

    expect(mockPlatformClient.getCampaignAds).toHaveBeenCalledWith(
      "1234567890:9876543",
      "access-token",
      { platformAccountId: "1234567890" }
    )
    expect(mockPlatformClient.getAdInsights).toHaveBeenCalledWith(
      "1234567890",
      "1234567890:9876543",
      "access-token",
      expect.any(Object)
    )
  })

  it("strips dashes from google_ads customer ID before prefixing", async () => {
    vi.mocked(mockAdAccountsRepo.findByUserAndClient).mockResolvedValue([
      makeAccount("google_ads", "123-456-7890"),
    ])

    await useCase.execute("user-1", "client-1", "google_ads", "9876543", undefined)

    expect(mockPlatformClient.getCampaignAds).toHaveBeenCalledWith(
      "1234567890:9876543",
      "access-token",
      { platformAccountId: "123-456-7890" }
    )
  })

  it("does NOT prefix campaignId for meta", async () => {
    vi.mocked(mockAdAccountsRepo.findByUserAndClient).mockResolvedValue([
      makeAccount("meta", "act_123456"),
    ])

    await useCase.execute("user-1", "client-1", "meta", "9876543", undefined)

    expect(mockPlatformClient.getCampaignAds).toHaveBeenCalledWith(
      "9876543",
      "access-token",
      { platformAccountId: "act_123456" }
    )
    // getAdInsights also receives the unchanged campaignId for meta
    expect(mockPlatformClient.getAdInsights).toHaveBeenCalledWith(
      "act_123456",
      "9876543",
      "access-token",
      expect.any(Object)
    )
  })

  it("returns ads list with zero metrics when no insights are returned", async () => {
    mockPlatformClient.getCampaignAds.mockResolvedValue([
      {
        ad_id: "ad-1",
        name: "Test Ad",
        status: "ENABLED",
        effective_status: "ENABLED",
        creative: { creative_id: "ad-1", type: "unknown", thumbnail_url: null, image_url: null, cards: [] },
      },
    ])

    const result = await useCase.execute("user-1", "client-1", "google_ads", "5555", undefined)

    expect(result.ads).toHaveLength(1)
    expect(result.ads[0].metrics.spend).toBe(0)
    expect(result.ads[0].metrics.conversions).toBe(0)
  })

  it("uses 'conversion' action_type for google_ads conversions", async () => {
    mockPlatformClient.getCampaignAds.mockResolvedValue([
      {
        ad_id: "ad-1",
        name: "Test Ad",
        status: "ENABLED",
        effective_status: "ENABLED",
        creative: { creative_id: "ad-1", type: "unknown", thumbnail_url: null, image_url: null, cards: [] },
      },
    ])
    mockPlatformClient.getAdInsights.mockResolvedValue([
      {
        ad_id: "ad-1",
        spend: 50,
        impressions: 1000,
        clicks: 10,
        reach: 0,
        ctr: 1,
        cpc: 5,
        cpm: 50,
        actions: [{ action_type: "conversion", value: "3" }],
        action_values: [{ action_type: "conversion", value: "150" }],
      },
    ])

    const result = await useCase.execute("user-1", "client-1", "google_ads", "5555", undefined)

    expect(result.ads[0].metrics.conversions).toBe(3)
    expect(result.ads[0].metrics.revenue).toBe(150)
    expect(result.ads[0].metrics.roas).toBeCloseTo(3)
  })

  it("does NOT count google_ads 'conversion' as meta conversion (purchase)", async () => {
    mockPlatformClient.getCampaignAds.mockResolvedValue([
      {
        ad_id: "ad-1",
        name: "Meta Ad",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        creative: { creative_id: "ad-1", type: "unknown", thumbnail_url: null, image_url: null, cards: [] },
      },
    ])
    mockPlatformClient.getAdInsights.mockResolvedValue([
      {
        ad_id: "ad-1",
        spend: 10,
        impressions: 500,
        clicks: 5,
        reach: 400,
        ctr: 1,
        cpc: 2,
        cpm: 20,
        actions: [{ action_type: "purchase", value: "2" }],
        action_values: [{ action_type: "purchase", value: "80" }],
      },
    ])

    vi.mocked(mockAdAccountsRepo.findByUserAndClient).mockResolvedValue([
      makeAccount("meta", "act_123456"),
    ])

    const result = await useCase.execute("user-1", "client-1", "meta", "5555", undefined)

    expect(result.ads[0].metrics.conversions).toBe(2)
    expect(result.ads[0].metrics.revenue).toBe(80)
  })
})
