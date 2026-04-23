import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export interface OptimizationConfig {
  id: string
  mvp_actions_enabled: boolean
  auto_apply_policy: "off" | "low_risk" | "all"
  budget_drift_threshold_pct: number
  analysis_cache_ttl_hours: number
  max_budget_adjust_pct: number
  min_days_before_action: number
  min_spend_before_action: number
  analyze_rate_limit_per_hour: number
  llm_model: string
  llm_max_tokens: number
  prompt_version: string
  allowed_actions: string[]
}

const DEFAULTS: OptimizationConfig = {
  id: "default",
  mvp_actions_enabled: true,
  auto_apply_policy: "off",
  budget_drift_threshold_pct: 5,
  analysis_cache_ttl_hours: 12,
  max_budget_adjust_pct: 25,
  min_days_before_action: 3,
  min_spend_before_action: 20,
  analyze_rate_limit_per_hour: 10,
  llm_model: "claude-sonnet-4-5",
  llm_max_tokens: 2000,
  prompt_version: "v1",
  allowed_actions: [
    "pause_campaign",
    "resume_campaign",
    "adjust_budget",
    "flag_for_review",
  ],
}

/**
 * Reads global optimization config (single row).
 * Falls back to safe defaults if the table is empty or unavailable
 * so the optimization pipeline can still run.
 */
export class OptimizationConfigRepository {
  private cache: { value: OptimizationConfig; expiresAt: number } | null = null
  private readonly cacheMs = 60_000

  async get(): Promise<OptimizationConfig> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value
    }

    const { data, error } = await supabaseAdmin
      .from("optimization_config")
      .select("*")
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      const value = { ...DEFAULTS }
      this.cache = { value, expiresAt: Date.now() + this.cacheMs }
      return value
    }

    const allowedActions = Array.isArray(data.allowed_actions)
      ? (data.allowed_actions as string[])
      : DEFAULTS.allowed_actions

    const value: OptimizationConfig = {
      id: data.id,
      mvp_actions_enabled: data.mvp_actions_enabled ?? DEFAULTS.mvp_actions_enabled,
      auto_apply_policy: data.auto_apply_policy ?? DEFAULTS.auto_apply_policy,
      budget_drift_threshold_pct:
        Number(data.budget_drift_threshold_pct ?? DEFAULTS.budget_drift_threshold_pct),
      analysis_cache_ttl_hours:
        Number(data.analysis_cache_ttl_hours ?? DEFAULTS.analysis_cache_ttl_hours),
      max_budget_adjust_pct:
        Number(data.max_budget_adjust_pct ?? DEFAULTS.max_budget_adjust_pct),
      min_days_before_action:
        Number(data.min_days_before_action ?? DEFAULTS.min_days_before_action),
      min_spend_before_action:
        Number(data.min_spend_before_action ?? DEFAULTS.min_spend_before_action),
      analyze_rate_limit_per_hour:
        Number(data.analyze_rate_limit_per_hour ?? DEFAULTS.analyze_rate_limit_per_hour),
      llm_model: data.llm_model ?? DEFAULTS.llm_model,
      llm_max_tokens: Number(data.llm_max_tokens ?? DEFAULTS.llm_max_tokens),
      prompt_version: data.prompt_version ?? DEFAULTS.prompt_version,
      allowed_actions: allowedActions,
    }

    this.cache = { value, expiresAt: Date.now() + this.cacheMs }
    return value
  }

  invalidate(): void {
    this.cache = null
  }
}
