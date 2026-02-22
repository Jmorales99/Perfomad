import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

/**
 * Security headers middleware
 * Sets security headers on all responses
 */
export async function securityHeadersPlugin(app: FastifyInstance) {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    reply.header("X-Content-Type-Options", "nosniff")
    reply.header("X-Frame-Options", "DENY")
    reply.header("X-XSS-Protection", "1; mode=block")
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin")

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
    reply.header("Content-Security-Policy", csp)

    reply.header(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()"
    )
  })
}

/**
 * CORS configuration
 * Validates Origin header and sets appropriate CORS headers
 */
export function configureCORS(allowedOrigins: string[] = ["http://localhost:5173"]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin

    if (request.method === "OPTIONS") {
      if (origin && allowedOrigins.includes(origin)) {
        reply
          .header("Access-Control-Allow-Origin", origin)
          .header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
          .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
          .header("Access-Control-Max-Age", "86400")
          .header("Access-Control-Allow-Credentials", "true")
          .code(204)
          .send()
        return
      } else {
        reply.code(403).send({ error: "Origin not allowed" })
        return
      }
    }

    if (origin && allowedOrigins.includes(origin)) {
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Access-Control-Allow-Credentials", "true")
    }

    if (request.url.includes("/oauth-callback") || request.url.includes("/subscription/oauth-callback")) {
      if (!origin || !allowedOrigins.includes(origin)) {
        const platformOrigins = [
          "https://www.facebook.com",
          "https://accounts.google.com",
          "https://www.linkedin.com",
        ]
        const isValidPlatformOrigin = platformOrigins.some((po) => origin?.startsWith(po))
        if (!isValidPlatformOrigin && (!origin || !allowedOrigins.includes(origin))) {
          reply.code(403).send({ error: "Invalid origin for OAuth callback" })
          return
        }
      }
    }
  }
}
