import { salesOrderValidationFailure } from './domain/sales-order-errors'

const UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u

export interface NormalizedSalesOrderCustomerInput {
  readonly name: string
  readonly phone: string
  readonly fbName: string | null
  readonly lineName: string | null
  readonly countryRegionId: string
  readonly provinceStateId: string
  readonly cityId: string
  readonly addressDetail: string
}

export interface NormalizedSalesOrderInfoUpdateCommand {
  readonly expectedVersion: number
  readonly reason: string
  readonly orderDate: string
  readonly remark: string | null
  readonly customer: NormalizedSalesOrderCustomerInput
}

function requireRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return salesOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function requireVersion(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    return salesOrderValidationFailure('expectedVersion')
  }
  return value
}

function requireReason(value: unknown): string {
  if (typeof value !== 'string') {
    return salesOrderValidationFailure('reason')
  }
  const normalized = value.trim().normalize('NFKC')
  const length = [...normalized].length
  if (length < 1 || length > 500) {
    return salesOrderValidationFailure('reason')
  }
  return normalized
}

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') {
    return salesOrderValidationFailure(field)
  }
  const normalized = value.trim().normalize('NFKC')
  const length = [...normalized].length
  if (length < 1 || length > maximum) {
    return salesOrderValidationFailure(field)
  }
  return normalized
}

/** 选填字段：缺省、null、纯空白都视为未填写。 */
function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string') {
    return salesOrderValidationFailure(field)
  }
  const normalized = value.trim().normalize('NFKC')
  if (normalized.length === 0) {
    return null
  }
  if ([...normalized].length > maximum) {
    return salesOrderValidationFailure(field)
  }
  return normalized
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return salesOrderValidationFailure(field)
  }
  return value
}

function requireOrderDate(value: unknown, businessToday: string): string {
  if (typeof value !== 'string') {
    return salesOrderValidationFailure('orderDate')
  }
  const parts = value.match(ISO_DATE_PATTERN)
  const todayParts = businessToday.match(ISO_DATE_PATTERN)
  if (parts === null || todayParts === null || value > businessToday) {
    return salesOrderValidationFailure('orderDate', '必须是今天或历史日期')
  }
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return salesOrderValidationFailure('orderDate')
  }
  return value
}

function normalizeCustomer(value: unknown): NormalizedSalesOrderCustomerInput {
  const customer = requireRecord(value, 'customer')
  return {
    name: requireText(customer.name, 'customer.name', 24),
    phone: requireText(customer.phone, 'customer.phone', 64),
    fbName: optionalText(customer.fbName, 'customer.fbName', 128),
    lineName: optionalText(customer.lineName, 'customer.lineName', 128),
    countryRegionId: requireUuid(customer.countryRegionId, 'customer.countryRegionId'),
    provinceStateId: requireUuid(customer.provinceStateId, 'customer.provinceStateId'),
    cityId: requireUuid(customer.cityId, 'customer.cityId'),
    addressDetail: requireText(customer.addressDetail, 'customer.addressDetail', 1000),
  }
}

/**
 * 备注必须显式出现，显式 `null` 才表示清空；缺省字段会被拒绝，
 * 避免“没传”被误判成“清空”。
 */
export function normalizeSalesOrderInfoUpdateCommand(
  input: unknown,
  businessToday: string,
): NormalizedSalesOrderInfoUpdateCommand {
  const body = requireRecord(input, 'body')
  if (!Object.hasOwn(body, 'remark')) {
    return salesOrderValidationFailure('remark')
  }
  const remark = body.remark === null
    ? null
    : requireText(body.remark, 'remark', 1000)
  return {
    expectedVersion: requireVersion(body.expectedVersion),
    reason: requireReason(body.reason),
    orderDate: requireOrderDate(body.orderDate, businessToday),
    remark,
    customer: normalizeCustomer(body.customer),
  }
}
