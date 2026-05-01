import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { PlatformApiClient, PlatformClientConfig } from "./PlatformApiClient"
import { MetaApiClient } from "./MetaApiClient"
import { GoogleAdsApiClient } from "./GoogleAdsApiClient"
import { TikTokApiClient } from "./TikTokApiClient"
import { env, isTikTokIntegrationConfigured } from "@/config/env"

/**
 * Factory for creating platform-specific API clients
 */
export class PlatformApiClientFactory {
  /**
   * Creates and returns the appropriate platform API client
   */
  static createClient(platform: Platform): PlatformApiClient {
    switch (platform) {
      case "meta": {
        const config: PlatformClientConfig = {
          clientId: env.META_APP_ID || "",
          clientSecret: env.META_APP_SECRET || "",
          redirectUri: env.META_REDIRECT_URI || "",
          apiVersion: "v18.0",
        }

        if (!config.clientId || !config.clientSecret) {
          throw new Error("Meta API credentials not configured. Set META_APP_ID and META_APP_SECRET.")
        }

        return new MetaApiClient(config)
      }

      case "google_ads": {
        const config: PlatformClientConfig = {
          clientId: env.GOOGLE_ADS_CLIENT_ID || "",
          clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || "",
          redirectUri: env.GOOGLE_ADS_REDIRECT_URI || "",
          developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
          apiVersion: env.GOOGLE_ADS_API_VERSION,
          loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "",
          debug: env.GOOGLE_ADS_DEBUG === "true",
        }

        if (!config.clientId || !config.clientSecret) {
          throw new Error("Google Ads API credentials not configured. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET.")
        }

        return new GoogleAdsApiClient(config)
      }

      case "linkedin": {
        // TODO: Implement LinkedIn client when needed
        throw new Error("LinkedIn API client not yet implemented")
      }

      case "tiktok": {
        if (!isTikTokIntegrationConfigured()) {
          throw new Error(
            "TikTok is disabled or not configured. Set TIKTOK_ENABLED=true and TIKTOK_APP_ID, TIKTOK_SECRET, TIKTOK_ADVERTISER_AUTH_URL, TIKTOK_ADVERTISER_REDIRECT_URI."
          )
        }
        const apiBase = env.TIKTOK_API_BASE_URL?.replace(/\/$/, "") || "https://business-api.tiktok.com"
        const config: PlatformClientConfig & { advertiserAuthUrl?: string; apiBaseUrl?: string } = {
          clientId: env.TIKTOK_APP_ID || "",
          clientSecret: env.TIKTOK_SECRET || "",
          redirectUri: env.TIKTOK_ADVERTISER_REDIRECT_URI || "",
          advertiserAuthUrl: env.TIKTOK_ADVERTISER_AUTH_URL,
          apiBaseUrl: apiBase,
        }
        return new TikTokApiClient(config)
      }

      default:
        throw new Error(`Unsupported platform: ${platform}`)
    }
  }

  /**
   * Checks if a platform is supported
   */
  static isSupported(platform: string): platform is Platform {
    return platform === "meta" || platform === "google_ads" || platform === "linkedin" || platform === "tiktok"
  }
}
