import type { AxiosInstance } from 'axios'
import type {
  SlhBillPageDto,
  SlhReconciliationBatchCandidatesData,
  SlhReconciliationBatchCreateDto,
  SlhReconciliationBatchDetailDto,
  SlhReconciliationBatchesListData,
  SlhReconciliationBatchPageDto,
  SlhReconciliationBillOptionPageDto,
  SlhReconciliationBillOptionsData,
  SlhReconciliationReconcilableCountsDto,
  SlhReconciliationReconcilableCountsRequestDto,
  SlhReconciliationSettlementCreateDto,
  SlhReconciliationSettlementDto,
} from '../generated/types.gen'
import api from '../index'

export type SlhReconciliationBatchListQuery = NonNullable<SlhReconciliationBatchesListData['query']>
export type SlhReconciliationBatchCandidateQuery = NonNullable<SlhReconciliationBatchCandidatesData['query']>
export type SlhReconciliationBillOptionQuery = NonNullable<SlhReconciliationBillOptionsData['query']>

const path = (id: string) => `slh-reconciliation-batches/${encodeURIComponent(id)}`
const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })
const write = (signal: AbortSignal) => ({ ...read(signal), retry: false as const })

export function createSlhReconciliationBatchesApi(client: AxiosInstance) {
  return {
    list: (query: SlhReconciliationBatchListQuery, signal: AbortSignal) => client.get<SlhReconciliationBatchPageDto>('slh-reconciliation-batches', { ...read(signal), params: query }),
    candidates: (query: SlhReconciliationBatchCandidateQuery, signal: AbortSignal) => client.get<SlhBillPageDto>('slh-reconciliation-batches/candidates', { ...read(signal), params: query }),
    // 可选/不可选两组账单：group 选择返回哪一组，计数始终同时给出。
    selectableBills: (query: SlhReconciliationBillOptionQuery, signal: AbortSignal) => client.get<SlhReconciliationBillOptionPageDto>('slh-reconciliation-batches/selectable-bills', { ...read(signal), params: query }),
    // 批量算「当前可核对」是只读查询，但用 POST 传账单标识：不进 URL，也就不进日志与历史记录。
    reconcilableCounts: (data: SlhReconciliationReconcilableCountsRequestDto, signal: AbortSignal) => client.post<SlhReconciliationReconcilableCountsDto>('slh-reconciliation-batches/reconcilable-counts', data, write(signal)),
    // 创建会消耗批次编号，重复提交必须命中同一批次：携带幂等键且禁用自动重试。
    create: (data: SlhReconciliationBatchCreateDto, key: string, signal: AbortSignal) => client.post<SlhReconciliationBatchDetailDto>('slh-reconciliation-batches', data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
    get: (id: string, signal: AbortSignal) => client.get<SlhReconciliationBatchDetailDto>(path(id), read(signal)),
    complete: (id: string, signal: AbortSignal) => client.post<SlhReconciliationBatchDetailDto>(`${path(id)}/complete`, {}, write(signal)),
    // 确认结算：同样携带幂等键，双击或网络重试只会恢复同一条结算记录。
    settle: (id: string, data: SlhReconciliationSettlementCreateDto, key: string, signal: AbortSignal) => client.post<SlhReconciliationSettlementDto>(`${path(id)}/settlements`, data, { ...write(signal), headers: { 'Idempotency-Key': key } }),
  }
}

export default createSlhReconciliationBatchesApi(api)
