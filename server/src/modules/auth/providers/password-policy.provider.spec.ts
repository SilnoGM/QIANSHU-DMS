import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { PasswordPolicyProvider } from './password-policy.provider'

const provider = new PasswordPolicyProvider()

const expectWeakPassword = (
  operation: () => unknown,
  fieldName: 'password' | 'newPassword' = 'password',
  secret?: string,
): void => {
  let thrown: unknown

  try {
    operation()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  expect((thrown as ApiException).getStatus()).toBe(
    HttpStatus.UNPROCESSABLE_ENTITY,
  )
  expect((thrown as ApiException).code).toBe('PASSWORD_POLICY_VIOLATION')
  expect((thrown as ApiException).publicMessage).toBe('密码不符合要求')
  expect((thrown as ApiException).fieldErrors).toEqual({
    [fieldName]: ['密码不符合要求'],
  })

  if (secret !== undefined) {
    expect(JSON.stringify(thrown)).not.toContain(secret)
  }
}

describe('PasswordPolicyProvider', () => {
  it('对密码执行 NFC 但不 trim，并接受空格与 Unicode', () => {
    const password = '  cafe\u0301-安全密码-2026  '

    expect(
      provider.assertAcceptable({
        password,
      }),
    ).toBe('  café-安全密码-2026  ')
  })

  it.each([
    ['恰好 8 个 Unicode code point', '😀'.repeat(8)],
    ['恰好 20 个 Unicode code point', '😀'.repeat(20)],
  ])('接受%s', (_description, password) => {
    expect(
      provider.assertAcceptable({
        password,
      }),
    ).toBe(password)
  })

  it.each([
    ['少于 8 个 Unicode code point', '😀'.repeat(7)],
    ['超过 20 个 Unicode code point', '😀'.repeat(21)],
  ])('以固定错误拒绝%s', (_description, password) => {
    expectWeakPassword(
      () =>
        provider.assertAcceptable({
          password,
        }),
      'password',
      password,
    )
  })

  it.each([
    ['普通用户名字符串', 'operator'],
    ['包含项目词的字符串', '1qianshu'],
    ['常见密码字符串', 'passwordpassword'],
  ])('除长度外不拒绝%s', (_description, password) => {
    expect(
      provider.assertAcceptable({
        password,
      }),
    ).toBe(password)
  })

  it('允许调用方把长度错误绑定到 newPassword', () => {
    const password = '1234567'

    expectWeakPassword(
      () => provider.assertAcceptable({ password, fieldName: 'newPassword' }),
      'newPassword',
      password,
    )
  })
})
