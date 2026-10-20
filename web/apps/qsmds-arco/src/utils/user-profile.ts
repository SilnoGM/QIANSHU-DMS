import type {
  CurrentUserProfileDto,
  UpdateCurrentUserProfileRequestDto,
  UpdateUserRequestDto,
  UserDto,
} from '@/api/generated/types.gen'

import { validateChinaMobileNational } from './china-mobile'

export type CurrentUserProfileValue = Pick<
  CurrentUserProfileDto,
  'avatarUrl' | 'email' | 'mobileE164'
>

export interface CurrentUserProfileFormValue {
  avatarUrl: string
  email: string
  mobileE164: string
}

export type AdminUserProfileValue = Pick<UserDto, 'displayName'>
  & Pick<UserDto['profile'], 'avatarUrl' | 'email' | 'mobileE164' | 'remark'>

export interface AdminUserProfileFormValue extends CurrentUserProfileFormValue {
  displayName: string
  remark: string
}

export type CurrentUserProfilePatch = UpdateCurrentUserProfileRequestDto
export type AdminUserProfilePatch = Pick<
  UpdateUserRequestDto,
  'avatarUrl' | 'displayName' | 'email' | 'mobileE164' | 'remark'
>
export type UserProfileFieldErrors = Partial<Record<
  'avatarUrl' | 'displayName' | 'email' | 'mobileE164' | 'remark',
  string
>>

export interface CurrentUserProfileValidationMessages {
  avatarUrlInvalid: string
  avatarUrlTooLong: string
  emailInvalid: string
  emailTooLong: string
  mobileE164Invalid: string
  mobileDigitsInvalid?: string
  mobileForeignInvalid?: string
  mobileLengthInvalid?: string
  mobileSegmentInvalid?: string
}

export interface CurrentUserProfileValidationOptions {
  /** 个人资料/管理端表单使用：只接受 +86 + 11 位大陆手机号。 */
  requireChinaMainland?: boolean
  /** 未触碰的存量非大陆号码：跳过手机号校验，保存时保持原值。 */
  preserveUnsupportedMobile?: boolean
}

