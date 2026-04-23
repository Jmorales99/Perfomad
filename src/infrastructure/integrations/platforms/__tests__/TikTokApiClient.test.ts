import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import axios from "axios"
import { TikTokApiClient } from "../TikTokApiClient"

function client() {
  return new TikTokApiClient({
    clientId: "app1",
    clientSecret: "secret1",
    redirectUri: "https://example.com/cb",
    advertiserAuthUrl: "https://ads.tiktok.com/marketing_api/auth",
    apiBaseUrl: "https://business-api.tiktok.com",
  })
}

describe("TikTokApiClient", () => {
  beforeEach(() => {
    vi.spyOn(axios, "create").mockImplementation(() => {
      const post = vi.fn()
      return { post } as unknown as ReturnType<typeof axios.create>
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("getOAuthUrl appends app_id redirect_uri state", () => {
    const c = client()
    const url = c.getOAuthUrl("", "state-xyz")
    expect(url).toContain("app_id=app1")
    expect(url).toContain("state=state-xyz")
    expect(url).toContain(encodeURIComponent("https://example.com/cb"))
  })

  it("exchangeAuthCodeForTokens parses TikTok envelope", async () => {
    const post = vi.fn().mockResolvedValue({
      data: {
        code: 0,
        message: "OK",
        data: {
          access_token: "at",
          refresh_token: "rt",
          expires_in: 7200,
          refresh_token_expires_in: 86400,
          advertiser_ids: ["111", "222"],
        },
      },
    })
    vi.spyOn(axios, "create").mockImplementation(() => ({ post }) as unknown as ReturnType<typeof axios.create>)

    const c = client()
    const r = await c.exchangeAuthCodeForTokens("code123")
    expect(r.accessToken).toBe("at")
    expect(r.refreshToken).toBe("rt")
    expect(r.expiresIn).toBe(7200)
    expect(r.refreshTokenExpiresIn).toBe(86400)
    expect(r.advertiserIdsFromToken).toEqual(["111", "222"])
    expect(post).toHaveBeenCalledWith(
      "/open_api/v1.3/oauth2/access_token/",
      expect.objectContaining({ auth_code: "code123", app_id: "app1", secret: "secret1" }),
      expect.any(Object)
    )
  })

  it("getAuthorizedAdvertisers maps list from advertiser/get", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            list: [
              { advertiser_id: "9", advertiser_name: "Acme", currency: "USD" },
              { advertiser_id: "8", advertiser_name: "Beta" },
            ],
          },
        },
      })
    vi.spyOn(axios, "create").mockImplementation(() => ({ post }) as unknown as ReturnType<typeof axios.create>)

    const c = client()
    const list = await c.getAuthorizedAdvertisers("token")
    expect(list).toEqual([
      { id: "9", name: "Acme", currency: "USD" },
      { id: "8", name: "Beta", currency: "USD" },
    ])
    expect(post).toHaveBeenCalledWith("/open_api/v1.3/oauth2/advertiser/get/", {}, {
      headers: { "Access-Token": "token" },
    })
  })

  it("updateCampaignStatus throws platform_not_supported_yet", async () => {
    const c = client()
    await expect(c.updateCampaignStatus("c1", "PAUSED", "tok")).rejects.toThrow(
      /platform_not_supported_yet/
    )
  })

  it("updateCampaignBudget throws platform_not_supported_yet", async () => {
    const c = client()
    await expect(c.updateCampaignBudget("c1", 100, "tok")).rejects.toThrow(
      /platform_not_supported_yet/
    )
  })

  it("getCampaignBudget returns null snapshot (read-only stub)", async () => {
    const c = client()
    const snap = await c.getCampaignBudget("c1", "tok")
    expect(snap.daily_budget).toBeNull()
    expect(snap.lifetime_budget).toBeNull()
    expect(snap.spend_to_date).toBeNull()
  })

  it("listCampaignAdSets returns empty array (stub)", async () => {
    const c = client()
    const r = await c.listCampaignAdSets("c1", "tok")
    expect(r).toEqual([])
  })

  it("listAdSetAds returns empty array (stub)", async () => {
    const c = client()
    const r = await c.listAdSetAds("a1", "tok")
    expect(r).toEqual([])
  })
})
