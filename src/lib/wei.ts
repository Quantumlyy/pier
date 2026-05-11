/**
 * Kodex `formatEtherPrice` parses stats via `BigNumber.from(price.replace('.', ''))` — it expects
 * **integer wei**, not decimal ETH. `/total_stats` monetary strings must be non-negative integer wei (no `.`).
 */

export function parseWeiBigInt(raw: string | null | undefined): bigint {
  if (raw == null || raw === '') return 0n
  const head = String(raw).trim().split(/[.eE]/)[0] ?? ''
  if (head === '' || head === '-') return 0n
  try {
    return BigInt(head)
  } catch {
    return 0n
  }
}

/** BigInt wei → API string for Kodex stats / marketplace formatters. */
export function weiBigIntToApiString(wei: bigint): string {
  return wei.toString()
}

/** Subgraph / Grails wei field → API string (truncates fractional wei from averages). */
export function weiRawToApiString(raw: string | null | undefined): string {
  return parseWeiBigInt(raw).toString()
}
