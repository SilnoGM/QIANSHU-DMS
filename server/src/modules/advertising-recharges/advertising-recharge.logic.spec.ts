import {
  buildAdvertisingRechargeProofFilename,
  buildAdvertisingRechargeQrFilename,
  hashAdvertisingRechargeNumberFingerprint,
  hashAdvertisingRechargeRequestKey,
  normalizeAdvertisingAccountText,
  normalizeAdvertisingRechargeAmount,
  normalizeAdvertisingRechargeCurrency,
  normalizeAdvertisingRechargeReason,
  normalizeAdvertisingRechargeRemark,
  requireAdvertisingRechargeMediaId,
  requireAdvertisingRechargeRequestKey,
} from './advertising-recharge.logic'

describe('advertising recharge logic', () => {
  it('normalizes positive amounts to two decimals and rejects zero or extra precision', () => {
    expect(normalizeAdvertisingRechargeAmount(' 100 ')).toBe('100.00')
    expect(normalizeAdvertisingRechargeAmount('0.5')).toBe('0.50')
    expect(normalizeAdvertisingRechargeAmount('12.34')).toBe('12.34')
    expect(() => normalizeAdvertisingRechargeAmount('0')).toThrow(RangeError)
    expect(() => normalizeAdvertisingRechargeAmount('0.00')).toThrow(RangeError)
    expect(() => normalizeAdvertisingRechargeAmount('-1')).toThrow(RangeError)
    expect(() => normalizeAdvertisingRechargeAmount('1.234')).toThrow(RangeError)
    expect(() => normalizeAdvertisingRechargeAmount('abc')).toThrow(RangeError)
  })

  it('defaults the recharge currency to USD and only accepts CNY or USD', () => {
    expect(normalizeAdvertisingRechargeCurrency(undefined)).toBe('USD')
    expect(normalizeAdvertisingRechargeCurrency('cny')).toBe('CNY')
    expect(normalizeAdvertisingRechargeCurrency(' USD ')).toBe('USD')
    expect(() => normalizeAdvertisingRechargeCurrency('EUR')).toThrow(RangeError)
  })

  it('trims account name and number and rejects blank or overlong values', () => {
    expect(normalizeAdvertisingAccountText('  千树户  ', '广告账户名称')).toBe('千树户')
    expect(() => normalizeAdvertisingAccountText('   ', '广告账户名称')).toThrow(RangeError)
    expect(() => normalizeAdvertisingAccountText('x'.repeat(129), '广告账户名称')).toThrow(RangeError)
  })

  it('treats a blank remark as absent and trims reasons', () => {
    expect(normalizeAdvertisingRechargeRemark(undefined)).toBeNull()
    expect(normalizeAdvertisingRechargeRemark('   ')).toBeNull()
    expect(normalizeAdvertisingRechargeRemark(' 加急 ')).toBe('加急')
    expect(normalizeAdvertisingRechargeReason(' 金额填错 ')).toBe('金额填错')
    expect(() => normalizeAdvertisingRechargeReason('  ')).toThrow(RangeError)
  })

  it('requires an idempotency uuid and a media uuid', () => {
    const key = '3f6f4b1e-7d0a-4a2e-9f5f-4b1c2d3e4f50'
    expect(requireAdvertisingRechargeRequestKey(key.toUpperCase())).toBe(key)
    expect(() => requireAdvertisingRechargeRequestKey('not-a-uuid')).toThrow(RangeError)
    expect(requireAdvertisingRechargeMediaId(key.toUpperCase())).toBe(key)
    expect(() => requireAdvertisingRechargeMediaId('nope')).toThrow(RangeError)
  })

  it('hashes the request key to exactly 32 bytes and fingerprints every immutable field', () => {
    const key = '3f6f4b1e-7d0a-4a2e-9f5f-4b1c2d3e4f50'
    expect(hashAdvertisingRechargeRequestKey(key)).toHaveLength(32)
    const base = {
      applicantUserId: 'user-1',
      accountType: 'PERSONAL',
      adAccountName: '千树户',
      adAccountNo: 'act_1',
      rechargeAmount: '100.00',
      rechargeCurrency: 'USD',
      paymentQrMediaAssetId: 'media-1',
      remark: null,
      requestKey: key,
    }
    const fingerprint = hashAdvertisingRechargeNumberFingerprint(base)
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(hashAdvertisingRechargeNumberFingerprint({ ...base, rechargeAmount: '101.00' })).not.toBe(fingerprint)
    expect(hashAdvertisingRechargeNumberFingerprint({ ...base, paymentQrMediaAssetId: null })).not.toBe(fingerprint)
    expect(hashAdvertisingRechargeNumberFingerprint({ ...base, remark: '加急' })).not.toBe(fingerprint)
  })

  it('builds display filenames from the applicant and Shanghai date without user paths', () => {
    const uploadedAt = new Date('2026-11-02T16:30:00.000Z')
    expect(buildAdvertisingRechargeProofFilename({
      amount: '3680.00',
      displayName: '张三/测试',
      extension: '.png',
      uploadedAt,
    })).toBe('张三_测试-广告充值3680元-20261103.png')
    expect(buildAdvertisingRechargeQrFilename({
      displayName: '张三',
      extension: '.jpg',
      uploadedAt,
    })).toBe('张三-广告账户充值收款码-20261103.jpg')
    expect(() => buildAdvertisingRechargeQrFilename({
      displayName: '张三',
      extension: '.gif',
      uploadedAt,
    })).toThrow(RangeError)
  })
})
