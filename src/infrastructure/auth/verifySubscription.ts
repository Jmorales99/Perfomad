import type { FastifyReply, FastifyRequest } from "fastify"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

/**
 * ✅ Verifica que el usuario tenga una suscripción activa
 * 
 * @param req - FastifyRequest
 * @param reply - FastifyReply
 * @returns true si tiene suscripción activa, false si no
 */
export async function verifySubscription(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string
): Promise<boolean> {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("has_active_subscription, subscription_expires")
      .eq("id", userId)
      .maybeSingle()

    if (error) {
      req.log.error({ error }, "Error verificando suscripción")
      reply.code(500).send({ error: "Error al verificar suscripción" })
      return false
    }

    if (!profile) {
      reply.code(404).send({ error: "Perfil no encontrado" })
      return false
    }

    // Verificar que tenga suscripción activa
    if (!profile.has_active_subscription) {
      reply.code(403).send({
        error: "Suscripción requerida",
        message: "Necesitas una suscripción activa para realizar esta acción",
      })
      return false
    }

    // Verificar que la suscripción no haya expirado
    if (profile.subscription_expires) {
      const expiryDate = new Date(profile.subscription_expires)
      const now = new Date()

      if (expiryDate < now) {
        // Si expiró, actualizar el estado en la base de datos
        await supabaseAdmin
          .from("profiles")
          .update({ has_active_subscription: false })
          .eq("id", userId)

        reply.code(403).send({
          error: "Suscripción expirada",
          message: "Tu suscripción ha expirado. Por favor, renueva tu suscripción",
          expires_at: profile.subscription_expires,
        })
        return false
      }
    }

    return true
  } catch (err) {
    req.log.error({ err }, "Error en verifySubscription")
    reply.code(500).send({ error: "Error al verificar suscripción" })
    return false
  }
}

/**
 * ✅ Middleware combinado: verifica usuario Y suscripción
 * 
 * @param req - FastifyRequest
 * @param reply - FastifyReply
 * @returns usuario autenticado o null si falla la verificación
 */
export async function verifyUserAndSubscription(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<any> {
  // Primero verificar usuario
  const authHeader = req.headers.authorization
  if (!authHeader) {
    reply.code(401).send({ error: "Token no provisto" })
    return null
  }

  const token = authHeader.replace("Bearer ", "")
  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user) {
    reply.code(401).send({ error: "Token inválido o expirado" })
    return null
  }

  // Luego verificar suscripción
  const hasSubscription = await verifySubscription(req, reply, data.user.id)
  if (!hasSubscription) {
    return null
  }

  return data.user
}

