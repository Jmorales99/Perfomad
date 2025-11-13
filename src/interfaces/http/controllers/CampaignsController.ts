import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import axios from "axios"

const MOCK_API_URL = process.env.MOCK_API_URL || "http://localhost:4001"
const MOCK_API_KEY = process.env.MOCK_API_KEY || "mock-key"

export async function CampaignsController(app: FastifyInstance) {
  const repo = new SupabaseCampaignsRepository()

  // 📦 Listar campañas
  app.get("/campaigns", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      const campaigns = await repo.listByUser(user.id)
      return reply.send(campaigns)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al listar campañas" })
    }
  })

  // 🆕 Crear campaña (con conexión a mock y Supabase)
  app.post("/campaigns", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      const body = req.body as {
        name: string
        platforms: ("meta" | "google_ads" | "linkedin")[]
        description?: string
        budget_usd?: number
        start_date?: string
        end_date?: string
      }

      if (!body.name || !body.platforms?.length)
        return reply.code(400).send({ error: "Faltan campos obligatorios" })

      // 1️⃣ Crear campaña local en Supabase
      const created = await repo.create({
        user_id: user.id,
        name: body.name,
        platforms: body.platforms,
        description: body.description || "",
        budget_usd: body.budget_usd ?? 0,
        spend_usd: 0,
        status: "active",
        start_date: body.start_date ?? new Date().toISOString(),
        end_date: body.end_date ?? null,
        images: [],
      })

      // 2️⃣ Crear campaña simulada en Plai (mock)
      const { data } = await axios.post(
        `${MOCK_API_URL}/meta/campaign/create`,
        {
          ad_account_id: "act_mock_001",
          name: body.name,
          objective: "LINK_CLICKS",
          daily_budget: body.budget_usd ?? 100,
          start_time: body.start_date ?? new Date().toISOString(),
          end_time: body.end_date ?? null,
        },
        { headers: { "x-api-key": MOCK_API_KEY } }
      )

      // 3️⃣ Guardar datos de Plai (mock)
      const updated = await repo.update(user.id, created.id, {
        mock_campaign_id: data.results.campaign_id,
        mock_stats: data.results.metrics,
      })

      return reply.code(201).send(updated)
    } catch (err) {
      console.error("Error creando campaña:", err)
      return reply.code(500).send({ error: "Error al crear campaña" })
    }
  })

  // 📈 Obtener métricas simuladas
  app.get("/campaigns/:id/overview", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      const { id } = req.params as { id: string }

      const campaign = await repo.findById(user.id, id)
      if (!campaign || !campaign.mock_campaign_id)
        return reply.code(404).send({ error: "Campaña no encontrada o sin mock_id" })

      const { data } = await axios.get(
        `${MOCK_API_URL}/meta/campaign/overview`,
        {
          params: { campaign_id: campaign.mock_campaign_id },
          headers: { "x-api-key": MOCK_API_KEY },
        }
      )

      return reply.send({
        id: campaign.id,
        name: campaign.name,
        metrics: data.results.metrics,
      })
    } catch (err) {
      console.error("Error al obtener métricas:", err)
      return reply.code(500).send({ error: "Error al obtener métricas" })
    }
  })
}
