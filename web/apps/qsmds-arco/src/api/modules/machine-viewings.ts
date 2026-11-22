import type { AxiosInstance } from 'axios'
import type {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingManualNotificationTextDto,
  MachineViewingPageDto,
  MachineViewingsListData,
  MachineViewingStatusTransitionDto,
  UpdateMachineViewingDto,
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
    update: (id: string, data: UpdateMachineViewingDto, signal: AbortSignal) =>
      client.patch<MachineViewingDto>(`machine-viewings/${id}`, data, write(signal)),
    transitionStatus: (id: string, data: MachineViewingStatusTransitionDto, signal: AbortSignal) =>
      client.post<MachineViewingDto>(`machine-viewings/${id}/status-transitions`, data, write(signal)),
    manualNotificationText: (id: string, signal: AbortSignal) =>
      client.get<MachineViewingManualNotificationTextDto>(`machine-viewings/${id}/manual-notification-text`, read(signal)),
    markManuallyNotified: (id: string, signal: AbortSignal) =>
      client.post<MachineViewingDto>(`machine-viewings/${id}/manual-notifications`, undefined, write(signal)),
  }
}

export default createMachineViewingsApi(api)
