import { resolveSendCooldownMs } from './assistant-send-gate.service'

describe('resolveSendCooldownMs', () => {
  it('draws a cooldown between the minimum interval and the jitter upper bound', () => {
    expect(resolveSendCooldownMs(3_000, 2_000, 0)).toBe(3_000)
    expect(resolveSendCooldownMs(3_000, 2_000, 0.5)).toBe(4_000)
    expect(resolveSendCooldownMs(3_000, 2_000, 0.999_999)).toBe(5_000)
  })

  it('clamps out-of-range random values instead of exceeding the upper bound', () => {
    expect(resolveSendCooldownMs(3_000, 2_000, 1)).toBe(5_000)
    expect(resolveSendCooldownMs(3_000, 2_000, -1)).toBe(3_000)
    expect(resolveSendCooldownMs(3_000, 2_000, Number.NaN)).toBe(3_000)
  })

  it('keeps the fixed minimum interval when jitter is disabled', () => {
    expect(resolveSendCooldownMs(3_000, 0, 0.9)).toBe(3_000)
  })

  it('does not throttle when the minimum interval is disabled', () => {
    expect(resolveSendCooldownMs(0, 2_000, 0.9)).toBe(0)
  })
})
