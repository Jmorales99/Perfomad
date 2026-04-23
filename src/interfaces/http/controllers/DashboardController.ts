import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { SupabaseClientsRepository } from "@/infrastructure/repositories/SupabaseClientsRepository"
import { DashboardSnapshotsRepository } from "@/infrastructure/repositories/DashboardSnapshotsRepository"
import { TokenManager } from "@/infrastructure/integrations/TokenManager"
import { GetConsolidatedDashboard } from "@/application/usecases/dashboard/GetConsolidatedDashboard"
import { SyncDashboardData } from "@/application/usecases/dashboard/SyncDashboardData"

export async function DashboardController(app: FastifyInstance) {
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const clientsRepo = new SupabaseClientsRepository()
  const snapshotsRepo = new DashboardSnapshotsRepository()
  const tokenManager = new TokenManager()

  const getConsolidatedDashboard = new GetConsolidatedDashboard(snapshotsRepo)
  const syncDashboardData = new SyncDashboardData(
    adAccountsRepo,
    snapshotsRepo,
    tokenManager,
    clientsRepo
  )

  /**
   * GET /v1/dashboard/consolidated
   * Reads cached platform data from dashboard_snapshots.
   * Fast — no calls to external APIs.
   *
   * Query params:
   *   client_id (required) – the brand/client to show data for
   *   platform  (optional) – filter to a single platform
   */
  app.get("/dashboard/consolidated", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { client_id, platform } = req.query as {
        client_id?: string
        platform?: string
      }

      if (!client_id) {
        return reply.code(400).send({ error: "client_id is required" })
      }

      const result = await getConsolidatedDashboard.execute(user.id, client_id, platform)
      return reply.send(result)
    } catch (err: any) {
      req.log.error({ err }, "Error getting consolidated dashboard")
      return reply.code(500).send({ error: err.message ?? "Error al obtener dashboard consolidado" })
    }
  })

  /**
   * POST /v1/dashboard/sync
   * Calls platform APIs, updates dashboard_snapshots, returns fresh data.
   * Slower (3-10s) — called only when the user presses "Actualizar".
   *
   * Body: { client_id: string, since?: string (YYYY-MM-DD), until?: string }
   */
  app.post("/dashboard/sync", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const body = req.body as {
        client_id?: string
        since?: string
        until?: string
      }

      if (!body.client_id) {
        return reply.code(400).send({ error: "client_id is required" })
      }

      const dateRange =
        body.since && body.until
          ? { since: body.since, until: body.until }
          : undefined

      const result = await syncDashboardData.execute(user.id, body.client_id, dateRange)
      return reply.send(result)
    } catch (err: any) {
      req.log.error({ err }, "Error syncing dashboard data")
      return reply.code(500).send({ error: err.message ?? "Error al sincronizar datos del dashboard" })
    }
  })
}
