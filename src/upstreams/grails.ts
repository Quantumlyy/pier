import { env } from '../env.ts'
import { statsAggregationCache } from '../lib/cache.ts'
import type { TotalStatsType } from '../lib/types.ts'
import { weiRawToApiString } from '../lib/wei.ts'

/**
 * Grails [`GET /analytics/market`](https://github.com/grailsmarket/backend/blob/main/services/api/src/routes/analytics.ts)
 * aggregates ETH/WETH sales from Grails’ DB (`period`=24h|7d|30d|…).
 * [`GET /analytics/sales`](https://api.grails.app/api/v1/analytics/sales) supplies the latest sale + name for `last_sale*`.
 *
 * Optional: set `GRAILS_ANALYTICS_BASE` (e.g. `https://api.grails.app/api/v1/analytics`). When unset, returns `{}`
 * so `/total_stats` keeps zero sales fields unless another source fills them.
 */

type GrailsMarketPayload = {
  success?: boolean
  data?: {
    volume?: {
      sales_count?: number
      total_volume_wei?: string
      avg_sale_price_wei?: string
      max_sale_price_wei?: string
    }
  }
}

type GrailsSalesPayload = {
  success?: boolean
  data?: {
    results?: Array<{ sale_price_wei?: string; name?: string | null }>
  }
}

const FETCH_MS = 12_000

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`Grails HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Maps Grails market + sales endpoints onto Kodex `TotalStatsType` sales columns. */
export async function fetchGrailsSalesStats(): Promise<Partial<TotalStatsType>> {
  const raw = env.GRAILS_ANALYTICS_BASE
  if (!raw) return {}

  const base = raw.replace(/\/$/, '')

  return statsAggregationCache.getOrSet('grailsSalesStats', async () => {
    const [m24, m7, m30, sales] = await Promise.all([
      fetchJson<GrailsMarketPayload>(`${base}/market?period=24h`),
      fetchJson<GrailsMarketPayload>(`${base}/market?period=7d`),
      fetchJson<GrailsMarketPayload>(`${base}/market?period=30d`),
      fetchJson<GrailsSalesPayload>(
        `${base}/sales?period=30d&limit=1&sortBy=date&sortOrder=desc`,
      ),
    ])

    if (!m24.success || !m7.success || !m30.success || !m24.data?.volume || !m7.data?.volume || !m30.data?.volume) {
      return {}
    }

    const v24 = m24.data.volume
    const v7 = m7.data.volume
    const v30 = m30.data.volume

    const last = sales.success ? sales.data?.results?.[0] : undefined

    return {
      volume_day: weiRawToApiString(v24.total_volume_wei),
      volume_week: weiRawToApiString(v7.total_volume_wei),
      volume_month: weiRawToApiString(v30.total_volume_wei),
      average_sale: weiRawToApiString(v30.avg_sale_price_wei),
      daily_sales: String(v24.sales_count ?? 0),
      highest_sale: weiRawToApiString(v7.max_sale_price_wei),
      last_sale: last?.sale_price_wei != null ? weiRawToApiString(last.sale_price_wei) : '0',
      last_sale_domain_name: last?.name ?? '',
    }
  }) as Promise<Partial<TotalStatsType>>
}
