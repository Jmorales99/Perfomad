import Fastify from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import swagger from "@fastify/swagger"
import swaggerUi from "@fastify/swagger-ui"
import { routes } from "./routes/index.js"
import authPlugin from "./plugins/authPlugin.js"
import { swaggerSchemas } from "./openapi/swaggerSchemas.js"
import { authRoutes } from "./routes/authRoutes.js"
import { securityHeadersPlugin } from "./middlewares/securityHeaders.js"

export function buildServer() {
  const app = Fastify({ logger: true })

  const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, "http://localhost:5173"]
    : ["http://localhost:5173"]

  app.register(cors, {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })

  app.register(helmet)
  app.register(securityHeadersPlugin)

  Object.entries(swaggerSchemas).forEach(([name, schema]) => {
    app.addSchema({ $id: name, ...schema })
  })

  app.register(swagger as Parameters<typeof app.register>[0], {
    openapi: {
      info: {
        title: "PERFOMAD API",
        description: "API REST de PERFOMAD",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  })

  app.register(swaggerUi, {
    routePrefix: "/docs",
    staticCSP: true,
  })

  app.register(authPlugin)

  app.after(() => {
    app.register(authRoutes, { prefix: "/v1/auth" })
    app.register(routes, { prefix: "/v1" })
    app.get("/", async () => ({ message: "Welcome to PERFOMAD API 🚀" }))
  })

  app.setErrorHandler((error, req, reply) => {
    if ((error as { validation?: unknown[] }).validation) {
      const validation = (error as { validation: Array<{ instancePath?: string; params?: { missingProperty?: string }; message?: string }> }).validation
      const details = validation
        .map((v) => {
          const field = v.instancePath?.replace("/", "") || v.params?.missingProperty
          return field ? `Campo '${field}' es inválido o faltante` : v.message ?? "Error de validación"
        })
        .filter(Boolean)
        .join(", ")
      return reply.code(400).send({ error: details || "Datos inválidos." })
    }
    req.log.error(error)
    return reply.code(500).send({ error: "Error interno del servidor." })
  })

  return app
}
