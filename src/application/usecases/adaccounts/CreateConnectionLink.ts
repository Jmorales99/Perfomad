import { PlatformApiClientFactory } from "@/infrastructure/services/platforms/PlatformApiClientFactory"
import { StateManager } from "@/infrastructure/security/StateManager"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

export class CreateConnectionLink {
  constructor(
    private stateManager: StateManager,
    private clientsRepo: ClientsRepository
  ) {}

  async execute(
    userId: string,
    clientId: string,
    platform: Platform,
    redirectUri?: string,
    customState?: string
  ): Promise<string> {
    const client = await this.clientsRepo.getById(userId, clientId)
    if (!client) {
      throw new Error("Client not found or does not belong to user")
    }

    const state = customState ?? (await this.stateManager.generateState(userId, clientId, platform, redirectUri))
    const platformClient = PlatformApiClientFactory.createClient(platform)
    return platformClient.getOAuthUrl(redirectUri ?? "", state)
  }
}
