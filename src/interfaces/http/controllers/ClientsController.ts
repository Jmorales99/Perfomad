import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseClientsRepository } from "@/infrastructure/repositories/SupabaseClientsRepository"
import { ListClients } from "@/application/usecases/clients/ListClients"
import { CreateClient } from "@/application/usecases/clients/CreateClient"
import { GetClientById } from "@/application/usecases/clients/GetClientById"

export async function ClientsController(app: FastifyInstance) {
  const clientsRepo = new SupabaseClientsRepository()
  const listClients = new ListClients(clientsRepo)
  const createClient = new CreateClient(clientsRepo)
  const getClientById = new GetClientById(clientsRepo)

  // GET /clients — list user's internal clients (empresas internas)
  app.get("/", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const clients = await listClients.execute(user.id)
      return reply.send(clients)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al listar empresas" })
    }
  })

  // POST /clients — create internal client
  app.post("/", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const body = req.body as { name?: string; description?: string }
      if (!body.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "name is required" })
      }
      const client = await createClient.execute(user.id, body.name, body.description ?? null)
      return reply.code(201).send(client)
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("name")) {
        return reply.code(400).send({ error: err.message })
      }
      req.log.error(err)
      return reply.code(500).send({ error: "Error al crear empresa" })
    }
  })

  // GET /clients/:id — get one client (must belong to user)
  app.get("/:id", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const client = await getClientById.execute(user.id, id)
      if (!client) {
        return reply.code(404).send({ error: "Empresa no encontrada" })
      }
      return reply.send(client)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al obtener empresa" })
    }
  })
}
