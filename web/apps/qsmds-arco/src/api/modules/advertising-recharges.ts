import type { AxiosInstance } from 'axios'
import type {
  AdvertisingRechargeDto,
  AdvertisingRechargeMediaUploadDto,
  AdvertisingRechargePageDto,
  AdvertisingRechargesListData,
  AdvertisingRechargesListSelfData,
  CreateAdvertisingRechargeDto,
  PayAdvertisingRechargeDto,
  RejectAdvertisingRechargeDto,
  VoidAdvertisingRechargeDto,
} from '../generated/types.gen'
import api from '../index'

export type AdvertisingRechargeListSelfQuery = NonNullable<AdvertisingRechargesListSelfData['query']>
export type AdvertisingRechargeListQuery = NonNullable<AdvertisingRechargesListData['query']>

/**
 * 广告充值 API。创建带幂等键；付款/驳回/作废用版本号裁决，不允许自动重试。
 * 二维码与付款截图都走私有内容路由，页面自行生成预览，不暴露对象键。
 */
export function createAdvertisingRechargesApi(client: AxiosInstance) {
  const path = (id: string) => `advertising-recharges/${encodeURIComponent(id)}`
  const read = (signal: AbortSignal) => ({ errorPresentation: 'local' as const, signal })
  const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })
  const upload = (file: File) => {
    const body = new FormData()
    // 流式解析器要求 mediaType 先于 file。
    body.append('mediaType', 'IMAGE')
    body.append('file', file)
    return body
  }
  return {
    listSelf: (query: AdvertisingRechargeListSelfQuery, signal: AbortSignal) =>
      client.get<AdvertisingRechargePageDto>('advertising-recharges/me', { ...read(signal), params: query }),
    getSelf: (id: string, signal: AbortSignal) =>
      client.get<AdvertisingRechargeDto>(`advertising-recharges/me/${encodeURIComponent(id)}`, read(signal)),
    create: (data: CreateAdvertisingRechargeDto, idempotencyKey: string) =>
      client.post<AdvertisingRechargeDto>('advertising-recharges', data, {
        errorPresentation: 'local',
        retry: false,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    uploadQr: (file: File, signal: AbortSignal) =>
      client.post<AdvertisingRechargeMediaUploadDto>('advertising-recharges/qr-uploads', upload(file), write(signal)),
    withdraw: (id: string, data: { expectedVersion: number }, signal: AbortSignal) =>
      client.post<AdvertisingRechargeDto>(`${path(id)}/withdrawals`, data, write(signal)),
    list: (query: AdvertisingRechargeListQuery, signal: AbortSignal) =>
      client.get<AdvertisingRechargePageDto>('advertising-recharges', { ...read(signal), params: query }),
    get: (id: string, signal: AbortSignal) =>
      client.get<AdvertisingRechargeDto>(path(id), read(signal)),
    pay: (id: string, data: PayAdvertisingRechargeDto, signal: AbortSignal) =>
      client.post<AdvertisingRechargeDto>(`${path(id)}/payments`, data, write(signal)),
    reject: (id: string, data: RejectAdvertisingRechargeDto, signal: AbortSignal) =>
      client.post<AdvertisingRechargeDto>(`${path(id)}/rejections`, data, write(signal)),
    void: (id: string, data: VoidAdvertisingRechargeDto, signal: AbortSignal) =>
      client.post<AdvertisingRechargeDto>(`${path(id)}/voids`, data, write(signal)),
    uploadProof: (id: string, file: File, signal: AbortSignal) =>
      client.post<AdvertisingRechargeMediaUploadDto>(`${path(id)}/payment-proofs`, upload(file), write(signal)),
  }
}

const advertisingRechargesApi = createAdvertisingRechargesApi(api)
export default advertisingRechargesApi
