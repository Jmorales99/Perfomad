import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { Recommendation } from "@/application/usecases/optimization/schemas/OptimizationOutput"

export interface OptimizationRunRecord {
  id: string
  campaign_id: string
  user_id: string
  input_hash: string
  prompt_version: string
  model: string
  status: "pending" | "succeeded" | "failed" | "insufficient_data"
  raw_input: unknown | null
  raw_output: unknown | null
  summary: {
    overall_health: string
    headline: string
    health_score?: number
    health_score_criteria?: Record<string, number>
    health_trend?: { direction: string; delta_pts?: number | null }
    alerts?: Array<{ urgency: string; type: string; message: string }>
    next_step?: string
  } | null
  input_tokens: number | null
  output_tokens: number | null
  latency_ms: number | null
  error_message: string | null
  created_at: string
}

export interface OptimizationRecommendationRecord {
  id: string
  run_id: string
  campaign_id: string
  user_id: string
  external_id: string
  action_type: Recommendation["action_type"]
  priority: Recommendation["priority"]
  title: string
  rationale: string | null
  expected_impact: string | null
  params: Record<string, unknown>
  requires_confirmation: boolean
  confidence: number | null
  applicable_to_platform: boolean
  platform_support: "automatic" | "manual_required" | "unsupported"
  prompt_version: string | null
  created_at: string
}

export interface OptimizationDecisionRecord {
  id: string
  recommendation_id: string
  campaign_id: string
  user_id: string
  decision: "accept" | "reject" | "defer"
  override_params: Record<string, unknown> | null
  notes: string | null
  created_at: string
}

export interface OptimizationExecutionRecord {
  id: string
  decision_id: string
  recommendation_id: string
  campaign_id: string
  user_id: string
  platform: string
  action_type: string
  status:
    | "pending"
    | "succeeded"
    | "failed"
    | "manual_required"
    | "unsupported"
    | "skipped"
  execution_key: string
  request_payload: Record<string, unknown> | null
  response_payload: Record<string, unknown> | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export class OptimizationRepository {
  // ── runs ────────────────────────────────────────────────────────────────

  async findFreshRunByHash(
    campaignId: string,
    inputHash: string,
    maxAgeHours: number
  ): Promise<OptimizationRunRecord | null> {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
      .from("optimization_runs")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("input_hash", inputHash)
      .eq("status", "succeeded")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return (data as OptimizationRunRecord) ?? null
  }

  async createRun(params: {
    campaign_id: string
    user_id: string
    input_hash: string
    prompt_version: string
    model: string
    status: OptimizationRunRecord["status"]
    raw_input?: unknown
    raw_output?: unknown
    summary?: OptimizationRunRecord["summary"]
    input_tokens?: number | null
    output_tokens?: number | null
    latency_ms?: number | null
    error_message?: string | null
  }): Promise<OptimizationRunRecord> {
    const { data, error } = await supabaseAdmin
      .from("optimization_runs")
      .insert({
        campaign_id: params.campaign_id,
        user_id: params.user_id,
        input_hash: params.input_hash,
        prompt_version: params.prompt_version,
        model: params.model,
        status: params.status,
        raw_input: params.raw_input ?? null,
        raw_output: params.raw_output ?? null,
        summary: params.summary ?? null,
        input_tokens: params.input_tokens ?? null,
        output_tokens: params.output_tokens ?? null,
        latency_ms: params.latency_ms ?? null,
        error_message: params.error_message ?? null,
      })
      .select()
      .single()

    if (error) throw error
    return data as OptimizationRunRecord
  }

  async listRuns(
    campaignId: string,
    userId: string,
    limit = 20
  ): Promise<OptimizationRunRecord[]> {
    const { data, error } = await supabaseAdmin
      .from("optimization_runs")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data || []) as OptimizationRunRecord[]
  }

