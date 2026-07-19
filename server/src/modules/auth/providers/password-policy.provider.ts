import { HttpStatus, Injectable } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  isPasswordCodePointLengthValid,
  normalizePassword,
} from './password.provider'

export type PasswordPolicyFieldName = 'password' | 'newPassword'

export interface PasswordPolicyInput {
  password: string
  fieldName?: PasswordPolicyFieldName
}

/**
 * 密码写入前只执行统一的 Unicode 长度校验，并把失败映射为稳定的业务错误。
 * 返回值只做 NFC，不 trim，也不附加字符组合、用户名或弱密码列表规则。
 */
@Injectable()
export class PasswordPolicyProvider {
  assertAcceptable(input: PasswordPolicyInput): string {
    const normalizedPassword = normalizePassword(input.password)
    const fieldName = input.fieldName ?? 'password'

    if (!isPasswordCodePointLengthValid(normalizedPassword)) {
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
