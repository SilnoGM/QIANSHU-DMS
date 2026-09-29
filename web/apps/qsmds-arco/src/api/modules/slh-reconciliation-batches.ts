import type { AxiosInstance } from 'axios'
import type {
  SlhBillPageDto,
  SlhReconciliationBatchCandidatesData,
  SlhReconciliationBatchCreateDto,
  SlhReconciliationBatchDetailDto,
  SlhReconciliationBatchesListData,
  SlhReconciliationBatchPageDto,
  SlhReconciliationBatchPreviewDto,
  SlhReconciliationBatchPreviewRequestDto,
  SlhReconciliationBatchReconcileDto,
} from '../generated/types.gen'
import api from '../index'

export type SlhReconciliationBatchListQuery = NonNullable<SlhReconciliationBatchesListData['query']>
export type SlhReconciliationBatchCandidateQuery = NonNullable<SlhReconciliationBatchCandidatesData['query']>

const path = (id: string) => `slh-reconciliation-batches/${encodeURIComponent(id)}`
const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })
const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })

export function createSlhReconciliationBatchesApi(client: AxiosInstance) {
  return {
    list: (query: SlhReconciliationBatchListQuery, signal: AbortSignal) => client.get<SlhReconciliationBatchPageDto>('slh-reconciliation-batches', { ...read(signal), params: query }),
    // 候选账单与匹配预览都是只读查询，但用 POST 传账单标识：不进 URL，也就不进日志与历史记录。
    candidates: (query: SlhReconciliationBatchCandidateQuery, signal: AbortSignal) => client.get<SlhBillPageDto>('slh-reconciliation-batches/candidates', { ...read(signal), params: query }),
    matchPreview: (data: SlhReconciliationBatchPreviewRequestDto, signal: AbortSignal) => client.post<SlhReconciliationBatchPreviewDto>('slh-reconciliation-batches/match-preview', data, write(signal)),
    // 创建会消耗批次编号，重复提交必须命中同一批次：携带幂等键且禁用自动重试。
    create: (data: SlhReconciliationBatchCreateDto, key: string, signal: AbortSignal) => client.post<SlhReconciliationBatchDetailDto>('slh-reconciliation-batches', data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    get: (id: string, signal: AbortSignal) => client.get<SlhReconciliationBatchDetailDto>(path(id), read(signal)),
    reconcile: (id: string, data: SlhReconciliationBatchReconcileDto, signal: AbortSignal) => client.post<SlhReconciliationBatchDetailDto>(`${path(id)}/reconcile`, data, write(signal)),
    complete: (id: string, signal: AbortSignal) => client.post<SlhReconciliationBatchDetailDto>(`${path(id)}/complete`, {}, write(signal)),
  }
}

export default createSlhReconciliationBatchesApi(api)
