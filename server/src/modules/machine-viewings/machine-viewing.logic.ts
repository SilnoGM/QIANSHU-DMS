import { createHash } from 'node:crypto'

import {
  MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH,
  MACHINE_VIEWING_HOUR_MAX,
  MACHINE_VIEWING_HOUR_MIN,
  MACHINE_VIEWING_MACHINE_TYPE_VALUES,
  MACHINE_VIEWING_PERIOD_VALUES,
  MACHINE_VIEWING_SITE_VALUES,
  type MachineViewingMachineTypeValue,
  type MachineViewingPeriodValue,
  type MachineViewingSiteValue,
} from './machine-viewing.contract'

const REQUEST_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

/** 入参校验失败统一抛这个类型，服务层翻译成 422，避免把 RangeError 当 500。 */
export class MachineViewingValidationError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'MachineViewingValidationError'
  }
}

export interface ShanghaiCalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

export interface MachineViewingCreateInput {
  readonly site: string
  readonly machineType: string
  readonly appointmentMonth: number
  readonly appointmentDay: number
  readonly period: string
  readonly hour?: number
  readonly customerName: string
  readonly customerPhone?: string
  readonly contactPerson: string
}

export interface NormalizedMachineViewingCreate {
  readonly site: MachineViewingSiteValue
  readonly machineType: MachineViewingMachineTypeValue
  readonly appointmentDate: Date
  readonly period: MachineViewingPeriodValue
  readonly hour: number | null
  readonly customerName: string
  readonly customerPhone: string | null
  readonly contactPerson: string
}

/** 服务端时钟只在这里读取一次，年份推断与列表归属都以业务时区为准。 */
export function shanghaiCalendarDate(now: Date): ShanghaiCalendarDate {
  if (!Number.isFinite(now.getTime())) {
    throw new MachineViewingValidationError('创建时间无效')
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(now)
  const pick = (type: string): number => {
    const value = parts.find(part => part.type === type)?.value
    return Number(value)
  }
  const result = { year: pick('year'), month: pick('month'), day: pick('day') }
  if (!Number.isSafeInteger(result.year) || !Number.isSafeInteger(result.month) || !Number.isSafeInteger(result.day)) {
    throw new MachineViewingValidationError('创建时间无效')
  }
  return result
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 需求不选年份：取上海当前年；若「月/日」早于今天则顺延到下一年。
 *
 * 只按自然日比较，不比较时段与小时——今天上午已经过去时，用户仍是在登记「今天」，
 * 自动跳到明年会明显违背预期。顺延后的年份负责校验 2 月 29 日这类闰年边界。
 */
export function resolveMachineViewingDate(month: number, day: number, now: Date): Date {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new MachineViewingValidationError('预约月份无效')
  }
  if (!Number.isSafeInteger(day) || day < 1 || day > 31) {
    throw new MachineViewingValidationError('预约日期无效')
  }
  const today = shanghaiCalendarDate(now)
  const year = month * 100 + day < today.month * 100 + today.day ? today.year + 1 : today.year
  if (day > daysInMonth(year, month)) {
    throw new MachineViewingValidationError(`${month} 月没有 ${day} 日，请重新选择预约时间`)
  }
  return new Date(Date.UTC(year, month - 1, day))
}

/** 必填文本去掉首尾空白后必须非空，长度按 Unicode 码点收敛。 */
export function normalizeMachineViewingText(value: string, maxLength: number, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new MachineViewingValidationError(`${label}不能为空`)
  }
  if ([...normalized].length > maxLength) {
    throw new MachineViewingValidationError(`${label}不能超过 ${maxLength} 个字符`)
  }
  return normalized
}

/** 选填电话：纯空白视为未填写，避免空字符串与 NULL 两种形态并存。 */
export function normalizeMachineViewingOptionalText(value: string | null | undefined, maxLength: number, label: string): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }
  if ([...normalized].length > maxLength) {
    throw new MachineViewingValidationError(`${label}不能超过 ${maxLength} 个字符`)
  }
  return normalized
}

