import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseCampaignsRepository } from "@/infrastructure/repositories/SupabaseCampaignsRepository"
import { SupabaseProductMetricsRepository } from "@/infrastructure/repositories/SupabaseProductMetricsRepository"
import { SupabaseProductAnalysisRepository } from "@/infrastructure/repositories/SupabaseProductAnalysisRepository"
import { GetAllProductMetrics } from "@/application/usecases/products/GetAllProductMetrics"
import { AnalyzeProductPerformance } from "@/application/usecases/products/AnalyzeProductPerformance"

export async function ProductsController(app: FastifyInstance) {
  const campaignsRepo = new SupabaseCampaignsRepository()
  const productMetricsRepo = new SupabaseProductMetricsRepository()
  const productAnalysisRepo = new SupabaseProductAnalysisRepository()
  const getAllProductMetrics = new GetAllProductMetrics(campaignsRepo, productMetricsRepo)
  const analyzeProductPerformance = new AnalyzeProductPerformance(getAllProductMetrics, productAnalysisRepo)

  app.get("/v1/products", { preHandler: [verifyUser] }, async (request, reply) => {
    const userId = (request as any).userId as string
    const { client_id, since, until, platform } = request.query as {
      client_id?: string
      since?: string
      until?: string
      platform?: string
    }

    if (!client_id) {
      return reply.status(400).send({ error: "client_id is required" })
    }

    const result = await getAllProductMetrics.execute(userId, client_id, { since, until, platform })
    return reply.send(result)
  })

  app.post("/v1/products/analyze", { preHandler: [verifyUser] }, async (request, reply) => {
    const userId = (request as any).userId as string
    const { client_id } = request.query as { client_id?: string }

    if (!client_id) {
      return reply.status(400).send({ error: "client_id is required" })
    }

    const result = await analyzeProductPerformance.execute(userId, client_id)
    return reply.send(result)
  })

  app.get("/v1/products/analysis", { preHandler: [verifyUser] }, async (request, reply) => {
    const userId = (request as any).userId as string
    const { client_id } = request.query as { client_id?: string }

    if (!client_id) {
      return reply.status(400).send({ error: "client_id is required" })
    }

    const result = await productAnalysisRepo.getLatestRun(userId, client_id)
    return reply.send(result ?? { run: null, recommendations: [] })
  })
}
