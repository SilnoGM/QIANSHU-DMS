/**
 * 认领产品匹配只用于「货件库存分配行 → 目标销售行」的资格校验。
 * 目录产品有稳定 product_id；自定义产品没有主档，只能用名称别名做弱匹配，
 * 名称不一致时必须由人工显式确认，不能猜测相似度。
 */
export type ClaimProductLineType = 'CATALOG' | 'CUSTOM'

export type ClaimProductMatchMode = 'AUTO' | 'MANUAL_OVERRIDE'

/** 全半角、首尾空白和连续空白不构成产品差异；拉丁字母大小写不构成差异。 */
export function normalizeClaimProductName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function claimProductAliases(
  values: readonly (string | null | undefined)[],
): string[] {
  const aliases = new Set<string>()
  for (const value of values) {
    if (value === null || value === undefined) continue
    const normalized = normalizeClaimProductName(value)
    if (normalized !== '') aliases.add(normalized)
  }
  return [...aliases]
}

export function claimProductMatches(input: {
  readonly sourceLineType: ClaimProductLineType
  readonly sourceProductId: string | null
  readonly sourceAliases: readonly string[]
  readonly targetLineType: ClaimProductLineType
  readonly targetProductId: string | null
  readonly targetProductName: string
}): boolean {
  if (input.sourceLineType !== input.targetLineType) {
    return false
  }
  if (input.sourceLineType === 'CATALOG') {
    return input.sourceProductId !== null
      && input.sourceProductId === input.targetProductId
  }
  return input.sourceAliases.includes(normalizeClaimProductName(input.targetProductName))
}
