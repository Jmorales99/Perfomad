import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export interface BenchmarkLookupKey {
  platform: string
  objective?: string | null
  country?: string | null
  spend_tier?: "xs" | "s" | "m" | "l" | "xl" | null
}

export interface BenchmarkMetricDistribution {
  metric_key: string
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  sample_size: number
}

export interface BenchmarkSnapshot {
  version: number | null
  segment: BenchmarkLookupKey | null
  metrics: Record<string, BenchmarkMetricDistribution>
}

const EMPTY_SNAPSHOT: BenchmarkSnapshot = {
  version: null,
  segment: null,
  metrics: {},
}

/**
 * Reads the most recent benchmark distributions for a (platform, objective,
 * country, spend_tier) segment. Returns an empty snapshot when the segment
 * does not exist yet so the LLM input can simply omit benchmarks.
 */
export class BenchmarksRepository {
  async getLatestForSegment(key: BenchmarkLookupKey): Promise<BenchmarkSnapshot> {
    const { data: latestVersion } = await supabaseAdmin
      .from("benchmark_versions")
      .select("id, version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestVersion) return EMPTY_SNAPSHOT

    let segmentQuery = supabaseAdmin
      .from("benchmark_segments")
      .select("id, platform, objective, country, spend_tier")
      .eq("platform", key.platform)

    segmentQuery = key.objective
      ? segmentQuery.eq("objective", key.objective)
      : segmentQuery.is("objective", null)

    segmentQuery = key.country
      ? segmentQuery.eq("country", key.country)
      : segmentQuery.is("country", null)

    segmentQuery = key.spend_tier
      ? segmentQuery.eq("spend_tier", key.spend_tier)
      : segmentQuery.is("spend_tier", null)

    const { data: segmentRow } = await segmentQuery.maybeSingle()
    if (!segmentRow) return EMPTY_SNAPSHOT

    const { data: distRows } = await supabaseAdmin
      .from("benchmark_metric_distributions")
      .select("metric_key, p25, p50, p75, p90, sample_size")
      .eq("version_id", latestVersion.id)
      .eq("segment_id", segmentRow.id)

    const metrics: Record<string, BenchmarkMetricDistribution> = {}
    for (const row of distRows || []) {
      metrics[row.metric_key] = {
        metric_key: row.metric_key,
        p25: row.p25 !== null ? Number(row.p25) : null,
        p50: row.p50 !== null ? Number(row.p50) : null,
        p75: row.p75 !== null ? Number(row.p75) : null,
        p90: row.p90 !== null ? Number(row.p90) : null,
        sample_size: Number(row.sample_size ?? 0),
      }
    }

    return {
      version: Number(latestVersion.version),
      segment: {
        platform: segmentRow.platform,
        objective: segmentRow.objective,
        country: segmentRow.country,
        spend_tier: segmentRow.spend_tier,
      },
      metrics,
    }
  }
}
