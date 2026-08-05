import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import {
  isNormalizableDictionaryBatchCodes,
  isNormalizableDictionaryDescription,
  isNormalizableDictionaryItemValue,
  isNormalizableDictionaryLabel,
  isNormalizableDictionaryName,
  isNormalizableDictionaryQuery,
  isNormalizableDictionaryTypeCode,
  normalizeDictionaryBatchCodes,
  normalizeDictionaryDescription,
  normalizeDictionaryItemValue,
  normalizeDictionaryLabel,
  normalizeDictionaryName,
  normalizeDictionaryQuery,
  normalizeDictionaryTypeCode,
  normalizeOptionalDictionaryDescription,
} from './dictionary.normalizer'

function expectValidationFailure(
  operation: () => unknown,
  field: string,
  sensitiveValue?: string,
): void {
  let thrown: unknown

  try {
    operation()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  const exception = thrown as ApiException
  expect(exception.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  expect(exception).toMatchObject({
    code: 'VALIDATION_FAILED',
    publicMessage: '请求参数校验失败',
  })
  expect(Object.keys(exception.fieldErrors ?? {})).toEqual([field])
  expect(exception.fieldErrors?.[field]).toEqual([expect.any(String)])

  if (sensitiveValue !== undefined) {
    const publicSurface = JSON.stringify({
      code: exception.code,
      publicMessage: exception.publicMessage,
      fieldErrors: exception.fieldErrors,
      response: exception.getResponse(),
    })
    expect(publicSurface).not.toContain(sensitiveValue)
  }
}

describe('dictionary identifier normalizers', () => {
  it('normalizes Type code after NFC and Unicode trim, then lowercases ASCII', () => {
    expect(normalizeDictionaryTypeCode('  Sales.Order_Status\u3000')).toBe(
      'sales.order_status',
    )
    // Kelvin sign 在 NFC 后成为 ASCII K，证明 ASCII 限制发生在 NFC 之后、大小写转换之前。
    expect(normalizeDictionaryTypeCode('\u212Aernel.Mode')).toBe(
      'kernel.mode',
    )
    expect(normalizeDictionaryTypeCode('\u0085Inventory.State\u0085')).toBe(
      'inventory.state',
    )
    expect(isNormalizableDictionaryTypeCode(' A.B ')).toBe(true)
  })

  it.each([
    '',
    'ab',
    '1.type',
    'type.1value',
    'type..value',
    'type.-value',
    'type value.code',
    '订单.状态',
    'ß.type',
    'ı.type',
    `a.${'b'.repeat(63)}`,
    123,
    null,
  ])('rejects a non-normalizable Type code without exposing it: %j', (value) => {
    expect(isNormalizableDictionaryTypeCode(value)).toBe(false)
    expectValidationFailure(
      () => normalizeDictionaryTypeCode(value),
      'code',
      typeof value === 'string' && value.length > 0 ? value : undefined,
    )
  })

  it('normalizes Item value after NFC and Unicode trim, then uppercases ASCII', () => {
    expect(normalizeDictionaryItemValue('  pending-state_1\u3000')).toBe(
      'PENDING-STATE_1',
    )
    expect(normalizeDictionaryItemValue('\u212A.value')).toBe('K.VALUE')
    expect(normalizeDictionaryItemValue('\u0085pending.value\u0085')).toBe(
      'PENDING.VALUE',
    )
    expect(isNormalizableDictionaryItemValue(' a.b-c_1 ')).toBe(true)
  })

  it.each([
    '',
    '-VALUE',
    '_VALUE',
    'VALUE SPACE',
    '订单',
    'ß_VALUE',
    'ı_VALUE',
    'A'.repeat(65),
    123,
    null,
  ])('rejects a non-normalizable Item value: %j', (value) => {
    expect(isNormalizableDictionaryItemValue(value)).toBe(false)
    expectValidationFailure(() => normalizeDictionaryItemValue(value), 'value')
  })
})

describe('dictionary display text normalizers', () => {
  it('normalizes Name and Label using NFC and Unicode whitespace folding', () => {
    expect(normalizeDictionaryName('  Re\u0301al\u3000订单\t名称  ')).toBe(
      'Réal 订单 名称',
    )
    expect(normalizeDictionaryLabel('  待处理\r\n订单  ')).toBe('待处理 订单')

    // 原始 UTF-16 长度超过 128，但 NFC 后恰好为 128 个 Unicode code point。
    const decomposed = 'e\u0301'.repeat(128)
    expect([...normalizeDictionaryName(decomposed)]).toHaveLength(128)
    expect(isNormalizableDictionaryName(decomposed)).toBe(true)
    expect(isNormalizableDictionaryLabel('😀'.repeat(128))).toBe(true)
  })

  it.each([
    ['name', () => normalizeDictionaryName(' \u3000\t '), isNormalizableDictionaryName],
    ['name', () => normalizeDictionaryName('😀'.repeat(129)), isNormalizableDictionaryName],
    ['label', () => normalizeDictionaryLabel(' \n '), isNormalizableDictionaryLabel],
    ['label', () => normalizeDictionaryLabel('😀'.repeat(129)), isNormalizableDictionaryLabel],
  ] as const)('rejects invalid %s text after normalization', (field, operation, predicate) => {
    expect(predicate(field === 'name' ? ' '.repeat(129) : null)).toBe(false)
    expectValidationFailure(operation, field)
  })

  it('maps blank Description to null and preserves omission for PATCH', () => {
    expect(normalizeDictionaryDescription(undefined)).toBeNull()
    expect(normalizeDictionaryDescription(null)).toBeNull()
    expect(normalizeDictionaryDescription(' \u3000\t ')).toBeNull()
    expect(normalizeDictionaryDescription('  一段\r\n说明  ')).toBe('一段 说明')
    expect(normalizeOptionalDictionaryDescription(undefined)).toBeUndefined()
    expect(normalizeOptionalDictionaryDescription(null)).toBeNull()
    expect(normalizeOptionalDictionaryDescription(' \t ')).toBeNull()
    expect(normalizeDictionaryDescription('😀'.repeat(500))).toBe(
      '😀'.repeat(500),
    )

    expect(isNormalizableDictionaryDescription(undefined)).toBe(true)
    expect(isNormalizableDictionaryDescription(null)).toBe(true)
    expect(isNormalizableDictionaryDescription(' \t ')).toBe(true)
  })

  it('rejects an oversized or non-string Description', () => {
    for (const value of ['😀'.repeat(501), 123, {}]) {
      expect(isNormalizableDictionaryDescription(value)).toBe(false)
      expectValidationFailure(
        () => normalizeDictionaryDescription(value),
        'description',
      )
    }
  })
})

describe('dictionary query and batch code normalizers', () => {
  it('normalizes an optional Query without adding hidden case semantics', () => {
    expect(normalizeDictionaryQuery(undefined)).toBeUndefined()
    expect(normalizeDictionaryQuery('  Re\u0301al\u3000订单\t状态  ')).toBe(
      'Réal 订单 状态',
    )
    expect(normalizeDictionaryQuery('😀'.repeat(128))).toBe('😀'.repeat(128))
    expect(isNormalizableDictionaryQuery(undefined)).toBe(true)
    expect(isNormalizableDictionaryQuery(' 有效查询 ')).toBe(true)
  })

  it.each([' \u3000\t ', '😀'.repeat(129), null, 123])(
    'rejects an invalid or blank Query: %j',
    (value) => {
      expect(isNormalizableDictionaryQuery(value)).toBe(false)
      expectValidationFailure(() => normalizeDictionaryQuery(value), 'query')
    },
  )

  it('normalizes batch codes, preserves request order and rejects duplicates', () => {
    expect(
      normalizeDictionaryBatchCodes([
        ' Sales.Status ',
        'shipping.method',
        'PAYMENT.MODE',
      ]),
    ).toEqual(['sales.status', 'shipping.method', 'payment.mode'])
    expect(
      isNormalizableDictionaryBatchCodes([' Sales.Status ', 'PAYMENT.MODE']),
    ).toBe(true)

    const duplicated = ['sales.status', ' SALES.STATUS ']
    expect(isNormalizableDictionaryBatchCodes(duplicated)).toBe(false)
    expectValidationFailure(
      () => normalizeDictionaryBatchCodes(duplicated),
      'codes',
    )
  })

  it.each([
    [],
    Array.from({ length: 21 }, (_unused, index) => `group.code_${index}`),
    ['valid.code', 'not valid.code'],
    ['valid.code', 123],
    'valid.code',
    null,
  ])('rejects an invalid batch input with a stable safe error: %j', (value) => {
    expect(isNormalizableDictionaryBatchCodes(value)).toBe(false)
    expectValidationFailure(() => normalizeDictionaryBatchCodes(value), 'codes')
  })
})
