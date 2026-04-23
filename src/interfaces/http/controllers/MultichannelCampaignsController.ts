import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { verifyUserAndSubscription } from "@/infrastructure/auth/verifySubscription"
import { SupabaseMultichannelCampaignsRepository } from "@/infrastructure/repositories/SupabaseMultichannelCampaignsRepository"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import { CampaignMetricsHistoryRepository } from "@/infrastructure/repositories/CampaignMetricsHistoryRepository"
import { OptimizationRepository } from "@/infrastructure/repositories/OptimizationRepository"
import { OptimizationConfigRepository } from "@/infrastructure/repositories/OptimizationConfigRepository"
import { BenchmarksRepository } from "@/infrastructure/repositories/BenchmarksRepository"
import { ClaudeClient } from "@/infrastructure/integrations/llm/ClaudeClient"
import { CreateMultichannelCampaign } from "@/application/usecases/campaigns/CreateMultichannelCampaign"
import { UpdateMultichannelCampaignStatus } from "@/application/usecases/campaigns/UpdateMultichannelCampaignStatus"
import { GetMultichannelCampaignMetrics } from "@/application/usecases/campaigns/GetMultichannelCampaignMetrics"
import { BuildOptimizationInput } from "@/application/usecases/optimization/BuildOptimizationInput"
import { AnalyzeCampaignOptimization } from "@/application/usecases/optimization/AnalyzeCampaignOptimization"
import { ApplyOptimizationRecommendation } from "@/application/usecases/optimization/ApplyOptimizationRecommendation"
import { ListOptimizationRuns } from "@/application/usecases/optimization/ListOptimizationRuns"
import { GetLatestRecommendations } from "@/application/usecases/optimization/GetLatestRecommendations"

