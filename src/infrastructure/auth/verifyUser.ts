import type { FastifyReply, FastifyRequest } from "fastify"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

/**
 * ✅ Middleware de autenticación
 * Verifica el token JWT del usuario usando Supabase Admin (más confiable)
 */
export async function verifyUser(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<any> {
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

  return data.user
}
