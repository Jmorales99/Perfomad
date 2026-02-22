import { CryptoService } from "@/infrastructure/security/CryptoService"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { AdAccount } from "@/domain/repositories/AdAccountsRepository"

export type { AdAccount }

/**
 * TokenManager handles encryption, decryption, and refresh of OAuth tokens
 * All tokens are encrypted at rest and decrypted only in memory during API calls
 */
export class TokenManager {
  private cryptoService: CryptoService
  private refreshBufferMinutes = 5 // Refresh tokens 5 minutes before expiration

  constructor() {
    this.cryptoService = new CryptoService()
  }

  /**
   * Encrypts a token and returns the encrypted string with IV and tag
   * Tokens are stored separately with their IV and tag in the database
   */
  encryptToken(token: string, accountId: string): { encrypted: string; iv: string; tag: string } {
    const { ciphertext, iv, tag } = this.cryptoService.encrypt(token, accountId)
    return { encrypted: ciphertext, iv, tag }
  }

  /**
   * Decrypts an encrypted token
   */
  decryptToken(encryptedToken: string, iv: string, tag: string, accountId: string): string {
    return this.cryptoService.decrypt(encryptedToken, iv, tag, accountId)
  }

  /**
   * Checks if a token is expired or will expire soon
   */
  isTokenExpired(expiresAt: string | null | undefined): boolean {
    if (!expiresAt) {
      return true // No expiration date means expired
    }

    const expirationDate = new Date(expiresAt)
    const now = new Date()
    const bufferTime = this.refreshBufferMinutes * 60 * 1000 // Convert to milliseconds

    // Token is expired if current time + buffer is past expiration
    return now.getTime() + bufferTime >= expirationDate.getTime()
  }

  /**
   * Retrieves and validates access token for an account
   * Automatically refreshes if expired or about to expire
   * REQUIRES encrypted tokens with IV and tag - no plaintext support
   */
  async refreshTokenIfNeeded(
    account: AdAccount,
    refreshCallback: (refreshToken: string) => Promise<{
      accessToken: string
      refreshToken?: string
      expiresIn: number
    }>
  ): Promise<string> {
    // Check if token exists and is not expired
    if (
      account.access_token &&
      account.token_expires_at &&
      !this.isTokenExpired(account.token_expires_at)
    ) {
      // Token must be encrypted - verify IV and tag exist
      if (!account.access_token_iv || !account.access_token_tag) {
        throw new Error(
          `Access token for account ${account.id} is not properly encrypted. Missing IV or tag. Please reconnect your account.`
        )
      }

      // Decrypt the encrypted token
      return this.decryptToken(
        account.access_token,
        account.access_token_iv,
        account.access_token_tag,
        account.id
      )
    }

    // Token is expired or missing, need to refresh
    if (!account.refresh_token) {
      throw new Error(`No refresh token available for account ${account.id}`)
    }

    // Refresh token must be encrypted - verify IV and tag exist
    if (!account.refresh_token_iv || !account.refresh_token_tag) {
      throw new Error(
        `Refresh token for account ${account.id} is not properly encrypted. Missing IV or tag. Please reconnect your account.`
      )
    }

    try {
      // Decrypt the encrypted refresh token
      const refreshToken = this.decryptToken(
        account.refresh_token,
        account.refresh_token_iv,
        account.refresh_token_tag,
        account.id
      )

      // Call refresh callback to get new tokens from platform
      const newTokens = await refreshCallback(refreshToken)

      // Calculate expiration date
      const expiresAt = new Date()
      expiresAt.setSeconds(expiresAt.getSeconds() + newTokens.expiresIn)

      // Encrypt new tokens
      const encryptedAccess = this.encryptToken(newTokens.accessToken, account.id)
      const encryptedRefresh = newTokens.refreshToken
        ? this.encryptToken(newTokens.refreshToken, account.id)
        : null

      if (!encryptedRefresh) {
        throw new Error("Platform did not return a refresh token")
      }

      // Update account with encrypted tokens and their IVs/tags
      await supabaseAdmin
        .from("ad_accounts")
        .update({
          access_token: encryptedAccess.encrypted,
          access_token_iv: encryptedAccess.iv,
          access_token_tag: encryptedAccess.tag,
          refresh_token: encryptedRefresh.encrypted,
          refresh_token_iv: encryptedRefresh.iv,
          refresh_token_tag: encryptedRefresh.tag,
          token_expires_at: expiresAt.toISOString(),
        })
        .eq("id", account.id)

      return newTokens.accessToken
    } catch (error: any) {
      throw new Error(`Failed to refresh token for account ${account.id}: ${error.message}`)
    }
  }

  /**
   * Gets a valid access token for an account
   * Decrypts and returns the token, refreshing if needed
   */
  async getValidAccessToken(
    account: AdAccount,
    refreshCallback: (refreshToken: string) => Promise<{
      accessToken: string
      refreshToken?: string
      expiresIn: number
    }>
  ): Promise<string> {
    return this.refreshTokenIfNeeded(account, refreshCallback)
  }

  /**
   * Stores encrypted tokens in the database with IVs and tags
   */
  async storeTokens(
    accountId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ): Promise<void> {
    // Encrypt tokens
    const encryptedAccess = this.encryptToken(accessToken, accountId)
    const encryptedRefresh = this.encryptToken(refreshToken, accountId)

    // Calculate expiration date
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn)

    // Update account with encrypted tokens and their IVs/tags
    const { error } = await supabaseAdmin
      .from("ad_accounts")
      .update({
        access_token: encryptedAccess.encrypted,
        access_token_iv: encryptedAccess.iv,
        access_token_tag: encryptedAccess.tag,
        refresh_token: encryptedRefresh.encrypted,
        refresh_token_iv: encryptedRefresh.iv,
        refresh_token_tag: encryptedRefresh.tag,
        token_expires_at: expiresAt.toISOString(),
      })
      .eq("id", accountId)

    if (error) {
      throw new Error(`Failed to store tokens: ${error.message}`)
    }
  }

  /**
   * Rotates refresh token (when platform supports it)
   */
  async rotateRefreshToken(
    account: AdAccount,
    rotateCallback: (refreshToken: string) => Promise<{
      accessToken: string
      refreshToken: string
      expiresIn: number
    }>
  ): Promise<void> {
    if (!account.refresh_token) {
      throw new Error(`No refresh token available for account ${account.id}`)
    }

    try {
      // Decrypt refresh token (must be encrypted with IV and tag)
      if (!account.refresh_token_iv || !account.refresh_token_tag) {
        throw new Error(
          `Refresh token for account ${account.id} is not properly encrypted. Missing IV or tag. Please reconnect your account.`
        )
      }
      const refreshToken = this.decryptToken(
        account.refresh_token!,
        account.refresh_token_iv,
        account.refresh_token_tag,
        account.id
      )

      // Rotate token
      const newTokens = await rotateCallback(refreshToken)

      // Store new tokens
      await this.storeTokens(account.id, newTokens.accessToken, newTokens.refreshToken, newTokens.expiresIn)
    } catch (error: any) {
      throw new Error(`Failed to rotate refresh token: ${error.message}`)
    }
  }

  /**
   * Masks a token for logging (shows only first and last 4 characters)
   */
  static maskTokenForLogging(token: string): string {
    return CryptoService.maskTokenForLogging(token)
  }
}

