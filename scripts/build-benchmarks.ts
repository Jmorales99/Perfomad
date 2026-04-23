/**
 * Benchmark builder
 *
 * Computes percentile distributions (p25/p50/p75/p90) for key KPIs per segment
 * (platform + objective + country + spend_tier) from campaign_metrics_history
 * and writes them to benchmark_metric_distributions under a new benchmark_versions
 * row.
 *
 * Usage:
 *   pnpm tsx scripts/build-benchmarks.ts
 *
 * Schedule this with a cron / GitHub Action / Supabase scheduled job daily.
 */

import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

const METRICS = ["ctr", "cpc", "cpm", "cpa", "roa", "conversion_rate"] as const
const MIN_SAMPLE_SIZE = 20

interface Row {
  platform: string
  objective: string | null
  country: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  cpm: number | null
  cpc: number | null
  cpa: number | null
  roa: number | null
  ctr: number | null
}

function spendTier(spend: number): "xs" | "s" | "m" | "l" | "xl" {
  if (spend < 100) return "xs"
  if (spend < 500) return "s"
  if (spend < 2500) return "m"
  if (spend < 10000) return "l"
  return "xl"
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(v)
}

async function fetchRows(): Promise<Row[]> {
  const { data, error } = await supabaseAdmin
    .from("campaign_metrics_history")
    .select(
      "platform, spend, impressions, clicks, conversions, revenue, cpm, cost_per_click, cpa, roa, ctr, campaigns(objective)"
    )
    .limit(50000)

  if (error) throw error

  return (data || []).map((r: any) => ({
    platform: r.platform,
    objective: r.campaigns?.objective ?? null,
    country: null,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
    revenue: Number(r.revenue ?? 0),
    cpm: r.cpm !== null ? Number(r.cpm) : null,
    cpc: r.cost_per_click !== null ? Number(r.cost_per_click) : null,
    cpa: r.cpa !== null ? Number(r.cpa) : null,
    roa: r.roa !== null ? Number(r.roa) : null,
    ctr: r.ctr !== null ? Number(r.ctr) : null,
  }))
}

async function ensureSegment(
  platform: string,
  objective: string | null,
  country: string | null,
  tier: "xs" | "s" | "m" | "l" | "xl"
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("benchmark_segments")
    .select("id")
    .eq("platform", platform)
    .eq("spend_tier", tier)
    .match({
      ...(objective ? { objective } : {}),
      ...(country ? { country } : {}),
    })
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabaseAdmin
    .from("benchmark_segments")
    .insert({
      platform,
      objective,
      country,
      spend_tier: tier,
    })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

async function main() {
  console.log("Building benchmarks...")
  const rows = await fetchRows()
  console.log(`Fetched ${rows.length} rows`)

  const { data: latest } = await supabaseAdmin
    .from("benchmark_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = (latest?.version ?? 0) + 1

  const { data: versionRow, error: versionErr } = await supabaseAdmin
    .from("benchmark_versions")
    .insert({ version: nextVersion, source: "internal" })
    .select("id")
    .single()
  if (versionErr) throw versionErr
  const versionId = versionRow.id
  console.log(`Benchmark version ${nextVersion} (${versionId})`)

  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const tier = spendTier(r.spend)
    const key = `${r.platform}|${r.objective || ""}|${r.country || ""}|${tier}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(r)
    else groups.set(key, [r])
  }

  let inserted = 0
  for (const [key, bucket] of groups) {
    if (bucket.length < MIN_SAMPLE_SIZE) continue
    const [platform, objective, country, tier] = key.split("|")
    const segmentId = await ensureSegment(
      platform,
      objective || null,
      country || null,
      tier as "xs" | "s" | "m" | "l" | "xl"
    )

    for (const metric of METRICS) {
      const values = bucket
        .map((r) => {
          if (metric === "conversion_rate") {
            return r.clicks > 0 ? (r.conversions / r.clicks) * 100 : null
          }
          return (r as any)[metric] as number | null
        })
        .filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0)

      if (values.length < MIN_SAMPLE_SIZE) continue

      const row = {
        version_id: versionId,
        segment_id: segmentId,
        metric_key: metric,
        sample_size: values.length,
        p25: percentile(values, 25),
        p50: percentile(values, 50),
        p75: percentile(values, 75),
        p90: percentile(values, 90),
        mean: mean(values),
        stddev: stddev(values),
      }

      const { error } = await supabaseAdmin
        .from("benchmark_metric_distributions")
        .upsert(row, { onConflict: "version_id,segment_id,metric_key" })
      if (error) {
        console.error(`Failed to upsert distribution for ${metric} / ${key}:`, error.message)
        continue
      }
      inserted += 1
    }
  }

  console.log(`Inserted ${inserted} distributions for version ${nextVersion}`)
}

main().catch((err) => {
  console.error("Benchmark build failed:", err)
  process.exit(1)
})
