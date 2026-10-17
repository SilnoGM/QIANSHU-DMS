import type { AxiosInstance } from 'axios'
import type {
  ApproveFundWithdrawalDto,
  CreateFundWithdrawalDto,
  FundWithdrawalDto,
  FundWithdrawalPageDto,
  FundWithdrawalProofUploadDto,
  FundWithdrawalsListData,
  FundWithdrawalsListSelfData,
  RejectFundWithdrawalDto,
} from '../generated/types.gen'
import api from '../index'

export type FundWithdrawalListSelfQuery = NonNullable<FundWithdrawalsListSelfData['query']>
export type FundWithdrawalListQuery = NonNullable<FundWithdrawalsListData['query']>

/**
 * 提款申请/审批 API。提交带幂等键；通过/拒绝用版本号裁决，不允许自动重试。
 * 付款截图读取返回 blob，页面自行生成本地预览 URL，避免把私有凭证 URL 暴露给非授权上下文。
 */
export function createFundWithdrawalsApi(client: AxiosInstance) {
  const path = (id: string) => `fund-withdrawals/${encodeURIComponent(id)}`
  const read = (signal: AbortSignal) => ({ errorPresentation: 'local' as const, signal })
  const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })
  return {
    listSelf: (query: FundWithdrawalListSelfQuery, signal: AbortSignal) =>
      client.get<FundWithdrawalPageDto>('fund-withdrawals/me', { ...read(signal), params: query }),
    getSelf: (id: string, signal: AbortSignal) =>
      client.get<FundWithdrawalDto>(`fund-withdrawals/me/${encodeURIComponent(id)}`, read(signal)),
    list: (query: FundWithdrawalListQuery, signal: AbortSignal) =>
      client.get<FundWithdrawalPageDto>('fund-withdrawals', { ...read(signal), params: query }),
    get: (id: string, signal: AbortSignal) =>
      client.get<FundWithdrawalDto>(path(id), read(signal)),
    create: (data: CreateFundWithdrawalDto, idempotencyKey: string) =>
      client.post<FundWithdrawalDto>('fund-withdrawals', data, {
        errorPresentation: 'local',
        retry: false,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    approve: (id: string, data: ApproveFundWithdrawalDto, signal: AbortSignal) =>
      client.post<FundWithdrawalDto>(`${path(id)}/approvals`, data, write(signal)),
    reject: (id: string, data: RejectFundWithdrawalDto, signal: AbortSignal) =>
      client.post<FundWithdrawalDto>(`${path(id)}/rejections`, data, write(signal)),
    uploadProof: (id: string, file: File, signal: AbortSignal) => {
      const body = new FormData()
      // 流式解析器要求 mediaType 先于 file。
      body.append('mediaType', 'IMAGE')
      body.append('file', file)
      return client.post<FundWithdrawalProofUploadDto>(`${path(id)}/payment-proofs`, body, write(signal))
    },
    proofSelf: (id: string, signal: AbortSignal) =>
      client.get<Blob>(`fund-withdrawals/me/${encodeURIComponent(id)}/payment-proof`, {
        ...read(signal),
        responseType: 'blob',
      }),
    proofReview: (id: string, signal: AbortSignal) =>
      client.get<Blob>(`${path(id)}/payment-proof`, {
        ...read(signal),
        responseType: 'blob',
      }),
  }
}

const fundWithdrawalsApi = createFundWithdrawalsApi(api)
export default fundWithdrawalsApi
