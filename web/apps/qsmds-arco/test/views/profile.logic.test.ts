import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  buildAdminUserProfilePatch,
  buildCurrentUserProfilePatch,
  getProfileConflictField,
  isProfilePatchApplied,
  resolveAvatarPreviewUrl,
  validateAdminUserProfileFields,
  validateCurrentUserProfileFields,
} from '../../src/utils/user-profile'

test('Profile 请求和响应值直接绑定 OpenAPI 生成类型', () => {
  const source = readFileSync(
    new URL('../../src/utils/user-profile.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /from '@\/api\/generated\/types\.gen'/u)
  assert.match(
    source,
    /CurrentUserProfileValue\s*=\s*Pick<\s*CurrentUserProfileDto/u,
  )
  assert.match(
    source,
    /CurrentUserProfilePatch\s*=\s*UpdateCurrentUserProfileRequestDto/u,
  )
  assert.match(
    source,
    /AdminUserProfilePatch\s*=\s*Pick<\s*UpdateUserRequestDto/u,
  )
  assert.doesNotMatch(source, /interface CurrentUserProfileValue/u)
})

test('本人资料只构造三个允许字段，并把经过规范化的空值转换为 null', () => {
  const patch = buildCurrentUserProfilePatch(
    { avatarUrl: null, email: null, mobileE164: null },
    {
      avatarUrl: '',
      email: '  A\u030Alice@Example.COM  ',
      mobileE164: '+8613800138000',
    },
  )

  assert.deepEqual(patch, {
    email: 'Ålice@Example.COM',
    mobileE164: '+8613800138000',
  })
  assert.equal('remark' in patch, false)
  assert.equal('userId' in patch, false)
  assert.equal('emailNormalized' in patch, false)

  assert.deepEqual(buildCurrentUserProfilePatch(
    {
      avatarUrl: 'https://cdn.example.com/avatar.png',
      email: 'user@example.com',
      mobileE164: '+8613800138000',
    },
    { avatarUrl: '', email: '   ', mobileE164: '' },
  ), {
    avatarUrl: null,
    email: null,
    mobileE164: null,
  })
})

test('本人资料只提交实际变化字段，无差异时返回空 patch', () => {
  const initial = {
    avatarUrl: 'https://cdn.example.com/avatar.png',
    email: 'user@example.com',
    mobileE164: '+8613800138000',
  }

  assert.deepEqual(buildCurrentUserProfilePatch(initial, {
    avatarUrl: initial.avatarUrl,
    email: '  user@example.com  ',
    mobileE164: initial.mobileE164,
  }), {})
})

test('本人资料校验 Email 的 NFC、格式与 Unicode code point 上限', () => {
  assert.deepEqual(validateCurrentUserProfileFields({
    avatarUrl: '',
    email: '  A\u030Alice@example.com  ',
    mobileE164: '',
  }), {})

  assert.deepEqual(validateCurrentUserProfileFields({
    avatarUrl: '',
    email: 'not-an-email',
    mobileE164: '',
  }), { email: '请输入有效的邮箱地址' })

  assert.deepEqual(validateCurrentUserProfileFields({
    avatarUrl: '',
    email: `${'😀'.repeat(250)}@e.co`,
    mobileE164: '',
  }), { email: '邮箱不能超过 254 个字符' })

  for (const email of [
    'a..b@example.com',
    'a@-example.com',
    'a@example..com',
    'a@exa_mple.com',
    `${'a'.repeat(65)}@example.com`,
  ]) {
    assert.deepEqual(validateCurrentUserProfileFields({
      avatarUrl: '',
      email,
      mobileE164: '',
    }), { email: '请输入有效的邮箱地址' })
  }
})

test('本人资料校验允许界面注入当前语言的字段错误文案', () => {
  assert.deepEqual(validateCurrentUserProfileFields({
    avatarUrl: 'javascript:alert(1)',
    email: 'invalid-email',
    mobileE164: '13800138000',
  }, {
    avatarUrlInvalid: 'avatar-invalid',
    avatarUrlTooLong: 'avatar-too-long',
    emailInvalid: 'email-invalid',
    emailTooLong: 'email-too-long',
    mobileE164Invalid: 'mobile-invalid',
  }), {
    avatarUrl: 'avatar-invalid',
    email: 'email-invalid',
    mobileE164: 'mobile-invalid',
  })
})

test('手机号严格使用 E.164，不自动清理空格、横线或国家码', () => {
  for (const mobileE164 of [
    '+12345678',
    '+8613800138000',
    '+123456789012345',
  ]) {
    assert.deepEqual(validateCurrentUserProfileFields({
      avatarUrl: '',
      email: '',
      mobileE164,
    }), {})
  }

  for (const mobileE164 of [
    '13800138000',
    ' +8613800138000',
    '+86 13800138000',
    '+86-13800138000',
    '+01234567',
    '+1234567',
    '+1234567890123456',
  ]) {
    assert.deepEqual(validateCurrentUserProfileFields({
      avatarUrl: '',
      email: '',
      mobileE164,
    }), { mobileE164: '请输入有效的 E.164 手机号' })
  }
})

test('头像预览只接受无 credentials 的绝对 http/https URL', () => {
  for (const avatarUrl of [
    'https://cdn.example.com/avatar.png',
    'http://127.0.0.1:9000/avatar.png',
  ]) {
    assert.equal(resolveAvatarPreviewUrl(avatarUrl), avatarUrl)
    assert.deepEqual(validateCurrentUserProfileFields({
      avatarUrl,
      email: '',
      mobileE164: '',
    }), {})
  }

  for (const avatarUrl of [
    '/avatar.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA==',
    'file:///tmp/avatar.png',
    'https://user:password@example.com/avatar.png',
    ' https://example.com/avatar.png',
  ]) {
    assert.equal(resolveAvatarPreviewUrl(avatarUrl), null)
    assert.deepEqual(validateCurrentUserProfileFields({
      avatarUrl,
      email: '',
      mobileE164: '',
    }), { avatarUrl: '请输入有效的 HTTP 或 HTTPS 绝对地址' })
  }

  assert.deepEqual(validateCurrentUserProfileFields({
    avatarUrl: `https://example.com/${'a'.repeat(2048)}`,
    email: '',
    mobileE164: '',
  }), { avatarUrl: '头像地址不能超过 2048 个字符' })
})

test('管理员资料支持 remark，并继续只构造实际变化字段', () => {
  assert.deepEqual(validateAdminUserProfileFields({
    avatarUrl: '',
    displayName: '  Alice  ',
    email: '',
    mobileE164: '',
    remark: '  内部\n备注  ',
  }), {})

  assert.deepEqual(buildAdminUserProfilePatch({
    avatarUrl: null,
    displayName: 'Alice',
    email: null,
    mobileE164: null,
    remark: null,
  }, {
    avatarUrl: '',
    displayName: '  Alice  ',
    email: '',
    mobileE164: '',
    remark: '  内部\n备注  ',
  }), {
    remark: '内部\n备注',
  })

  assert.deepEqual(validateAdminUserProfileFields({
    avatarUrl: '',
    displayName: 'Alice',
    email: '',
    mobileE164: '',
    remark: '😀'.repeat(2001),
  }), { remark: '管理员备注不能超过 2000 个字符' })
})

test('唯一冲突只映射到对应公开字段', () => {
  assert.equal(getProfileConflictField({
    body: { code: 'EMAIL_ALREADY_EXISTS' },
    kind: 'http',
    status: 409,
  }), 'email')
  assert.equal(getProfileConflictField({
    body: { code: 'MOBILE_ALREADY_EXISTS' },
    kind: 'http',
    status: 409,
  }), 'mobileE164')
  assert.equal(getProfileConflictField({
    body: { code: 'INTERNAL_ERROR' },
    kind: 'http',
    status: 500,
  }), undefined)
  assert.equal(getProfileConflictField(new Proxy({}, {
    get() {
      throw new Error('sensitive getter')
    },
  })), undefined)
})

test('未知 mutation 结果只比较本次提交字段，不要求未提交字段一致', () => {
  assert.equal(isProfilePatchApplied({
    avatarUrl: 'https://cdn.example.com/old.png',
    email: 'new@example.com',
    mobileE164: '+8613800138000',
  }, { email: 'new@example.com' }), true)

  assert.equal(isProfilePatchApplied({
    avatarUrl: null,
    email: 'old@example.com',
    mobileE164: null,
  }, { email: 'new@example.com' }), false)

  assert.equal(isProfilePatchApplied({
    avatarUrl: null,
    email: null,
    mobileE164: null,
  }, {}), false)
})
