import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { supabaseClient } from "../../infrastructure/db/supabaseClient.js";

/**
 * Plugin que valida el JWT de Supabase en los headers Authorization.
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;

      if (!authHeader?.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Token no proporcionado o formato inválido" });
      }

      const token = authHeader.replace("Bearer ", "").trim();

      // Verificar token con Supabase
      const { data, error } = await supabaseClient.auth.getUser(token);

      if (error || !data?.user) {
        return reply.code(401).send({ error: "Token inválido o expirado" });
      }

      // Guardamos el usuario en la request
      request.user = data.user;
    } catch (error) {
      app.log.error(error);
      return reply.code(401).send({ error: "No autorizado" });
    }
  });
};

export default fp(authPlugin);

// Tipado para TypeScript (añadimos `authenticate` y `user`)
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: any;
  }
}
