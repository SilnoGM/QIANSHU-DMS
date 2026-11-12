import { assistantAdminErrorToApiException } from './assistant-admin.errors'
import { AssistantAdminError } from './notification.types'

describe('assistantAdminErrorToApiException', () => {
  it('maps outbound guard failures to an actionable 503', () => {
    const result = assistantAdminErrorToApiException(new AssistantAdminError('ASSISTANT_BASE_URL_INVALID', 'REJECTED', 'GeWe 地址校验失败'))
    expect(result.getStatus()).toBe(503)
    expect(result).toMatchObject({ code: 'ASSISTANT_OUTBOUND_BLOCKED' })
  })

  it('maps offline and rate-limit failures to 422/429', () => {
    const offline = assistantAdminErrorToApiException(new AssistantAdminError('ASSISTANT_OFFLINE', 'OFFLINE', '公司号离线'))
    const limited = assistantAdminErrorToApiException(new AssistantAdminError('ASSISTANT_RATE_LIMITED', 'RATE_LIMITED', '请求被限流'))
    expect(offline.getStatus()).toBe(422)
    expect(offline).toMatchObject({ code: 'ASSISTANT_ACCOUNT_OFFLINE' })
    expect(limited.getStatus()).toBe(429)
    expect(limited).toMatchObject({ code: 'ASSISTANT_RATE_LIMITED' })
  })

  it('keeps token and network failures as distinct 503 codes', () => {
    const token = assistantAdminErrorToApiException(new AssistantAdminError('ASSISTANT_TOKEN_MISSING', 'REJECTED', '未配置'))
    const network = assistantAdminErrorToApiException(new AssistantAdminError('ASSISTANT_NETWORK_ERROR', 'NETWORK', '网络失败'))
    expect(token).toMatchObject({ code: 'ASSISTANT_NOT_CONFIGURED' })
    expect(network).toMatchObject({ code: 'ASSISTANT_UPSTREAM_UNAVAILABLE', publicMessage: '无法连接 GeWe，请检查网络或 DNS' })
  })
})
