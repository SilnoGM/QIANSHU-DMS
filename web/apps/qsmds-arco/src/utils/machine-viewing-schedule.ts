import type { CreateMachineViewingDto, MachineViewingDto } from '../api/generated/types.gen'

export type MachineViewingSiteValue = MachineViewingDto['site']
export type MachineViewingMachineTypeValue = MachineViewingDto['machineType']
export type MachineViewingPeriodValue = MachineViewingDto['period']

export const MACHINE_VIEWING_SITE_OPTIONS: readonly MachineViewingSiteValue[] = [
  'NEW_TAIPEI_LINKOU',
  'TAICHUNG_LONGJING',
]

export const MACHINE_VIEWING_MACHINE_TYPE_OPTIONS: readonly MachineViewingMachineTypeValue[] = [
  'MINI_TILLER',
  'SHREDDER',
  'INCINERATOR',
]

export const MACHINE_VIEWING_PERIOD_OPTIONS: readonly MachineViewingPeriodValue[] = ['AM', 'PM']

export const MACHINE_VIEWING_HOURS: readonly number[] = Array.from({ length: 12 }, (_, index) => index + 1)

export const MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH = 128
export const MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH = 64
export const MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH = 64

export interface ShanghaiDateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

export interface MachineViewingDraft {
  site: MachineViewingSiteValue | ''
  machineType: MachineViewingMachineTypeValue | ''
  month: number | null
  day: number | null
  period: MachineViewingPeriodValue
  /** 空值表示只约到上午/下午，不指定几点。 */
  hour: number | null
  customerName: string
  customerPhone: string
  contactPerson: string
}

export type MachineViewingField
  = | 'site'
    | 'machineType'
    | 'appointmentTime'
    | 'customerName'
    | 'customerPhone'
    | 'contactPerson'

export type MachineViewingDraftErrors = Partial<Record<MachineViewingField, string>>

type Translate = (key: string, params?: Record<string, string | number>) => string

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

function codePointLength(value: string): number {
  return Array.from(value).length
}

/** 与服务端同口径：业务时区按上海自然日，浏览器本地时区不参与年份推断。 */
export function shanghaiDateParts(epochMs: number): ShanghaiDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(new Date(epochMs))
  const pick = (type: string): number => Number(parts.find(part => part.type === type)?.value)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 「月/日」早于今天则顺延下一年；与今天同日保留当前年（允许今天已过的时段）。 */
export function resolveViewingYear(month: number, day: number, epochMs: number): number {
  const today = shanghaiDateParts(epochMs)
  return month * 100 + day < today.month * 100 + today.day ? today.year + 1 : today.year
}

/**
 * 「日」下拉的可选范围。
 *
 * 同一个月里较早的日会顺延到明年、较晚的日留在今年，而两年的当月天数可能不同
 * （只有 2 月 29 日这一种情况）。这里取两年的较大值，让闰日仍然可选；具体年份
 * 不成立时由 `validateMachineViewingDraft` 明确拦下，而不是静默少给一天。
 */
export function viewingDayOptions(month: number, epochMs: number): number[] {
  const currentYear = shanghaiDateParts(epochMs).year
  const days = Math.max(daysInMonth(currentYear, month), daysInMonth(currentYear + 1, month))
  return Array.from({ length: days }, (_, index) => index + 1)
}

/** 打开弹窗时的默认值：上海今天 + 上午，不指定小时。 */
export function createMachineViewingDraft(issuerPrefix: string | null | undefined, epochMs: number): MachineViewingDraft {
  const today = shanghaiDateParts(epochMs)
  return {
    site: '',
    machineType: '',
    month: today.month,
    day: today.day,
    period: 'AM',
    hour: null,
    customerName: '',
    customerPhone: '',
    contactPerson: issuerPrefix?.trim() ?? '',
  }
}

