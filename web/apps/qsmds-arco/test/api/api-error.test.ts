import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 纯函数单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import { isApiError } from '../../src/api/api-error'

const validApiError = {
  code: 'VALIDATION_FAILED',
  fieldErrors: {
    email: ['邮箱格式不正确'],
    name: ['姓名不能为空', '姓名过长'],
  },
  message: '请检查输入内容',
  requestId: 'req_12345678-1234-4234-9234-123456789abc',
}

test('isApiError 接受完整 ApiError、可选 fieldErrors 与未来额外字段', () => {
  assert.equal(isApiError(validApiError), true)
  assert.equal(isApiError({
    code: 'NOT_FOUND',
    futureMetadata: { source: 'server' },
    message: '资源不存在',
    requestId: 'req_12345678-1234-4234-9234-123456789abc',
  }), true)
  assert.equal(isApiError({
    ...validApiError,
    code: '',
    fieldErrors: {},
    message: '',
    requestId: '',
  }), true)
})

test('isApiError 要求 code、message 和 requestId 均为 string', () => {
  for (const key of ['code', 'message', 'requestId'] as const) {
    const { [key]: _omitted, ...missingRequiredField } = validApiError
    assert.equal(isApiError(missingRequiredField), false, `missing ${key}`)

    for (const invalidValue of [null, undefined, 1, true, {}, []]) {
      assert.equal(
        isApiError({ ...validApiError, [key]: invalidValue }),
        false,
        `${key}=${String(invalidValue)}`,
      )
    }
  }
})

test('isApiError 仅接受 Record<string, string[]> 形式的 fieldErrors', () => {
  const invalidFieldErrors: unknown[] = [
    null,
    'invalid',
    [],
    { email: '邮箱格式不正确' },
    { email: [1] },
    { email: ['邮箱格式不正确', null] },
  ]

  for (const fieldErrors of invalidFieldErrors) {
    assert.equal(isApiError({ ...validApiError, fieldErrors }), false)
  }
})

test('isApiError 的 fieldErrors 仅接受普通或 null prototype record', () => {
  const nullPrototypeFieldErrors = Object.assign(
    Object.create(null) as Record<string, string[]>,
    { email: ['邮箱格式不正确'] },
  )
  assert.equal(
    isApiError({ ...validApiError, fieldErrors: nullPrototypeFieldErrors }),
    true,
  )

  for (const fieldErrors of [new Date(), new Map(), new Set(), /error/]) {
    assert.equal(
      isApiError({ ...validApiError, fieldErrors }),
      false,
      fieldErrors.constructor.name,
    )
  }
})

test('isApiError 在不可信属性、prototype 或 values 访问抛错时返回 false', () => {
  const throwingCandidate = Object.defineProperty({}, 'code', {
    enumerable: true,
    get: () => {
      throw new Error('raw ApiError getter secret')
    },
  })
  const throwingPrototype = new Proxy({}, {
    getPrototypeOf: () => {
      throw new Error('raw prototype secret')
    },
  })
  const throwingFieldValue = Object.defineProperty({}, 'email', {
    enumerable: true,
    get: () => {
      throw new Error('raw field value secret')
    },
  })

  assert.equal(isApiError(throwingCandidate), false)
  assert.equal(
    isApiError({ ...validApiError, fieldErrors: throwingPrototype }),
    false,
  )
  assert.equal(
    isApiError({ ...validApiError, fieldErrors: throwingFieldValue }),
    false,
  )
})

test('isApiError 拒绝非对象值', () => {
  for (const value of [null, undefined, 'error', 1, true, []]) {
    assert.equal(isApiError(value), false)
  }
})
