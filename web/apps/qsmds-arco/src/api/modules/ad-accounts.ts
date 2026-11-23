import type { AxiosInstance } from 'axios'
import type {
  AdAccountAssigneeDto,
  AdAccountAssignmentResultDto,
  AdAccountBalanceAlertSummaryDto,
  AdAccountListDto,
  AdAccountReleaseResultDto,
  AssignAdAccountRequestDto,
  SyncAdAccountsResultDto,
} from '../generated/types.gen'
import api from '../index'

/**
 * 猎豹广告账户请求契约。
 *
 * 写请求一律 `retry: false`：绑定与同步由服务端状态裁决，自动重放只会把
 * 409 冲突藏起来。无业务入参的 POST 仍发送空 JSON，避免 CSRF 守卫拒绝。
 */
export function createAdAccountsApi(client: AxiosInstance) {
  const path = (id: string) => `ad-accounts/${encodeURIComponent(id)}`
  const read = (signal: AbortSignal) => ({ errorPresentation: 'local' as const, signal })
  const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })

  return {
    listMine: (signal: AbortSignal) =>
      client.get<AdAccountListDto>('ad-accounts/mine', read(signal)),
    list: (signal: AbortSignal) =>
      client.get<AdAccountListDto>('ad-accounts', read(signal)),
    alertSummaryMine: (signal: AbortSignal) =>
      client.get<AdAccountBalanceAlertSummaryDto>('ad-accounts/mine/alert-summary', read(signal)),
    alertSummary: (signal: AbortSignal) =>
      client.get<AdAccountBalanceAlertSummaryDto>('ad-accounts/alert-summary', read(signal)),
    assignableUsers: (keyword: string | undefined, signal: AbortSignal) =>
      client.get<AdAccountAssigneeDto[]>('ad-accounts/assignable-users', {
        ...read(signal),
        params: keyword === undefined || keyword.trim() === ''
          ? undefined
          : { keyword: keyword.trim() },
      }),
    sync: (signal: AbortSignal) =>
      client.post<SyncAdAccountsResultDto>('ad-accounts/sync', {}, write(signal)),
    assign: (id: string, data: AssignAdAccountRequestDto, signal: AbortSignal) =>
      client.post<AdAccountAssignmentResultDto>(`${path(id)}/assign`, data, write(signal)),
    release: (id: string, signal: AbortSignal) =>
      client.post<AdAccountReleaseResultDto>(`${path(id)}/release`, {}, write(signal)),
  }
}

export default createAdAccountsApi(api)
