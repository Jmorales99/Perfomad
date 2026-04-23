import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { verifyUserAndSubscription } from "@/infrastructure/auth/verifySubscription"
import { SupabaseClientsRepository } from "@/infrastructure/repositories/SupabaseClientsRepository"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { AuditLogger } from "@/infrastructure/security/AuditLogger"
import { ListClientsWithDefault } from "@/application/usecases/clients/ListClientsWithDefault"
import { CreateClient } from "@/application/usecases/clients/CreateClient"
import { GetClientById } from "@/application/usecases/clients/GetClientById"
import { DeleteClient, ClientNotFoundError, LastClientDeletionForbiddenError } from "@/application/usecases/clients/DeleteClient"
import { SyncConnectedAccounts } from "@/application/usecases/adaccounts/SyncConnectedAccounts"
import { SyncCampaignMetrics } from "@/application/usecases/campaigns/SyncCampaignMetrics"
import { SyncClientData } from "@/application/usecases/sync/SyncClientData"

export async function ClientsController(app: FastifyInstance) {
  const clientsRepo = new SupabaseClientsRepository()
  const listClientsWithDefault = new ListClientsWithDefault(clientsRepo)
  const createClient = new CreateClient(clientsRepo)
  const getClientById = new GetClientById(clientsRepo)
  const deleteClient = new DeleteClient(clientsRepo)

  // Sync orchestrator dependencies
  const campaignsRepo = new SupabaseCampaignsRepository()
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const metricsHistoryRepo = new CampaignMetricsHistoryRepository()
  const syncConnectedAccounts = new SyncConnectedAccounts(adAccountsRepo, new TokenManager(), new AuditLogger())
  const syncCampaignMetrics = new SyncCampaignMetrics(campaignsRepo, metricsHistoryRepo)
  const syncClientData = new SyncClientData(
    campaignsRepo,
    adAccountsRepo,
    metricsHistoryRepo,
    syncConnectedAccounts,
    syncCampaignMetrics
  )

  // GET /clients — list user's clients; auto-creates "Default" if none exist
  app.get("/", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const clients = await listClientsWithDefault.execute(user.id)
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

  // POST /clients/:id/sync — full sync for a client (accounts + all campaigns)
  app.post("/:id/sync", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      const client = await getClientById.execute(user.id, id)
      if (!client) {
        return reply.code(404).send({ error: "Empresa no encontrada" })
      }
      const result = await syncClientData.execute(user.id, id)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al sincronizar datos" })
    }
  })

  // DELETE /clients/:id — delete a client; last brand cannot be deleted
  app.delete("/:id", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return
      const { id } = req.params as { id: string }
      await deleteClient.execute(user.id, id)
      return reply.code(204).send()
    } catch (err: unknown) {
      if (err instanceof ClientNotFoundError) {
        return reply.code(404).send({ error: "Empresa no encontrada" })
      }
      if (err instanceof LastClientDeletionForbiddenError) {
        return reply.code(409).send({
          error: "No puedes eliminar la última marca",
          code: "last_brand_forbidden",
        })
      }
      req.log.error(err)
      return reply.code(500).send({ error: "Error al eliminar empresa" })
    }
  })
}
