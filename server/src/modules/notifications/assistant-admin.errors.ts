import { ApiException } from '../../infrastructure/http/api.exception'
import type { AssistantAdminError } from './notification.types'

/**
 * 把传输层分类保留为可操作的管理端错误，而不是全部折叠成通用 503。
 * 只使用固定文案，不回传 GeWe 原始 msg，避免把上游细节带进响应。
 */
export function assistantAdminErrorToApiException(error: AssistantAdminError): ApiException {
  if (error.code === 'ASSISTANT_TOKEN_MISSING') {
    return new ApiException(503, 'ASSISTANT_NOT_CONFIGURED', '千树小助理未配置')
  }
  if (error.code === 'ASSISTANT_BASE_URL_INVALID') {
    return new ApiException(503, 'ASSISTANT_OUTBOUND_BLOCKED', 'GeWe 地址校验失败，请检查代理或 DNS 设置')
  }
  if (error.kind === 'OFFLINE' || error.code === 'ASSISTANT_OFFLINE') {
    return new ApiException(422, 'ASSISTANT_ACCOUNT_OFFLINE', '公司号离线，请先在 GeWe 控制台重连')
  }
  if (error.kind === 'RATE_LIMITED' || error.code === 'ASSISTANT_RATE_LIMITED') {
    return new ApiException(429, 'ASSISTANT_RATE_LIMITED', 'GeWe 请求被限流，请稍后重试')
  }
  if (
    error.code === 'ASSISTANT_TIMEOUT'
    || error.code === 'ASSISTANT_NETWORK_ERROR'
    || error.code === 'ASSISTANT_DNS_ERROR'
  ) {
    return new ApiException(503, 'ASSISTANT_UPSTREAM_UNAVAILABLE', '无法连接 GeWe，请检查网络或 DNS')
  }
  return new ApiException(503, 'ASSISTANT_UPSTREAM_UNAVAILABLE', '千树小助理服务暂时不可用')
}
