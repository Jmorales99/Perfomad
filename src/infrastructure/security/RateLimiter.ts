/**
 * RateLimiter provides rate limiting functionality
 * Can be implemented with in-memory storage, Redis, or database
 */

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number // Time window in milliseconds
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  limit: number
}

/**
 * Simple in-memory rate limiter
 * For production, consider using Redis or a dedicated rate limiting service
 */
export class RateLimiter {
  private store: Map<string, { count: number; resetAt: Date }> = new Map()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000)
  }

  /**
   * Checks if a request should be allowed based on rate limit
   */
  async checkRateLimit(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const now = new Date()
    const entry = this.store.get(key)

    if (!entry || entry.resetAt < now) {
      // Create new entry or reset expired entry
      const resetAt = new Date(now.getTime() + config.windowMs)
      this.store.set(key, {
        count: 1,
        resetAt,
      })

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt,
        limit: config.maxRequests,
      }
    }

    // Entry exists and is still valid
    if (entry.count >= config.maxRequests) {
      // Rate limit exceeded
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        limit: config.maxRequests,
      }
    }

    // Increment count
    entry.count++
    this.store.set(key, entry)

    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      resetAt: entry.resetAt,
      limit: config.maxRequests,
    }
  }

  /**
   * Records a request (alternative to checkRateLimit)
   * Returns true if allowed, false if rate limited
   */
  async recordRequest(key: string, config: RateLimitConfig): Promise<boolean> {
    const result = await this.checkRateLimit(key, config)
    return result.allowed
  }

  /**
   * Generates a rate limit key for a user and endpoint
   */
  static generateKey(userId: string, endpoint: string): string {
    return `rate_limit:${userId}:${endpoint}`
  }

  /**
   * Generates a rate limit key for an IP address and endpoint
   */
  static generateIPKey(ipAddress: string, endpoint: string): string {
    return `rate_limit:ip:${ipAddress}:${endpoint}`
  }

  /**
   * Cleans up expired entries
   */
  private cleanup(): void {
    const now = new Date()
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Clears all rate limit entries (useful for testing)
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * Destroys the rate limiter and cleans up intervals
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.store.clear()
  }
}

/**
 * Default rate limit configurations
 */
export const DefaultRateLimits = {
  // Per-user limits
  USER_OAUTH_CALLBACK: { maxRequests: 10, windowMs: 15 * 60 * 1000 }, // 10 requests per 15 minutes
  USER_API_CALL: { maxRequests: 100, windowMs: 60 * 1000 }, // 100 requests per minute
  USER_CAMPAIGN_CREATE: { maxRequests: 20, windowMs: 60 * 1000 }, // 20 requests per minute
  USER_METRICS_SYNC: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 requests per minute

  // Per-IP limits
  IP_AUTH: { maxRequests: 5, windowMs: 15 * 60 * 1000 }, // 5 requests per 15 minutes
  IP_API: { maxRequests: 200, windowMs: 60 * 1000 }, // 200 requests per minute
  IP_OAUTH_CALLBACK: { maxRequests: 20, windowMs: 15 * 60 * 1000 }, // 20 requests per 15 minutes
} as const

