import type { AxiosInstance, AxiosResponse } from 'axios'
import type { HealthGetErrors, HealthGetResponses } from '../generated/types.gen'

import api from '../index'

export type HealthResponse = HealthGetResponses[200]
export type HealthFailureResponse = HealthGetErrors[503]
/** 503 也是健康检查的正常读数，因此调用方可能拿到失败响应体。 */
export type HealthResponseBody = HealthResponse | HealthFailureResponse

export interface HealthRequestOptions {
  /**
   * 系统状态页自带内联错误态，因此默认不触发全局 Toast：
   * 服务端 503 是健康检查的预期结果之一，不是需要打断用户的报错。
   */
  errorPresentation?: 'global' | 'local'
  /** 把 503 视为可读响应，便于展示 Terminus 的指示器明细而不是只看到状态码。 */
  acceptUnhealthyResponse?: boolean
}

/**
 * 健康检查保留完整 Axios response，使调用方能够同时读取响应体、状态码和 X-Request-Id。
 * Web Client 的 baseURL 已包含 `/api`，因此这里使用相对业务路径 `/health`。
 */
export function getHealth(
  client: AxiosInstance = api,
  options: HealthRequestOptions = {},
): Promise<AxiosResponse<HealthResponseBody>> {
  return client.get<HealthResponseBody>('/health', {
    errorPresentation: options.errorPresentation ?? 'local',
    ...(options.acceptUnhealthyResponse === true
      ? { validateStatus: (status: number) => status === 200 || status === 503 }
      : {}),
  })
}
