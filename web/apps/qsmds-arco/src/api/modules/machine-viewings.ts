import type { AxiosInstance } from 'axios'
import type {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingPageDto,
  MachineViewingsListData,
} from '../generated/types.gen'
import api from '../index'

export type MachineViewingListQuery = NonNullable<MachineViewingsListData['query']>

const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })
const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })

/**
 * 看机预约：运营与采运共用同一对接口，归属范围由服务端按 `data-scope:all` 判定。
 *
 * 写请求强制关闭自动重试；重试必须复用同一个 Idempotency-Key，避免生成重复预约。
 */
export function createMachineViewingsApi(client: AxiosInstance) {
  return {
    list: (query: MachineViewingListQuery, signal: AbortSignal) =>
      client.get<MachineViewingPageDto>('machine-viewings', { ...read(signal), params: query }),
    create: (data: CreateMachineViewingDto, key: string, signal: AbortSignal) =>
      client.post<MachineViewingDto>('machine-viewings', data, {
        ...write(signal),
        headers: { 'Idempotency-Key': key },
      }),
  }
}

export default createMachineViewingsApi(api)
