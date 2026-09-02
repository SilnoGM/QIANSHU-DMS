import type { OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type {
  ExistingSalesOrderLineDraft,
  SalesOrderProductEditFieldErrors,
  SalesOrderProductEditIntent,
  SalesOrderProductEditModalContext,
  SalesOrderProductEditPreview,
} from './types'

import { validateMoneyString } from '../../base/MoneyInput/logic'

const AMOUNT_SCALE = 10_000n
const MAXIMUM_QUANTITY = 2_147_483_647
const MAXIMUM_LINES = 100
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type BuildSalesOrderProductEditIntentResult
  = | {
    readonly valid: true
    readonly intent: SalesOrderProductEditIntent
    readonly preview: SalesOrderProductEditPreview
  }
  | {
    readonly valid: false
    readonly fieldErrors: SalesOrderProductEditFieldErrors
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
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const integerPart = absolute / AMOUNT_SCALE
  if (precision === 0) {
    return `${sign}${integerPart}`
  }
  const fractionPart = (absolute % AMOUNT_SCALE).toString().padStart(4, '0')
  return `${sign}${integerPart}.${fractionPart.slice(0, precision)}`
}

function normalizeExistingQuantity(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    return null
  }
  const quantity = Number(value)
  return Number.isSafeInteger(quantity) && quantity <= MAXIMUM_QUANTITY
    ? quantity
    : null
}

function normalizeNewQuantity(value: string): number | null {
  const quantity = normalizeExistingQuantity(value)
  return quantity !== null && quantity > 0 ? quantity : null
}

function normalizeAmount(value: string | null, precision: number): string | null {
  if (value === null || value === '') {
    return null
  }
  const result = validateMoneyString(value, { min: '0', precision })
  return result.valid ? result.normalizedValue : null
}

export function createExistingSalesOrderLineDrafts(
  context: SalesOrderProductEditModalContext,
): readonly ExistingSalesOrderLineDraft[] {
  return context.existingLines.map(line => ({
    lineId: line.id,
    originalQuantity: line.quantity,
    desiredQuantity: String(line.quantity),
    minimumQuantity: line.canDecrease ? 0 : line.quantity,
  }))
}

/**
 * 预览与服务端使用相同的四位定点计算。这里只提供提交前解释，不把任何汇总金额
 * 发送给服务端；最终金额、采购覆盖和履约状态仍由事务内业务事实决定。
 */
export function calculateSalesOrderProductEditPreview(input: {
  readonly context: SalesOrderProductEditModalContext
  readonly existingLineDrafts: readonly ExistingSalesOrderLineDraft[]
  readonly newLines: readonly OrderProductLineModel[]
  readonly precision: number
}): SalesOrderProductEditPreview | null {
  const draftById = new Map(input.existingLineDrafts.map(draft => [draft.lineId, draft]))
  if (draftById.size !== input.context.existingLines.length) {
    return null
  }

  let newSubtotalUnits = 0n
  let remainingQuantity = 0
  let increasedLineCount = 0
  let decreasedLineCount = 0
  let removedLineCount = 0
  for (const line of input.context.existingLines) {
    const draft = draftById.get(line.id)
    const desired = draft === undefined
      ? null
      : normalizeExistingQuantity(draft.desiredQuantity)
    const priceUnits = amountUnits(line.actualUnitPriceAmount)
    if (
      draft === undefined
      || draft.originalQuantity !== line.quantity
      || draft.minimumQuantity !== (line.canDecrease ? 0 : line.quantity)
      || desired === null
      || desired < draft.minimumQuantity
      || priceUnits === null
    ) {
      return null
    }

    newSubtotalUnits += priceUnits * BigInt(desired)
    remainingQuantity += Math.max(desired - line.activePurchasedQuantity, 0)
    if (desired > line.quantity) {
      increasedLineCount += 1
    }
    else if (desired === 0 && line.quantity > 0) {
      removedLineCount += 1
    }
    else if (desired < line.quantity) {
      decreasedLineCount += 1
    }
  }

  for (const line of input.newLines) {
    const quantity = normalizeNewQuantity(line.quantity)
    const amount = normalizeAmount(line.actualUnitPriceAmount, input.precision)
    const priceUnits = amount === null ? null : amountUnits(amount)
    if (quantity === null || priceUnits === null) {
      return null
    }
    newSubtotalUnits += priceUnits * BigInt(quantity)
    remainingQuantity += quantity
  }

  const oldSubtotalUnits = amountUnits(input.context.amounts.lineSubtotalAmount)
  const oldAgreedUnits = amountUnits(input.context.amounts.agreedTotalAmount)
  const oldDepositUnits = amountUnits(input.context.amounts.depositDueAmount)
  if (oldSubtotalUnits === null || oldAgreedUnits === null || oldDepositUnits === null) {
    return null
  }
  const amountDeltaUnits = newSubtotalUnits - oldSubtotalUnits
  const newAgreedUnits = oldAgreedUnits + amountDeltaUnits
  if (newAgreedUnits < 0n) {
    return null
  }
  const newDepositUnits = oldDepositUnits > newAgreedUnits
    ? newAgreedUnits
    : oldDepositUnits
  const activePurchasedQuantity = input.context.existingLines.reduce(
    (sum, line) => sum + line.activePurchasedQuantity,
    0,
  )
  const expectedFulfillmentStatus = remainingQuantity > 0
    ? 'PENDING'
    : input.context.salesOrder.fulfillmentStatus === 'PENDING' && activePurchasedQuantity > 0
      ? 'PREPARING'
      : input.context.salesOrder.fulfillmentStatus

  return {
    amountDelta: formatAmountUnits(amountDeltaUnits, input.precision),
    lineSubtotalAmount: formatAmountUnits(newSubtotalUnits, input.precision),
    agreedTotalAmount: formatAmountUnits(newAgreedUnits, input.precision),
    depositDueAmount: formatAmountUnits(newDepositUnits, input.precision),
    balanceDueAmount: formatAmountUnits(newAgreedUnits - newDepositUnits, input.precision),
    depositReductionAmount: formatAmountUnits(
      oldDepositUnits - newDepositUnits,
      input.precision,
    ),
    requiresDepositReduction: newDepositUnits < oldDepositUnits,
    addedLineCount: input.newLines.length,
    increasedLineCount,
    decreasedLineCount,
    removedLineCount,
    expectedFulfillmentStatus,
  }
}