export function normalizeMachineViewingCreate(input: MachineViewingCreateInput, now: Date): NormalizedMachineViewingCreate {
  if (!(MACHINE_VIEWING_SITE_VALUES as readonly string[]).includes(input.site)) {
    throw new MachineViewingValidationError('看机地点无效')
  }
  if (!(MACHINE_VIEWING_MACHINE_TYPE_VALUES as readonly string[]).includes(input.machineType)) {
    throw new MachineViewingValidationError('看机机型无效')
  }
  if (!(MACHINE_VIEWING_PERIOD_VALUES as readonly string[]).includes(input.period)) {
    throw new MachineViewingValidationError('预约时段无效')
  }
  if (input.hour !== undefined
    && (!Number.isSafeInteger(input.hour) || input.hour < MACHINE_VIEWING_HOUR_MIN || input.hour > MACHINE_VIEWING_HOUR_MAX)) {
    throw new MachineViewingValidationError(`预约小时必须在 ${MACHINE_VIEWING_HOUR_MIN}–${MACHINE_VIEWING_HOUR_MAX} 之间`)
  }
  return {
    site: input.site as MachineViewingSiteValue,
    machineType: input.machineType as MachineViewingMachineTypeValue,
    appointmentDate: resolveMachineViewingDate(input.appointmentMonth, input.appointmentDay, now),
    period: input.period as MachineViewingPeriodValue,
    hour: input.hour ?? null,
    customerName: normalizeMachineViewingText(input.customerName, MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH, '客户姓名'),
    customerPhone: normalizeMachineViewingOptionalText(input.customerPhone, MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH, '客户电话'),
    contactPerson: normalizeMachineViewingText(input.contactPerson, MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH, '业务对接人'),
  }
}

export function requireMachineViewingRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_KEY_PATTERN.test(value)) {
    throw new MachineViewingValidationError('缺少或非法的 Idempotency-Key 请求头')
  }
  return value.toLowerCase()
}

export function hashMachineViewingRequestKey(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32)
  bytes.set(createHash('sha256').update(value).digest())
  return bytes
}

/**
 * 编号指纹绑定全部不可变登记内容：同一幂等键改了任何字段都必须冲突，
 * 不能复用旧单号登记一条内容不同的预约。
 */
export function hashMachineViewingNumberFingerprint(input: {
  readonly actorUserId: string
  readonly site: string
  readonly machineType: string
  readonly appointmentDate: string
  readonly period: string
  readonly hour: number | null
  readonly customerName: string
  readonly customerPhone: string | null
  readonly contactPerson: string
  readonly requestKey: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    format: 'machine-viewing.create.v1',
    actorUserId: input.actorUserId,
    site: input.site,
    machineType: input.machineType,
    appointmentDate: input.appointmentDate,
    period: input.period,
    hour: input.hour,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    contactPerson: input.contactPerson,
    requestKey: input.requestKey,
  })).digest('hex')
}

/** 幂等重放必须比对全部不可变字段；同一把钥匙提交不同内容要明确冲突。 */
export function sameMachineViewingPayload(
  previous: {
    readonly site: string
    readonly machineType: string
    readonly appointmentDate: Date
    readonly period: string
    readonly hour: number | null
    readonly customerName: string
    readonly customerPhone: string | null
    readonly contactPerson: string
  },
  next: NormalizedMachineViewingCreate,
): boolean {
  return previous.site === next.site
    && previous.machineType === next.machineType
    && previous.appointmentDate.toISOString().slice(0, 10) === next.appointmentDate.toISOString().slice(0, 10)
    && previous.period === next.period
    && previous.hour === next.hour
    && previous.customerName === next.customerName
    && previous.customerPhone === next.customerPhone
    && previous.contactPerson === next.contactPerson
}

/** 日期列按 UTC 零点读写，序列化只取日期部分，避免浏览器时区把日期退一天。 */
export function formatMachineViewingDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
