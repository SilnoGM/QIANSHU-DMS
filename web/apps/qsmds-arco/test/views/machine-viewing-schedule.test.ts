import type { MachineViewingDraft } from '../../src/utils/machine-viewing-schedule'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 看机预约时间口径需要与服务端一致。
import test from 'node:test'
import {
  createMachineViewingDraft,
  daysInMonth,
  formatMachineViewingFullTime,
  formatMachineViewingTime,

  previewMachineViewingTime,
  resolveViewingYear,
  shanghaiDateParts,
  toMachineViewingCreatePayload,
  validateMachineViewingDraft,
  viewingDayOptions,
} from '../../src/utils/machine-viewing-schedule'

const NOW = new Date('2026-11-05T02:00:00.000Z').getTime()

function draft(overrides: Partial<MachineViewingDraft> = {}): MachineViewingDraft {
  return {
    site: 'NEW_TAIPEI_LINKOU',
    machineType: 'MINI_TILLER',
    month: 11,
    day: 20,
    period: 'PM',
    hour: 3,
    customerName: '陈先生',
    customerPhone: '0912-345-678',
    contactPerson: '李华',
    ...overrides,
  }
}

function translate(key: string, params?: Record<string, string | number>): string {
  if (key === 'machineViewing.period.AM') {
    return '上午'
  }
  if (key === 'machineViewing.period.PM') {
    return '下午'
  }
  if (key === 'machineViewing.time.withHour') {
    return `${params?.date}日 ${params?.period} ${params?.hour}点`
  }
  if (key === 'machineViewing.time.withoutHour') {
    return `${params?.date}日 ${params?.period}`
  }
  if (key === 'machineViewing.time.withHourFull') {
    return `${params?.date} ${params?.period} ${params?.hour}点`
  }
  if (key === 'machineViewing.time.withoutHourFull') {
    return `${params?.date} ${params?.period}`
  }
  return key
}

test('上海自然日不随浏览器时区变化', () => {
  assert.deepEqual(shanghaiDateParts(new Date('2026-11-05T02:00:00.000Z').getTime()), { year: 2026, month: 11, day: 5 })
  // UTC 仍是 11-05，上海已经跨到 11-06。
  assert.deepEqual(shanghaiDateParts(new Date('2026-11-05T16:30:00.000Z').getTime()), { year: 2026, month: 11, day: 6 })
})

test('年份推断：当天与未来留在本年，已过的月日顺延下一年', () => {
  assert.equal(resolveViewingYear(11, 5, NOW), 2026)
  assert.equal(resolveViewingYear(11, 20, NOW), 2026)
  assert.equal(resolveViewingYear(12, 1, NOW), 2026)
  assert.equal(resolveViewingYear(11, 4, NOW), 2027)
  assert.equal(resolveViewingYear(1, 5, NOW), 2027)
})

test('「日」选项取相邻两年的较大天数，闰日仍可见', () => {
  assert.equal(daysInMonth(2028, 2), 29)
  assert.equal(daysInMonth(2029, 2), 28)
  // 2026/2027 都不是闰年：2 月只给 28 天。
  assert.equal(viewingDayOptions(2, NOW).length, 28)
  // 从 2027 年看，相邻年份含 2028 闰年：闰日仍可选，由提交前校验裁决具体年份。
  const beforeLeapYear = new Date('2027-06-01T02:00:00.000Z').getTime()
  assert.equal(viewingDayOptions(2, beforeLeapYear).length, 29)
  assert.equal(viewingDayOptions(4, NOW).length, 30)
  assert.equal(viewingDayOptions(12, NOW).length, 31)
})

test('新建草稿默认今天、上午、不带小时，并写入出单人前缀', () => {
  const created = createMachineViewingDraft('李华', NOW)
  assert.equal(created.month, 11)
  assert.equal(created.day, 5)
  assert.equal(created.period, 'AM')
  assert.equal(created.hour, null)
  assert.equal(created.site, '')
  assert.equal(created.machineType, '')
  assert.equal(created.contactPerson, '李华')
  assert.equal(createMachineViewingDraft(null, NOW).contactPerson, '')
})

test('必填项、长度与当月天数都参与校验', () => {
  assert.deepEqual(validateMachineViewingDraft(draft(), NOW), {})

  const empty = validateMachineViewingDraft(
    draft({ site: '', machineType: '', month: null, day: null, customerName: ' ', contactPerson: '' }),
    NOW,
  )
  assert.equal(empty.site, 'machineViewing.validation.siteRequired')
  assert.equal(empty.machineType, 'machineViewing.validation.machineTypeRequired')
  assert.equal(empty.appointmentTime, 'machineViewing.validation.appointmentTimeRequired')
  assert.equal(empty.customerName, 'machineViewing.validation.customerNameRequired')
  assert.equal(empty.contactPerson, 'machineViewing.validation.contactPersonRequired')

  assert.equal(
    validateMachineViewingDraft(draft({ day: 31, month: 4 }), NOW).appointmentTime,
    'machineViewing.validation.appointmentTimeInvalid',
  )
  assert.equal(
    validateMachineViewingDraft(draft({ customerName: '陈'.repeat(129) }), NOW).customerName,
    'machineViewing.validation.customerNameTooLong',
  )
  assert.equal(
    validateMachineViewingDraft(draft({ customerPhone: '0'.repeat(65) }), NOW).customerPhone,
    'machineViewing.validation.customerPhoneTooLong',
  )
  assert.equal(
    validateMachineViewingDraft(draft({ contactPerson: '李'.repeat(65) }), NOW).contactPerson,
    'machineViewing.validation.contactPersonTooLong',
  )
})

test('提交载荷裁剪空白，并省略未填写的选填字段', () => {
  const payload = toMachineViewingCreatePayload(draft({
    customerName: ' 陈先生 ',
    customerPhone: '  ',
    contactPerson: ' 李华 ',
    hour: null,
  }))
  assert.deepEqual(payload, {
    site: 'NEW_TAIPEI_LINKOU',
    machineType: 'MINI_TILLER',
    appointmentMonth: 11,
    appointmentDay: 20,
    period: 'PM',
    customerName: '陈先生',
    contactPerson: '李华',
  })
  assert.throws(() => toMachineViewingCreatePayload(draft({ month: null })), TypeError)
})

test('展示格式固定为 M/D日 上午/下午 [H点]', () => {
  assert.equal(
    formatMachineViewingTime(translate, { appointmentDate: '2026-11-05', period: 'PM', hour: 3 }),
    '11/5日 下午 3点',
  )
  assert.equal(
    formatMachineViewingTime(translate, { appointmentDate: '2027-01-09', period: 'AM', hour: null }),
    '1/9日 上午',
  )
  assert.equal(previewMachineViewingTime(translate, draft()), '11/20日 下午 3点')
  assert.equal(previewMachineViewingTime(translate, draft({ month: null })), '')
})

test('详情抽屉展示含年份的完整日期', () => {
  assert.equal(
    formatMachineViewingFullTime(translate, { appointmentDate: '2027-01-05', period: 'AM', hour: null }),
    '2027-01-05 上午',
  )
  assert.equal(
    formatMachineViewingFullTime(translate, { appointmentDate: '2026-11-06', period: 'PM', hour: 3 }),
    '2026-11-06 下午 3点',
  )
})
