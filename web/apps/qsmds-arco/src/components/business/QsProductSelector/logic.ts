import type {
  ExistingCatalogLine,
  ProductIncrementCandidate,
  ProductSelectionChange,
  ProductSelectorGroup,
  ProductSelectorItem,
  ProductSelectorQuery,
  SelectedProductGroup,
  SelectedProductItem,
} from './types'

export interface ProductSelectionDecision {
  readonly changes: readonly ProductSelectionChange[]
  readonly incrementCandidate: ProductIncrementCandidate | null
}

export function normalizeProductSelectorKeyword(value: string): string {
  return value.trim().normalize('NFKC')
}

export function createProductSelectorQueryKey(
  query: ProductSelectorQuery,
): string {
  return [
    query.currencyCode,
    normalizeProductSelectorKeyword(query.keyword ?? ''),
    query.supplierValue ?? '',
    query.categoryName ?? '',
    query.unclassified === true ? 'uncategorized' : '',
  ].join('\u0000')
}

export function canApplyProductSelectorResponse(input: {
  readonly activeQueryKey: string
  readonly activeVersion: number
  readonly requestQueryKey: string
  readonly requestVersion: number
  readonly aborted: boolean
}): boolean {
  return !input.aborted
    && input.activeVersion === input.requestVersion
    && input.activeQueryKey === input.requestQueryKey
}

/** 滚动分页只按稳定产品 ID 合并，服务端意外重复项不会产生第二个交互身份。 */
export function mergeProductSelectorItems(
  current: readonly ProductSelectorItem[],
  incoming: readonly ProductSelectorItem[],
  replace: boolean,
): readonly ProductSelectorItem[] {
  const byId = new Map<string, ProductSelectorItem>()
  if (!replace) {
    for (const item of current) {
      byId.set(item.id, item)
    }
  }
  for (const item of incoming) {
    byId.set(item.id, item)
  }
  return [...byId.values()]
}

/**
 * 分组键必须包含分类：文本型产品头允许跨分类同名，只按产品头分组会把
 * 两个不同分类的同名系列错误合并。Map 保持服务端已有的分类/产品头顺序。
 */
