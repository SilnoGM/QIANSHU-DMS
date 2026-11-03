import type { AxiosInstance } from 'axios'
import type {
  AssignableUserDto,
  AssignProxyNodeRequestDto,
  ProxyNodeAssignmentResultDto,
  ProxyNodeListDto,
  ProxyNodeReleaseResultDto,
  SyncProxyNodesResultDto,
} from '../generated/types.gen'
import api from '../index'

/**
 * IPFoxy 静态节点请求契约。
 *
 * 写请求一律 `retry: false`：同步与绑定由服务端状态裁决，自动重放只会把
 * 409 冲突藏起来。无业务入参的 POST 仍发送空 JSON，避免 CSRF 守卫拒绝。
 */
export function createProxyNodesApi(client: AxiosInstance) {
  const path = (id: string) => `proxy-nodes/${encodeURIComponent(id)}`
  const read = (signal: AbortSignal) => ({ errorPresentation: 'local' as const, signal })
  const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })

  return {
    listMine: (signal: AbortSignal) =>
      client.get<ProxyNodeListDto>('proxy-nodes/mine', read(signal)),
    list: (signal: AbortSignal) =>
      client.get<ProxyNodeListDto>('proxy-nodes', read(signal)),
    assignableUsers: (keyword: string | undefined, signal: AbortSignal) =>
      client.get<AssignableUserDto[]>('proxy-nodes/assignable-users', {
        ...read(signal),
        params: keyword === undefined || keyword.trim() === ''
          ? undefined
          : { keyword: keyword.trim() },
      }),
    sync: (signal: AbortSignal) =>
      client.post<SyncProxyNodesResultDto>('proxy-nodes/sync', {}, write(signal)),
    assign: (id: string, data: AssignProxyNodeRequestDto, signal: AbortSignal) =>
      client.post<ProxyNodeAssignmentResultDto>(`${path(id)}/assign`, data, write(signal)),
    release: (id: string, signal: AbortSignal) =>
      client.post<ProxyNodeReleaseResultDto>(`${path(id)}/release`, {}, write(signal)),
  }
}

export default createProxyNodesApi(api)
