import {
  calculateIdempotencyKeyHash,
  calculateNumberingRequestFingerprintHash,
  validateGenerateNumberRequest,
  validateGenerateScopedNumberRequest,
} from './numbering-internal-input'
import { NumberingGenerationError } from './numbering.errors'

function captureGenerationError(
  action: () => unknown,
): NumberingGenerationError {
  let thrown: unknown

  try {
    action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(NumberingGenerationError)
  return thrown as NumberingGenerationError
}

describe('numbering internal generator input', () => {
  it('accepts only already-canonical rule and consumer codes', () => {
    expect(validateGenerateNumberRequest({
      ruleCode: 'SALES_ORDER',
      consumerCode: 'OMS.ORDER_V1',
      idempotencyKey: 'request-1',
    })).toMatchObject({
      ruleCode: 'SALES_ORDER',
      consumerCode: 'OMS.ORDER_V1',
    })

    for (const input of [
      {
        ruleCode: 'sales_order',
        consumerCode: 'OMS.ORDER_V1',
        idempotencyKey: 'request-1',
      },
      {
        ruleCode: 'SALES_ORDER',
        consumerCode: ' oms.order_v1 ',
        idempotencyKey: 'request-1',
      },
      {
        ruleCode: 'SALES_ORDER',
        consumerCode: 'ＯＭＳ',
        idempotencyKey: 'request-1',
      },
    ]) {
      const error = captureGenerationError(
        () => validateGenerateNumberRequest(input),
      )
      expect(error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('hashes the exact raw UTF-8 idempotency bytes without normalization', () => {
    expect(calculateIdempotencyKeyHash(' 订单/😀 ').toString('hex'))
      .toBe('feb5ac03dc00aeab0d676fee28f4e2f9f68fc12e8aef4c5a4ec215a12c1ed2dd')
    expect(calculateIdempotencyKeyHash('é').toString('hex'))
      .toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
    expect(calculateIdempotencyKeyHash('e\u0301').toString('hex'))
      .toBe('bf12767b0f2a56b2190075bae8169f656e3ce8d6357d4aff184bc6c7ea48f9f6')
  })

  it('validates the idempotency key by raw UTF-8 byte length 1..200', () => {
    expect(() => calculateIdempotencyKeyHash('😀'.repeat(50))).not.toThrow()

    for (const value of ['', '😀'.repeat(51), 123]) {
      const error = captureGenerationError(
        () => calculateIdempotencyKeyHash(value),
      )

      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.retryable).toBe(false)
      if (String(value).length > 0) {
        expect(JSON.stringify(error)).not.toContain(String(value))
      }
    }
  })

  it('uses the frozen versioned fingerprint byte sequence', () => {
    expect(calculateNumberingRequestFingerprintHash('ORDER_NO').toString('hex'))
      .toBe('5a7fc999ab7fdee3632710e189c3e41dce3805064db9df4d2e10f7cafbbf4772')
  })

  it('accepts only an exact 64-character lowercase scoped fingerprint', () => {
    const fingerprint = 'ab'.repeat(32)

    expect(validateGenerateScopedNumberRequest({
      ruleCode: 'PRODUCT',
      consumerCode: 'PRODUCT.CREATE',
      idempotencyKey: 'product-request-1',
      requestFingerprint: fingerprint,
    })).toMatchObject({
      ruleCode: 'PRODUCT',
      consumerCode: 'PRODUCT.CREATE',
      requestFingerprintHash: Buffer.from(fingerprint, 'hex'),
    })

    for (const requestFingerprint of [
      'A'.repeat(64),
      'a'.repeat(63),
      'a'.repeat(65),
      `${'a'.repeat(63)}g`,
      Buffer.alloc(32),
      { digest: fingerprint },
    ]) {
      const error = captureGenerationError(
        () => validateGenerateScopedNumberRequest({
          ruleCode: 'PRODUCT',
          consumerCode: 'PRODUCT.CREATE',
          idempotencyKey: 'product-request-1',
          requestFingerprint,
        } as never),
      )

      expect(error.code).toBe('VALIDATION_FAILED')
      if (typeof requestFingerprint === 'string') {
        expect(JSON.stringify(error)).not.toContain(requestFingerprint)
      }
    }
  })

  it('returns only hashes after validating the opaque key', () => {
    const input = validateGenerateNumberRequest({
      ruleCode: 'ORDER_NO',
      consumerCode: 'OMS.ORDER',
      idempotencyKey: 'raw-secret-key',
    })

    expect(input.idempotencyKeyHash).toBeInstanceOf(Buffer)
    expect(input.requestFingerprintHash).toBeInstanceOf(Buffer)
    expect(input.idempotencyKeyHash).toHaveLength(32)
    expect(input.requestFingerprintHash).toHaveLength(32)
    expect(input).not.toHaveProperty('idempotencyKey')
    expect(JSON.stringify(input)).not.toContain('raw-secret-key')
  })

  it('drops both raw key and scoped fingerprint after validation', () => {
    const requestFingerprint = '12'.repeat(32)
    const input = validateGenerateScopedNumberRequest({
      ruleCode: 'PRODUCT',
      consumerCode: 'PRODUCT.CREATE',
      idempotencyKey: 'raw-product-key',
      requestFingerprint,
    })

    expect(input.idempotencyKeyHash).toHaveLength(32)
    expect(input.requestFingerprintHash).toEqual(
      Buffer.from(requestFingerprint, 'hex'),
    )
    expect(input).not.toHaveProperty('idempotencyKey')
    expect(input).not.toHaveProperty('requestFingerprint')
    expect(JSON.stringify(input)).not.toContain('raw-product-key')
    expect(JSON.stringify(input)).not.toContain(requestFingerprint)
  })
})
