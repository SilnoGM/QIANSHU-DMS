export const PRODUCT_ALIAS_MAX_CODE_POINTS = 36
export const PRODUCT_ALIAS_MAX_PRODUCT_IDS = 100

const PRODUCT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const FORBIDDEN_ALIAS_PATTERN = /[\p{Cc}×]/u

/** 与唛头标签一致：去首尾空白并折叠内部空白，不改变字符本身。 */
export function normalizeProductAlias(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function productAliasCodePointLength(value: string): number {
  return Array.from(value).length
}

export function isValidProductAlias(value: string): boolean {
  return value.length > 0
    && productAliasCodePointLength(value) <= PRODUCT_ALIAS_MAX_CODE_POINTS
    && !FORBIDDEN_ALIAS_PATTERN.test(value)
}

/** 逗号分隔的产品 ID 查询；返回去重后的 UUID，空串视为未过滤。 */
export function parseProductAliasProductIds(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return []
  }
  const ids = [...new Set(value.split(',').map(part => part.trim()))]
  if (ids.length > PRODUCT_ALIAS_MAX_PRODUCT_IDS || ids.some(id => !PRODUCT_ID_PATTERN.test(id))) {
    throw new ProductAliasValidationError('产品 ID 列表格式不正确')
  }
  return ids
}

export class ProductAliasValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductAliasValidationError'
  }
}

export function aliasLookupKey(userId: string, productId: string): string {
  return `${userId}:${productId}`
}
