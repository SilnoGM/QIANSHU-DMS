import { HttpStatus } from '@nestjs/common'
import { isEmail } from 'class-validator'

import { ApiException } from '../../infrastructure/http/api.exception'

const EMAIL_MAX_CODE_POINTS = 254
const AVATAR_URL_MAX_CODE_POINTS = 2048
const REMARK_MAX_CODE_POINTS = 2000
const MOBILE_E164_PATTERN = /^\+[1-9]\d{7,14}$/u

export type NormalizedEmail = Readonly<{
  email: string | null
  emailNormalized: string | null
}>

export type UserProfileUpdateData = {
  email?: string | null
  emailNormalized?: string | null
  mobileE164?: string | null
  avatarUrl?: string | null
  remark?: string | null
}

export type NormalizedUserProfileUpdate = Readonly<{
  data: UserProfileUpdateData
  changedFields: string
}>

export type NormalizeUserProfileUpdateOptions = Readonly<{
  allowRemark?: boolean
}>

/**
 * 生成 Email 展示值与数据库唯一比较值。NFC、trim、格式校验和 lowercase 的顺序
 * 是数据契约的一部分，不能改由 locale-sensitive API 处理。
 */
export function normalizeEmail(value: unknown): NormalizedEmail {
  if (value === null) {
    return { email: null, emailNormalized: null }
  }
  if (typeof value !== 'string') {
    throw validationFailed('email', '请输入有效的 Email 地址')
  }

  const email = value.normalize('NFC').trim()
  const emailNormalized = email.toLowerCase()
  if (
    codePointLength(email) < 1
    || codePointLength(email) > EMAIL_MAX_CODE_POINTS
    || codePointLength(emailNormalized) > EMAIL_MAX_CODE_POINTS
    || !isEmail(email)
  ) {
    throw validationFailed('email', '请输入有效的 Email 地址')
  }

  return { email, emailNormalized }
}

/** E.164 是存储格式本身，因此不删除空格、横线或括号，也不推断国家码。 */
export function normalizeMobileE164(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string' || !MOBILE_E164_PATTERN.test(value)) {
    throw validationFailed('mobileE164', '手机号必须使用 E.164 格式')
  }

  return value
}

/**
 * Avatar URL 只做语法与协议边界校验，既不发起网络请求，也不 canonicalize 用户值。
 * URL credentials 会在浏览器或日志中形成敏感信息泄露面，因此显式拒绝。
 */
export function normalizeAvatarUrl(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (
    typeof value !== 'string'
    || codePointLength(value) < 1
    || codePointLength(value) > AVATAR_URL_MAX_CODE_POINTS
  ) {
    throw validationFailed(
      'avatarUrl',
      '头像地址必须是无凭据的绝对 HTTP(S) URL',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw validationFailed(
      'avatarUrl',
      '头像地址必须是无凭据的绝对 HTTP(S) URL',
    )
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username.length > 0
    || parsed.password.length > 0
  ) {
    throw validationFailed(
      'avatarUrl',
      '头像地址必须是无凭据的绝对 HTTP(S) URL',
    )
  }

  return value
}

/** 管理员备注使用稳定 Unicode 形式，但保留内部换行与空白。 */
export function normalizeRemark(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw validationFailed('remark', '管理员备注不能为空且不能超过 2000 个字符')
  }

  const remark = value.normalize('NFC').trim()
  const length = codePointLength(remark)
  if (length < 1 || length > REMARK_MAX_CODE_POINTS) {
    throw validationFailed('remark', '管理员备注不能为空且不能超过 2000 个字符')
  }

  return remark
}

/** 对受信任字段名去重并排序，生成 Audit metadata 可接受的 scalar。 */
export function createChangedFields(fields: readonly string[]): string {
  return [...new Set(fields)].sort().join(',')
}

/**
 * 把部分更新转换为可直接交给事务层的稳定数据。Nest 的 transform 会把未提交的
 * DTO 字段实例化为值为 `undefined` 的 own property，因此只有 own 且非 `undefined`
 * 才表示客户端实际提交；显式 `null` 仍表示清空字段。
 */
export function normalizeUserProfileUpdate(
  input: unknown,
  options: NormalizeUserProfileUpdateOptions = {},
): NormalizedUserProfileUpdate {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw validationFailed()
  }

  const data: UserProfileUpdateData = {}
  const changedFields: string[] = []
  const record = input as Record<string, unknown>

  if (hasSubmittedField(record, 'email')) {
    Object.assign(
      data,
      normalizeEmail(record.email),
    )
    changedFields.push('email')
  }
  if (hasSubmittedField(record, 'mobileE164')) {
    data.mobileE164 = normalizeMobileE164(record.mobileE164)
    changedFields.push('mobileE164')
  }
  if (hasSubmittedField(record, 'avatarUrl')) {
    data.avatarUrl = normalizeAvatarUrl(record.avatarUrl)
    changedFields.push('avatarUrl')
  }
  if (hasSubmittedField(record, 'remark')) {
    if (options.allowRemark !== true) {
      throw validationFailed('remark', '不允许修改管理员备注')
    }
    data.remark = normalizeRemark(record.remark)
    changedFields.push('remark')
  }

  if (changedFields.length === 0) {
    throw validationFailed()
  }

  return {
    data,
    changedFields: createChangedFields(changedFields),
  }
}

function hasSubmittedField(
  input: Record<string, unknown>,
  field: string,
): boolean {
  return Object.hasOwn(input, field) && input[field] !== undefined
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function validationFailed(field?: string, message?: string): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    field === undefined || message === undefined
      ? undefined
      : { [field]: [message] },
  )
}
