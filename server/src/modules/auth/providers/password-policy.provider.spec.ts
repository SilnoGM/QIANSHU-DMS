import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  LOCAL_WEAK_PASSWORD_BLOCKLIST_VERSION,
  PasswordPolicyProvider,
} from './password-policy.provider'

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
        username: 'normal-user',
        usernameNormalized: 'normal-user',
      }),
    ).toBe('  café-安全密码-2026  ')
  })

  it.each([
    ['恰好 15 个 Unicode code point', '😀'.repeat(15)],
    ['恰好 128 个 Unicode code point', '😀'.repeat(128)],
  ])('接受%s', (_description, password) => {
    expect(
      provider.assertAcceptable({
        password,
        username: 'normal-user',
        usernameNormalized: 'normal-user',
      }),
    ).toBe(password)
  })

  it.each([
    ['少于 15 个 Unicode code point', '😀'.repeat(14)],
    ['超过 128 个 Unicode code point', '😀'.repeat(129)],
  ])('以固定错误拒绝%s', (_description, password) => {
    expectWeakPassword(
      () =>
        provider.assertAcceptable({
          password,
          username: 'normal-user',
          usernameNormalized: 'normal-user',
        }),
      'password',
      password,
    )
  })

  it.each([
    {
      description: '展示用户名的 NFC 等价形式',
      password: 'CAFÉ-Administrator-01',
      username: 'CAFE\u0301-Administrator-01',
      usernameNormalized: 'unrelated-user',
    },
    {
      description: '规范化用户名的大小写等价形式',
      password: 'NORMALIZED-USER-NAME',
      username: 'another-display-name',
      usernameNormalized: 'normalized-user-name',
    },
  ])('拒绝等于$description的密码', ({ password, username, usernameNormalized }) => {
    expectWeakPassword(
      () =>
        provider.assertAcceptable({ password, username, usernameNormalized }),
      'password',
      password,
    )
  })

  it.each([
    '123456qianshu123456',
    '!!!!!!千树!!!!!!!!',
    '2026_qianshu-dms_2026',
    '000000qsmds000000',
    '111111dms111111',
  ])('拒绝只用数字、空白或符号包裹项目高概率词：%s', (password) => {
    expectWeakPassword(
      () =>
        provider.assertAcceptable({
          password,
          username: 'normal-user',
          usernameNormalized: 'normal-user',
        }),
      'password',
      password,
    )
  })

  it('不会因为真正的长密码中包含项目词就误拒绝', () => {
    const password = 'My-qianshu-workflow-secret'

    expect(
      provider.assertAcceptable({
        password,
        username: 'normal-user',
        usernameNormalized: 'normal-user',
      }),
    ).toBe(password)
  })

  it.each([
    'PASSWORDPASSWORD',
    '123456789012345',
    'QWERTYUIOPASDFGH',
    'ADMINADMINADMIN',
    'ChangeMeChangeMe',
  ])('使用大小写不敏感的本地弱密码 blocklist 拒绝：%s', (password) => {
    expectWeakPassword(
      () =>
        provider.assertAcceptable({
          password,
          username: 'normal-user',
          usernameNormalized: 'normal-user',
        }),
      'password',
      password,
    )
  })

  it('在代码中公开稳定的本地 blocklist 版本号', () => {
    expect(LOCAL_WEAK_PASSWORD_BLOCKLIST_VERSION).toBe('v1')
  })

  it('允许调用方把固定字段错误绑定到 newPassword', () => {
    const password = 'passwordpassword'

    expectWeakPassword(
      () =>
        provider.assertAcceptable({
          password,
          username: 'normal-user',
          usernameNormalized: 'normal-user',
          fieldName: 'newPassword',
        }),
      'newPassword',
      password,
    )
  })
})
