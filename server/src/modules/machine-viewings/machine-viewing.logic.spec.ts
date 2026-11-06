import {
  daysInMonth,
  formatMachineViewingDate,
  hashMachineViewingRequestKey,
  MachineViewingValidationError,
  normalizeMachineViewingCreate,
  normalizeMachineViewingOptionalText,
  normalizeMachineViewingText,
  requireMachineViewingRequestKey,
  resolveMachineViewingDate,
  sameMachineViewingPayload,
  shanghaiCalendarDate,
  type MachineViewingCreateInput,
} from './machine-viewing.logic'

const CREATE_INPUT: MachineViewingCreateInput = {
  site: 'NEW_TAIPEI_LINKOU',
  machineType: 'MINI_TILLER',
  appointmentMonth: 11,
  appointmentDay: 5,
  period: 'PM',
  hour: 3,
  customerName: '陈先生',
  customerPhone: '0912-345-678',
  contactPerson: '李华',
}

function createInput(overrides: Partial<MachineViewingCreateInput> = {}): MachineViewingCreateInput {
  return { ...CREATE_INPUT, ...overrides }
}

describe('machine viewing calendar resolution', () => {
  it('reads the Shanghai calendar date, not the UTC date', () => {
    // 2026-11-05T16:30Z === 2026-11-06 00:30 上海
    expect(shanghaiCalendarDate(new Date('2026-11-05T16:30:00.000Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 6,
    })
  })

  it('keeps the current year for today and later dates', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    expect(formatMachineViewingDate(resolveMachineViewingDate(11, 5, now))).toBe('2026-11-05')
    expect(formatMachineViewingDate(resolveMachineViewingDate(11, 20, now))).toBe('2026-11-20')
    expect(formatMachineViewingDate(resolveMachineViewingDate(12, 31, now))).toBe('2026-12-31')
  })

  it('rolls an already-past month/day into the next year', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    expect(formatMachineViewingDate(resolveMachineViewingDate(11, 4, now))).toBe('2027-11-04')
    expect(formatMachineViewingDate(resolveMachineViewingDate(1, 5, now))).toBe('2027-01-05')
  })

  it('rolls over at the Shanghai month/day boundary even when UTC is still the previous day', () => {
    // 上海已经是 11-06，UTC 仍是 11-05：月/日为 11-05 时必须顺延到 2027。
    const now = new Date('2026-11-05T16:30:00.000Z')
    expect(formatMachineViewingDate(resolveMachineViewingDate(11, 5, now))).toBe('2027-11-05')
  })

  it('validates the day against the resolved year, including leap day', () => {
    const leapYearNow = new Date('2028-01-10T02:00:00.000Z')
    expect(formatMachineViewingDate(resolveMachineViewingDate(2, 29, leapYearNow))).toBe('2028-02-29')

    // 2029 不是闰年：2/29 落到顺延后的年份时必须被拒绝。
    const afterLeapYear = new Date('2028-03-01T02:00:00.000Z')
    expect(() => resolveMachineViewingDate(2, 29, afterLeapYear)).toThrow(MachineViewingValidationError)
  })

  it('rejects impossible month and day values', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    expect(() => resolveMachineViewingDate(0, 5, now)).toThrow(MachineViewingValidationError)
    expect(() => resolveMachineViewingDate(13, 5, now)).toThrow(MachineViewingValidationError)
    expect(() => resolveMachineViewingDate(2, 31, now)).toThrow(MachineViewingValidationError)
    expect(() => resolveMachineViewingDate(6, 31, now)).toThrow(MachineViewingValidationError)
    expect(() => resolveMachineViewingDate(4, 31, now)).toThrow(MachineViewingValidationError)
  })

  it('counts month days from a real calendar', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })
})

describe('machine viewing input normalization', () => {
  it('trims required text and rejects blank values', () => {
    expect(normalizeMachineViewingText('  陈先生 ', 128, '客户姓名')).toBe('陈先生')
    expect(() => normalizeMachineViewingText('   ', 128, '客户姓名')).toThrow(MachineViewingValidationError)
    expect(() => normalizeMachineViewingText('陈'.repeat(129), 128, '客户姓名')).toThrow(MachineViewingValidationError)
  })

  it('treats a blank optional phone as not provided', () => {
    expect(normalizeMachineViewingOptionalText('  ', 64, '客户电话')).toBeNull()
    expect(normalizeMachineViewingOptionalText(undefined, 64, '客户电话')).toBeNull()
    expect(normalizeMachineViewingOptionalText(' 0912-345-678 ', 64, '客户电话')).toBe('0912-345-678')
  })

  it('accepts an omitted hour and rejects an out-of-range hour', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    const withoutHour = normalizeMachineViewingCreate(createInput({ hour: undefined }), now)
    expect(withoutHour.hour).toBeNull()

    for (const hour of [0, 13, 1.5, Number.NaN]) {
      expect(() => normalizeMachineViewingCreate(createInput({ hour }), now)).toThrow(MachineViewingValidationError)
    }
    expect(normalizeMachineViewingCreate(createInput({ hour: 12 }), now).hour).toBe(12)
  })

  it('rejects an unknown site, machine type or period', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    expect(() => normalizeMachineViewingCreate(createInput({ site: 'TAIPEI' }), now)).toThrow(MachineViewingValidationError)
    expect(() => normalizeMachineViewingCreate(createInput({ machineType: 'TRACTOR' }), now)).toThrow(MachineViewingValidationError)
    expect(() => normalizeMachineViewingCreate(createInput({ period: 'NOON' }), now)).toThrow(MachineViewingValidationError)
  })

  it('stores the resolved date, not the raw month/day', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    const normalized = normalizeMachineViewingCreate(createInput({ appointmentMonth: 1, appointmentDay: 5 }), now)
    expect(formatMachineViewingDate(normalized.appointmentDate)).toBe('2027-01-05')
  })
})

describe('machine viewing idempotency helpers', () => {
  it('accepts a uuid request key and lowercases it', () => {
    expect(requireMachineViewingRequestKey('3F2504E0-4F89-41D3-9A0C-0305E82C3301'))
      .toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301')
    expect(() => requireMachineViewingRequestKey('not-a-uuid')).toThrow(MachineViewingValidationError)
    expect(() => requireMachineViewingRequestKey(undefined)).toThrow(MachineViewingValidationError)
    expect(() => requireMachineViewingRequestKey(42)).toThrow(MachineViewingValidationError)
  })

  it('hashes the request key into 32 bytes', () => {
    expect(hashMachineViewingRequestKey('abc')).toHaveLength(32)
  })

  it('requires every immutable field to match on replay', () => {
    const now = new Date('2026-11-05T02:00:00.000Z')
    const normalized = normalizeMachineViewingCreate(createInput(), now)
    const previous = {
      site: normalized.site,
      machineType: normalized.machineType,
      appointmentDate: normalized.appointmentDate,
      period: normalized.period,
      hour: normalized.hour,
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      contactPerson: normalized.contactPerson,
    }
    expect(sameMachineViewingPayload(previous, normalized)).toBe(true)
    expect(sameMachineViewingPayload({ ...previous, customerName: '林小姐' }, normalized)).toBe(false)
    expect(sameMachineViewingPayload({ ...previous, hour: null }, normalized)).toBe(false)
    expect(sameMachineViewingPayload({ ...previous, appointmentDate: new Date('2026-11-06T00:00:00.000Z') }, normalized)).toBe(false)
  })
})
