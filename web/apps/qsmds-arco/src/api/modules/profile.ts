import type { AxiosInstance } from 'axios'
import type {
  CurrentUserProfileDto,
  UpdateCurrentUserProfileRequestDto,
} from '../generated/types.gen'

import api from '../index'

/** 本人资料 API 只复用 OpenAPI DTO；PATCH 是不可安全重放的审计 mutation。 */
export function createProfileApi(client: AxiosInstance) {
  return {
    get: (signal?: AbortSignal) =>
      client.get<CurrentUserProfileDto>('profile', {
        errorPresentation: 'local',
        ...(signal === undefined ? {} : { signal }),
      }),
    update: (data: UpdateCurrentUserProfileRequestDto) =>
      client.patch<CurrentUserProfileDto>('profile', data, {
        errorPresentation: 'local',
        retry: false,
      }),
  }
}

export default createProfileApi(api)
