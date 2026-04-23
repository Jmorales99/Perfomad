import { isAxiosError } from "axios"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { CryptoService } from "./CryptoService"

export type Platform = "meta" | "google_ads" | "linkedin" | "tiktok" | "youtube"

export type AuditEventType =
  | "token_refresh"
  | "oauth_callback"
  | "token_access"
  | "security_event"
  | "platform_api_call"
  | "token_rotation"

interface AuditLogEntry {
  event_type: AuditEventType
  user_id: string
  platform?: Platform
  account_id?: string
  success: boolean
  details?: Record<string, any>
  ip_address?: string
  user_agent?: string
  error_message?: string
}

/**
 * AuditLogger logs security-sensitive events
 * NEVER logs tokens, passwords, or other sensitive credentials
 */
export class AuditLogger {
  private cryptoService: CryptoService

  constructor() {
    this.cryptoService = new CryptoService()
  }

  /**
   * Logs token refresh events
   */
  async logTokenRefresh(
    accountId: string,
    platform: Platform,
    success: boolean,
    userId?: string,
    error?: unknown
  ): Promise<void> {
    const details: Record<string, any> = {
      platform,
      account_id: accountId, // Not sensitive - just an ID
    }

    if (error != null) {
      const safe = this.safeErrorDetails(error)
      details.error_type = safe.error_type
      details.error_message = safe.error_message
    }

    await this.log({
      event_type: "token_refresh",
      user_id: userId || "unknown",
      platform,
      account_id: accountId,
      success,
      details,
    })
  }

