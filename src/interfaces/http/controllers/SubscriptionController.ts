import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import axios from "axios"

const MOCK_API_URL = process.env.MOCK_API_URL || "http://localhost:4000"
const MOCK_API_KEY = process.env.MOCK_API_KEY || "mock-key"

export async function SubscriptionController(app: FastifyInstance) {
  // ============================================================
  // 💳 Activar o reactivar suscripción dummy
  // ============================================================
  app.post("/subscription/activate-dummy", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      // Obtenemos perfil actual
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plai_mock_user_id")
        .eq("id", user.id)
        .maybeSingle()

      let mockUserId = profile?.plai_mock_user_id

      // Si no existe, creamos perfil mock
      if (!mockUserId) {
        const { data } = await axios.post(
          `${MOCK_API_URL}/auth/create_profile`,
          { email: user.email, name: user.user_metadata?.name ?? "User" },
          { headers: { "x-api-key": MOCK_API_KEY } }
        )
        mockUserId = data.results.id
      }

      const startDate = new Date().toISOString()
      const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      const { error } = await supabaseAdmin
        .from("profiles")
        .update({
          has_active_subscription: true,
          plai_mock_user_id: mockUserId,
          subscription_start: startDate,
          subscription_expires: expiryDate,
        })
        .eq("id", user.id)

      if (error) throw error

      return reply.status(200).send({
        message: "Suscripción dummy activada o reactivada correctamente ✅",
        plai_mock_user_id: mockUserId,
        expires_at: expiryDate,
      })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: "Error al activar suscripción dummy" })
    }
  })
}
