import type { FastifyInstance } from "fastify"
import { supabaseClient } from "@/infrastructure/db/supabaseClient"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"

export async function CampaignsController(app: FastifyInstance) {
  const repo = new SupabaseCampaignsRepository()

  // 🔐 Obtener usuario autenticado
  const getUserFromToken = async (req: any, reply: any) => {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      reply.code(401).send({ error: "Token no provisto" })
      throw new Error("Token no provisto")
    }

    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error,
    } = await supabaseClient.auth.getUser(token)

    if (error || !user) {
      reply.code(401).send({ error: "Token inválido" })
      throw new Error("Token inválido")
    }

    return user
  }

  // 📦 GET /v1/campaigns - Listar campañas
  app.get("/campaigns", async (req, reply) => {
    try {
      const user = await getUserFromToken(req, reply)
      const campaigns = await repo.listByUser(user.id)
      return reply.send(campaigns)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al listar campañas" })
    }
  })

  // 🆕 POST /v1/campaigns - Crear campaña (múltiples plataformas)
  app.post("/campaigns", async (req, reply) => {
    try {
      const user = await getUserFromToken(req, reply)

      const body = req.body as {
        name: string
        platforms: ("meta" | "google_ads" | "linkedin")[]
        description?: string
        budget_usd?: number
        images?: { path: string }[]
      }

      if (!body.name || !body.platforms?.length) {
        return reply.code(400).send({
          error: "Faltan campos obligatorios (name, platforms)",
        })
      }

      const campaign = await repo.create({
        user_id: user.id,
        name: body.name,
        platforms: body.platforms,
        description: body.description || "",
        budget_usd: body.budget_usd ?? 0,
        spend_usd: 0,
        status: "active",
        start_date: new Date().toISOString(),
        end_date: null,
        images: body.images || [],
      })

      return reply.code(201).send(campaign)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al crear campaña" })
    }
  })

  // ✏️ PUT /v1/campaigns/:id - Actualizar campaña
  app.put("/campaigns/:id", async (req, reply) => {
    try {
      const user = await getUserFromToken(req, reply)
      const { id } = req.params as { id: string }

      const updates = req.body as Partial<{
        name: string
        description: string
        budget_usd: number
        platforms: ("meta" | "google_ads" | "linkedin")[]
        status: "active" | "paused" | "completed"
        images: { path: string }[]
      }>

      const validStatuses = ["active", "paused", "completed"] as const
      if (updates.status && !validStatuses.includes(updates.status)) {
        return reply.code(400).send({ error: "Estado de campaña no válido." })
      }

      // Normalizar imágenes
      if (updates.images && Array.isArray(updates.images)) {
        const normalizedImages = updates.images.map((img) => ({
          file_path: img.path,
        }))
        ;(updates as any).images = normalizedImages
      }

      const updated = await repo.update(user.id, id, updates as any)
      return reply.send(updated)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al actualizar campaña" })
    }
  })

  // ❌ DELETE /v1/campaigns/:id - Eliminar campaña
  app.delete("/campaigns/:id", async (req, reply) => {
    try {
      const user = await getUserFromToken(req, reply)
      const { id } = req.params as { id: string }
      await repo.delete(user.id, id)
      return reply.send({ success: true })
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al eliminar campaña" })
    }
  })
}
