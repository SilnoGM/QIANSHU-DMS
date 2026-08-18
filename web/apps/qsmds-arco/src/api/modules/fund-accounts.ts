import type { AxiosInstance } from 'axios'
import type {
  ChangeFundConfigurationStatusRequestDto,
  CreateFundAccountRequestDto,
  CreateFundBusinessSourceRequestDto,
  CreateFundManualAdjustmentRequestDto,
  CreateFundPostingTypeRequestDto,
  CreateFundReversalRequestDto,
  FundAccountDto,
  FundAccountMutationResultDto,
  FundAccountPageDto,
  FundAccountsListData,
  FundBusinessSourceDto,
  FundBusinessSourceMutationResultDto,
  FundBusinessSourcePageDto,
  FundBusinessSourcesListData,
  FundPostingBatchDetailDto,
  FundPostingResultDto,
  FundPostingTypeDto,
  FundPostingTypeMutationResultDto,
  FundPostingTypePageDto,
  FundPostingTypesListData,
  FundTransactionPageDto,
  FundTransactionsListData,
  PublishFundPostingRuleRequestDto,
  ReplaceFundDraftRuleRequestDto,
  UpdateFundBusinessSourceRequestDto,
  UpdateFundPostingTypeRequestDto,
  UpdateFundShareRateRequestDto,
} from '../generated/types.gen'

import api from '../index'

export type FundAccountListQuery
  = NonNullable<FundAccountsListData['query']>
export type FundTransactionListQuery
  = NonNullable<FundTransactionsListData['query']>
export type FundPostingTypeListQuery
  = NonNullable<FundPostingTypesListData['query']>
export type FundBusinessSourceListQuery
  = NonNullable<FundBusinessSourcesListData['query']>

const LOCAL_MUTATION_CONFIG = Object.freeze({
  errorPresentation: 'local' as const,
  retry: false as const,
})

function resourcePath(resource: string, id: string): string {
  return `${resource}/${encodeURIComponent(id)}`
}

function idempotentMutationConfig(idempotencyKey: string) {
  return {
    ...LOCAL_MUTATION_CONFIG,
    headers: { 'Idempotency-Key': idempotencyKey },
  }
}

/**
 * 资金管理 API 只把 OpenAPI generated DTO 连接到应用级 Axios client，不在
 * Web 复制传输结构。factory 允许契约测试注入 recorder，生产运行时仍复用统一
 * 身份、CSRF、错误归一化和 private-cache 边界。
 *
 * GET 强制调用方传入 AbortSignal，以便页面在筛选、退出登录或撤权时取消旧请求；
 * mutation 不接收页面 AbortSignal，避免请求发出后被主动取消而扩大结果未知窗口。
 * 所有写请求均禁止自动重试，只有服务端支持幂等的调账和冲账携带 Idempotency-Key。
 */
export function createFundAccountsApi(client: AxiosInstance) {
  return {
    accounts: {
      list: (query: FundAccountListQuery, signal: AbortSignal) =>
        client.get<FundAccountPageDto>('fund-accounts', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      create: (data: CreateFundAccountRequestDto) =>
        client.post<FundAccountDto>(
          'fund-accounts',
          data,
          LOCAL_MUTATION_CONFIG,
        ),
      updateShareRate: (
        accountId: string,
        data: UpdateFundShareRateRequestDto,
      ) => client.patch<FundAccountMutationResultDto>(
        `${resourcePath('fund-accounts', accountId)}/share-rate`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      manualAdjust: (
        accountId: string,
        data: CreateFundManualAdjustmentRequestDto,
        idempotencyKey: string,
      ) => client.post<FundPostingResultDto>(
        `${resourcePath('fund-accounts', accountId)}/manual-adjustments`,
        data,
        idempotentMutationConfig(idempotencyKey),
      ),
    },
    transactions: {
      list: (query: FundTransactionListQuery, signal: AbortSignal) =>
        client.get<FundTransactionPageDto>('fund-transactions', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
    },
    batches: {
      get: (batchId: string, signal: AbortSignal) =>
        client.get<FundPostingBatchDetailDto>(
          resourcePath('fund-posting-batches', batchId),
          { errorPresentation: 'local', signal },
        ),
      reverse: (
        batchId: string,
        data: CreateFundReversalRequestDto,
        idempotencyKey: string,
      ) => client.post<FundPostingResultDto>(
        `${resourcePath('fund-posting-batches', batchId)}/reversals`,
        data,
        idempotentMutationConfig(idempotencyKey),
      ),
    },
    postingTypes: {
      list: (query: FundPostingTypeListQuery, signal: AbortSignal) =>
        client.get<FundPostingTypePageDto>('fund-posting-types', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      create: (data: CreateFundPostingTypeRequestDto) =>
        client.post<FundPostingTypeDto>(
          'fund-posting-types',
          data,
          LOCAL_MUTATION_CONFIG,
        ),
      update: (
        postingTypeId: string,
        data: UpdateFundPostingTypeRequestDto,
      ) => client.patch<FundPostingTypeMutationResultDto>(
        resourcePath('fund-posting-types', postingTypeId),
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      replaceDraftRule: (
        postingTypeId: string,
        data: ReplaceFundDraftRuleRequestDto,
      ) => client.post<FundPostingTypeMutationResultDto>(
        `${resourcePath('fund-posting-types', postingTypeId)}/draft-rule`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      publish: (
        postingTypeId: string,
        data: PublishFundPostingRuleRequestDto,
      ) => client.post<FundPostingTypeMutationResultDto>(
        `${resourcePath('fund-posting-types', postingTypeId)}/publish`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      enable: (
        postingTypeId: string,
        data: ChangeFundConfigurationStatusRequestDto,
      ) => client.post<FundPostingTypeMutationResultDto>(
        `${resourcePath('fund-posting-types', postingTypeId)}/enable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      disable: (
        postingTypeId: string,
        data: ChangeFundConfigurationStatusRequestDto,
      ) => client.post<FundPostingTypeMutationResultDto>(
        `${resourcePath('fund-posting-types', postingTypeId)}/disable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
    },
    businessSources: {
      list: (query: FundBusinessSourceListQuery, signal: AbortSignal) =>
        client.get<FundBusinessSourcePageDto>('fund-business-sources', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      create: (data: CreateFundBusinessSourceRequestDto) =>
        client.post<FundBusinessSourceDto>(
          'fund-business-sources',
          data,
          LOCAL_MUTATION_CONFIG,
        ),
      update: (
        businessSourceId: string,
        data: UpdateFundBusinessSourceRequestDto,
      ) => client.patch<FundBusinessSourceMutationResultDto>(
        resourcePath('fund-business-sources', businessSourceId),
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      enable: (
        businessSourceId: string,
        data: ChangeFundConfigurationStatusRequestDto,
      ) => client.post<FundBusinessSourceMutationResultDto>(
        `${resourcePath('fund-business-sources', businessSourceId)}/enable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      disable: (
        businessSourceId: string,
        data: ChangeFundConfigurationStatusRequestDto,
      ) => client.post<FundBusinessSourceMutationResultDto>(
        `${resourcePath('fund-business-sources', businessSourceId)}/disable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
    },
  }
}

export default createFundAccountsApi(api)
