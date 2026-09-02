import type { OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type {
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

export function calculateAmountDifference(
  nextValue: string | null,
  previousValue: string | null,
  precision: number,
): string | null {
  if (nextValue === null || previousValue === null) {
    return null
  }
  const nextUnits = amountUnits(nextValue)
  const previousUnits = amountUnits(previousValue)
  return nextUnits === null || previousUnits === null
    ? null
    : formatAmountUnits(nextUnits - previousUnits, precision)
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

function editableAmount(value: string): string {
  return value.includes('.')
    ? value.replace(/0+$/u, '').replace(/\.$/u, '')
    : value
}

function standardTotalUnits(lines: readonly OrderProductLineModel[]): bigint | null {
  let total = 0n
  for (const line of lines) {
    const quantity = normalizeQuantity(line.quantity)
    if (quantity === null) {
      return null
    }
    if (line.standardUnitPriceAmount === null) {
      continue
    }
    const price = amountUnits(line.standardUnitPriceAmount)
    if (price === null) {
      return null
    }
    total += price * BigInt(quantity)
  }
  return total
}

export function createSalesOrderProductEditLines(
  context: SalesOrderProductEditModalContext,
): readonly OrderProductLineModel[] {
  return context.existingLines.map(line => ({
    key: line.id,
    lineType: line.lineType,
    productId: line.productId,
    productNo: line.productNo,
    name: line.productName,
    description: line.description ?? '',
    standardUnitPriceAmount: line.standardUnitPriceAmount,
    actualUnitPriceAmount: editableAmount(line.actualUnitPriceAmount),
    quantity: String(line.quantity),
    mainImage: line.mainImage,
  }))
}

/**
 * 用服务端最新上下文刷新采购约束和产品身份，同时保留用户仍然合法的可编辑草稿。
 * 已删除的未采购行继续保持删除；如果刷新期间出现有效采购，则恢复该行，让最新
 * 采购事实重新进入删除锁和数量下限校验。
 */
export function reconcileSalesOrderProductEditLines(input: {
  readonly previousContext: SalesOrderProductEditModalContext
  readonly nextContext: SalesOrderProductEditModalContext
  readonly previousLines: readonly OrderProductLineModel[]
}): readonly OrderProductLineModel[] {
  const previousContextIds = new Set(input.previousContext.existingLines.map(line => line.id))
  const previousByKey = new Map(input.previousLines.map(line => [line.key, line]))
  const previousNewLines = input.previousLines.filter(line => !previousContextIds.has(line.key))
  const nextContextById = new Map(input.nextContext.existingLines.map(line => [line.id, line]))
  const reconciledExistingLines = createSalesOrderProductEditLines(input.nextContext)
    .flatMap((line) => {
      const previous = previousByKey.get(line.key)
      if (previous !== undefined) {
        return [{
          ...line,
          name: previous.name,
          description: previous.description,
          actualUnitPriceAmount: previous.actualUnitPriceAmount,
          quantity: previous.quantity,
        }]
      }
      const wasRemovedByUser = previousContextIds.has(line.key)
      const nowPurchased = (nextContextById.get(line.key)?.activePurchasedQuantity ?? 0) > 0
      return wasRemovedByUser && !nowPurchased ? [] : [line]
    })
  return [
    ...reconciledExistingLines,
    ...previousNewLines.map(line => ({ ...line })),
  ]
}

/**
 * 预览与服务端使用相同的四位定点计算。统一行数组既包含当前销售明细，也包含
 * 新增草稿；稳定销售行 ID 用于识别修改，缺少且未采购的既有行表示业务移除。
 */
export function calculateSalesOrderProductEditPreview(input: {
  readonly context: SalesOrderProductEditModalContext
  readonly lines: readonly OrderProductLineModel[]
  readonly precision: number
}): SalesOrderProductEditPreview | null {
  const contextById = new Map(input.context.existingLines.map(line => [line.id, line]))
  const draftByKey = new Map<string, OrderProductLineModel>()
  for (const line of input.lines) {
    if (draftByKey.has(line.key)) {
      return null
    }
    draftByKey.set(line.key, line)
  }

  let newSubtotalUnits = 0n
  let remainingQuantity = 0
  let increasedLineCount = 0
  let decreasedLineCount = 0
  let removedLineCount = 0
  for (const current of input.context.existingLines) {
    const draft = draftByKey.get(current.id)
    if (draft === undefined) {
      if (current.activePurchasedQuantity > 0) {
        return null
      }
      removedLineCount += 1
      continue
    }
    if (
      draft.lineType !== current.lineType
      || draft.productId !== current.productId
      || draft.productNo !== current.productNo
    ) {
      return null
    }
    const desiredQuantity = normalizeQuantity(draft.quantity)
    const price = normalizeAmount(draft.actualUnitPriceAmount, input.precision)
    const priceUnits = price === null ? null : amountUnits(price)
    if (
      desiredQuantity === null
      || desiredQuantity < current.activePurchasedQuantity
      || priceUnits === null
    ) {
      return null
    }
    newSubtotalUnits += priceUnits * BigInt(desiredQuantity)
    remainingQuantity += Math.max(desiredQuantity - current.activePurchasedQuantity, 0)
    if (desiredQuantity > current.quantity) {
      increasedLineCount += 1
    }
    else if (desiredQuantity < current.quantity) {
      decreasedLineCount += 1
    }
  }

  const newLines = input.lines.filter(line => !contextById.has(line.key))
  for (const line of newLines) {
    const quantity = normalizeQuantity(line.quantity)
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
  const paidUnits = amountUnits(input.context.amounts.paidAmount)
  if (
    oldSubtotalUnits === null
    || oldAgreedUnits === null
    || oldDepositUnits === null
    || paidUnits === null
  ) {
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
  const oldStandardUnits = standardTotalUnits(createSalesOrderProductEditLines(input.context))
  const newStandardUnits = standardTotalUnits(input.lines)
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
    standardAmountDelta: oldStandardUnits === null || newStandardUnits === null
      ? null
      : formatAmountUnits(newStandardUnits - oldStandardUnits, input.precision),
    standardSubtotalAmount: newStandardUnits === null
      ? null
      : formatAmountUnits(newStandardUnits, input.precision),
    lineSubtotalAmount: formatAmountUnits(newSubtotalUnits, input.precision),
    agreedTotalAmount: formatAmountUnits(newAgreedUnits, input.precision),
    depositDueAmount: formatAmountUnits(newDepositUnits, input.precision),
    balanceDueAmount: formatAmountUnits(newAgreedUnits - newDepositUnits, input.precision),
    paidAmount: formatAmountUnits(paidUnits, input.precision),
    outstandingAmount: formatAmountUnits(newAgreedUnits - paidUnits, input.precision),
    depositReductionAmount: formatAmountUnits(oldDepositUnits - newDepositUnits, input.precision),
    requiresDepositReduction: newDepositUnits < oldDepositUnits,
    addedLineCount: newLines.length,
    increasedLineCount,
    decreasedLineCount,
    removedLineCount,
    expectedFulfillmentStatus,
  }
}

export function buildSalesOrderProductEditIntent(input: {
  readonly context: SalesOrderProductEditModalContext
  readonly lines: readonly OrderProductLineModel[]
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

  const contextById = new Map(input.context.existingLines.map(line => [line.id, line]))
  const draftByKey = new Map<string, { readonly line: OrderProductLineModel, readonly index: number }>()
  for (const [index, line] of input.lines.entries()) {
    if (draftByKey.has(line.key)) {
      errors.lines = '产品明细已变化，请重新加载'
    }
    draftByKey.set(line.key, { line, index })
  }

  const existingLines: SalesOrderProductEditIntent['existingLines'][number][] = []
  for (const current of input.context.existingLines) {
    const draftEntry = draftByKey.get(current.id)
    if (draftEntry === undefined) {
      if (current.activePurchasedQuantity > 0) {
        errors.lines = '存在有效采购单的产品不能删除'
      }
      existingLines.push({
        lineId: current.id,
        name: current.productName,
        description: current.description,
        actualUnitPriceAmount: normalizeAmount(
          editableAmount(current.actualUnitPriceAmount),
          input.precision,
        ) ?? current.actualUnitPriceAmount,
        desiredQuantity: 0,
      })
      continue
    }
    const { line, index } = draftEntry
    if (
      line.lineType !== current.lineType
      || line.productId !== current.productId
      || line.productNo !== current.productNo
    ) {
      errors[`lines.${index}.productId`] = '既有产品身份不能直接修改，请删除后重新添加'
    }
    const name = normalizeText(line.name)
    const description = normalizeText(line.description)
    const price = normalizeAmount(line.actualUnitPriceAmount, input.precision)
    const desiredQuantity = normalizeQuantity(line.quantity)
    if (name === '') {
      errors[`lines.${index}.name`] = '请输入产品名称'
    }
    else if (codePointLength(name) > 128) {
      errors[`lines.${index}.name`] = '产品名称最多 128 个字符'
    }
    if (description !== '' && codePointLength(description) > 1000) {
      errors[`lines.${index}.description`] = '产品备注最多 1000 个字符'
    }
    if (price === null) {
      errors[`lines.${index}.actualUnitPriceAmount`] = '请输入有效的本单售价'
    }
    if (desiredQuantity === null) {
      errors[`lines.${index}.quantity`] = '产品数量必须是正整数'
    }
    else if (desiredQuantity < current.activePurchasedQuantity) {
      errors[`lines.${index}.quantity`] = `存在有效采购单，数量不能低于 ${current.activePurchasedQuantity}`
    }
    if (
      name !== ''
      && codePointLength(name) <= 128
      && codePointLength(description) <= 1000
      && price !== null
      && desiredQuantity !== null
    ) {
      existingLines.push({
        lineId: current.id,
        name,
        description: description === '' ? null : description,
        actualUnitPriceAmount: price,
        desiredQuantity,
      })
    }
  }

  const newLines: SalesOrderProductEditIntent['newLines'][number][] = []
  for (const [index, line] of input.lines.entries()) {
    if (contextById.has(line.key)) {
      continue
    }
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
    errors.preview = '请完成并修正产品明细'
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
