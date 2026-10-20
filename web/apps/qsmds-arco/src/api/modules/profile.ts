import type { AxiosInstance } from 'axios'
import type {
  CurrentUserProfileDto,
  ProfileAvatarUploadDto,
  UpdateCurrentUserProfileRequestDto,
} from '../generated/types.gen'

import api from '../index'

/** 本人资料 API 只复用 OpenAPI DTO；PATCH 与上传都是不可安全重放的审计 mutation。 */
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
    uploadAvatar: (file: File, signal?: AbortSignal) => {
      const body = new FormData()
      // 服务端流式 multipart 解析器要求 mediaType 位于 file part 之前。
      body.append('mediaType', 'IMAGE')
      body.append('file', file, file.name)
      return client.post<ProfileAvatarUploadDto>('profile/avatar-uploads', body, {
        errorPresentation: 'local',
        retry: false,
        ...(signal === undefined ? {} : { signal }),
      })
    },
  }
}

export default createProfileApi(api)