export async function MultichannelCampaignsController(app: FastifyInstance) {
  const mcRepo = new SupabaseMultichannelCampaignsRepository()
  const campaignsRepo = new SupabaseCampaignsRepository()
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const metricsHistoryRepo = new CampaignMetricsHistoryRepository()

  const createMultichannelCampaign = new CreateMultichannelCampaign()
  const updateStatus = new UpdateMultichannelCampaignStatus()
  const getMetrics = new GetMultichannelCampaignMetrics()

  // Optimization dependencies (same DI pattern as CampaignsController)
  const optimizationRepo = new OptimizationRepository()
  const optimizationConfigRepo = new OptimizationConfigRepository()
  const benchmarksRepo = new BenchmarksRepository()
  const claudeClient = new ClaudeClient()
  const buildOptimizationInput = new BuildOptimizationInput({ metricsHistoryRepo, benchmarksRepo, adAccountsRepo })
  const analyzeCampaignOptimization = new AnalyzeCampaignOptimization(
    campaignsRepo,
    optimizationRepo,
    optimizationConfigRepo,
    buildOptimizationInput,
    claudeClient
  )
  const applyOptimizationRecommendation = new ApplyOptimizationRecommendation(
    campaignsRepo,
    adAccountsRepo,
    optimizationRepo,
    optimizationConfigRepo
  )
  const listOptimizationRuns = new ListOptimizationRuns(campaignsRepo, optimizationRepo)
  const getLatestRecommendations = new GetLatestRecommendations(campaignsRepo, optimizationRepo)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Returns the campaigns row linked to a multichannel parent, or null. */
  async function getLinkedCampaign(mcId: string) {
    return mcRepo.findCampaignByMultichannelId(mcId)
  }

  // ── Phase 1: Create / List / Get ─────────────────────────────────────────────

  // POST /multichannel-campaigns — create a new multichannel campaign
  app.post("/", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const body = req.body as {
        clientId?: string
        name?: string
        objective?: string
        totalBudgetUsd?: number
        startDate?: string
        endDate?: string
        platforms?: Array<{ platform: string; budget: { type: string; amount: number } }>
        billingEvent?: string
        bidStrategy?: string
        specialAdCategories?: string[]
        targeting?: { geoCountries?: string[]; ageMin?: number; ageMax?: number; genders?: string[] }
        creative?: {
          pageId?: string; mediaUrl?: string; mediaType?: string; mediaFilename?: string
          headline: string; primaryText: string; description?: string; cta?: string; link: string
        }
        productPrice?: number
        productCost?: number
      }

      if (!body.clientId) return reply.code(400).send({ error: "clientId is required" })
      if (!body.name || typeof body.name !== "string") return reply.code(400).send({ error: "name is required" })
      if (!body.platforms || body.platforms.length === 0) {
        return reply.code(400).send({ error: "at least one platform is required" })
      }

      const result = await createMultichannelCampaign.execute({
        userId: user.id,
        clientId: body.clientId,
        name: body.name,
        objective: body.objective,
        totalBudgetUsd: body.totalBudgetUsd,
        startDate: body.startDate,
        endDate: body.endDate,
        platforms: body.platforms as any,
        billingEvent: body.billingEvent,
        bidStrategy: body.bidStrategy,
        specialAdCategories: body.specialAdCategories,
        targeting: body.targeting,
        creative: body.creative as any,
        productPrice: body.productPrice,
        productCost: body.productCost,
      })

      const statusCode = Object.keys(result.errors).length > 0 ? 207 : 201
      return reply.code(statusCode).send(result)
    } catch (err: unknown) {
      req.log.error(err)
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.code(404).send({ error: err.message })
      }
      return reply.code(500).send({ error: "Error al crear campaña multicanal" })
    }
  })

  // GET /multichannel-campaigns?clientId=... — list campaigns for a client
  app.get("/", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { clientId } = req.query as { clientId?: string }
      if (!clientId) return reply.code(400).send({ error: "clientId query param is required" })

      const campaigns = await mcRepo.listByUserAndClient(user.id, clientId)
      return reply.send(campaigns)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al listar campañas multicanal" })
    }
  })

  // GET /multichannel-campaigns/:id — detail + linked campaign
  app.get("/:id", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const parent = await mcRepo.findById(user.id, id)
      if (!parent) return reply.code(404).send({ error: "Campaña multicanal no encontrada" })

      const linkedCampaign = await getLinkedCampaign(id)
      return reply.send({ ...parent, campaign: linkedCampaign })
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al obtener campaña multicanal" })
    }
  })

  // ── Phase 2: Pause / Resume ──────────────────────────────────────────────────

  // PATCH /multichannel-campaigns/:id/status — pause/resume all platforms
  app.patch("/:id/status", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const { action } = req.body as { action?: string }

      if (action !== "pause" && action !== "resume") {
        return reply.code(400).send({ error: "action must be 'pause' or 'resume'" })
      }

      const result = await updateStatus.execute(user.id, id, action)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.code(404).send({ error: err.message })
      }
      return reply.code(500).send({ error: "Error al actualizar estado de campaña" })
    }
  })

  // PATCH /multichannel-campaigns/:id/platforms/:platform/status — per-platform
  app.patch("/:id/platforms/:platform/status", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const { id, platform } = req.params as { id: string; platform: string }
      const { action } = req.body as { action?: string }

      if (action !== "pause" && action !== "resume") {
        return reply.code(400).send({ error: "action must be 'pause' or 'resume'" })
      }

      const result = await updateStatus.execute(user.id, id, action, platform)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.code(404).send({ error: err.message })
      }
      return reply.code(500).send({ error: "Error al actualizar estado de plataforma" })
    }
  })

  // ── Phase 3: Consolidated metrics ───────────────────────────────────────────

  // GET /multichannel-campaigns/:id/metrics?since=&until=
  app.get("/:id/metrics", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const query = req.query as { since?: string; until?: string }
      const until = query.until ?? new Date().toISOString().slice(0, 10)
      const since = query.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      const result = await getMetrics.execute(user.id, id, since, until)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.code(404).send({ error: err.message })
      }
      return reply.code(500).send({ error: "Error al obtener métricas consolidadas" })
    }
  })

  // ── Phase 4: Optimization ────────────────────────────────────────────────────

  // GET /multichannel-campaigns/:id/optimize/runs
  app.get("/:id/optimize/runs", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const parent = await mcRepo.findById(user.id, id)
      if (!parent) return reply.code(404).send({ error: "Campaña multicanal no encontrada" })

      const linked = await getLinkedCampaign(id)
      if (!linked) return reply.send([])

      const runs = await listOptimizationRuns.execute(user.id, linked.id)
      return reply.send(runs)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al obtener runs de optimización" })
    }
  })

  // GET /multichannel-campaigns/:id/optimize/recommendations/latest
  app.get("/:id/optimize/recommendations/latest", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const parent = await mcRepo.findById(user.id, id)
      if (!parent) return reply.code(404).send({ error: "Campaña multicanal no encontrada" })

      const linked = await getLinkedCampaign(id)
      if (!linked) return reply.send({ recommendations: [] })

      const result = await getLatestRecommendations.execute(user.id, linked.id)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al obtener recomendaciones" })
    }
  })

  // POST /multichannel-campaigns/:id/optimize/analyze
  app.post("/:id/optimize/analyze", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const parent = await mcRepo.findById(user.id, id)
      if (!parent) return reply.code(404).send({ error: "Campaña multicanal no encontrada" })

      const linked = await getLinkedCampaign(id)
      if (!linked) return reply.code(422).send({ error: "No hay campaña vinculada para analizar" })

      const result = await analyzeCampaignOptimization.execute(user.id, linked.id)
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al analizar campaña" })
    }
  })

  // POST /multichannel-campaigns/:id/optimize/apply
  app.post("/:id/optimize/apply", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const { id } = req.params as { id: string }
      const parent = await mcRepo.findById(user.id, id)
      if (!parent) return reply.code(404).send({ error: "Campaña multicanal no encontrada" })

      const { recommendationId, decision, campaignId: bodyClientId } = req.body as {
        recommendationId?: string
        decision?: "accept" | "reject"
        campaignId?: string
      }
      if (!recommendationId) return reply.code(400).send({ error: "recommendationId is required" })
      if (decision !== "accept" && decision !== "reject") {
        return reply.code(400).send({ error: "decision must be 'accept' or 'reject'" })
      }

      const linked = await getLinkedCampaign(id)
      if (!linked) return reply.code(422).send({ error: "No hay campaña vinculada" })

      const result = await applyOptimizationRecommendation.execute({
        userId: user.id,
        campaignId: linked.id,
        recommendationId,
        decision,
      })
      return reply.send(result)
    } catch (err: unknown) {
      req.log.error(err)
      return reply.code(500).send({ error: "Error al aplicar recomendación" })
    }
  })
}
