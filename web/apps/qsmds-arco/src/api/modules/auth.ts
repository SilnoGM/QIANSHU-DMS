import type { AxiosInstance } from 'axios'
import type {
  AuthContextDto,
  ChangePasswordRequestDto,
  LoginRequestDtoWritable,
} from '../generated/types.gen'

import api from '../index'

/** 真实 Cookie Session 认证 API；密码和 Session mutation 一律禁止自动重试。 */
export function createAuthApi(client: AxiosInstance) {
  return {
    login: (data: LoginRequestDtoWritable) =>
      client.post<AuthContextDto>('auth/login', data, {
        errorPresentation: 'local',
        retry: false,
      }),
    me: (
      signal?: AbortSignal,
      broadcastSessionInvalid = true,
    ) =>
      client.get<AuthContextDto>('auth/me', {
        retry: false,
        ...(broadcastSessionInvalid
          ? {}
          : { broadcastSessionInvalid: false }),
        ...(signal === undefined ? {} : { signal }),
      }),
    changePassword: (data: ChangePasswordRequestDto) =>
      client.post<AuthContextDto>('auth/password/change', data, {
        errorPresentation: 'local',
        retry: false,
      }),
    logout: () => client.post<void>('auth/logout', {}, {
      errorPresentation: 'local',
      retry: false,
    }),
    logoutAll: () => client.post<void>('auth/logout-all', {}, {
      errorPresentation: 'local',
      retry: false,
    }),
  }
}

export default createAuthApi(api)
