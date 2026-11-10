import { isWithinScanWindow, proxyBucket } from './notification-scan'

const DAY_MS = 24 * 60 * 60 * 1_000

describe('notification scan helpers', () => {
  it('runs only inside the Shanghai daytime window', () => {
    expect(isWithinScanWindow(new Date('2026-11-10T00:59:00.000Z'))).toBe(false)
    expect(isWithinScanWindow(new Date('2026-11-10T01:00:00.000Z'))).toBe(true)
    expect(isWithinScanWindow(new Date('2026-11-10T13:59:00.000Z'))).toBe(true)
    expect(isWithinScanWindow(new Date('2026-11-10T14:00:00.000Z'))).toBe(false)
  })

  it('maps remaining time to the 7-day and 1-day buckets', () => {
    const now = new Date('2026-11-10T01:00:00.000Z')
    expect(proxyBucket(now, new Date(now.getTime() + 8 * DAY_MS))).toBeNull()
    expect(proxyBucket(now, new Date(now.getTime() + 7 * DAY_MS))).toBe('7d')
    expect(proxyBucket(now, new Date(now.getTime() + 2 * DAY_MS))).toBe('7d')
    expect(proxyBucket(now, new Date(now.getTime() + DAY_MS))).toBe('1d')
    expect(proxyBucket(now, new Date(now.getTime() + DAY_MS / 2))).toBe('1d')
    expect(proxyBucket(now, now)).toBeNull()
  })
})
