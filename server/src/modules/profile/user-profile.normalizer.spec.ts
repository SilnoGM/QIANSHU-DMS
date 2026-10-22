import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import {
  createChangedFields,
  normalizeAvatarUrl,
  normalizeEmail,
  normalizeIssuerPrefix,
  normalizeMobileE164,
  normalizeRemark,
  normalizeUserProfileUpdate,
} from './user-profile.normalizer'

function expectValidationFailure(
  operation: () => unknown,
  field?: string,
): void {
  let thrown: unknown
  try {
    operation()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  expect(thrown).toMatchObject({
    code: 'VALIDATION_FAILED',
    publicMessage: '请求参数校验失败',
  })
  expect((thrown as ApiException).getStatus()).toBe(
    HttpStatus.UNPROCESSABLE_ENTITY,
  )
  if (field !== undefined) {
    const fieldErrors = (thrown as ApiException).fieldErrors
    expect(Object.keys(fieldErrors ?? {})).toEqual([field])
    expect(fieldErrors?.[field]).toHaveLength(1)
    expect(typeof fieldErrors?.[field]?.[0]).toBe('string')
  }
}

describe('user profile field normalizers', () => {
  it('normalizes Email display and unique values in the required order', () => {
    expect(normalizeEmail('  A\u030A.User@EXAMPLE.COM  ')).toEqual({
      email: 'Å.User@EXAMPLE.COM',
      emailNormalized: 'å.user@example.com',
    })
    expect(normalizeEmail(null)).toEqual({
      email: null,
      emailNormalized: null,
    })
  })

  it.each([
    '',
    '   ',
    'not-an-email',
    `${'a'.repeat(64)}x@example.com`,
  ])('rejects an invalid Email without leaking parser details: %j', (value) => {
    expectValidationFailure(() => normalizeEmail(value), 'email')
  })

  it('accepts only exact E.164 values and null clearing', () => {
    expect(normalizeMobileE164('+8613812345678')).toBe('+8613812345678')
    expect(normalizeMobileE164(null)).toBeNull()

    for (const invalid of [
      '',
      ' +8613812345678',
      '+86 13812345678',
      '13812345678',
      '+012345678',
      '+1234567',
      '+1234567890123456',
    ]) {
      expectValidationFailure(
        () => normalizeMobileE164(invalid),
        'mobileE164',
      )
    }
  })

  it('accepts absolute HTTP(S) avatar URLs without fetching or canonicalizing them', () => {
    expect(normalizeAvatarUrl('https://cdn.example.com/a%20b.png?size=2')).toBe(
      'https://cdn.example.com/a%20b.png?size=2',
    )
    expect(normalizeAvatarUrl('http://127.0.0.1/avatar.png')).toBe(
      'http://127.0.0.1/avatar.png',
    )
    expect(normalizeAvatarUrl(null)).toBeNull()
  })

  it.each([
    '',
    '/avatar.png',
    'ftp://example.com/avatar.png',
    'https://user@example.com/avatar.png',
    'https://user:secret@example.com/avatar.png',
    'https://',
  ])('rejects an unsafe or invalid avatar URL: %j', (value) => {
    expectValidationFailure(() => normalizeAvatarUrl(value), 'avatarUrl')
  })

  it('normalizes admin remark while preserving internal line breaks', () => {
    expect(normalizeRemark('  Line A\r\nA\u030A line  ')).toBe(
      'Line A\r\nÅ line',
    )
    expect(normalizeRemark(null)).toBeNull()
    expect(normalizeRemark('😀'.repeat(2000))).toBe('😀'.repeat(2000))
    expectValidationFailure(() => normalizeRemark(''), 'remark')
    expectValidationFailure(() => normalizeRemark('😀'.repeat(2001)), 'remark')
  })

  it('normalizes the issuer prefix to at most three Han characters', () => {
    expect(normalizeIssuerPrefix('  李华  ')).toBe('李华')
    expect(normalizeIssuerPrefix('李华华')).toBe('李华华')
    expect(normalizeIssuerPrefix(null)).toBeNull()
    for (const invalid of ['', '   ', '李华华华', 'LH', '李1', '李 华', '😀']) {
      expectValidationFailure(() => normalizeIssuerPrefix(invalid), 'issuerPrefix')
    }
  })
})

describe('normalizeUserProfileUpdate', () => {
  it('uses own-property presence to distinguish omission from explicit null', () => {
    const input = Object.create({ email: 'inherited@example.com' }) as {
      email?: string
      avatarUrl?: string | null
    }
    input.avatarUrl = null

    expect(normalizeUserProfileUpdate(input)).toEqual({
      data: { avatarUrl: null },
      changedFields: 'avatarUrl',
    })
  })

  it('accepts issuer-prefix-only updates and explicit clearing', () => {
    expect(normalizeUserProfileUpdate({ issuerPrefix: ' 李华 ' })).toEqual({
      data: { issuerPrefix: '李华' },
      changedFields: 'issuerPrefix',
    })
    expect(normalizeUserProfileUpdate({ issuerPrefix: null })).toEqual({
      data: { issuerPrefix: null },
      changedFields: 'issuerPrefix',
    })
  })

  it('treats transformer-created undefined own properties as omitted fields', () => {
    expect(
      normalizeUserProfileUpdate({
        email: undefined,
        mobileE164: undefined,
        avatarUrl: 'https://cdn.example.com/profile.png',
      }),
    ).toEqual({
      data: { avatarUrl: 'https://cdn.example.com/profile.png' },
      changedFields: 'avatarUrl',
    })

    expectValidationFailure(() =>
      normalizeUserProfileUpdate({
        email: undefined,
        mobileE164: undefined,
        avatarUrl: undefined,
      }),
    )
  })

  it('builds a stable sorted changedFields scalar and coupled Email columns', () => {
    expect(
      normalizeUserProfileUpdate({
        mobileE164: '+8613812345678',
        email: ' User@Example.COM ',
        avatarUrl: null,
      }),
    ).toEqual({
      data: {
        avatarUrl: null,
        email: 'User@Example.COM',
        emailNormalized: 'user@example.com',
        mobileE164: '+8613812345678',
      },
      changedFields: 'avatarUrl,email,mobileE164',
    })
    expect(
      createChangedFields(['remark', 'email', 'remark', 'displayName']),
    ).toBe('displayName,email,remark')
  })

  it('rejects an empty or inherited-only PATCH', () => {
    expectValidationFailure(() => normalizeUserProfileUpdate({}))
    expectValidationFailure(() =>
      normalizeUserProfileUpdate(
        Object.create({ email: 'inherited@example.com' }) as object,
      ),
    )
  })

  it('keeps remark unavailable unless the admin caller explicitly enables it', () => {
    expectValidationFailure(
      () => normalizeUserProfileUpdate({ remark: 'internal' }),
      'remark',
    )
    expect(
      normalizeUserProfileUpdate(
        { remark: ' internal ' },
        { allowRemark: true },
      ),
    ).toEqual({
      data: { remark: 'internal' },
      changedFields: 'remark',
    })
  })
})
