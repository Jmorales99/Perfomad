import { z } from "zod"

/**
 * Canonical schema for POST /v1/campaigns payload.
 *
 * Kept as loose as the existing frontend requires (most fields optional) but
 * validates the ones that matter for platform API calls:
 *   - budget is coerced to number (handles "1.234,56" already parsed by frontend
 *     NumberInput to a number, and rejects NaN)
 *   - exactly one of budget_amount / lifetime_budget
 *   - date coherence
 *   - Meta enums (objective / billing_event)
 */

export const VALID_PLATFORMS = ["meta", "google_ads", "linkedin", "tiktok"] as const

export const META_OBJECTIVES = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_SALES",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_AWARENESS",
  "OUTCOME_APP_PROMOTION",
] as const

export const META_BILLING_EVENTS = [
  "IMPRESSIONS",
  "LINK_CLICKS",
  "POST_ENGAGEMENT",
  "VIDEO_VIEWS",
  "THRUPLAY",
] as const

export const META_BID_STRATEGIES = [
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
  "BID_CAP",
] as const

export const SPECIAL_AD_CATEGORIES = [
  "HOUSING",
  "EMPLOYMENT",
  "CREDIT",
  "ISSUES_ELECTIONS_POLITICS",
] as const

export const CALL_TO_ACTIONS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "DOWNLOAD",
  "BOOK_NOW",
  "CONTACT_US",
  "APPLY_NOW",
  "GET_OFFER",
  "SUBSCRIBE",
] as const

const targetingSchema = z
  .object({
    geo_countries: z.array(z.string().length(2)).min(1),
    age_min: z.number().int().min(13).max(65),
    age_max: z.number().int().min(13).max(65),
    genders: z.array(z.enum(["male", "female", "all"])).optional(),
  })
  .refine((t) => t.age_min <= t.age_max, {
    message: "age_min must be <= age_max",
    path: ["age_max"],
  })

const creativeSchema = z.object({
  // New wizard fields (Fase B)
  page_id: z.string().optional(),
  media_url: z.string().optional(),
  media_type: z.enum(["image", "video"]).optional(),
  media_filename: z.string().optional(),
  // Legacy field kept for backward compat
  media_ids: z.array(z.string()).min(1).max(10).optional(),
  headline: z.string().min(1).max(40),
  primary_text: z.string().min(1).max(125),
  description: z.string().max(30).optional(),
  cta: z.enum(CALL_TO_ACTIONS),
  link: z.string().url(),
})

export const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(200),
    platforms: z.array(z.enum(VALID_PLATFORMS)).min(1),
    client_id: z.string().uuid().optional(),
    description: z.string().max(500).optional(),

    // Budget — null-safe: null is treated as absent (frontend may send null for empty fields)
    budget_amount: z.preprocess(
      (v) => (v == null ? undefined : Number(v)),
      z.number().positive()
    ).optional(),
    lifetime_budget: z.preprocess(
      (v) => (v == null ? undefined : Number(v)),
      z.number().positive()
    ).optional(),

    // Per-platform budget overrides (take precedence over global budget_amount/lifetime_budget)
    platform_budgets: z.record(
      z.enum(VALID_PLATFORMS),
      z.object({
        budget_type: z.enum(["daily", "lifetime"]),
        amount: z.number().positive(),
      })
    ).optional(),

    // Campaign settings
    objective: z.enum(META_OBJECTIVES).optional(),
    billing_event: z.enum(META_BILLING_EVENTS).optional(),
    bid_strategy: z.enum(META_BID_STRATEGIES).optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    special_ad_categories: z.array(z.enum(SPECIAL_AD_CATEGORIES)).optional(),

    // Dates
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().nullable().optional(),

    // Product pricing
    product_price: z.coerce.number().positive().optional(),
    product_cost: z.coerce.number().positive().optional(),

    // Platform-specific
    meta_settings: z
      .object({
        page_id: z.string().optional(),
        promoted_object: z.any().optional(),
      })
      .passthrough()
      .optional(),

    // Targeting (Meta / LinkedIn only)
    targeting: targetingSchema.optional(),

    // Creative (sent when user configured ad-level content in the wizard)
    creative: creativeSchema.optional(),

    // Legacy image paths (Supabase Storage) — kept for backward compat with
    // the old inline modal flow. The new wizard uses `creative.media_ids`.
    images: z
      .array(z.object({ path: z.string() }))
      .optional(),
  })
  .refine(
    (d) => {
      const hasPlatformBudgets =
        d.platform_budgets && Object.keys(d.platform_budgets).length > 0
      if (hasPlatformBudgets) return true
      return (d.budget_amount != null) !== (d.lifetime_budget != null)
    },
    {
      message:
        "Debes indicar exactamente un presupuesto: diario (budget_amount) o total (lifetime_budget), o configurar presupuestos por plataforma (platform_budgets)",
      path: ["budget_amount"],
    }
  )
  .refine(
    (d) =>
      !d.end_date ||
      !d.start_date ||
      new Date(d.end_date) > new Date(d.start_date),
    { message: "end_date must be after start_date", path: ["end_date"] }
  )

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
