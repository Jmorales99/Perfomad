import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Cargar .env desde la raíz del proyecto (funciona con tsx src/ y node dist/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    SUPABASE_URL: z.string().url(),
    // New names (Publishable = public, Secret = private/admin)
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    // Old names (for backward compatibility)
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    // Platform OAuth Configuration
    // Meta (Facebook/Instagram) Ads
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),
    META_REDIRECT_URI: z.string().url().optional(),
    // Google Ads
    GOOGLE_ADS_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_ADS_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_ADS_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(1).optional(),
    /** Google Ads REST API version segment, e.g. v23 (https://googleads.googleapis.com/{version}/...). */
    GOOGLE_ADS_API_VERSION: z.string().optional(),
    /** MCC Manager Account customer ID. Required only if the ad account is managed under a Google Ads MCC. */
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
    /** Set to "true" to log raw GAQL queries and responses for debugging. Never enable in production. */
    GOOGLE_ADS_DEBUG: z.string().optional(),
    /** Redirect URI for Merchant Center OAuth callback. Register this in your Google Cloud OAuth app. */
    GOOGLE_MC_REDIRECT_URI: z.string().url().optional(),
    // TikTok Marketing API (Advertiser OAuth MVP; account-holder URLs stored for future use)
    TIKTOK_ENABLED: z.union([z.boolean(), z.string()]).optional(),
    TIKTOK_APP_ID: z.string().optional(),
    TIKTOK_SECRET: z.string().optional(),
    TIKTOK_ADVERTISER_AUTH_URL: z.string().optional(),
    TIKTOK_ADVERTISER_REDIRECT_URI: z.string().optional(),
    TIKTOK_ACCOUNT_HOLDER_AUTH_URL: z.string().optional(),
    TIKTOK_ACCOUNT_HOLDER_REDIRECT_URI: z.string().optional(),
    TIKTOK_API_BASE_URL: z.string().optional(),
    TIKTOK_FRONTEND_SUCCESS_URL: z.string().optional(),
    TIKTOK_FRONTEND_ERROR_URL: z.string().optional(),
    // Token Encryption
    TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(), // Base64 encoded 32-byte key for AES-256
    // LLM (Anthropic / Claude) for campaign optimization
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().optional(),
  })
  .transform((data) => {
    const rawGaVersion = data.GOOGLE_ADS_API_VERSION?.trim() || "v23"
    const googleAdsApiVersion = rawGaVersion.replace(/^\//, "")
    const tiktokEnabled =
      data.TIKTOK_ENABLED === true ||
      data.TIKTOK_ENABLED === "true" ||
      data.TIKTOK_ENABLED === "1"
    const trim = (s: string | undefined) => (s?.trim() ? s.trim() : undefined)
    return {
      ...data,
      // Use new names if provided, fallback to old names
      SUPABASE_PUBLISHABLE_KEY: data.SUPABASE_PUBLISHABLE_KEY || data.SUPABASE_ANON_KEY || "",
      SUPABASE_SECRET_KEY: data.SUPABASE_SECRET_KEY || data.SUPABASE_SERVICE_ROLE_KEY || "",
      GOOGLE_ADS_API_VERSION: googleAdsApiVersion,
      TIKTOK_ENABLED: tiktokEnabled,
      TIKTOK_APP_ID: trim(data.TIKTOK_APP_ID),
      TIKTOK_SECRET: trim(data.TIKTOK_SECRET),
      TIKTOK_ADVERTISER_AUTH_URL: trim(data.TIKTOK_ADVERTISER_AUTH_URL),
      TIKTOK_ADVERTISER_REDIRECT_URI: trim(data.TIKTOK_ADVERTISER_REDIRECT_URI),
      TIKTOK_ACCOUNT_HOLDER_AUTH_URL: trim(data.TIKTOK_ACCOUNT_HOLDER_AUTH_URL),
      TIKTOK_ACCOUNT_HOLDER_REDIRECT_URI: trim(data.TIKTOK_ACCOUNT_HOLDER_REDIRECT_URI),
      TIKTOK_API_BASE_URL: trim(data.TIKTOK_API_BASE_URL),
      TIKTOK_FRONTEND_SUCCESS_URL: trim(data.TIKTOK_FRONTEND_SUCCESS_URL),
      TIKTOK_FRONTEND_ERROR_URL: trim(data.TIKTOK_FRONTEND_ERROR_URL),
    }
  })
  .refine(
    (data) => data.SUPABASE_PUBLISHABLE_KEY && data.SUPABASE_SECRET_KEY,
    {
      message: "Either SUPABASE_PUBLISHABLE_KEY/SUPABASE_SECRET_KEY or SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY must be provided",
    }
  );

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const firstIssue = parsed.error.issues[0];
  const hint = firstIssue?.path?.join(".") || "env";
  console.error(`Environment validation failed (${hint}): ${firstIssue?.message ?? parsed.error.message}`);
  console.error("Copy .env.example to .env and set the required variables.");
  throw parsed.error;
}

export const env = parsed.data;

/** True when TikTok OAuth is enabled and required advertiser credentials are set. */
export function isTikTokIntegrationConfigured(): boolean {
  return (
    env.TIKTOK_ENABLED === true &&
    !!env.TIKTOK_APP_ID &&
    !!env.TIKTOK_SECRET &&
    !!env.TIKTOK_ADVERTISER_AUTH_URL &&
    !!env.TIKTOK_ADVERTISER_REDIRECT_URI
  )
}

// Bandera global
export const isProd = env.NODE_ENV === "production";
