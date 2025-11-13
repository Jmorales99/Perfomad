import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export async function ProfileController(app: FastifyInstance) {
  // 🧠 Obtener perfil
  app.get("/", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id, email, name, age, phone, has_completed_onboarding, has_active_subscription, created_at")
        .eq("id", user.id)
        .single()

      if (error || !profile) {
        return reply.status(404).send({ error: "Perfil no encontrado" })
      }

      return reply.status(200).send(profile)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al obtener el perfil" })
    }
  })

  // ✏️ Actualizar perfil
  app.patch("/", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      const { name, age, phone } = req.body as any

      if (!name && !age && !phone) {
        return reply.status(400).send({ error: "No se enviaron campos para actualizar" })
      }

      const updates = {
        ...(name && { name }),
        ...(age && { age }),
        ...(phone && { phone }),
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .update(updates)
        .eq("id", user.id)
        .select()
        .single()

      if (error) throw error
      return reply.status(200).send(data)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al actualizar el perfil" })
    }
  })

  // ✅ Completar onboarding
  app.patch("/onboarding", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .update({ has_completed_onboarding: true })
        .eq("id", user.id)
        .select()
        .single()

      if (error) throw error
      return reply.status(200).send(data)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al actualizar onboarding" })
    }
  })
}
