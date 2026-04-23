import { describe, it, expect } from "vitest"
import { tokenErrorRequiresReconnect, reconnectErrorPayload } from "../reconnectErrors"

describe("tokenErrorRequiresReconnect", () => {
  it("detects Google invalid_grant", () => {
    expect(
      tokenErrorRequiresReconnect(
        "Failed to refresh token for account abc: invalid_grant: Token has been expired or revoked."
      )
    ).toBe(true)
  })

  it("detects missing IV/tag encryption errors", () => {
    expect(
      tokenErrorRequiresReconnect(
        "Access token for account abc is not properly encrypted. Missing IV or tag."
      )
    ).toBe(true)
  })

  it("detects missing refresh token", () => {
    expect(tokenErrorRequiresReconnect("No refresh token available for account abc")).toBe(true)
  })

  it("detects Meta OAuthException (error code 190 message)", () => {
    expect(
      tokenErrorRequiresReconnect(
        "invalid_grant: Error validating access token: Session has expired. The user must reconnect their Meta account."
      )
    ).toBe(true)
  })

  it("detects generic 'reconnect' keyword in message", () => {
    expect(tokenErrorRequiresReconnect("Please reconnect your account.")).toBe(true)
  })

  it("detects token has been expired or revoked in message", () => {
    expect(tokenErrorRequiresReconnect("Token has been expired or revoked")).toBe(true)
  })

  it("returns false for unrelated errors", () => {
    expect(tokenErrorRequiresReconnect("Network timeout")).toBe(false)
    expect(tokenErrorRequiresReconnect("Rate limit exceeded")).toBe(false)
    expect(tokenErrorRequiresReconnect("Brand not found")).toBe(false)
  })
})

describe("reconnectErrorPayload", () => {
  it("builds the expected payload shape", () => {
    const payload = reconnectErrorPayload(new Error("invalid_grant: Token revoked."), "google_ads", "acc-123")
    expect(payload).toEqual({
      code: "oauth_reconnect_required",
      message: "invalid_grant: Token revoked.",
      requires_reconnection: true,
      platform: "google_ads",
      ad_account_id: "acc-123",
    })
  })

  it("omits ad_account_id when not provided", () => {
    const payload = reconnectErrorPayload(new Error("No refresh token available"), "meta")
    expect(payload).not.toHaveProperty("ad_account_id")
    expect(payload.requires_reconnection).toBe(true)
  })
})
