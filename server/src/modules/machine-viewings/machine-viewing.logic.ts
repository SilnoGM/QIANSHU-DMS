import { createHash } from 'node:crypto'

import {
  MACHINE_VIEWING_CANCEL_REASON_MAX_LENGTH,
  MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH,
  MACHINE_VIEWING_FEEDBACK_MAX_LENGTH,
  MACHINE_VIEWING_HOUR_MAX,
  MACHINE_VIEWING_HOUR_MIN,
  MACHINE_VIEWING_MACHINE_TYPE_VALUES,
  MACHINE_VIEWING_PERIOD_VALUES,
  MACHINE_VIEWING_SITE_VALUES,
  MACHINE_VIEWING_TRANSITION_TARGET_VALUES,
  type MachineViewingMachineTypeValue,
  type MachineViewingPeriodValue,
  type MachineViewingSiteValue,
  type MachineViewingStatusValue,
  type MachineViewingTransitionTargetValue,
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

export interface MachineViewingUpdateInput {
  readonly site: string
  readonly machineType: string
  readonly appointmentDate: string
  readonly period: string
  readonly hour?: number
  readonly customerName: string
  readonly customerPhone?: string
  readonly contactPerson: string
}

export interface MachineViewingStatusTransitionInput {
  readonly status: string
  readonly feedback?: string
  readonly cancelReason?: string
}

export interface NormalizedMachineViewingStatusTransition {
  readonly status: MachineViewingTransitionTargetValue
  readonly feedback: string | null
  readonly cancelReason: string | null
}

export type MachineViewingTransitionAction = 'NOOP' | 'INVALID' | 'TRANSITION' | 'FEEDBACK_EDIT'

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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/**
 * 解析并校验 `YYYY-MM-DD`。
 *
 * 列表筛选与编辑都走这里：只靠正则会把 2 月 31 日放进查询，最终由 PostgreSQL
 * 抛驱动错误变成 500，因此必须在进入查询前按真实日历日拒掉。
 */
export function parseMachineViewingDateOnly(value: string, label: string): Date {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new MachineViewingValidationError(`${label}必须是 YYYY-MM-DD 格式`)
  }
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isSafeInteger(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new MachineViewingValidationError(`${label}不是有效日期`)
  }
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * 编辑时的日期口径与新建不同：编辑必须保留原年份，不能被「月/日早于今天就顺延」
 * 二次改写；同时不允许把预约改到今年之前或两年以后，保持与新建一致的可选范围。
 */
export function normalizeMachineViewingUpdateDate(value: string, now: Date): Date {
  const date = parseMachineViewingDateOnly(value, '预约日期')
  const today = shanghaiCalendarDate(now)
  if (date.getUTCFullYear() !== today.year && date.getUTCFullYear() !== today.year + 1) {
    throw new MachineViewingValidationError('预约日期只能选择今年或明年')
  }
  if (date.getTime() < Date.UTC(today.year, today.month - 1, today.day)) {
    throw new MachineViewingValidationError('预约日期不能早于今天')
  }
  return date
}

export function normalizeMachineViewingUpdate(input: MachineViewingUpdateInput, now: Date): NormalizedMachineViewingCreate {
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
    appointmentDate: normalizeMachineViewingUpdateDate(input.appointmentDate, now),
    period: input.period as MachineViewingPeriodValue,
    hour: input.hour ?? null,
    customerName: normalizeMachineViewingText(input.customerName, MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH, '客户姓名'),
    customerPhone: normalizeMachineViewingOptionalText(input.customerPhone, MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH, '客户电话'),
    contactPerson: normalizeMachineViewingText(input.contactPerson, MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH, '业务对接人'),
  }
}

