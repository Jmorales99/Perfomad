import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export class CreateConnectionLink {
  constructor(private plaiApi: PlaiApiClient) {}

  async execute(
    plaiUserId: string,
    platform: Platform,
    redirectUri?: string,
    state?: string
  ): Promise<string> {
    const link = await this.plaiApi.createConnectionLink(
      plaiUserId,
      platform,
      redirectUri,
      state
    )

    return link
  }
}
