import type { ProductSelectionChange } from '../QsProductSelector/types'
import type { OrderProductLineModel } from './types'

const AMOUNT_SCALE = 10_000n
const MAXIMUM_QUANTITY = 2_147_483_647

export type ApplyProductSelectionResult
  = | { readonly ok: true, readonly lines: readonly OrderProductLineModel[] }
    | {
      readonly ok: false
      readonly code: 'LINE_LIMIT' | 'STALE_SELECTION'
      readonly message: string
    }

function newLineKey(): string {
  return globalThis.crypto.randomUUID()
}

function validQuantity(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= MAXIMUM_QUANTITY
    ? parsed
    : null
}

function validSelectionQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAXIMUM_QUANTITY
}

function amountUnits(value: string | null): bigint | null {
  if (value === null) {
    return null
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/u.exec(value)
  if (match === null) {
    return null
  }
  return BigInt(match[1]!) * AMOUNT_SCALE
    + BigInt((match[2] ?? '').padEnd(4, '0'))
}

function formatAmountUnits(value: bigint, precision: number): string {
  const integerPart = value / AMOUNT_SCALE
  const fractionPart = (value % AMOUNT_SCALE).toString().padStart(4, '0')
  return precision === 0
    ? integerPart.toString()
    : `${integerPart}.${fractionPart.slice(0, precision)}`
}

export function createTemporaryOrderProductLine(
  key: string = newLineKey(),
): OrderProductLineModel {
  return {
    key,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    name: '',
    description: '',
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: null,
    quantity: '1',
    mainImage: null,
  }
}

/**
 * 先在副本上验证并应用完整变更集；任何陈旧行、重复产品或数量上限都会让整批
 * 失败，父级因此不会观察到部分写入。
 */
export function applyProductSelectionChanges(
  source: readonly OrderProductLineModel[],
  changes: readonly ProductSelectionChange[],
  maximumLines = 100,
): ApplyProductSelectionResult {
  const lines = source.map(line => ({ ...line }))
  const productIds = new Set(lines.flatMap(line => (
    line.productId === null ? [] : [line.productId]
  )))
  const changedProductIds = new Set<string>()

  // 同一产品在一次选择会话中只能产生一种最终差异，避免 REMOVE + ADD 等矛盾
  // 组合覆盖明细中已经录入的真实售价和备注。
  for (const change of changes) {
    const productId = change.kind === 'ADD' ? change.product.id : change.productId
    if (changedProductIds.has(productId)) {
      return {
        ok: false,
        code: 'STALE_SELECTION',
        message: '产品明细已变化，请重新选择产品',
      }
    }
    changedProductIds.add(productId)
  }

  // 先应用删除，确保满行状态下也能通过“删除旧产品并新增其他产品”完成替换。
  for (const change of changes) {
    if (change.kind !== 'REMOVE') {
      continue
    }
    const index = lines.findIndex(line => (
      line.key === change.lineKey && line.productId === change.productId
    ))
    const current = index === -1 ? undefined : lines[index]
    if (current?.lineType !== 'CATALOG') {
      return {
        ok: false,
        code: 'STALE_SELECTION',
        message: '产品明细已变化，请重新选择产品',
      }
    }
    lines.splice(index, 1)
    productIds.delete(change.productId)
  }

  for (const change of changes) {
    if (change.kind !== 'INCREMENT') {
      continue
    }
    const index = lines.findIndex(line => (
      line.key === change.lineKey && line.productId === change.productId
    ))
    const current = index === -1 ? undefined : lines[index]
    const quantity = current === undefined ? null : validQuantity(current.quantity)
    if (
      current?.lineType !== 'CATALOG'
      || quantity === null
      || !validSelectionQuantity(change.delta)
      || quantity + change.delta > MAXIMUM_QUANTITY
    ) {
      return {
        ok: false,
        code: 'STALE_SELECTION',
        message: '产品明细已变化，请重新选择产品',
      }
    }
    lines[index] = { ...current, quantity: String(quantity + change.delta) }
  }

  for (const change of changes) {
    if (change.kind !== 'ADD') {
      continue
    }
    if (!validSelectionQuantity(change.quantity)) {
      return {
        ok: false,
        code: 'STALE_SELECTION',
        message: '产品明细已变化，请重新选择产品',
      }
    }
    if (lines.length >= maximumLines) {
      return { ok: false, code: 'LINE_LIMIT', message: `产品明细最多 ${maximumLines} 行` }
    }
    if (productIds.has(change.product.id)) {
      return {
        ok: false,
        code: 'STALE_SELECTION',
        message: '产品明细已变化，请重新选择产品',
      }
    }
    productIds.add(change.product.id)
    lines.push({
      key: newLineKey(),
      lineType: 'CATALOG',
      productId: change.product.id,
      productNo: change.product.productNo,
      name: change.product.name,
      description: '',
      standardUnitPriceAmount: change.product.standardUnitPriceAmount,
      actualUnitPriceAmount: change.product.standardUnitPriceAmount,
      quantity: String(change.quantity),
      mainImage: change.product.mainImage,
    })
  }
  return { ok: true, lines }
}

export interface OrderProductLineTotals {
  readonly standardTotal: string | null
  readonly actualTotal: string | null
  readonly missingStandardPriceCount: number
}

export function calculateOrderProductLineTotals(
  lines: readonly OrderProductLineModel[],
  precision: number,
): OrderProductLineTotals {
  let standardTotal = 0n
  let actualTotal = 0n
  let standardTotalValid = true
  let actualTotalValid = true
  let missingStandardPriceCount = 0
  for (const line of lines) {
    // 标准价缺失是允许的业务状态，本单售价为空则仍是待填写状态；两种汇总必须
    // 独立计算，避免一个无标准价产品把其他产品可信的标准价汇总一起清空。
    const quantity = validQuantity(line.quantity)
    const actualPrice = amountUnits(line.actualUnitPriceAmount)
    if (quantity === null) {
      standardTotalValid = false
      actualTotalValid = false
      continue
    }
    if (actualPrice === null) {
      actualTotalValid = false
    }
    else if (actualTotalValid) {
      actualTotal += actualPrice * BigInt(quantity)
    }
    if (line.lineType === 'CATALOG') {
      if (line.standardUnitPriceAmount === null) {
        missingStandardPriceCount += 1
        continue
      }
      const standardPrice = amountUnits(line.standardUnitPriceAmount)
      if (standardPrice === null) {
        standardTotalValid = false
      }
      else if (standardTotalValid) {
        standardTotal += standardPrice * BigInt(quantity)
      }
    }
  }
  return {
    standardTotal: standardTotalValid
      ? formatAmountUnits(standardTotal, precision)
      : null,
    actualTotal: actualTotalValid
      ? formatAmountUnits(actualTotal, precision)
      : null,
    missingStandardPriceCount,
  }
}
