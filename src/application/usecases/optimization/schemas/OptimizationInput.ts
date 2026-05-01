import { z } from "zod"

/**
 * OptimizationInput v1
 *
 * Payload estable enviado al LLM para analizar una campania.
 * NO debe contener credenciales, IDs de plataforma crudos innecesarios,
 * ni informacion personal del usuario.
 */

export const OPTIMIZATION_INPUT_VERSION = "v1" as const

export const platformEnum = z.enum(["meta", "google_ads", "linkedin", "tiktok"])

export const campaignContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: platformEnum,
  objective: z.string().nullable().optional(),
  is_catalog: z.boolean().optional(),
  country: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "completed", "removed", "unknown"]),
  start_date: z.string().nullable().optional(),
  days_active: z.number().int().nonnegative().nullable().optional(),
})

export const budgetContextSchema = z.object({
  local_daily: z.number().nonnegative().nullable().optional(),
  local_lifetime: z.number().nonnegative().nullable().optional(),
  platform_daily: z.number().nonnegative().nullable().optional(),
  platform_lifetime: z.number().nonnegative().nullable().optional(),
  source_of_truth: z.enum(["local", "platform"]).default("platform"),
  drift_pct: z.number().nullable().optional(),
  spend_total: z.number().nonnegative().default(0),
  spend_period: z.number().nonnegative().default(0),
  currency: z.string().trim().length(3),
})

export const metricsPeriodSchema = z.object({
  since: z.string(),
  until: z.string(),
  days: z.number().int().positive(),
})

export const metricsBlockSchema = z.object({
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  spend: z.number().nonnegative().default(0),
  reach: z.number().nonnegative().default(0),
  ctr: z.number().nonnegative().default(0),
  cpc: z.number().nonnegative().default(0),
  cpm: z.number().nonnegative().default(0),
  conversions: z.number().nonnegative().default(0),
  revenue: z.number().nonnegative().default(0),
  cpa: z.number().nullable().optional(),
  roa: z.number().nullable().optional(),
  conversion_rate: z.number().nullable().optional(),
  frequency: z.number().nullable().optional(),
})

export const benchmarkEntrySchema = z.object({
  p25: z.number().nullable().optional(),
  p50: z.number().nullable().optional(),
  p75: z.number().nullable().optional(),
  p90: z.number().nullable().optional(),
  sample_size: z.number().int().nonnegative().default(0),
  source: z.enum(["internal", "external", "general_fallback"]).default("internal"),
})

export const benchmarksSchema = z
  .object({
    segment: z
      .object({
        platform: platformEnum,
        objective: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        spend_tier: z.enum(["xs", "s", "m", "l", "xl"]).nullable().optional(),
      })
      .optional(),
    metrics: z.record(z.string(), benchmarkEntrySchema).optional(),
    version: z.number().int().nullable().optional(),
  })
  .optional()

export const historyPointSchema = z.object({
  date: z.string(),
  spend: z.number().nonnegative().default(0),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  conversions: z.number().nonnegative().default(0),
  revenue: z.number().nonnegative().default(0),
})

export const activeAdSummarySchema = z.object({
  ad_id: z.string(),
  name: z.string(),
  spend: z.number().nonnegative().default(0),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  ctr: z.number().nonnegative().default(0),
  cpc: z.number().nonnegative().default(0),
  conversions: z.number().nonnegative().default(0),
  cpa: z.number().nullable().optional(),
  frequency: z.number().nullable().optional(),
  creative_type: z.enum(["image", "video", "carousel", "unknown"]).optional(),
})

export const policySchema = z.object({
  allowed_actions: z.array(
    z.enum([
      "pause_campaign",
      "resume_campaign",
      "adjust_budget",
      "flag_for_review",
      "informational",
      "pause_ad",
      "flag_creative",
    ])
  ),
  max_budget_adjust_pct: z.number().nonnegative(),
  min_days_before_action: z.number().int().nonnegative(),
  min_spend_before_action: z.number().nonnegative(),
  platform_support: z.enum(["automatic", "manual_required", "unsupported"]),
})

export const activeProductSummarySchema = z.object({
  product_id: z.string(),
  product_name: z.string(),
  spend: z.number().nonnegative().default(0),
  spend_pct: z.number().nonnegative().default(0),
  roas: z.number().nullable().optional(),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  conversions: z.number().nonnegative().default(0),
})

export const pixelEventsSchema = z.object({
  leads: z.number().nonnegative().default(0),
  page_views: z.number().nonnegative().default(0),
  form_starts: z.number().nonnegative().default(0),
  form_completions: z.number().nonnegative().default(0),
  period_days: z.number().int().positive(),
})

export const optimizationInputSchema = z.object({
  version: z.literal(OPTIMIZATION_INPUT_VERSION),
  generated_at: z.string(),
  campaign: campaignContextSchema,
  budget: budgetContextSchema,
  metrics_period: metricsPeriodSchema,
  metrics: metricsBlockSchema,
  benchmarks: benchmarksSchema,
  history: z.array(historyPointSchema).optional(),
  active_ads: z.array(activeAdSummarySchema).optional(),
  active_products: z.array(activeProductSummarySchema).optional(),
  pixel_events: pixelEventsSchema.optional(),
  policy: policySchema,
})

export type OptimizationInput = z.infer<typeof optimizationInputSchema>
export type OptimizationInputPolicy = z.infer<typeof policySchema>
export type OptimizationInputBudget = z.infer<typeof budgetContextSchema>
export type OptimizationInputMetrics = z.infer<typeof metricsBlockSchema>
export type OptimizationInputBenchmarks = z.infer<typeof benchmarksSchema>
export type ActiveAdSummary = z.infer<typeof activeAdSummarySchema>
export type ActiveProductSummary = z.infer<typeof activeProductSummarySchema>
export type PixelEvents = z.infer<typeof pixelEventsSchema>
