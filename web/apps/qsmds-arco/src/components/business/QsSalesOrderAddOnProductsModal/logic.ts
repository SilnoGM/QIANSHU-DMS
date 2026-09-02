import type { OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type {
  SalesOrderAddOnFieldErrors,
  SalesOrderAddOnIntent,
  SalesOrderAddOnModalContext,
  SalesOrderAddOnPreview,
} from './types'

import { validateMoneyString } from '../../base/MoneyInput/logic'

const AMOUNT_SCALE = 10_000n
const MAXIMUM_QUANTITY = 2_147_483_647
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type BuildSalesOrderAddOnIntentResult
  = | {
    readonly valid: true
    readonly intent: SalesOrderAddOnIntent
  }
  | {
    readonly valid: false
    readonly fieldErrors: SalesOrderAddOnFieldErrors
  }

function codePointLength(value: string): number {
  return [...value].length
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFKC')
}

function amountUnits(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/u.exec(value)
  if (match === null) {
    return null
  }
  return BigInt(match[1]!) * AMOUNT_SCALE
    + BigInt((match[2] ?? '').padEnd(4, '0'))
}

function formatAmountUnits(value: bigint, precision: number): string {
  const integerPart = value / AMOUNT_SCALE
  if (precision === 0) {
    return integerPart.toString()
  }
  const fractionPart = (value % AMOUNT_SCALE).toString().padStart(4, '0')
  return `${integerPart}.${fractionPart.slice(0, precision)}`
}

function addAmount(value: string, delta: bigint, precision: number): string | null {
  const units = amountUnits(value)
  return units === null ? null : formatAmountUnits(units + delta, precision)
}

function normalizeQuantity(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) {
    return null
  }
  const quantity = Number(value)
  return Number.isSafeInteger(quantity) && quantity <= MAXIMUM_QUANTITY
    ? quantity
    : null
}

function normalizeAmount(value: string | null, precision: number): string | null {
  if (value === null || value === '') {
    return null
  }
  const result = validateMoneyString(value, { min: '0', precision })
  return result.valid ? result.normalizedValue : null
}

/**
 * 金额预览只读取本次新增行。原销售产品永远不进入 editable lines，避免在预览中
 * 被二次累计；所有金额用四位定点单位相加，禁止使用浮点数模拟服务端结果。
 */
export function calculateSalesOrderAddOnPreview(
  context: SalesOrderAddOnModalContext,
  lines: readonly OrderProductLineModel[],
  precision: number,
): SalesOrderAddOnPreview | null {
  let delta = 0n
  for (const line of lines) {
    const quantity = normalizeQuantity(line.quantity)
    const price = normalizeAmount(line.actualUnitPriceAmount, precision)
    const priceUnits = price === null ? null : amountUnits(price)
    if (quantity === null || priceUnits === null) {
      return null
    }
    delta += priceUnits * BigInt(quantity)
  }

  const lineSubtotalAmount = addAmount(context.amounts.lineSubtotalAmount, delta, precision)
  const agreedTotalAmount = addAmount(context.amounts.agreedTotalAmount, delta, precision)
  const balanceDueAmount = addAmount(context.amounts.balanceDueAmount, delta, precision)
  const depositUnits = amountUnits(context.amounts.depositDueAmount)
  if (
    lineSubtotalAmount === null
    || agreedTotalAmount === null
    || balanceDueAmount === null
    || depositUnits === null
  ) {
    return null
  }
  return {
    amountDelta: formatAmountUnits(delta, precision),
    lineSubtotalAmount,
    agreedTotalAmount,
    depositDueAmount: formatAmountUnits(depositUnits, precision),
    balanceDueAmount,
  }
}

export function buildSalesOrderAddOnIntent(input: {
  readonly context: SalesOrderAddOnModalContext
  readonly lines: readonly OrderProductLineModel[]
  readonly precision: number
  readonly reason: string
}): BuildSalesOrderAddOnIntentResult {
  const errors: Record<string, string> = {}
  const reason = normalizeText(input.reason)
  if (reason === '') {
    errors.reason = '请填写加购原因'
  }
  else if (codePointLength(reason) > 500) {
    errors.reason = '加购原因最多 500 个字符'
  }

  if (input.context.availableLineCapacity <= 0) {
    errors.lines = '销售订单产品明细已达上限'
  }
  else if (input.lines.length === 0) {
    errors.lines = '请至少新增一行产品'
  }
  else if (input.lines.length > input.context.availableLineCapacity) {
    errors.lines = `本次最多可新增 ${input.context.availableLineCapacity} 行产品`
  }

  const normalizedLines: SalesOrderAddOnIntent['lines'][number][] = []
  for (const [index, line] of input.lines.entries()) {
    const field = `lines.${index}`
    const quantity = normalizeQuantity(line.quantity)
    const price = normalizeAmount(line.actualUnitPriceAmount, input.precision)
    if (quantity === null) {
      errors[`${field}.quantity`] = '产品数量必须是正整数'
    }
    if (price === null) {
      errors[`${field}.actualUnitPriceAmount`] = '请输入有效的本单售价'
    }

    if (line.lineType === 'CATALOG') {
      if (line.productId === null || !UUID_PATTERN.test(line.productId)) {
        errors[`${field}.productId`] = '请选择数据库产品'
      }
      if (line.productId !== null && UUID_PATTERN.test(line.productId) && price !== null && quantity !== null) {
        normalizedLines.push({
          lineType: 'CATALOG',
          productId: line.productId,
          actualUnitPriceAmount: price,
          quantity,
        })
      }
      continue
    }

    const name = normalizeText(line.name)
    const description = normalizeText(line.description)
    if (name === '') {
      errors[`${field}.name`] = '请输入临时产品名称'
    }
    else if (codePointLength(name) > 128) {
      errors[`${field}.name`] = '临时产品名称最多 128 个字符'
    }
    if (description !== '' && codePointLength(description) > 1000) {
      errors[`${field}.description`] = '临时产品说明最多 1000 个字符'
    }
    if (
      name !== ''
      && codePointLength(name) <= 128
      && codePointLength(description) <= 1000
      && price !== null
      && quantity !== null
    ) {
      normalizedLines.push({
        lineType: 'CUSTOM',
        name,
        description: description === '' ? null : description,
        actualUnitPriceAmount: price,
        quantity,
      })
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, fieldErrors: errors }
  }
  return {
    valid: true,
    intent: {
      expectedVersion: input.context.salesOrder.version,
      reason,
      lines: normalizedLines,
    },
  }
}