export function buildSalesOrderProductEditIntent(input: {
  readonly context: SalesOrderProductEditModalContext
  readonly existingLineDrafts: readonly ExistingSalesOrderLineDraft[]
  readonly newLines: readonly OrderProductLineModel[]
  readonly precision: number
  readonly reason: string
  readonly confirmDepositReduction: boolean
}): BuildSalesOrderProductEditIntentResult {
  const errors: Record<string, string> = {}
  const reason = normalizeText(input.reason)
  if (reason === '') {
    errors.reason = '请填写产品修改原因'
  }
  else if (codePointLength(reason) > 500) {
    errors.reason = '产品修改原因最多 500 个字符'
  }

  const contextLineById = new Map(input.context.existingLines.map(line => [line.id, line]))
  const seenIds = new Set<string>()
  const existingLines: SalesOrderProductEditIntent['existingLines'][number][] = []
  for (const [index, draft] of input.existingLineDrafts.entries()) {
    const field = `existingLines.${index}.desiredQuantity`
    const line = contextLineById.get(draft.lineId)
    const desiredQuantity = normalizeExistingQuantity(draft.desiredQuantity)
    if (line === undefined || seenIds.has(draft.lineId)) {
      errors[field] = '产品明细已变化，请重新加载'
      continue
    }
    seenIds.add(draft.lineId)
    const minimumQuantity = line.canDecrease ? 0 : line.quantity
    if (draft.originalQuantity !== line.quantity || draft.minimumQuantity !== minimumQuantity) {
      errors[field] = '产品采购约束已变化，请重新加载'
    }
    else if (desiredQuantity === null) {
      errors[field] = '目标数量必须是非负整数'
    }
    else if (desiredQuantity < minimumQuantity) {
      errors[field] = `存在有效采购单，数量不能低于 ${minimumQuantity}`
    }
    else {
      existingLines.push({ lineId: line.id, desiredQuantity })
    }
  }
  if (seenIds.size !== input.context.existingLines.length) {
    errors.existingLines = '产品明细已变化，请重新加载'
  }

  const newLines: SalesOrderProductEditIntent['newLines'][number][] = []
  for (const [index, line] of input.newLines.entries()) {
    const field = `newLines.${index}`
    const quantity = normalizeNewQuantity(line.quantity)
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
        newLines.push({
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
    if (name !== '' && codePointLength(name) <= 128 && codePointLength(description) <= 1000 && price !== null && quantity !== null) {
      newLines.push({
        lineType: 'CUSTOM',
        name,
        description: description === '' ? null : description,
        actualUnitPriceAmount: price,
        quantity,
      })
    }
  }

  const desiredActiveCount = existingLines.filter(line => line.desiredQuantity > 0).length
    + newLines.length
  if (desiredActiveCount < 1) {
    errors.lines = '销售订单必须至少保留一行产品'
  }
  else if (desiredActiveCount > MAXIMUM_LINES) {
    errors.lines = '销售订单产品明细不能超过 100 行'
  }

  const preview = calculateSalesOrderProductEditPreview(input)
  if (preview === null) {
    errors.preview = '请完成并修正产品数量与售价'
  }
  if (Object.keys(errors).length > 0 || preview === null) {
    return { valid: false, fieldErrors: errors }
  }
  if (input.confirmDepositReduction !== preview.requiresDepositReduction) {
    return {
      valid: false,
      fieldErrors: { confirmation: '定金调整确认状态已变化，请重新核对' },
    }
  }
  return {
    valid: true,
    preview,
    intent: {
      expectedVersion: input.context.salesOrder.version,
      reason,
      confirmDepositReduction: input.confirmDepositReduction,
      existingLines,
      newLines,
    },
  }
}