const EMAIL_MAX_CODE_POINTS = 254
const EMAIL_LOCAL_MAX_CODE_POINTS = 64
const EMAIL_DOMAIN_LABEL_MAX_CODE_POINTS = 63
const AVATAR_URL_MAX_CODE_POINTS = 2048
const DISPLAY_NAME_MAX_CODE_POINTS = 128
const REMARK_MAX_CODE_POINTS = 2000
const MOBILE_E164_PATTERN = /^\+[1-9]\d{7,14}$/u
const PROFILE_PATCH_FIELDS = new Set([
  'avatarUrl',
  'email',
  'mobileE164',
])
const EMAIL_LOCAL_PART_PATTERN
  = /^[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u
const EMAIL_DOMAIN_LABEL_PATTERN
  = /^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?$/u
const DEFAULT_VALIDATION_MESSAGES: Required<CurrentUserProfileValidationMessages> = {
  avatarUrlInvalid: '请输入有效的 HTTP 或 HTTPS 绝对地址',
  avatarUrlTooLong: '头像地址不能超过 2048 个字符',
  emailInvalid: '请输入有效的邮箱地址',
  emailTooLong: '邮箱不能超过 254 个字符',
  mobileDigitsInvalid: '手机号只能输入数字',
  mobileE164Invalid: '请输入有效的 E.164 手机号',
  mobileForeignInvalid: '仅支持中国大陆 +86 手机号',
  mobileLengthInvalid: '手机号应为 11 位',
  mobileSegmentInvalid: '手机号号段不合法，请检查',
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function normalizeEmail(value: string): string | null {
  const normalized = value.normalize('NFC').trim()
  return normalized === '' ? null : normalized
}

/**
 * 这里只验证当前契约需要的最小邮箱结构，不尝试实现完整 RFC 5322。
 * 使用定界符索引进行线性扫描，避免由重复通配片段造成正则回溯风险。
 */
function isEmailFormatValid(value: string): boolean {
  const atIndex = value.indexOf('@')
  if (
    atIndex <= 0
    || atIndex !== value.lastIndexOf('@')
    || atIndex === value.length - 1
    || /\s/u.test(value)
  ) {
    return false
  }

  const localPart = value.slice(0, atIndex)
  const domain = value.slice(atIndex + 1)
  const domainLabels = domain.split('.')

  // 对齐 Server `class-validator/isEmail` 的主要结构约束：local-part 最长
  // 64 个字符且 dot 不能连续或位于两端；域名必须有 TLD，每段不能以连字符
  // 开始/结束，也不能包含下划线。这里保持线性扫描，避免复杂正则回溯。
  if (
    codePointLength(localPart) > EMAIL_LOCAL_MAX_CODE_POINTS
    || localPart.startsWith('.')
    || localPart.endsWith('.')
    || localPart.includes('..')
    || !EMAIL_LOCAL_PART_PATTERN.test(localPart)
    || domainLabels.length < 2
  ) {
    return false
  }

  return domainLabels.every(label =>
    codePointLength(label) <= EMAIL_DOMAIN_LABEL_MAX_CODE_POINTS
    && EMAIL_DOMAIN_LABEL_PATTERN.test(label),
  )
}

function normalizeExactOptionalValue(value: string): string | null {
  return value === '' ? null : value
}

function normalizeRequiredText(value: string): string {
  return value.normalize('NFC').trim()
}

function normalizeRemark(value: string): string | null {
  const normalized = value.normalize('NFC').trim()
  return normalized === '' ? null : normalized
}

/**
 * 头像预览会直接触发浏览器网络请求，因此只有完整通过与 Server 相同的协议边界后
 * 才返回原值。输入中的首尾空白不做隐式清理，避免预览值和最终保存值发生漂移。
 */
export function resolveAvatarPreviewUrl(value: string): string | null {
  if (
    value === ''
    || value.trim() !== value
    || codePointLength(value) > AVATAR_URL_MAX_CODE_POINTS
  ) {
    return null
  }

  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username !== ''
      || url.password !== ''
    ) {
      return null
    }
    return value
  }
  catch {
    return null
  }
}

export function validateCurrentUserProfileFields(
  value: CurrentUserProfileFormValue,
  messages: CurrentUserProfileValidationMessages = DEFAULT_VALIDATION_MESSAGES,
  options: CurrentUserProfileValidationOptions = {},
): UserProfileFieldErrors {
  const errors: UserProfileFieldErrors = {}
  const resolved = { ...DEFAULT_VALIDATION_MESSAGES, ...messages }
  const email = normalizeEmail(value.email)
  const mobileE164 = normalizeExactOptionalValue(value.mobileE164)
  const avatarUrl = normalizeExactOptionalValue(value.avatarUrl)

  if (email !== null) {
    if (codePointLength(email) > EMAIL_MAX_CODE_POINTS) {
      errors.email = resolved.emailTooLong
    }
    else if (!isEmailFormatValid(email)) {
      errors.email = resolved.emailInvalid
    }
  }

  if (mobileE164 !== null && options.preserveUnsupportedMobile !== true) {
    if (options.requireChinaMainland === true) {
      if (!mobileE164.startsWith('+86')) {
        errors.mobileE164 = resolved.mobileForeignInvalid
      }
      else {
        const issue = validateChinaMobileNational(mobileE164.slice(3))
        if (issue === 'digits') {
          errors.mobileE164 = resolved.mobileDigitsInvalid
        }
        else if (issue === 'length') {
          errors.mobileE164 = resolved.mobileLengthInvalid
        }
        else if (issue === 'segment') {
          errors.mobileE164 = resolved.mobileSegmentInvalid
        }
      }
    }
    else if (!MOBILE_E164_PATTERN.test(mobileE164)) {
      errors.mobileE164 = resolved.mobileE164Invalid
    }
  }

  if (avatarUrl !== null) {
    if (codePointLength(avatarUrl) > AVATAR_URL_MAX_CODE_POINTS) {
      errors.avatarUrl = resolved.avatarUrlTooLong
    }
    else if (resolveAvatarPreviewUrl(avatarUrl) === null) {
      errors.avatarUrl = resolved.avatarUrlInvalid
    }
  }

  return errors
}