export function groupProductSelectorItems(
  items: readonly ProductSelectorItem[],
): readonly ProductSelectorGroup[] {
  const groups = new Map<string, {
    categoryName: string | null
    productHeadName: string | null
    items: ProductSelectorItem[]
  }>()
  for (const item of items) {
    const key = `${item.categoryName ?? ''}\u0000${item.productHeadName ?? ''}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, {
        categoryName: item.categoryName,
        productHeadName: item.productHeadName,
        items: [item],
      })
    }
    else {
      existing.items.push(item)
    }
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    categoryName: group.categoryName,
    productHeadName: group.productHeadName,
    items: group.items,
  }))
}

export function createExistingCatalogLineIndex(
  lines: readonly ExistingCatalogLine[],
): ReadonlyMap<string, ExistingCatalogLine> {
  const index = new Map<string, ExistingCatalogLine>()
  for (const line of lines) {
    if (!index.has(line.productId)) {
      index.set(line.productId, line)
    }
  }
  return index
}

function changeProductId(change: ProductSelectionChange): string {
  return change.kind === 'ADD' ? change.product.id : change.productId
}

function displayQuantity(value: string, delta: number): string {
  if (!/^[1-9]\d*$/u.test(value)) {
    return value
  }
  const parsed = Number(value)
  const result = parsed + delta
  return Number.isSafeInteger(parsed) && Number.isSafeInteger(result)
    ? String(result)
    : value
}

/**
 * 右侧已选列表是“确认后数据库产品明细”的会话投影：先回显原明细，再叠加
 * 新增、加量与删除变更。临时产品不进入该投影。
 */
export function createSelectedProductItems(
  existingLines: readonly ExistingCatalogLine[],
  changes: readonly ProductSelectionChange[],
): readonly SelectedProductItem[] {
  const removedProductIds = new Set(changes.flatMap(change => (
    change.kind === 'REMOVE' ? [change.productId] : []
  )))
  const incrementByProductId = new Map(changes.flatMap(change => (
    change.kind === 'INCREMENT' ? [[change.productId, change.delta] as const] : []
  )))
  const existingProductIds = new Set(existingLines.map(line => line.productId))
  const existingItems = existingLines.flatMap(line => (
    removedProductIds.has(line.productId)
      ? []
      : [{
          origin: 'EXISTING' as const,
          productId: line.productId,
          productNo: line.productNo,
          name: line.name,
          quantity: displayQuantity(
            line.quantity,
            incrementByProductId.get(line.productId) ?? 0,
          ),
          supplierValue: line.supplierValue ?? null,
        }]
  ))
  const addedItems = changes.flatMap(change => (
    change.kind === 'ADD' && !existingProductIds.has(change.product.id)
      ? [{
          origin: 'ADDED' as const,
          productId: change.product.id,
          productNo: change.product.productNo,
          name: change.product.name,
          quantity: String(change.quantity),
          supplierValue: change.product.supplierValue,
        }]
      : []
  ))
  return [...existingItems, ...addedItems]
}

/**
 * 右侧清单按供应商分组；已有明细可能没有供应商，调用方可用候选页同一
 * productId 的供应商补齐，仍无法确定时归入 null 组（未设置供应商）。
 */
export function groupSelectedProductItems(
  items: readonly SelectedProductItem[],
  resolveSupplier: (item: SelectedProductItem) => string | null = item => (
    item.supplierValue
  ),
): readonly SelectedProductGroup[] {
  const groups = new Map<string, {
    supplierValue: string | null
    items: SelectedProductItem[]
  }>()
  for (const item of items) {
    const supplierValue = resolveSupplier(item)
    const key = supplierValue ?? ''
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { supplierValue, items: [item] })
    }
    else {
      group.items.push(item)
    }
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    supplierValue: group.supplierValue,
    items: group.items,
  }))
}

export function removeProductFromSession(
  changes: readonly ProductSelectionChange[],
  productId: string,
  existingByProductId: ReadonlyMap<string, ExistingCatalogLine>,
): readonly ProductSelectionChange[] {
  const remaining = changes.filter(change => changeProductId(change) !== productId)
  const existing = existingByProductId.get(productId)
  return existing === undefined
    ? remaining
    : [...remaining, {
        kind: 'REMOVE',
        lineKey: existing.key,
        productId: existing.productId,
      }]
}

export function selectProductForSession(
  changes: readonly ProductSelectionChange[],
  product: ProductSelectorItem,
  existingByProductId: ReadonlyMap<string, ExistingCatalogLine>,
): ProductSelectionDecision {
  const pendingRemoval = changes.find(change => (
    change.kind === 'REMOVE' && change.productId === product.id
  ))
  if (pendingRemoval !== undefined) {
    return {
      changes: changes.filter(change => change !== pendingRemoval),
      incrementCandidate: null,
    }
  }

  const pendingAdd = changes.find(change => (
    change.kind === 'ADD' && change.product.id === product.id
  ))
  if (pendingAdd !== undefined) {
    return {
      changes: [...changes],
      incrementCandidate: {
        kind: 'ADD',
        lineKey: null,
        productId: product.id,
      },
    }
  }

  const existing = existingByProductId.get(product.id)
  if (existing !== undefined) {
    return {
      changes: [...changes],
      incrementCandidate: {
        kind: 'EXISTING',
        lineKey: existing.key,
        productId: existing.productId,
      },
    }
  }

  return {
    changes: [...changes, { kind: 'ADD', product, quantity: 1 }],
    incrementCandidate: null,
  }
}

export function confirmProductIncrement(
  changes: readonly ProductSelectionChange[],
  candidate: ProductIncrementCandidate,
): readonly ProductSelectionChange[] {
  if (candidate.kind === 'ADD') {
    return changes.map(change => (
      change.kind === 'ADD' && change.product.id === candidate.productId
        ? { ...change, quantity: change.quantity + 1 }
        : change
    ))
  }

  const pendingIncrement = changes.find(change => (
    change.kind === 'INCREMENT' && change.productId === candidate.productId
  ))
  return pendingIncrement === undefined
    ? [...changes, {
        kind: 'INCREMENT',
        lineKey: candidate.lineKey,
        productId: candidate.productId,
        delta: 1,
      }]
    : changes.map(change => (
        change.kind === 'INCREMENT'
        && change.productId === candidate.productId
          ? { ...change, delta: change.delta + 1 }
          : change
      ))
}
