import axios from "axios"

export interface MerchantProduct {
  id: string
  offerId: string
  title: string
  imageLink: string
  additionalImageLinks?: string[]
  link: string
  price?: { value: string; currency: string }
}

/**
 * Google Merchant Center client — hybrid approach.
 *
 * Account discovery : Content API v2.1 authinfo — works with OAuth token, no registerGcp required.
 *                     Requires "Content API for Shopping" enabled in Perfomad's GCP project.
 * GCP registration  : Merchant API v1 registerGcp — called after discovery, non-fatal (409 = already registered).
 *                     Uses the OAuth user's own email so the role is added silently (no invitation email)
 *                     when the user is already an MC admin.
 * Products          : Merchant API v1 — requires API_DEVELOPER role (set up by registerGcp above).
 *
 * OAuth scope: https://www.googleapis.com/auth/content
 */
export class MerchantCenterApiClient {
  private readonly productsBase = "https://merchantapi.googleapis.com/products/v1"
  private readonly accountsBase = "https://merchantapi.googleapis.com/accounts/v1"
  private readonly contentBase = "https://shoppingcontent.googleapis.com/content/v2.1"

  constructor(
    private readonly config: {
      clientId: string
      clientSecret: string
      redirectUri: string
    }
  ) {}

  getOAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/content",
      state,
      access_type: "offline",
      prompt: "consent",
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  async exchangeCodeForToken(
    code: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      const { data } = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
          grant_type: "authorization_code",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
      if (!data.refresh_token) {
        throw new Error(
          "Google did not return a refresh token. " +
          "Revoke access at https://myaccount.google.com/permissions and reconnect."
        )
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
      }
    } catch (err: any) {
      if (err.message?.includes("refresh token")) throw err
      const detail = err.response?.data?.error_description || err.response?.data?.error || err.message
      throw new Error(`Failed to exchange Merchant Center code: ${detail}`)
    }
  }

  async refreshAccessToken(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
    try {
      const { data } = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
      }
    } catch (err: any) {
      const googleError = err.response?.data?.error
      const detail = err.response?.data?.error_description || googleError || err.message
      if (googleError === "invalid_grant") {
        throw new Error(`invalid_grant: ${detail}. The user must reconnect their Merchant Center account.`)
      }
      throw new Error(`Failed to refresh Merchant Center token: ${detail}`)
    }
  }

  /** Returns the email address of the authenticated OAuth user. */
  async getUserEmail(accessToken: string): Promise<string | null> {
    try {
      const { data } = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return data.email ?? null
    } catch {
      return null
    }
  }

  /**
   * Registers the GCP project with a Merchant Center account.
   * Pass the OAuth user's real email — since they are already an MC ADMIN,
   * Google silently adds the API_DEVELOPER role with no invitation email.
   * Errors are non-fatal: 409 means already registered.
   */
  async registerGcp(merchantId: string, accessToken: string, developerEmail: string): Promise<void> {
    await axios.post(
      `${this.accountsBase}/accounts/${merchantId}:registerGcp`,
      { developerEmail },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
  }

  /** Returns Merchant Center account IDs accessible with this OAuth token. */
  async listMerchantIds(accessToken: string): Promise<string[]> {
    const { data } = await axios.get(`${this.contentBase}/accounts/authinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return (data.accountIdentifiers ?? [])
      .map((a: any) => a.merchantId?.toString() || "")
      .filter(Boolean)
  }

  async listProducts(
    merchantId: string,
    accessToken: string,
    opts?: { maxResults?: number; pageToken?: string }
  ): Promise<MerchantProduct[]> {
    const params: Record<string, string | number> = {
      pageSize: opts?.maxResults ?? 50,
    }
    if (opts?.pageToken) params.pageToken = opts.pageToken

    const { data } = await axios.get(
      `${this.productsBase}/accounts/${merchantId}/products`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params,
      }
    )

    return (data.products ?? []).map(
      (p: any): MerchantProduct => ({
        id: p.productId ?? p.id,
        offerId: p.offerId ?? p.productId ?? p.id,
        title: p.title ?? "",
        imageLink: p.imageLink ?? p.primaryImage?.imageUri ?? "",
        additionalImageLinks: p.additionalImageLinks,
        link: p.link ?? p.linkTemplate ?? "",
        price: p.price
          ? { value: p.price.value ?? p.price.amountMicros, currency: p.price.currency ?? p.price.currencyCode }
          : undefined,
      })
    )
  }
}
