import type { AxiosInstance } from 'axios'
import type {
  ChangeNumberingRuleStatusRequestDto,
  CloneNumberingRuleRequestDto,
  CreateNumberingRuleRequestDto,
  NumberingIssuancePageDto,
  NumberingRuleDetailDto,
  NumberingRuleIssuancesListData,
  NumberingRulePageDto,
  NumberingRulesListData,
  NumberingRuleVersionPageDto,
  NumberingRuleVersionsListData,
  PreviewNumberingRuleRequestDto,
  PreviewNumberingRuleResponseDto,
  PublishNumberingRuleRequestDto,
  UpdateNumberingRuleRequestDto,
} from '../generated/types.gen'

import api from '../index'
import { assertNumberingPurposePage, assertNumberingRulePurpose } from './numbering-purpose'

function validateRuleResponse<T extends { data: NumberingRuleDetailDto }>(response: T): T {
  assertNumberingRulePurpose(response.data)
  return response
}

export type { NumberingRuleListItemDto } from '../generated/types.gen'

export type NumberingRuleListQuery
  = NonNullable<NumberingRulesListData['query']>
export type NumberingVersionListQuery
  = NonNullable<NumberingRuleVersionsListData['query']>
export type NumberingIssuanceListQuery
  = NonNullable<NumberingRuleIssuancesListData['query']>

function numberingRulePath(ruleId: string): string {
  return `numbering-rules/${encodeURIComponent(ruleId)}`
}

const LOCAL_MUTATION_CONFIG = {
  errorPresentation: 'local' as const,
  retry: false as const,
}

/**
 * 编号管理只以 OpenAPI generated types 为传输真相源。factory 只供 Node 契约
 * 测试注入 recorder，运行时统一复用应用 Axios client。
 *
 * 所有写请求和无状态 preview 都禁止自动重试；网络结果未知时由页面重新读取
 * 当前规则核对。四个 GET 均显式接收 AbortSignal，供页面阻断迟到响应。
 */
export function createNumberingApi(client: AxiosInstance) {
  return {
    rules: {
      list: (query: NumberingRuleListQuery, signal: AbortSignal) =>
        client.get<NumberingRulePageDto>('numbering-rules', {
          errorPresentation: 'local',
          params: query,
          signal,
        }).then((response) => {
          assertNumberingPurposePage(response.data, query.purpose)
          return response
        }),
      get: (ruleId: string, signal: AbortSignal) =>
        client.get<NumberingRuleDetailDto>(numberingRulePath(ruleId), {
          errorPresentation: 'local',
          signal,
        }).then(validateRuleResponse),
      versions: (
        ruleId: string,
        query: NumberingVersionListQuery,
        signal: AbortSignal,
      ) => client.get<NumberingRuleVersionPageDto>(
        `${numberingRulePath(ruleId)}/versions`,
        {
          errorPresentation: 'local',
          params: query,
          signal,
        },
      ),
      issuances: (
        ruleId: string,
        query: NumberingIssuanceListQuery,
        signal: AbortSignal,
      ) => client.get<NumberingIssuancePageDto>(
        `${numberingRulePath(ruleId)}/issuances`,
        {
          errorPresentation: 'local',
          params: query,
          signal,
        },
      ),
      preview: (
        data: PreviewNumberingRuleRequestDto,
        signal: AbortSignal,
      ) =>
        client.post<PreviewNumberingRuleResponseDto>(
          'numbering-rules/preview',
          data,
          { ...LOCAL_MUTATION_CONFIG, signal },
        ),
      create: (data: CreateNumberingRuleRequestDto) =>
        client.post<NumberingRuleDetailDto>(
          'numbering-rules',
          data,
          LOCAL_MUTATION_CONFIG,
        ).then(validateRuleResponse),
      update: (ruleId: string, data: UpdateNumberingRuleRequestDto) =>
        client.patch<NumberingRuleDetailDto>(
          numberingRulePath(ruleId),
          data,
          LOCAL_MUTATION_CONFIG,
        ).then(validateRuleResponse),
      clone: (ruleId: string, data: CloneNumberingRuleRequestDto) =>
        client.post<NumberingRuleDetailDto>(
          `${numberingRulePath(ruleId)}/clone`,
          data,
          LOCAL_MUTATION_CONFIG,
        ).then(validateRuleResponse),
      publish: (ruleId: string, data: PublishNumberingRuleRequestDto) =>
        client.post<NumberingRuleDetailDto>(
          `${numberingRulePath(ruleId)}/publish`,
          data,
          LOCAL_MUTATION_CONFIG,
        ).then(validateRuleResponse),
      enable: (
        ruleId: string,
        data: ChangeNumberingRuleStatusRequestDto,
      ) => client.post<NumberingRuleDetailDto>(
        `${numberingRulePath(ruleId)}/enable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ).then(validateRuleResponse),
      disable: (
        ruleId: string,
        data: ChangeNumberingRuleStatusRequestDto,
      ) => client.post<NumberingRuleDetailDto>(
        `${numberingRulePath(ruleId)}/disable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ).then(validateRuleResponse),
    },
  }
}

export default createNumberingApi(api)
