export interface ProductMetricRow {
  id?: string
  user_id: string
  client_id: string
  ad_account_id: string
  campaign_id?: string | null
  platform: string
  product_id: string
  product_title?: string | null
  image_url?: string | null
  recorded_at: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  revenue: number
  ctr: number
  cpc: number
  roas: number
  raw?: unknown
}

export interface ProductMetricsRepository {
  upsertRows(rows: ProductMetricRow[]): Promise<void>
  getByCampaign(
    campaignId: string,
    options?: { since?: string; until?: string }
  ): Promise<ProductMetricRow[]>
  getByAdAccount(
    userId: string,
    clientId: string,
    adAccountId: string,
    platform: string,
    options?: { since?: string; until?: string; campaignId?: string }
  ): Promise<ProductMetricRow[]>
  getAllByClient(
    userId: string,
    clientId: string,
    options?: { since?: string; until?: string; platform?: string }
  ): Promise<ProductMetricRow[]>
}
