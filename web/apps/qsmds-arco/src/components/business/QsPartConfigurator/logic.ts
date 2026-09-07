import type { PartConfiguration, PartConfigurationValidation, PartConfiguratorProduct } from './types'

export const MAX_PART_CONFIGURATIONS = 1000
export const MAX_PART_ITEMS = 10_000
export const MAX_PART_QUANTITY = 2_147_483_647
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function formatPartLabel(index: number): string {
  return `货件-${String(index + 1).padStart(2, '0')}`
}

export function isPartQuantity(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_PART_QUANTITY
}

export function parsePartQuantity(value: string): number | null {
  const quantity = Number(value)
  return /^[1-9]\d*$/u.test(value) && isPartQuantity(quantity) ? quantity : null
}

/**
 * 剩余数由产品与全部分配实时相减，删除货件无需额外回写数量。
 * 负数保留为错误证据，组件不能截断超量或偷偷重排上游已经确认的货件。
 */
export function getPartAllocationState(
  products: readonly PartConfiguratorProduct[],
  parts: readonly PartConfiguration[],
): { readonly remainingByProduct: ReadonlyMap<string, number>, readonly errors: readonly string[] } {
  const errors: string[] = []
  const productByKey = new Map<string, PartConfiguratorProduct>()
  const remainingByProduct = new Map<string, number>()
  if (products.length === 0) {
    errors.push('请先添加需要装入货件的产品')
  }
  for (const product of products) {
    if (product.key === '' || productByKey.has(product.key)) {
      errors.push('产品标识为空或重复，请返回检查产品明细')
    }
    if (!isPartQuantity(product.quantity)) {
      errors.push(`${product.name || '产品'}的数量必须为不超过 ${MAX_PART_QUANTITY} 的正整数`)
    }
    productByKey.set(product.key, product)
    remainingByProduct.set(product.key, isPartQuantity(product.quantity) ? product.quantity : 0)
  }
  if (parts.length > MAX_PART_CONFIGURATIONS) {
    errors.push(`货件最多 ${MAX_PART_CONFIGURATIONS} 件`)
  }
  if (parts.reduce((count, part) => count + part.items.length, 0) > MAX_PART_ITEMS) {
    errors.push(`全单分配明细最多 ${MAX_PART_ITEMS} 项，请调整货件配置`)
  }
  const partKeys = new Set<string>()
  for (const [index, part] of parts.entries()) {
    const label = formatPartLabel(index)
    if (!UUID_V4.test(part.key) || partKeys.has(part.key.toLowerCase())) {
      errors.push(`${label}的标识无效或重复`)
    }
    partKeys.add(part.key.toLowerCase())
    if (part.items.length === 0) {
      errors.push(`${label}不能为空`)
    }
    const itemKeys = new Set<string>()
    for (const item of part.items) {
      if (itemKeys.has(item.productKey)) {
        errors.push(`${label}中同一产品只能出现一次`)
      }
      itemKeys.add(item.productKey)
      if (!productByKey.has(item.productKey)) {
        errors.push(`${label}包含已移除的产品，请检查货件配置`)
        continue
      }
      if (!isPartQuantity(item.quantity)) {
        errors.push(`${label}的装入数量必须为不超过 ${MAX_PART_QUANTITY} 的正整数`)
        continue
      }
      remainingByProduct.set(item.productKey, remainingByProduct.get(item.productKey)! - item.quantity)
    }
  }
  for (const [key, remaining] of remainingByProduct) {
    if (remaining < 0) {
      errors.push(`${productByKey.get(key)!.name || '产品'}的装入数量超过本次产品数量`)
    }
  }
  return { remainingByProduct, errors: [...new Set(errors)] }
}

/** 完整提交校验：结构合法且所有当前产品数量恰好分配完毕。 */
export function validatePartConfigurations(
  products: readonly PartConfiguratorProduct[],
  parts: readonly PartConfiguration[],
): PartConfigurationValidation {
  const state = getPartAllocationState(products, parts)
  const remainingQuantity = [...state.remainingByProduct.values()].reduce((total, value) => total + Math.max(0, value), 0)
  const errors = [...state.errors]
  if (remainingQuantity > 0) {
    errors.push(`尚有 ${remainingQuantity} 件产品未装入货件`)
  }
  return { valid: errors.length === 0, remainingQuantity, errors }
}

export function getPendingPartProducts(
  products: readonly PartConfiguratorProduct[],
  parts: readonly PartConfiguration[],
): readonly PartConfiguratorProduct[] {
  const { remainingByProduct } = getPartAllocationState(products, parts)
  return products.filter(product => (remainingByProduct.get(product.key) ?? 0) > 0)
}

export function appendPartConfiguration(
  products: readonly PartConfiguratorProduct[],
  parts: readonly PartConfiguration[],
  items: PartConfiguration['items'],
  key: string = globalThis.crypto.randomUUID(),
): { readonly ok: true, readonly parts: readonly PartConfiguration[] } | { readonly ok: false, readonly message: string } {
  const next = [...parts, { key, items: items.map(item => ({ ...item })) }]
  const { errors } = getPartAllocationState(products, next)
  return errors.length > 0 ? { ok: false, message: errors[0]! } : { ok: true, parts: next }
}

export function removePartConfiguration(parts: readonly PartConfiguration[], key: string): readonly PartConfiguration[] {
  return parts.filter(part => part.key !== key)
}

export function removePartConfigurationItem(
  parts: readonly PartConfiguration[],
  partKey: string,
  productKey: string,
): readonly PartConfiguration[] {
  return parts.flatMap((part) => {
    if (part.key !== partKey) {
      return [part]
    }
    const items = part.items.filter(item => item.productKey !== productKey)
    return items.length === 0 ? [] : [{ ...part, items }]
  })
}
