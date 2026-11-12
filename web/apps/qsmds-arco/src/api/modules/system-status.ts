import type { AxiosInstance } from 'axios'
import type { SystemStatusGetResponse } from '../generated/types.gen'

import api from '../index'

/**
 * 系统状态是管理员只读诊断接口。
 *
 * 错误交给页面局部展示（`errorPresentation: 'local'` + 不自动重试），避免状态页
 * 加载失败时再弹全局 Toast；请求只读，不需要 CSRF 头。
 */
export function createSystemStatusApi(client: AxiosInstance) {
  return {
    get: (signal?: AbortSignal) =>
      client.get<SystemStatusGetResponse>('system/status', {
        errorPresentation: 'local',
        retry: false,
        ...(signal === undefined ? {} : { signal }),
      }),
  }
}

export default createSystemStatusApi(api)
