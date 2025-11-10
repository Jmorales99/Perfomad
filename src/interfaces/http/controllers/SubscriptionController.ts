// src/interfaces/http/controllers/SubscriptionController.ts
import type { FastifyInstance } from 'fastify'
import { supabaseClient, supabaseAdmin } from '@/infrastructure/db/supabaseClient'

export async function SubscriptionController(app: FastifyInstance) {
  // 🟦 Obtener estado de la suscripción
  app.get('/', async (request, reply) => {
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

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('has_active_subscription')
        .eq('id', user.id)
        .single()

      if (error || !profile) {
        return reply.status(404).send({ error: 'Perfil no encontrado' })
      }

      return reply.send({
        has_active_subscription: profile.has_active_subscription === true,
      })
    } catch (err) {
      console.error('❌ Error al obtener suscripción:', err)
      return reply.status(500).send({ error: 'Error interno del servidor.' })
    }
  })

  // 🟦 Activar suscripción dummy (solo para pruebas)
  app.post('/activate-dummy', async (request, reply) => {
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

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ has_active_subscription: true })
        .eq('id', user.id)

      if (error) {
        console.error('❌ Error al activar suscripción:', error)
        return reply.status(500).send({ error: 'No se pudo activar la suscripción.' })
      }

      return reply.send({ message: 'Suscripción activada (dummy) ✅' })
    } catch (err) {
      console.error('❌ Error al activar suscripción:', err)
      return reply.status(500).send({ error: 'Error interno del servidor.' })
    }
  })
}
