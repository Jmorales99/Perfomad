import type { FastifyInstance } from 'fastify'
import { supabaseClient, supabaseAdmin } from '@/infrastructure/db/supabaseClient'

export async function ProfileController(app: FastifyInstance) {
  // ============================================================
  // 🧠 Obtener el perfil del usuario autenticado
  // ============================================================
  app.get('/', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader) {
        return reply.status(401).send({ error: 'Token no provisto' })
      }

      const token = authHeader.replace('Bearer ', '')

      // ✅ Verificamos el usuario autenticado
      const {
        data: { user },
        error: authError,
      } = await supabaseClient.auth.getUser(token)

      if (authError || !user) {
        return reply.status(401).send({ error: 'Token inválido o expirado' })
      }

      // ✅ Consultamos el perfil desde la tabla "profiles"
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, name, age, phone, has_completed_onboarding, created_at')
        .eq('id', user.id)
        .single()

      if (error || !profile) {
        return reply.status(404).send({ error: 'Perfil no encontrado' })
      }

      return reply.status(200).send(profile)
    } catch (err) {
      console.error('❌ Error al obtener el perfil:', err)
      return reply.status(500).send({ error: 'Error interno del servidor.' })
    }
  })

  // ============================================================
  // 🧩 Actualizar campos del perfil (nombre, edad, teléfono, etc.)
  // ============================================================
  app.patch('/', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader) {
        return reply.status(401).send({ error: 'Token no provisto' })
      }

      const token = authHeader.replace('Bearer ', '')

      const {
        data: { user },
        error: authError,
      } = await supabaseClient.auth.getUser(token)

      if (authError || !user) {
        return reply.status(401).send({ error: 'Token inválido o expirado' })
      }

      const { name, age, phone } = request.body as {
        name?: string
        age?: number
        phone?: string
      }

      // 🧠 Validación ligera
      if (!name && !age && !phone) {
        return reply.status(400).send({ error: 'No se enviaron campos para actualizar.' })
      }

      const updates: Record<string, any> = {
        ...(name && { name }),
        ...(age && { age }),
        ...(phone && { phone }),
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select('id, email, name, age, phone, has_completed_onboarding, created_at')
        .single()

      if (error) throw error

      return reply.status(200).send(data)
    } catch (err) {
      console.error('❌ Error al actualizar perfil:', err)
      return reply.status(500).send({ error: 'Error al actualizar el perfil.' })
    }
  })

  // ============================================================
  // ✅ Marcar el onboarding como completado
  // ============================================================
  app.patch('/onboarding', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader) {
        return reply.status(401).send({ error: 'Token no provisto' })
      }

      const token = authHeader.replace('Bearer ', '')

      const {
        data: { user },
        error: authError,
      } = await supabaseClient.auth.getUser(token)

      if (authError || !user) {
        return reply.status(401).send({ error: 'Token inválido o expirado' })
      }

      // 🔄 Actualizamos el campo en la base de datos
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ has_completed_onboarding: true })
        .eq('id', user.id)
        .select('id, email, name, age, phone, has_completed_onboarding, created_at')
        .single()

      if (error) throw error

      return reply.status(200).send(data)
    } catch (err) {
      console.error('❌ Error al actualizar onboarding:', err)
      return reply.status(500).send({ error: 'Error al actualizar perfil.' })
    }
  })
}