export function validateAdminUserProfileFields(
  value: AdminUserProfileFormValue,
  options: CurrentUserProfileValidationOptions = {},
): UserProfileFieldErrors {
  const errors = validateCurrentUserProfileFields(value, undefined, options)
  const displayName = normalizeRequiredText(value.displayName)
  const remark = normalizeRemark(value.remark)

  if (displayName === '') {
    errors.displayName = '请输入显示名称'
  }
  else if (codePointLength(displayName) > DISPLAY_NAME_MAX_CODE_POINTS) {
    errors.displayName = '显示名称不能超过 128 个字符'
  }

  if (remark !== null && codePointLength(remark) > REMARK_MAX_CODE_POINTS) {
    errors.remark = '管理员备注不能超过 2000 个字符'
  }

  return errors
}

/** 只从固定 allowlist 构造本人 PATCH，调用方传入的对象无法扩张公共请求字段。 */
export function buildCurrentUserProfilePatch(
  initial: CurrentUserProfileValue,
  form: CurrentUserProfileFormValue,
): CurrentUserProfilePatch {
  const desired: CurrentUserProfileValue = {
    avatarUrl: normalizeExactOptionalValue(form.avatarUrl),
    email: normalizeEmail(form.email),
    mobileE164: normalizeExactOptionalValue(form.mobileE164),
  }
  const patch: CurrentUserProfilePatch = {}

  for (const field of ['avatarUrl', 'email', 'mobileE164'] as const) {
    if (desired[field] !== initial[field]) {
      patch[field] = desired[field]
    }
  }

  return patch
}

export function buildAdminUserProfilePatch(
  initial: AdminUserProfileValue,
  form: AdminUserProfileFormValue,
): AdminUserProfilePatch {
  const patch: AdminUserProfilePatch = buildCurrentUserProfilePatch(
    initial,
    form,
  )
  const displayName = normalizeRequiredText(form.displayName)
  const remark = normalizeRemark(form.remark)

  if (displayName !== initial.displayName) {
    patch.displayName = displayName
  }
  if (remark !== initial.remark) {
    patch.remark = remark
  }

  return patch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 409 只按公开稳定 error code 映射字段，不读取或展示底层错误内容。 */
export function getProfileConflictField(
  error: unknown,
): 'email' | 'mobileE164' | undefined {
  try {
    if (!isRecord(error) || error.status !== 409 || !isRecord(error.body)) {
      return undefined
    }
    if (error.body.code === 'EMAIL_ALREADY_EXISTS') {
      return 'email'
    }
    if (error.body.code === 'MOBILE_ALREADY_EXISTS') {
      return 'mobileE164'
    }
  }
  catch {
    return undefined
  }
  return undefined
}

/**
 * mutation 响应丢失时只核对本次提交字段。空 PATCH 或未知字段不能被误判为成功，
 * 也不能要求未提交字段保持不变而把其他标签页的合法更新当作失败。
 */
export function isProfilePatchApplied(
  profile: CurrentUserProfileValue,
  patch: CurrentUserProfilePatch,
): boolean {
  const fields = Object.keys(patch)
  if (
    fields.length === 0
    || fields.some(field => !PROFILE_PATCH_FIELDS.has(field))
  ) {
    return false
  }

  return fields.every((field) => {
    const profileField = field as keyof CurrentUserProfileValue
    return profile[profileField] === patch[profileField]
  })
}
