import type { AdAccount, Platform } from "@/domain/repositories/AdAccountsRepository"

/**
 * Matches the requested adAccountId to a row's platform_account_id.
 * Google Ads customer IDs may be stored or sent with or without dashes (1234567890 vs 123-456-7890).
 * Meta uses act_ prefix normalisation.
 */
export function resolveAdAccountByPlatformId(
  platform: Platform,
  accounts: AdAccount[],
  adAccountId: string
): AdAccount | undefined {
  if (platform === "google_ads") {
    const want = adAccountId.replace(/[-\s]/g, "")
    return accounts.find(
      (a) => String(a.platform_account_id ?? "").replace(/[-\s]/g, "") === want
    )
  }

  const stripped = adAccountId.replace(/^act_/, "")
  return accounts.find(
    (a) =>
      a.platform_account_id === adAccountId ||
      a.platform_account_id === `act_${stripped}` ||
      a.platform_account_id.replace(/^act_/, "") === stripped
  )
}
