import { purchaseOrderValidationFailure } from './domain/purchase-order-errors'

export interface NormalizedPurchaseOrderPart {
  readonly key: string
  readonly items: readonly { readonly lineNumber: number, readonly quantity: number }[]
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function record(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) {
    return purchaseOrderValidationFailure(field)
  }
  return value as Record<string, unknown>
}

/** 行号来自本次最终明细顺序；按数量守恒校验，不能只检查产品集合是否出现。 */
export function normalizePurchaseOrderParts(
  input: unknown,
  lines: readonly { readonly lineNumber: number, readonly quantity: number }[],
): readonly NormalizedPurchaseOrderPart[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 1000) {
    return purchaseOrderValidationFailure('parts', '必须配置 1 至 1000 个货件')
  }
  const remaining = new Map(lines.map(line => [line.lineNumber, line.quantity]))
  const keys = new Set<string>()
  let itemCount = 0
  const parts = input.map((value: unknown, index) => {
    const field = `parts.${index}`
    const part = record(value, ['key', 'items'], field)
    if (typeof part.key !== 'string' || !UUID_V4.test(part.key) || keys.has(part.key)) {
      return purchaseOrderValidationFailure(`${field}.key`, '货件标识必须是全单唯一的小写 UUID v4')
    }
    keys.add(part.key)
    if (!Array.isArray(part.items) || part.items.length < 1 || part.items.length > lines.length) {
      return purchaseOrderValidationFailure(`${field}.items`, '货件必须包含有效产品')
    }
    itemCount += part.items.length
    if (itemCount > 10_000) return purchaseOrderValidationFailure('parts', '全单产品分配项不得超过 10000 项')
    const seen = new Set<number>()
    const items = part.items.map((itemValue: unknown, itemIndex) => {
      const itemField = `${field}.items.${itemIndex}`
      const item = record(itemValue, ['lineNumber', 'quantity'], itemField)
      if (typeof item.lineNumber !== 'number' || !Number.isInteger(item.lineNumber)
        || !remaining.has(item.lineNumber) || seen.has(item.lineNumber)) {
        return purchaseOrderValidationFailure(`${itemField}.lineNumber`, '货件内产品行必须有效且不重复')
      }
      seen.add(item.lineNumber)
      if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity)
        || item.quantity < 1 || item.quantity > (remaining.get(item.lineNumber) ?? 0)) {
        return purchaseOrderValidationFailure(`${itemField}.quantity`, '分配数量必须为正整数且不得超过采购数量')
      }
      remaining.set(item.lineNumber, remaining.get(item.lineNumber)! - item.quantity)
      return Object.freeze({ lineNumber: item.lineNumber, quantity: item.quantity })
    }).sort((left, right) => left.lineNumber - right.lineNumber)
    return Object.freeze({ key: part.key, items: Object.freeze(items) })
  })
  if ([...remaining.values()].some(quantity => quantity !== 0)) {
    return purchaseOrderValidationFailure('parts', '所有采购数量必须全部分配至货件')
  }
  return Object.freeze(parts)
}