export function validateMachineViewingDraft(
  draft: MachineViewingDraft,
  epochMs: number,
): MachineViewingDraftErrors {
  const errors: MachineViewingDraftErrors = {}
  if (draft.site === '') {
    errors.site = 'machineViewing.validation.siteRequired'
  }
  if (draft.machineType === '') {
    errors.machineType = 'machineViewing.validation.machineTypeRequired'
  }
  if (draft.month === null || draft.day === null) {
    errors.appointmentTime = 'machineViewing.validation.appointmentTimeRequired'
  }
  else {
    const year = resolveViewingYear(draft.month, draft.day, epochMs)
    if (draft.day > daysInMonth(year, draft.month)) {
      errors.appointmentTime = 'machineViewing.validation.appointmentTimeInvalid'
    }
  }

  const customerName = draft.customerName.trim()
  if (customerName === '') {
    errors.customerName = 'machineViewing.validation.customerNameRequired'
  }
  else if (codePointLength(customerName) > MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH) {
    errors.customerName = 'machineViewing.validation.customerNameTooLong'
  }

  if (draft.customerPhone.trim() !== ''
    && codePointLength(draft.customerPhone.trim()) > MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH) {
    errors.customerPhone = 'machineViewing.validation.customerPhoneTooLong'
  }

  const contactPerson = draft.contactPerson.trim()
  if (contactPerson === '') {
    errors.contactPerson = 'machineViewing.validation.contactPersonRequired'
  }
  else if (codePointLength(contactPerson) > MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH) {
    errors.contactPerson = 'machineViewing.validation.contactPersonTooLong'
  }
  return errors
}

export function toMachineViewingCreatePayload(draft: MachineViewingDraft): CreateMachineViewingDto {
  if (draft.site === '' || draft.machineType === '' || draft.month === null || draft.day === null) {
    throw new TypeError('看机预约草稿尚未填写完整')
  }
  return {
    site: draft.site,
    machineType: draft.machineType,
    appointmentMonth: draft.month,
    appointmentDay: draft.day,
    period: draft.period,
    ...(draft.hour === null ? {} : { hour: draft.hour }),
    customerName: draft.customerName.trim(),
    ...(draft.customerPhone.trim() === '' ? {} : { customerPhone: draft.customerPhone.trim() }),
    contactPerson: draft.contactPerson.trim(),
  }
}

/** 列表展示格式固定为「M/D日 上午/下午 [H点]」，年份只在数据里，不出现在列表。 */
export function formatMachineViewingTime(
  translate: Translate,
  input: Pick<MachineViewingDto, 'appointmentDate' | 'period' | 'hour'>,
): string {
  const [year, month, day] = input.appointmentDate.split('-').map(Number)
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) {
    return input.appointmentDate
  }
  return translate(
    input.hour === null ? 'machineViewing.time.withoutHour' : 'machineViewing.time.withHour',
    { date: `${month}/${day}`, period: translate(`machineViewing.period.${input.period}`), hour: input.hour ?? '' },
  )
}

/**
 * 详情抽屉的展示格式：「YYYY-MM-DD 上午/下午 [H点]」。
 *
 * 年份推断对用户不可见，跨年预约或补录历史日期时必须在详情里能看到实际落库年份，
 * 否则「1/5日」这类文案无法判断是今年还是明年。
 */
export function formatMachineViewingFullTime(
  translate: Translate,
  input: Pick<MachineViewingDto, 'appointmentDate' | 'period' | 'hour'>,
): string {
  const [year, month, day] = input.appointmentDate.split('-').map(Number)
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) {
    return input.appointmentDate
  }
  return translate(
    input.hour === null ? 'machineViewing.time.withoutHourFull' : 'machineViewing.time.withHourFull',
    { date: input.appointmentDate, period: translate(`machineViewing.period.${input.period}`), hour: input.hour ?? '' },
  )
}

/** 表单里的实时预览：未选满月/日时返回空串，不显示半成品文案。 */
export function previewMachineViewingTime(
  translate: Translate,
  draft: Pick<MachineViewingDraft, 'month' | 'day' | 'period' | 'hour'>,
): string {
  if (draft.month === null || draft.day === null) {
    return ''
  }
  return translate(
    draft.hour === null ? 'machineViewing.time.withoutHour' : 'machineViewing.time.withHour',
    {
      date: `${draft.month}/${draft.day}`,
      period: translate(`machineViewing.period.${draft.period}`),
      hour: draft.hour ?? '',
    },
  )
}
