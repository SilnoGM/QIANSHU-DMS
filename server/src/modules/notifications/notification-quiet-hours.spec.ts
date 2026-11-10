import {
  isWithinQuietHours,
  nextQuietHoursEnd,
  parseNotificationQuietHours,
} from './notification-quiet-hours'

const overnight = { end: '09:00', start: '22:00', timezone: 'Asia/Shanghai' }
const sameDay = { end: '14:00', start: '12:00', timezone: 'Asia/Shanghai' }

describe('notification quiet hours', () => {
  it('parses valid values and rejects malformed values', () => {
    expect(parseNotificationQuietHours({ start: '22:00', end: '09:00' })).toEqual({
      end: '09:00',
      start: '22:00',
      timezone: 'Asia/Shanghai',
    })
    expect(parseNotificationQuietHours({ start: '25:00', end: '09:00' })).toBeNull()
    expect(parseNotificationQuietHours({ start: '22:00' })).toBeNull()
    expect(parseNotificationQuietHours(null)).toBeNull()
  })

  it('recognizes the overnight window boundaries', () => {
    expect(isWithinQuietHours(new Date('2026-11-10T13:59:00.000Z'), overnight)).toBe(false)
    expect(isWithinQuietHours(new Date('2026-11-10T14:00:00.000Z'), overnight)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-11-11T00:59:00.000Z'), overnight)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-11-11T01:00:00.000Z'), overnight)).toBe(false)
  })

  it('calculates the next send time for an overnight window', () => {
    expect(nextQuietHoursEnd(new Date('2026-11-10T14:00:00.000Z'), overnight)?.toISOString())
      .toBe('2026-11-11T01:00:00.000Z')
    expect(nextQuietHoursEnd(new Date('2026-11-11T00:00:00.000Z'), overnight)?.toISOString())
      .toBe('2026-11-11T01:00:00.000Z')
  })

  it('supports a same-day window', () => {
    expect(isWithinQuietHours(new Date('2026-11-10T04:30:00.000Z'), sameDay)).toBe(true)
    expect(nextQuietHoursEnd(new Date('2026-11-10T04:30:00.000Z'), sameDay)?.toISOString())
      .toBe('2026-11-10T06:00:00.000Z')
    expect(isWithinQuietHours(new Date('2026-11-10T06:00:00.000Z'), sameDay)).toBe(false)
  })
})
