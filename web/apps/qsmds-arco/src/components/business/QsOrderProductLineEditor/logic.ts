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
  initialActualUnitPriceAmount: string | null = '0.00',
): OrderProductLineModel {
  return {
    key,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    name: '',
    description: '',
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: initialActualUnitPriceAmount,
    quantity: '1',
    mainImage: null,
  }
}

export type MatchingCustomUnitPriceValidation
  = | { readonly ok: true }
    | {
      readonly ok: false
      readonly code: 'INVALID' | 'MISMATCH' | 'REQUIRED'
    }

/**
 * 采购等领域可以要求临时产品的参考价与实际价分别录入且数值相等。
 * 比较统一换算为四位定点单位，因此 `12.50` 与 `12.5000` 视为同一金额。
 */
export function validateMatchingCustomUnitPrices(
  line: OrderProductLineModel,
): MatchingCustomUnitPriceValidation {
  if (
    line.lineType !== 'CUSTOM'
    || line.standardUnitPriceAmount === null
    || line.actualUnitPriceAmount === null
    || line.standardUnitPriceAmount === ''
    || line.actualUnitPriceAmount === ''
  ) {
    return { ok: false, code: 'REQUIRED' }
  }
  const referenceUnits = amountUnits(line.standardUnitPriceAmount)
  const actualUnits = amountUnits(line.actualUnitPriceAmount)
  if (referenceUnits === null || actualUnits === null) {
    return { ok: false, code: 'INVALID' }
  }
  return referenceUnits === actualUnits
    ? { ok: true }
    : { ok: false, code: 'MISMATCH' }
}

/**
 * 先在副本上验证并应用完整变更集；任何陈旧行、重复产品或数量上限都会让整批
 * 失败，父级因此不会观察到部分写入。
 */
export function applyProductSelectionChanges(
  source: readonly OrderProductLineModel[],
  changes: readonly ProductSelectionChange[],
  maximumLines = 100,
  initialActualUnitPriceAmount: string | null = '0.00',
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
      // 本单价格属于订单录入值，不继承产品档案参考价；由用户基于当前订单重新确认。
      actualUnitPriceAmount: initialActualUnitPriceAmount,
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
    // 标准价缺失是允许的业务状态；两种汇总必须独立计算，避免一个无标准价产品
    // 把其他产品可信的标准价汇总一起清空。
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
    // 采购场景允许 CUSTOM 行手工录入采购定价；只要存在明确价格就应与数据库
    // 产品一样参与汇总。CUSTOM 空价仍保持“未提供参考价”语义，不伪造价格，也
    // 不计入仅面向数据库产品档案的缺价数量。
    if (line.standardUnitPriceAmount === null) {
      if (line.lineType === 'CATALOG') {
        missingStandardPriceCount += 1
      }
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
