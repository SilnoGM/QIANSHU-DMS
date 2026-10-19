import type { AxiosInstance, AxiosResponse } from 'axios'
import type { HealthGetResponses } from '../generated/types.gen'

import api from '../index'

export type HealthResponse = HealthGetResponses[200]

/**
 * 健康检查保留完整 Axios response，使调用方能够同时读取响应体、状态码和 X-Request-Id。
 * Web Client 的 baseURL 已包含 `/api`，因此这里使用相对业务路径 `/health`。
 * 健康状态属于页面局部提示，不触发全局错误 Toast，也不自动重试以免掩盖持续故障。
 */
export function getHealth(
  client: AxiosInstance = api,
  signal?: AbortSignal,
): Promise<AxiosResponse<HealthResponse>> {
  return client.get<HealthResponse>('/health', {
    errorPresentation: 'local',
    retry: false,
    signal,
  })
}
