import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export interface ProductAnalysisRun {
  id: string
  user_id: string
  client_id: string
  run_at: string
  model: string
  status: string
  summary: string | null
  products_count: number
  input_hash: string | null
}

export interface ProductRecommendation {
  id: string
  run_id: string
  product_id: string
  product_title: string | null
  image_url: string | null
  priority: string
  action_type: string
  title: string
  description: string
  rationale: string | null
  impact: string | null
}

export interface ProductAnalysisResult {
  run: ProductAnalysisRun
  recommendations: ProductRecommendation[]
}

export class SupabaseProductAnalysisRepository {
  async saveRun(data: {
    user_id: string
    client_id: string
    model: string
    status: string
    summary: string | null
    products_count: number
    input_hash: string
  }): Promise<ProductAnalysisRun> {
    const { data: row, error } = await supabaseAdmin
      .from("product_analysis_runs")
      .insert(data)
      .select()
      .single()
    if (error) throw error
    return row as ProductAnalysisRun
  }

  async saveRecommendations(
    runId: string,
    recs: Array<{
      product_id: string
      product_title: string | null
      image_url: string | null
      priority: string
      action_type: string
      title: string
      description: string
      rationale: string | null
      impact: string | null
    }>
  ): Promise<ProductRecommendation[]> {
    if (recs.length === 0) return []
    const { data, error } = await supabaseAdmin
      .from("product_recommendations")
      .insert(recs.map((r) => ({ ...r, run_id: runId })))
      .select()
    if (error) throw error
    return (data ?? []) as ProductRecommendation[]
  }

  async getLatestRun(userId: string, clientId: string): Promise<ProductAnalysisResult | null> {
    const { data: run, error } = await supabaseAdmin
      .from("product_analysis_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("status", "succeeded")
      .order("run_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !run) return null

    const { data: recs } = await supabaseAdmin
      .from("product_recommendations")
      .select("*")
      .eq("run_id", run.id)
      .order("priority", { ascending: true })

    return {
      run: run as ProductAnalysisRun,
      recommendations: (recs ?? []) as ProductRecommendation[],
    }
  }

  async findRunByHash(
    userId: string,
    clientId: string,
    hash: string,
    ttlHours = 24
  ): Promise<ProductAnalysisRun | null> {
    const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
      .from("product_analysis_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("input_hash", hash)
      .eq("status", "succeeded")
      .gte("run_at", cutoff)
      .order("run_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !data) return null
    return data as ProductAnalysisRun
  }
}
