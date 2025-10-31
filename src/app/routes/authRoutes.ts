import type { FastifyInstance } from "fastify"
import { AuthController } from "../../interfaces/http/controllers/AuthController.js"

export async function authRoutes(app: FastifyInstance) {
  const controller = new AuthController(app)

  // 🧾 Registro de usuario
  app.post("/signup", {
    schema: {
      summary: "Registro de usuario",
      body: {
        type: "object",
        required: ["email", "password", "name", "age", "phone"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          name: { type: "string", minLength: 2 },
          age: { type: "integer", minimum: 13 },
          phone: { type: "string", pattern: "^\\+[1-9]\\d{6,14}$" }, // ✅ E.164 internacional
        }
      },
      response: {
        201: {
          type: "object",
          properties: {
            message: { type: "string" },
            id: { type: "string" },
          },
        },
      },
    },
    handler: controller.signup,
  })

  // 🔐 Inicio de sesión
  app.post("/login", {
    schema: {
      summary: "Inicio de sesión",
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
    },
    handler: controller.login,
  })
}