/** 状态流转的入参先做纯校验；当前状态是否允许流转由服务层在同一行锁内裁决。 */
export function normalizeMachineViewingStatusTransition(
  input: MachineViewingStatusTransitionInput,
): NormalizedMachineViewingStatusTransition {
  if (!(MACHINE_VIEWING_TRANSITION_TARGET_VALUES as readonly string[]).includes(input.status)) {
    throw new MachineViewingValidationError('预约状态无效')
  }
  const status = input.status as MachineViewingTransitionTargetValue
  const feedback = normalizeMachineViewingOptionalText(input.feedback, MACHINE_VIEWING_FEEDBACK_MAX_LENGTH, '反馈内容')
  const cancelReason = normalizeMachineViewingOptionalText(input.cancelReason, MACHINE_VIEWING_CANCEL_REASON_MAX_LENGTH, '取消原因')

  if (status === 'APPOINTED') {
    if (feedback !== null || cancelReason !== null) {
      throw new MachineViewingValidationError('标记已预约时不能填写反馈或取消原因')
    }
    return { status, feedback: null, cancelReason: null }
  }
  if (status === 'FEEDBACK_GIVEN') {
    if (feedback === null) {
      throw new MachineViewingValidationError('反馈内容不能为空')
    }
    if (cancelReason !== null) {
      throw new MachineViewingValidationError('填写反馈时不能同时填写取消原因')
    }
    return { status, feedback, cancelReason: null }
  }
  if (feedback !== null) {
    throw new MachineViewingValidationError('取消预约时不能填写反馈')
  }
  return { status, feedback: null, cancelReason }
}

/**
 * 状态机：待预约 → 已预约 → 已反馈；待预约/已预约都可以取消。
 *
 * 同一状态重复提交按幂等处理：已预约/已取消不重复写审计；已反馈允许原地修改反馈。
 * 已反馈和已取消都不能再取消，保证「反馈」这一事实之后不会被取消掩盖。
 */
export function resolveMachineViewingTransition(
  from: MachineViewingStatusValue,
  to: MachineViewingTransitionTargetValue,
): MachineViewingTransitionAction {
  if (from === to) {
    return to === 'FEEDBACK_GIVEN' ? 'FEEDBACK_EDIT' : 'NOOP'
  }
  if (to === 'APPOINTED') {
    return from === 'PENDING_APPOINTMENT' ? 'TRANSITION' : 'INVALID'
  }
  if (to === 'FEEDBACK_GIVEN') {
    return from === 'APPOINTED' ? 'TRANSITION' : 'INVALID'
  }
  return from === 'PENDING_APPOINTMENT' || from === 'APPOINTED' ? 'TRANSITION' : 'INVALID'
}

export interface MachineViewingEditableSnapshot {
  readonly site: string
  readonly machineType: string
  readonly appointmentDate: Date
  readonly period: string
  readonly hour: number | null
  readonly customerName: string
  readonly customerPhone: string | null
  readonly contactPerson: string
}

export interface MachineViewingChangeEntry {
  readonly field: string
  readonly from: string | null
  readonly to: string | null
}

function metadataText(value: string | number | null): string | null {
  return value === null ? null : String(value)
}

/**
 * 更新审计只记录真正变化的字段，避免无改动保存产生噪音。
 *
 * 审计元数据只接受标量或对象数组，因此把前/后值拍平成 `changes` 数组，
 * 再由此派生 `changedFields`，保证两处口径不会漂移。
 */
export function machineViewingChangeEntries(
  previous: MachineViewingEditableSnapshot,
  next: NormalizedMachineViewingCreate,
): MachineViewingChangeEntry[] {
  const entries: MachineViewingChangeEntry[] = []
  const push = (field: string, from: string | number | null, to: string | number | null): void => {
    const before = metadataText(from)
    const after = metadataText(to)
    if (before !== after) {
      entries.push({ field, from: before, to: after })
    }
  }
  push('site', previous.site, next.site)
  push('machineType', previous.machineType, next.machineType)
  push(
    'appointmentDate',
    previous.appointmentDate.toISOString().slice(0, 10),
    next.appointmentDate.toISOString().slice(0, 10),
  )
  push('period', previous.period, next.period)
  push('hour', previous.hour, next.hour)
  push('customerName', previous.customerName, next.customerName)
  push('customerPhone', previous.customerPhone, next.customerPhone)
  push('contactPerson', previous.contactPerson, next.contactPerson)
  return entries
}

export function machineViewingChangedFields(
  previous: MachineViewingEditableSnapshot,
  next: NormalizedMachineViewingCreate,
): string[] {
  return machineViewingChangeEntries(previous, next).map(entry => entry.field)
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
