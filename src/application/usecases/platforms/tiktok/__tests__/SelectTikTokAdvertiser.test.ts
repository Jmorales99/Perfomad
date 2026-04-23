import { describe, it, expect, vi } from "vitest"
import { SelectTikTokAdvertiser } from "../SelectTikTokAdvertiser"
import { TIKTOK_PENDING_PLATFORM_ACCOUNT_ID } from "@/domain/tiktok/TikTokConnection"
import type { AdAccount, AdAccountsRepository } from "@/domain/repositories/AdAccountsRepository"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"

describe("SelectTikTokAdvertiser", () => {
  it("rejects advertiserId not in authorized list", async () => {
    const adAccountsRepo: Pick<AdAccountsRepository, "findByUserClientAndPlatform" | "update"> = {
      findByUserClientAndPlatform: vi.fn().mockResolvedValue({
        id: "acc1",
        platform_account_data: {
          tiktok: {
            selectionPending: true,
            authorizedAdvertisers: [{ id: "1", name: "One" }],
          },
        },
      } as AdAccount),
      update: vi.fn(),
    }
    const clientsRepo: Pick<ClientsRepository, "getById"> = {
      getById: vi.fn().mockResolvedValue({ id: "c1" }),
    }
    const uc = new SelectTikTokAdvertiser(adAccountsRepo as AdAccountsRepository, clientsRepo as ClientsRepository)
    await expect(uc.execute("u1", "c1", "999")).rejects.toThrow("not in the authorized list")
    expect(adAccountsRepo.update).not.toHaveBeenCalled()
  })

  it("updates row with selected advertiser and clears selection pending", async () => {
    const update = vi.fn().mockResolvedValue({ id: "acc1" })
    const adAccountsRepo: Pick<AdAccountsRepository, "findByUserClientAndPlatform" | "update"> = {
      findByUserClientAndPlatform: vi.fn().mockResolvedValue({
        id: "acc1",
        platform_account_id: TIKTOK_PENDING_PLATFORM_ACCOUNT_ID,
        platform_account_data: {
          tiktok: {
            selectionPending: true,
            authorizedAdvertisers: [
              { id: "42", name: "Brand", currency: "CLP" },
            ],
          },
        },
      } as AdAccount),
      update,
    }
    const clientsRepo: Pick<ClientsRepository, "getById"> = {
      getById: vi.fn().mockResolvedValue({ id: "c1" }),
    }
    const uc = new SelectTikTokAdvertiser(adAccountsRepo as AdAccountsRepository, clientsRepo as ClientsRepository)
    const out = await uc.execute("u1", "c1", "42")
    expect(out.accountId).toBe("acc1")
    expect(update).toHaveBeenCalledWith(
      "u1",
      "acc1",
      expect.objectContaining({
        platform_account_id: "42",
        account_name: "Brand",
        currency: "CLP",
        is_active: true,
        platform_account_data: {
          tiktok: expect.objectContaining({
            selectionPending: false,
            authorizedAdvertisers: [{ id: "42", name: "Brand", currency: "CLP" }],
          }),
        },
      })
    )
  })
})
