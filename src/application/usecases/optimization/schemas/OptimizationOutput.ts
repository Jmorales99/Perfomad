import { z } from "zod"

export const OPTIMIZATION_OUTPUT_VERSION = "v2" as const

export const recommendationActionEnum = z.enum([
  "pause_campaign",
  "resume_campaign",
  "adjust_budget",
  "flag_for_review",
  "informational",
  "pause_ad",
  "flag_creative",
])

function mapHealthStatus(v: string): "good" | "warning" | "critical" {
  const map: Record<string, "good" | "warning" | "critical"> = {
    cuenta_saludable: "good",
    requiere_atencion: "warning",
    problemas_importantes: "warning",
    situacion_critica: "critical",
  }
  return map[v] ?? (v as "good" | "warning" | "critical")
}

function mapTrendDirection(v: string): "improving" | "stable" | "declining" {
  const map: Record<string, "improving" | "stable" | "declining"> = {
    mejorando: "improving",
    empeorando: "declining",
    estable: "stable",
  }
  return map[v] ?? (v as "improving" | "stable" | "declining")
}

// Accepts both v2 fields (title/rationale/expected_impact) and Meta-specific
// fields (titulo/razon_principal/que_revisar/accion_recomendada). The transform
// normalizes to the canonical internal format before the caller uses the data.
export const recommendationSchema = z
  .object({
    id: z.string().min(1),
    diagnostico_id: z.number().int().optional(),
    variante: z.enum(["A", "B", "C", "D"]).nullable().optional(),
    action_type: recommendationActionEnum,
    priority: z.enum(["high", "medium", "low"]).default("medium"),
    // Meta-specific alias fields
    titulo: z.string().optional(),
    razon_principal: z.string().optional(),
    que_revisar: z.string().optional(),
    accion_recomendada: z.string().optional(),
    // v2 canonical fields (kept for backward compat)
    title: z.string().optional(),
    rationale: z.string().optional(),
    expected_impact: z.string().optional(),
    // v5 generic fields
    how_to_implement: z.string().optional(),
    effort: z.enum(["low", "medium", "high"]).optional(),
    params: z
      .object({
        delta_pct: z.number().optional(),
        new_budget: z.number().nonnegative().optional(),
        target_status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
        note: z.string().optional(),
        ad_id: z.string().optional(),
        ad_name: z.string().optional(),
        product_id: z.string().optional(),
        product_name: z.string().optional(),
      })
      .partial()
      .default({}),
    requires_confirmation: z.boolean().default(true),
    confidence: z.number().min(0).max(1).default(0.5),
  })
  .transform((raw) => ({
    id: raw.id,
    action_type: raw.action_type,
    priority: raw.priority,
    title: raw.titulo ?? raw.title ?? "",
    rationale: raw.razon_principal ?? raw.rationale ?? "",
    expected_impact: raw.accion_recomendada ?? raw.expected_impact ?? "",
    params: {
      ...raw.params,
      ...(raw.que_revisar && !raw.params?.note ? { note: raw.que_revisar } : {}),
      ...(raw.diagnostico_id !== undefined ? { diagnostico_id: raw.diagnostico_id } : {}),
      ...(raw.variante ? { variante: raw.variante } : {}),
      ...(raw.how_to_implement ? { how_to_implement: raw.how_to_implement } : {}),
      ...(raw.effort ? { effort: raw.effort } : {}),
    } as Record<string, unknown>,
    requires_confirmation: raw.requires_confirmation,
    confidence: raw.confidence,
  }))

// Dynamic criteria record — filters out "no_aplica" strings, keeps only numbers.
export const healthScoreCriteriaSchema = z
  .record(z.string(), z.unknown())
  .transform(
    (obj) =>
      Object.fromEntries(
        Object.entries(obj).filter(([, v]) => typeof v === "number")
      ) as Record<string, number>
  )

export const alertSchema = z.object({
  urgency: z.enum(["immediate", "today", "this_week"]),
  type: z.string().min(1),
  diagnostico_id: z.number().int().optional(),
  channel: z.enum(["google", "meta", "tiktok"]).optional(),
  message: z.string().min(1),
})

export const optimizationOutputSchema = z.object({
  version: z.string().default("v2"),
  summary: z.object({
    overall_health: z.string().default("warning").transform(mapHealthStatus),
    headline: z.string().default(""),
    health_score: z.number().int().min(0).max(100).optional(),
    health_score_criteria: healthScoreCriteriaSchema.optional(),
    health_trend: z
      .object({
        direction: z.string().transform(mapTrendDirection),
        delta_pts: z.number().nullable().optional(),
        score_anterior: z.number().nullable().optional(),
        score_actual: z.number().optional(),
      })
      .optional(),
    cpc_reference: z
      .object({
        type: z.string(),
        value: z.number().nullable().optional(),
        nota: z.string().optional(),
      })
      .optional(),
    cpl_reference: z
      .object({
        type: z.string(),
        value: z.number().nullable().optional(),
        nota: z.string().optional(),
      })
      .optional(),
    product_analysis: z
      .object({
        total_products_active: z.number().int().optional(),
        products_draining_budget: z
          .array(
            z.object({
              product_id: z.string(),
              product_name: z.string(),
              spend_pct: z.number(),
              roas: z.number(),
              days_active: z.number().int(),
            })
          )
          .optional(),
      })
      .optional(),
    // v5 generic: cross-channel budget distribution
    budget_recommendations: z
      .object({
        current_distribution: z.record(z.string(), z.object({
          percentage: z.number().optional(),
          amount: z.number().optional(),
        })).optional(),
        recommended_distribution: z.record(z.string(), z.object({
          percentage: z.number().optional(),
          amount: z.number().optional(),
        })).optional(),
        rationale: z.string().optional(),
        expected_impact: z.string().optional(),
      })
      .optional(),
  }),
  alerts: z.array(alertSchema).default([]),
  recommendations: z.array(recommendationSchema).default([]),
  next_step: z.string().optional(),
  meta: z
    .object({
      model: z.string().optional(),
      prompt_version: z.string().optional(),
      generated_at: z.string().optional(),
    })
    .passthrough()
    .default({}),
})

export type OptimizationOutput = z.infer<typeof optimizationOutputSchema>
export type Recommendation = z.infer<typeof recommendationSchema>
export type RecommendationAction = z.infer<typeof recommendationActionEnum>
export type Alert = z.infer<typeof alertSchema>
export type HealthScoreCriteria = Record<string, number>

export function buildFallbackOutput(reason: string): OptimizationOutput {
  return {
    version: OPTIMIZATION_OUTPUT_VERSION,
    summary: {
      overall_health: "warning",
      headline: "No se pudo generar un analisis automatico. Revisa manualmente.",
    },
    alerts: [],
    recommendations: [
      {
        id: "fallback_review",
        action_type: "flag_for_review",
        priority: "medium",
        title: "Revisar campania manualmente",
        rationale: `invalid_llm_response: ${reason}`.slice(0, 500),
        expected_impact: "Pendiente de analisis humano.",
        params: {},
        requires_confirmation: true,
        confidence: 0,
      },
    ],
    next_step: "Revisa los datos de la campania manualmente.",
    meta: {
      generated_at: new Date().toISOString(),
    },
  }
}
