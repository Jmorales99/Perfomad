import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"

export class SyncConnectedAccounts {
  constructor(
    private plaiApi: PlaiApiClient,
    private adAccountsRepo: SupabaseAdAccountsRepository
  ) {}

  async execute(userId: string, plaiUserId: string) {
    // 1. Fetch connected accounts from Plai
    const connectedAccounts = await this.plaiApi.getConnectedAccounts(plaiUserId)

    // 2. Sync to your database
    const accounts = await this.adAccountsRepo.syncConnectedAccounts(
      userId,
      plaiUserId,
      connectedAccounts
    )

    return accounts
  }
}