  /**
   * Logs OAuth callback events
   */
  async logOAuthCallback(
    userId: string,
    platform: Platform,
    success: boolean,
    ipAddress?: string,
    userAgent?: string,
    error?: unknown
  ): Promise<void> {
    const details: Record<string, any> = {
      platform,
    }

    if (error != null) {
      const safe = this.safeErrorDetails(error)
      details.error_type = safe.error_type
      details.error_message = safe.error_message
    }

    await this.log({
      event_type: "oauth_callback",
      user_id: userId,
      platform,
      success,
      details,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
  }

  /**
   * Logs token access events (when tokens are retrieved/decrypted)
   */
  async logTokenAccess(
    accountId: string,
    operation: string,
    userId?: string,
    platform?: Platform
  ): Promise<void> {
    await this.log({
      event_type: "token_access",
      user_id: userId || "unknown",
      platform,
      account_id: accountId,
      success: true,
      details: {
        operation, // e.g., "decrypt", "retrieve", "refresh"
      },
    })
  }

  /**
   * Logs general security events
   */
  async logSecurityEvent(
    event: string,
    userId: string,
    details?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // Sanitize details to remove sensitive information
    const sanitizedDetails = details ? this.sanitizeDetails(details) : undefined

    await this.log({
      event_type: "security_event",
      user_id: userId,
      success: true,
      details: {
        event,
        ...sanitizedDetails,
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    })
  }

  /**
   * Logs platform API call events
   */
  async logPlatformApiCall(
    platform: Platform,
    endpoint: string,
    success: boolean,
    userId?: string,
    accountId?: string,
    error?: unknown
  ): Promise<void> {
    const details: Record<string, any> = {
      platform,
      endpoint,
    }

    if (error != null) {
      const safe = this.safeErrorDetails(error)
      details.error_type = safe.error_type
      details.error_message = safe.error_message
    }

    await this.log({
      event_type: "platform_api_call",
      user_id: userId || "unknown",
      platform,
      account_id: accountId,
      success,
      details,
    })
  }

  /**
   * Internal method to write audit log entry
   */
  private async log(entry: AuditLogEntry): Promise<void> {
    try {
      // In a real implementation, you might have an audit_logs table
      // For now, we'll use console logging with structured format
      // and could write to database or external logging service

      const logEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
        details: entry.details || {},
      }

      // Console log for development (remove sensitive data first)
      if (process.env.NODE_ENV === "development") {
        console.log("[AUDIT]", JSON.stringify(logEntry, null, 2))
      }

      // TODO: Implement database logging when audit_logs table is created
      // For now, we'll rely on application logs
      // Uncomment when audit_logs table is available:
      /*
      const { error } = await supabaseAdmin.from("audit_logs").insert({
        event_type: entry.event_type,
        user_id: entry.user_id,
        platform: entry.platform || null,
        account_id: entry.account_id || null,
        success: entry.success,
        details: entry.details || {},
        ip_address: entry.ip_address || null,
        user_agent: entry.user_agent || null,
        error_message: entry.error_message || null,
        created_at: new Date().toISOString(),
      })

      if (error) {
        console.error("Failed to write audit log:", error)
      }
      */
    } catch (error) {
      // Don't throw - audit logging failures shouldn't break the application
      console.error("Audit logging error:", error)
    }
  }

  /**
   * Builds a safe { type, message } for audit logs. Never reads Axios request config/headers/body.
   */
  private safeErrorDetails(error: unknown): { error_type: string; error_message: string } {
    if (isAxiosError(error)) {
      const status = error.response?.status
      const statusText =
        typeof error.response?.statusText === "string"
          ? error.response.statusText.slice(0, 80)
          : ""
      let providerHint = ""
      const data = error.response?.data
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const o = data as Record<string, unknown>
        const errCode = o.error
        const errDesc = o.error_description
        if (typeof errCode === "string" && errCode.length > 0 && errCode.length < 120) {
          providerHint = errCode
        }
        if (typeof errDesc === "string" && errDesc.length > 0 && errDesc.length < 220) {
          providerHint = providerHint ? `${providerHint}: ${errDesc}` : errDesc
        }
      }
      const base = `HTTP ${status ?? "?"}${statusText ? ` ${statusText}` : ""}`
      const combined = providerHint ? `${base} — ${providerHint}` : base
      return {
        error_type: "AxiosError",
        error_message: this.sanitizeErrorMessage(combined),
      }
    }

    if (error instanceof Error) {
      return {
        error_type: error.constructor.name,
        error_message: this.sanitizeErrorMessage(error.message),
      }
    }

    return {
      error_type: "Unknown",
      error_message: this.sanitizeErrorMessage(String(error)),
    }
  }

  /**
   * Sanitizes error messages to remove sensitive information
   */
  private sanitizeErrorMessage(message: string): string {
    if (!message) return ""

    // Remove potential token patterns
    let sanitized = message
      .replace(/token[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, "token=***")
      .replace(/access_token[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, "access_token=***")
      .replace(/refresh_token[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, "refresh_token=***")
      .replace(/client_secret=[^&\s"'<>]+/gi, "client_secret=***")
      .replace(/code=[A-Za-z0-9._~-]{10,}/gi, "code=***")
      .replace(/state=[A-Za-z0-9._~-]{10,}/gi, "state=***")
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.+/=-]+/g, "***JWT***")
      .replace(/password[=:]\s*['"]?[^'"]+['"]?/gi, "password=***")
      .replace(/secret[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, "secret=***")

    return sanitized
  }

  /**
   * Sanitizes details object to remove sensitive fields
   */
  private sanitizeDetails(details: Record<string, any>): Record<string, any> {
    const sensitiveKeys = [
      "token",
      "access_token",
      "refresh_token",
      "password",
      "secret",
      "api_key",
      "apiKey",
      "authorization",
      "auth",
      "credentials",
    ]

    const sanitized: Record<string, any> = {}

    for (const [key, value] of Object.entries(details)) {
      const lowerKey = key.toLowerCase()

      // Skip sensitive keys
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
        sanitized[key] = "***REDACTED***"
        continue
      }

      // Recursively sanitize nested objects
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeDetails(value)
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((item) =>
          typeof item === "object" && item !== null ? this.sanitizeDetails(item) : item
        )
      } else {
        sanitized[key] = value
      }
    }

    return sanitized
  }
}

