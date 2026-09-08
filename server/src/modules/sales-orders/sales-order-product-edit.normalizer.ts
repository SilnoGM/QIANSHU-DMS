import type {
  NormalizedSalesOrderCreateLine,
} from './sales-order-command.normalizer'
import { normalizeSalesOrderLines } from './sales-order-command.normalizer'
import {
  normalizeSalesOrderAmount,
} from './domain/sales-order-decimal'
import { salesOrderValidationFailure } from './domain/sales-order-errors'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface NormalizedSalesOrderExistingLineTarget {
  readonly lineId: string
  readonly name: string
  readonly description: string | null
  readonly actualUnitPriceAmount: string
  readonly desiredQuantity: number
}

const ACTUAL_UNIT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u

export interface NormalizedSalesOrderProductEditCommand {
  readonly expectedVersion: number
  readonly reason: string
  readonly confirmDepositReduction: boolean
  readonly existingLines: readonly NormalizedSalesOrderExistingLineTarget[]
  readonly newLines: readonly NormalizedSalesOrderCreateLine[]
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return salesOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  field: string,
): void {
  const expected = new Set(keys)
  if (Object.keys(value).some(key => !expected.has(key) && value[key] !== undefined)) {
    return salesOrderValidationFailure(field)
  }
}

function positiveVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    return salesOrderValidationFailure('expectedVersion')
  }
  return value as number
}

function reason(value: unknown): string {
  if (typeof value !== 'string') return salesOrderValidationFailure('reason')
  const normalized = value.trim().normalize('NFKC')
  if ([...normalized].length < 1 || [...normalized].length > 500) {
    return salesOrderValidationFailure('reason')
  }
  return normalized
}

function existingLines(value: unknown): readonly NormalizedSalesOrderExistingLineTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return salesOrderValidationFailure('existingLines')
  }
  const seen = new Set<string>()
  return Object.freeze(value.map((item, index) => {
    const field = `existingLines.${index}`
    const line = record(item, field)
    exactKeys(line, [
      'lineId',
      'name',
      'description',
      'actualUnitPriceAmount',
      'desiredQuantity',
    ], field)
    if (typeof line.lineId !== 'string' || !UUID_V4_PATTERN.test(line.lineId)) {
      return salesOrderValidationFailure(`${field}.lineId`)
    }
    if (seen.has(line.lineId)) {
      return salesOrderValidationFailure(`${field}.lineId`, '销售明细不能重复')
    }
    if (
      !Number.isInteger(line.desiredQuantity)
      || (line.desiredQuantity as number) < 0
      || (line.desiredQuantity as number) > 2_147_483_647
    ) {
      return salesOrderValidationFailure(`${field}.desiredQuantity`)
    }
    if (typeof line.name !== 'string') {
      return salesOrderValidationFailure(`${field}.name`)
    }
    const name = line.name.trim().normalize('NFKC')
    if ([...name].length < 1 || [...name].length > 128) {
      return salesOrderValidationFailure(`${field}.name`)
    }
    const description = line.description === null
      ? null
      : typeof line.description === 'string'
        ? line.description.trim().normalize('NFKC')
        : salesOrderValidationFailure(`${field}.description`)
    if (description !== null && ([...description].length < 1 || [...description].length > 1000)) {
      return salesOrderValidationFailure(`${field}.description`)
    }
    if (
      typeof line.actualUnitPriceAmount !== 'string'
      || !ACTUAL_UNIT_PRICE_PATTERN.test(line.actualUnitPriceAmount)
    ) {
      return salesOrderValidationFailure(`${field}.actualUnitPriceAmount`)
    }
    seen.add(line.lineId)
    return Object.freeze({
      lineId: line.lineId,
      name,
      description,
      actualUnitPriceAmount: normalizeSalesOrderAmount(line.actualUnitPriceAmount),
      desiredQuantity: line.desiredQuantity as number,
    })
  }))
}

/**
 * 产品修改命令只规范化用户意图；金额、采购锁定和最终有效行数全部在事务内计算。
 * `existingLines` 必须非空且唯一，避免把请求遗漏误解为删除。
 */
export function normalizeSalesOrderProductEditCommand(
  input: unknown,
): NormalizedSalesOrderProductEditCommand {
  const body = record(input, 'body')
  exactKeys(body, [
    'expectedVersion',
    'reason',
    'confirmDepositReduction',
    'existingLines',
    'newLines',
  ], 'body')
  if (typeof body.confirmDepositReduction !== 'boolean') {
    return salesOrderValidationFailure('confirmDepositReduction')
  }
  if (!Array.isArray(body.newLines) || body.newLines.length > 100) {
    return salesOrderValidationFailure('newLines')
  }
  return Object.freeze({
    expectedVersion: positiveVersion(body.expectedVersion),
    reason: reason(body.reason),
    confirmDepositReduction: body.confirmDepositReduction,
    existingLines: existingLines(body.existingLines),
    newLines: body.newLines.length === 0
      ? Object.freeze([])
      : normalizeSalesOrderLines(body.newLines),
  })
}
