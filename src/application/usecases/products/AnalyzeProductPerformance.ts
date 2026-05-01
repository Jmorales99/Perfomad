import crypto from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { env } from "@/config/env"
import { GetAllProductMetrics } from "./GetAllProductMetrics"
import type { SupabaseProductAnalysisRepository } from "@/infrastructure/repositories/SupabaseProductAnalysisRepository"
import type { ProductAnalysisResult, ProductRecommendation } from "@/infrastructure/repositories/SupabaseProductAnalysisRepository"

const MODEL = "claude-sonnet-4-6"
const MAX_TOKENS = 2048
const CACHE_TTL_HOURS = 24

const productRecommendationSchema = z.object({
  product_id: z.string(),
  product_title: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  action_type: z.enum(["pause_product", "scale_product", "optimize_creative", "investigate"]),
  title: z.string().max(200),
  description: z.string().max(500),
  rationale: z.string().max(500).nullable().optional(),
  impact: z.string().max(300).nullable().optional(),
})

const outputSchema = z.object({
  summary: z.string().max(300),
  recommendations: z.array(productRecommendationSchema).max(10),
})

type AnalysisOutput = z.infer<typeof outputSchema>

export interface ProductAnalyzeResult {
  run_id: string
  cached: boolean
  status: "succeeded" | "failed" | "insufficient_data"
  summary: string | null
  recommendations: ProductRecommendation[]
  error_message?: string
}

export class AnalyzeProductPerformance {
  constructor(
    private readonly getAllProductMetrics: GetAllProductMetrics,
    private readonly analysisRepo: SupabaseProductAnalysisRepository
  ) {}

  async execute(userId: string, clientId: string): Promise<ProductAnalyzeResult> {
    if (!env.ANTHROPIC_API_KEY) {
      return {
        run_id: "",
        cached: false,
        status: "failed",
        summary: null,
        recommendations: [],
        error_message: "Optimización IA no configurada. Falta ANTHROPIC_API_KEY en el backend.",
      }
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const until = new Date().toISOString().slice(0, 10)
    const { products } = await this.getAllProductMetrics.execute(userId, clientId, { since, until })

    if (products.length === 0) {
      return {
        run_id: "",
        cached: false,
        status: "insufficient_data",
        summary: null,
        recommendations: [],
      }
    }

    const inputHash = hashProducts(products, since)

    const cached = await this.analysisRepo.findRunByHash(userId, clientId, inputHash, CACHE_TTL_HOURS)
    if (cached) {
      const latest = await this.analysisRepo.getLatestRun(userId, clientId)
      return {
        run_id: cached.id,
        cached: true,
        status: "succeeded",
        summary: cached.summary,
        recommendations: latest?.recommendations ?? [],
      }
    }

    const productTable = products
      .slice(0, 50)
      .map((p) =>
        `- ID: ${p.product_id} | Título: ${p.product_title ?? "Sin título"} | Gasto: $${p.spend.toFixed(2)} | ROAS: ${p.roas.toFixed(2)}x | CTR: ${(p.ctr * 100).toFixed(2)}% | Conv: ${p.conversions.toFixed(1)} | Rev: $${p.revenue.toFixed(2)}`
      )
      .join("\n")

    const userMessage = JSON.stringify({
      task: "Analiza el rendimiento de estos productos de publicidad digital y genera recomendaciones accionables.",
      period: `${since} a ${until}`,
      products: productTable,
      instructions: "Responde únicamente con JSON válido siguiendo el esquema: { summary: string, recommendations: Array<{ product_id, product_title, priority, action_type, title, description, rationale, impact }> }. priority: high|medium|low. action_type: pause_product|scale_product|optimize_creative|investigate. Máximo 10 recomendaciones.",
    })

    let parsedOutput: AnalysisOutput | null = null
    let rawText = ""

    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: "Eres un experto en publicidad digital. Analiza datos de rendimiento de productos y genera recomendaciones concretas y accionables en JSON válido únicamente.",
          messages: [{ role: "user", content: userMessage }],
        },
        { timeout: 50_000 }
      )
      rawText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim()

      let json: unknown = null
      try {
        json = JSON.parse(rawText)
      } catch {
        const first = rawText.indexOf("{")
        const last = rawText.lastIndexOf("}")
        if (first !== -1 && last > first) {
          try { json = JSON.parse(rawText.slice(first, last + 1)) } catch { /* ignore */ }
        }
      }

      const parsed = outputSchema.safeParse(json)
      if (parsed.success) parsedOutput = parsed.data
    } catch {
      const run = await this.analysisRepo.saveRun({
        user_id: userId,
        client_id: clientId,
        model: MODEL,
        status: "failed",
        summary: null,
        products_count: products.length,
        input_hash: inputHash,
      })
      return {
        run_id: run.id,
        cached: false,
        status: "failed",
        summary: null,
        recommendations: [],
        error_message: "El análisis IA falló. Intenta de nuevo en unos minutos.",
      }
    }

    const status = parsedOutput ? "succeeded" : "failed"
    const run = await this.analysisRepo.saveRun({
      user_id: userId,
      client_id: clientId,
      model: MODEL,
      status,
      summary: parsedOutput?.summary ?? null,
      products_count: products.length,
      input_hash: inputHash,
    })

    const imageMap = new Map(products.map((p) => [p.product_id, p.image_url ?? null]))
    const recs = parsedOutput
      ? await this.analysisRepo.saveRecommendations(
          run.id,
          parsedOutput.recommendations.map((r) => ({
            product_id: r.product_id,
            product_title: r.product_title ?? null,
            image_url: imageMap.get(r.product_id) ?? null,
            priority: r.priority,
            action_type: r.action_type,
            title: r.title,
            description: r.description,
            rationale: r.rationale ?? null,
            impact: r.impact ?? null,
          }))
        )
      : []

    return {
      run_id: run.id,
      cached: false,
      status,
      summary: parsedOutput?.summary ?? null,
      recommendations: recs,
    }
  }
}

function hashProducts(products: Array<{ product_id: string; spend: number; roas: number }>, since: string): string {
  const stable = products.map((p) => ({ id: p.product_id, spend: Math.round(p.spend * 100), roas: Math.round(p.roas * 100) }))
  return crypto.createHash("sha256").update(JSON.stringify({ stable, since })).digest("hex")
}
