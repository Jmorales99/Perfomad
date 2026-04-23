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

export const recommendationSchema = z.object({
  id: z.string().min(1),
  action_type: recommendationActionEnum,
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  title: z.string().min(1),
  rationale: z.string().default(""),
  expected_impact: z.string().default(""),
  params: z
    .object({
      delta_pct: z.number().optional(),
      new_budget: z.number().nonnegative().optional(),
      target_status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
      note: z.string().optional(),
      ad_id: z.string().optional(),
      ad_name: z.string().optional(),
    })
    .partial()
    .default({}),
  requires_confirmation: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.5),
})

export const healthScoreCriteriaSchema = z.object({
  ctr_performance: z.number().int().min(0).max(25),
  cpa_efficiency: z.number().int().min(0).max(25),
  budget_utilization: z.number().int().min(0).max(25),
  creative_freshness: z.number().int().min(0).max(25),
})

export const alertSchema = z.object({
  urgency: z.enum(["immediate", "today", "this_week"]),
  type: z.string().min(1),
  message: z.string().min(1),
})

export const optimizationOutputSchema = z.object({
  version: z.enum(["v1", "v2"]),
  summary: z.object({
    overall_health: z.enum(["good", "warning", "critical"]).default("warning"),
    headline: z.string().default(""),
    health_score: z.number().int().min(0).max(100).optional(),
    health_score_criteria: healthScoreCriteriaSchema.optional(),
    health_trend: z
      .object({
        direction: z.enum(["improving", "stable", "declining"]),
        delta_pts: z.number().nullable().optional(),
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
    .default({}),
})

export type OptimizationOutput = z.infer<typeof optimizationOutputSchema>
export type Recommendation = z.infer<typeof recommendationSchema>
export type RecommendationAction = z.infer<typeof recommendationActionEnum>
export type Alert = z.infer<typeof alertSchema>
export type HealthScoreCriteria = z.infer<typeof healthScoreCriteriaSchema>

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
