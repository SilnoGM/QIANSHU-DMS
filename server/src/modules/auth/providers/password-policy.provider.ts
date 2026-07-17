import { HttpStatus, Injectable } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  isPasswordCodePointLengthValid,
  normalizePassword,
} from './password.provider'

export const LOCAL_WEAK_PASSWORD_BLOCKLIST_VERSION = 'v1'

export type PasswordPolicyFieldName = 'password' | 'newPassword'

export interface PasswordPolicyInput {
  password: string
  username: string
  usernameNormalized: string
  fieldName?: PasswordPolicyFieldName
}

/**
 * 首期只保留高命中、与本系统场景直接相关的少量弱密码，不引入在线查询或庞大词库。
 * 修改条目时必须同步递增版本号，使审计与后续迁移可以明确识别策略版本。
 */
const LOCAL_WEAK_PASSWORD_BLOCKLIST = new Set<string>([
  'passwordpassword',
  '123456789012345',
  'qwertyuiopasdfgh',
  'adminadminadmin',
  'changemechangeme',
])

const PROJECT_HIGH_PROBABILITY_TERMS = new Set<string>([
  'qianshu',
  '千树',
  'qianshu-dms',
  'qsmds',
  'dms',
])

// 数字、标点、符号、空白/分隔符和控制字符只出现在两端时，视为明显“包裹”而非新增口令语义。
const LEADING_OBVIOUS_WRAPPER = /^[\p{N}\p{P}\p{S}\p{Z}\p{C}]+/u
const TRAILING_OBVIOUS_WRAPPER = /[\p{N}\p{P}\p{S}\p{Z}\p{C}]+$/u

const toComparisonKey = (value: string): string =>
  value.normalize('NFC').toLowerCase()

const removeObviousWrapper = (value: string): string =>
  value
    .replace(LEADING_OBVIOUS_WRAPPER, '')
    .replace(TRAILING_OBVIOUS_WRAPPER, '')

/**
 * 密码写入前的轻量业务策略。
 *
 * 所有失败均映射为同一个公开错误，调用方无法借错误内容判断命中了用户名、项目词
 * 还是本地 blocklist。返回值是只做 NFC 后的密码，空格等原始内容不会被 trim。
 */
@Injectable()
export class PasswordPolicyProvider {
  assertAcceptable(input: PasswordPolicyInput): string {
    const normalizedPassword = normalizePassword(input.password)
    const fieldName = input.fieldName ?? 'password'

    if (!isPasswordCodePointLengthValid(normalizedPassword)) {
      throw this.createWeakPasswordException(fieldName)
    }

    const passwordKey = toComparisonKey(normalizedPassword)
    const usernameKeys = [input.username, input.usernameNormalized].map(
      toComparisonKey,
    )

    if (usernameKeys.some((usernameKey) => usernameKey === passwordKey)) {
      throw this.createWeakPasswordException(fieldName)
    }

    const unwrappedPasswordKey = removeObviousWrapper(passwordKey)
    if (PROJECT_HIGH_PROBABILITY_TERMS.has(unwrappedPasswordKey)) {
      throw this.createWeakPasswordException(fieldName)
    }

    if (LOCAL_WEAK_PASSWORD_BLOCKLIST.has(passwordKey)) {
      throw this.createWeakPasswordException(fieldName)
    }

    return normalizedPassword
  }

  private createWeakPasswordException(
    fieldName: PasswordPolicyFieldName,
  ): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PASSWORD_POLICY_VIOLATION',
      '密码不符合要求',
      { [fieldName]: ['密码不符合要求'] },
    )
  }
}
