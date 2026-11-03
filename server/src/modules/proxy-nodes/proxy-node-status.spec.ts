import {
  isProxyNodeAssignable,
  resolveProxyNodeStatus,
} from './proxy-node-status'

const NOW = new Date('2026-11-03T00:00:00.000Z')
const DAY_MS = 86_400_000

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs)
}

describe('proxy node status', () => {
  it('keeps more than seven days as active', () => {
    expect(resolveProxyNodeStatus(at(7 * DAY_MS + 1), NOW)).toBe('ACTIVE')
    expect(resolveProxyNodeStatus(at(300 * DAY_MS), NOW)).toBe('ACTIVE')
  })

  it('marks the last seven days as expiring soon, including exactly seven days', () => {
    expect(resolveProxyNodeStatus(at(7 * DAY_MS), NOW)).toBe('EXPIRING_SOON')
    expect(resolveProxyNodeStatus(at(2 * DAY_MS), NOW)).toBe('EXPIRING_SOON')
    expect(resolveProxyNodeStatus(at(DAY_MS + 1), NOW)).toBe('EXPIRING_SOON')
  })

  it('marks the last day as critical, including exactly one day', () => {
    expect(resolveProxyNodeStatus(at(DAY_MS), NOW)).toBe('EXPIRING_CRITICAL')
    expect(resolveProxyNodeStatus(at(1), NOW)).toBe('EXPIRING_CRITICAL')
  })

  it('treats the exact expiry instant and the past as expired', () => {
    expect(resolveProxyNodeStatus(at(0), NOW)).toBe('EXPIRED')
    expect(resolveProxyNodeStatus(at(-1), NOW)).toBe('EXPIRED')
  })

  it('only allows assignment for present, unexpired nodes', () => {
    expect(isProxyNodeAssignable(at(DAY_MS), false, NOW)).toBe(true)
    expect(isProxyNodeAssignable(at(0), false, NOW)).toBe(false)
    expect(isProxyNodeAssignable(at(-1), false, NOW)).toBe(false)
    expect(isProxyNodeAssignable(at(DAY_MS), true, NOW)).toBe(false)
  })
})
