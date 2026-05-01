import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { StateManager } from "@/infrastructure/security/StateManager"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { MerchantCenterApiClient } from "@/infrastructure/integrations/platforms/MerchantCenterApiClient"
import { env } from "@/config/env"

export async function MerchantCenterController(app: FastifyInstance) {
  const stateManager = new StateManager()
  const tokenManager = new TokenManager()
  const adAccountsRepo = new SupabaseAdAccountsRepository()

  const auditLogger = new AuditLogger()

  function getMcClient(): MerchantCenterApiClient {
    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
      throw new Error(
        "Google OAuth credentials not configured. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET."
      )
    }
    if (!env.GOOGLE_MC_REDIRECT_URI) {
      throw new Error("GOOGLE_MC_REDIRECT_URI is not set. Configure it in .env and register it in Google Cloud Console.")
    }
    return new MerchantCenterApiClient({
      clientId: env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
      redirectUri: env.GOOGLE_MC_REDIRECT_URI,
    })
  }

  // POST /platforms/google_merchant_center/connect-link
  app.post("/platforms/google_merchant_center/connect-link", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const body = (req.body as any) ?? {}
      const clientId: string | undefined = body.clientId ?? body.client_id
      if (!clientId || typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId is required" })
      }

      const returnTo: string | undefined = body.redirect_uri ?? body.redirectUri
      const state = await stateManager.generateState(user.id, clientId, "google_merchant_center", returnTo)
      const url = getMcClient().getOAuthUrl(state)
      return reply.send({ url })
    } catch (err: unknown) {
      req.log.error(err)
      const message = err instanceof Error ? err.message : "Failed to create Merchant Center connection link"
      return reply.code(400).send({ error: message })
    }
  })

  const DEFAULT_RETURN_PATH = "/settings?tab=integrations"
  const CALLBACK_ERROR_MESSAGE = "Merchant Center connection failed. Try again."

  // GET /platforms/google_merchant_center/callback
  app.get("/platforms/google_merchant_center/callback", async (req, reply) => {
    const base = process.env.FRONTEND_URL ?? "http://localhost:5173"
    const fallback = `${base}${DEFAULT_RETURN_PATH}`
    const CALLBACK_ERROR = `${fallback}&connect=error&message=${encodeURIComponent(CALLBACK_ERROR_MESSAGE)}&platform=google_merchant_center`

    try {
      const { code, state, error } = req.query as {
        code?: string
        state?: string
        error?: string
      }

      if (error) return reply.redirect(CALLBACK_ERROR, 302)
      if (!code || !state) return reply.redirect(CALLBACK_ERROR, 302)

      const stateData = await stateManager.validateStateForCallback(state)
      if (!stateData || stateData.platform !== "google_merchant_center") {
        return reply.redirect(CALLBACK_ERROR, 302)
      }
      await stateManager.invalidateState(state)

      const mcClient = getMcClient()
      const tokens = await mcClient.exchangeCodeForToken(code)

      let merchantIds: string[]
      try {
        merchantIds = await mcClient.listMerchantIds(tokens.accessToken)
      } catch (listErr: any) {
        const body = listErr?.response?.data
        req.log.error({ body, status: listErr?.response?.status }, "MC listMerchantIds failed")
        throw new Error(
          `Failed to list Merchant Center accounts (${listErr?.response?.status ?? "unknown"}): ` +
          (body?.error?.message ?? body?.error ?? listErr?.message ?? "unknown error") +
          ". Ensure 'Merchant API' is enabled in your Google Cloud project."
        )
      }
      if (merchantIds.length === 0) {
        throw new Error(
          "No Merchant Center accounts found for this Google account. " +
          "Make sure 'Merchant API' is enabled in your Google Cloud project " +
          "and this Google account has access to at least one Merchant Center account."
        )
      }
      const primaryMerchantId = merchantIds[0]

      // Register GCP project using the OAuth user's own email.
      // Since the user is already an MC ADMIN, Google silently adds API_DEVELOPER
      // without sending any invitation email to the client.
      const oauthEmail = await mcClient.getUserEmail(tokens.accessToken)
      if (oauthEmail) {
        try {
          await mcClient.registerGcp(primaryMerchantId, tokens.accessToken, oauthEmail)
          req.log.info(`MC GCP registered with merchant ${primaryMerchantId} via ${oauthEmail}`)
        } catch (regErr: any) {
          req.log.warn(`MC registerGcp: ${regErr?.response?.data?.error?.message ?? regErr?.message}`)
        }
      }

      // Look up existing account to determine encryption context (account.id as AAD).
      const existing = await adAccountsRepo.findByUserClientAndPlatform(
        stateData.userId,
        stateData.clientId,
        "google_merchant_center",
        { includeInactive: true }
      )

      let accountId: string
      if (existing) {
        accountId = existing.id
      } else {
        // Create a shell row first to obtain the auto-generated UUID for token encryption.
        const shell = await adAccountsRepo.create({
          user_id: stateData.userId,
          client_id: stateData.clientId,
          platform: "google_merchant_center",
          platform_account_id: primaryMerchantId,
          account_name: "Merchant Center",
        })
        accountId = shell.id
      }

      const encAccess = tokenManager.encryptToken(tokens.accessToken, accountId)
      const encRefresh = tokenManager.encryptToken(tokens.refreshToken, accountId)
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()

      await adAccountsRepo.update(stateData.userId, accountId, {
        platform_account_id: primaryMerchantId,
        account_name: "Merchant Center",
        access_token: encAccess.encrypted,
        access_token_iv: encAccess.iv,
        access_token_tag: encAccess.tag,
        refresh_token: encRefresh.encrypted,
        refresh_token_iv: encRefresh.iv,
        refresh_token_tag: encRefresh.tag,
        token_expires_at: expiresAt,
        is_active: true,
        connection_status: "connected",
      })

      await auditLogger.logPlatformApiCall(
        "google_merchant_center" as any,
        "oauth_callback",
        true,
        stateData.userId,
        accountId
      )

      const returnTo = stateData.redirectUri ?? fallback
      const sep = returnTo.includes("?") ? "&" : "?"
      return reply.redirect(
        `${returnTo}${sep}connect=success&platform=google_merchant_center`,
        302
      )
    } catch (err: unknown) {
      req.log.error(err)
      const errMsg = err instanceof Error ? err.message : CALLBACK_ERROR_MESSAGE
      const errorUrl = `${fallback}&connect=error&message=${encodeURIComponent(errMsg)}&platform=google_merchant_center`
      return reply.redirect(errorUrl, 302)
    }
  })

  // GET /platforms/google_merchant_center/status?clientId=...
  app.get("/platforms/google_merchant_center/status", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { clientId } = req.query as { clientId?: string }
      if (!clientId) return reply.code(400).send({ error: "clientId is required" })

      const account = await adAccountsRepo.findByUserClientAndPlatform(
        user.id,
        clientId,
        "google_merchant_center"
      )

      return reply.send({
        connected: !!account,
        merchant_id: account?.platform_account_id ?? null,
        account_name: account?.account_name ?? null,
      })
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Internal server error" })
    }
  })
}
