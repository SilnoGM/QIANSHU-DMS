import type {
  NumberingRuleConfigResponseDto,
} from '@/api/generated/types.gen'
import type { QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'

import { buildNumberingRuleListQuery } from './numbering-management.logic'

export type NumberingResetPolicy = NumberingRuleConfigResponseDto['resetPolicy']

export interface NumberingListResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

export interface NumberingListFailure {
  readonly message: string
  readonly requestId: string | undefined
}

export interface NumberingListSortingItem {
  readonly desc: boolean
  readonly id: string
}

/** 把 QsGenericTable 的受控状态适配为领域层唯一的列表查询构造输入。 */
export function buildNumberingTableListQuery(input: {
  readonly filters: QsGenericTableFilterValues
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly sorting: readonly NumberingListSortingItem[]
}) {
  const updatedAtSorting = input.sorting.find(item => item.id === 'updatedAt')

  return buildNumberingRuleListQuery({
    keyword: input.search,
    page: input.page,
    pageSize: input.pageSize,
    sortOrder: updatedAtSorting?.desc === false ? 'asc' : 'desc',
    status: input.filters.status,
  })
}

/**
 * 列表 GET 的完成顺序不可信。只有请求未取消、当前身份仍有读取权限、身份纪元
 * 未变化且仍是最后一次请求时，页面才允许应用响应，避免迟到数据跨身份回填。
 */
export function canApplyNumberingRuleListResponse(
  input: NumberingListResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isNumberingAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    isRecord(error) && (
      error.code === 'ERR_CANCELED'
      || error.name === 'CanceledError'
    )
  )
}

/** Axios 失败仍是不可信输入，只向页面暴露安全的本地错误文案与 requestId。 */
export function getNumberingListFailure(error: unknown): NumberingListFailure {
  if (!isRecord(error)) {
    return {
      message: '编号规则加载失败，请稍后重试',
      requestId: undefined,
    }
  }
  const body = isRecord(error.body) ? error.body : undefined
  return {
    message: typeof body?.message === 'string'
      ? body.message
      : typeof error.message === 'string'
        ? error.message
        : '编号规则加载失败，请稍后重试',
    requestId: typeof body?.requestId === 'string'
      ? body.requestId
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
  }
}

export function numberingResetPolicyLabel(policy: NumberingResetPolicy): string {
  return {
    DAILY: '每日重置',
    MONTHLY: '每月重置',
    NEVER: '永不重置',
    YEARLY: '每年重置',
  }[policy]
}

/**
 * 结构摘要保留每种片段的决定性参数，便于列表快速审查；它只负责展示，不参与
 * 编号生成或配置回写，正式生成仍完全由 Server 的版本快照负责。
 */
export function formatNumberingRuleStructure(
  config: NumberingRuleConfigResponseDto,
): string {
  return config.segments.map((segment) => {
    switch (segment.type) {
      case 'FIXED':
        return segment.value
      case 'DATE':
        return `{${segment.format}}`
      case 'SEPARATOR':
        return segment.value
      case 'SEQUENCE':
        return `{SEQ:${segment.width},start=${segment.startValue},step=${segment.step}}`
      case 'RANDOM':
        return `{RND:A${segment.letterLength},N${segment.digitLength},${segment.mode}}`
    }
    const exhaustiveSegment: never = segment
    return exhaustiveSegment
  }).join('')
}