  async getLatestSucceededRun(
    campaignId: string,
    userId: string
  ): Promise<OptimizationRunRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("optimization_runs")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data as OptimizationRunRecord) ?? null
  }

  async countRecentRunsForUser(userId: string, windowHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
    const { count, error } = await supabaseAdmin
      .from("optimization_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", cutoff)
    if (error) throw error
    return count ?? 0
  }

  // ── recommendations ────────────────────────────────────────────────────

  async insertRecommendations(
    rows: Omit<OptimizationRecommendationRecord, "id" | "created_at">[]
  ): Promise<OptimizationRecommendationRecord[]> {
    if (rows.length === 0) return []
    const { data, error } = await supabaseAdmin
      .from("optimization_recommendations")
      .insert(rows)
      .select()
    if (error) throw error
    return (data || []) as OptimizationRecommendationRecord[]
  }

  async listRecommendationsByRun(
    runId: string
  ): Promise<OptimizationRecommendationRecord[]> {
    const { data, error } = await supabaseAdmin
      .from("optimization_recommendations")
      .select("*")
      .eq("run_id", runId)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
    if (error) throw error
    return (data || []) as OptimizationRecommendationRecord[]
  }

  async findRecommendationById(
    recommendationId: string,
    userId: string
  ): Promise<OptimizationRecommendationRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("optimization_recommendations")
      .select("*")
      .eq("id", recommendationId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) throw error
    return (data as OptimizationRecommendationRecord) ?? null
  }

  // ── decisions ──────────────────────────────────────────────────────────

  async upsertDecision(params: {
    recommendation_id: string
    campaign_id: string
    user_id: string
    decision: OptimizationDecisionRecord["decision"]
    override_params?: Record<string, unknown> | null
    notes?: string | null
  }): Promise<OptimizationDecisionRecord> {
    const { data, error } = await supabaseAdmin
      .from("optimization_decisions")
      .upsert(
        {
          recommendation_id: params.recommendation_id,
          campaign_id: params.campaign_id,
          user_id: params.user_id,
          decision: params.decision,
          override_params: params.override_params ?? null,
          notes: params.notes ?? null,
        },
        { onConflict: "recommendation_id" }
      )
      .select()
      .single()
    if (error) throw error
    return data as OptimizationDecisionRecord
  }

  async findDecisionByRecommendation(
    recommendationId: string
  ): Promise<OptimizationDecisionRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("optimization_decisions")
      .select("*")
      .eq("recommendation_id", recommendationId)
      .maybeSingle()
    if (error) throw error
    return (data as OptimizationDecisionRecord) ?? null
  }

  async listDecisionsByRecommendationIds(
    ids: string[]
  ): Promise<Map<string, OptimizationDecisionRecord>> {
    if (ids.length === 0) return new Map()
    const { data, error } = await supabaseAdmin
      .from("optimization_decisions")
      .select("*")
      .in("recommendation_id", ids)
    if (error) throw error
    const map = new Map<string, OptimizationDecisionRecord>()
    for (const row of (data ?? []) as OptimizationDecisionRecord[]) {
      map.set(row.recommendation_id, row)
    }
    return map
  }

  async listLatestExecutionsByDecisionIds(
    ids: string[]
  ): Promise<Map<string, OptimizationExecutionRecord>> {
    if (ids.length === 0) return new Map()
    const { data, error } = await supabaseAdmin
      .from("optimization_executions")
      .select("*")
      .in("decision_id", ids)
      .order("started_at", { ascending: false })
    if (error) throw error
    // Keep only the latest execution per decision_id
    const map = new Map<string, OptimizationExecutionRecord>()
    for (const row of (data ?? []) as OptimizationExecutionRecord[]) {
      if (!map.has(row.decision_id)) {
        map.set(row.decision_id, row)
      }
    }
    return map
  }

  // ── executions ─────────────────────────────────────────────────────────

  async findExecutionByKey(
    executionKey: string
  ): Promise<OptimizationExecutionRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("optimization_executions")
      .select("*")
      .eq("execution_key", executionKey)
      .maybeSingle()
    if (error) throw error
    return (data as OptimizationExecutionRecord) ?? null
  }

  async createExecution(params: {
    decision_id: string
    recommendation_id: string
    campaign_id: string
    user_id: string
    platform: string
    action_type: string
    status: OptimizationExecutionRecord["status"]
    execution_key: string
    request_payload?: Record<string, unknown> | null
    response_payload?: Record<string, unknown> | null
    error_message?: string | null
    completed_at?: string | null
  }): Promise<OptimizationExecutionRecord> {
    const { data, error } = await supabaseAdmin
      .from("optimization_executions")
      .insert({
        decision_id: params.decision_id,
        recommendation_id: params.recommendation_id,
        campaign_id: params.campaign_id,
        user_id: params.user_id,
        platform: params.platform,
        action_type: params.action_type,
        status: params.status,
        execution_key: params.execution_key,
        request_payload: params.request_payload ?? null,
        response_payload: params.response_payload ?? null,
        error_message: params.error_message ?? null,
        completed_at: params.completed_at ?? null,
      })
      .select()
      .single()
    if (error) throw error
    return data as OptimizationExecutionRecord
  }

  async listExecutionsForCampaign(
    campaignId: string,
    userId: string,
    limit = 20
  ): Promise<OptimizationExecutionRecord[]> {
    const { data, error } = await supabaseAdmin
      .from("optimization_executions")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data || []) as OptimizationExecutionRecord[]
  }
}
