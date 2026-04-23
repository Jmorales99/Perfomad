import { PlatformApiClientFactory } from "@/infrastructure/integrations/platforms/PlatformApiClientFactory"
import { StateManager } from "@/infrastructure/security/StateManager"
import { isTikTokIntegrationConfigured } from "@/config/env"
import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"
import type { Platform } from "@/domain/repositories/AdAccountsRepository"

export class CreateConnectionLink {
  constructor(
    private stateManager: StateManager,
    private clientsRepo: ClientsRepository
  ) {}

  /**
   * @param returnTo  Optional URL the frontend wants to land on after OAuth completes.
   *                  Stored in oauth_states.redirect_uri as RETURN_TO.
   *                  NOT sent to the OAuth provider — the provider always uses
   *                  the backend callback URI configured in env (META_REDIRECT_URI, etc.).
   */
  async execute(
    userId: string,
    clientId: string,
    platform: Platform,
    returnTo?: string,
    customState?: string
  ): Promise<string> {
    const client = await this.clientsRepo.getById(userId, clientId)
    if (!client) {
      throw new Error("Client not found or does not belong to user")
    }

    if (platform === "tiktok" && !isTikTokIntegrationConfigured()) {
      throw new Error(
        "TikTok integration is disabled or not fully configured. Enable TIKTOK_ENABLED and set TIKTOK_APP_ID, TIKTOK_SECRET, TIKTOK_ADVERTISER_AUTH_URL, and TIKTOK_ADVERTISER_REDIRECT_URI."
      )
    }

    // Store returnTo in state so the callback can redirect back to the correct frontend page.
    const state = customState ?? (await this.stateManager.generateState(userId, clientId, platform, returnTo))

    const platformClient = PlatformApiClientFactory.createClient(platform)

    // Pass "" so the platform client falls back to its configured redirectUri
    // (env.META_REDIRECT_URI / env.GOOGLE_ADS_REDIRECT_URI — the backend callback).
    return platformClient.getOAuthUrl("", state)
  }
}
