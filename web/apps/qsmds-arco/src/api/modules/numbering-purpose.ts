import type { NumberingRuleDetailDto, NumberingRulePageDto } from '../generated/types.gen'

export type NumberingPurpose = NumberingRuleDetailDto['purpose']
export type NumberingPurposeView = 'ALL' | NumberingPurpose

/** URL、请求 builder 与响应解码共用同一白名单；缺失用途不做历史兼容推断。 */
export function parseNumberingPurpose(value: unknown): NumberingPurpose | null {
  return value === 'BUSINESS' || value === 'SHIPPING_MARK' ? value : null
}

export function numberingPurposeLabel(value: NumberingPurpose): string {
  return value === 'BUSINESS' ? '业务编码' : '唛头编码'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertNumberingRulePurpose(value: unknown): asserts value is NumberingRuleDetailDto {
  if (!isRecord(value) || parseNumberingPurpose(value.purpose) === null) {
    throw new Error('编号规则用途响应无效，请刷新后重试')
  }
}

/** 必须校验三项完整聚合，再交给 Toolbar；不能把遗漏或旧契约响应显示成 0。 */
export function assertNumberingPurposePage(value: unknown, purpose?: NumberingPurpose): asserts value is NumberingRulePageDto {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.purposeCounts)) {
    throw new Error('编号分类统计响应无效，请刷新后重试')
  }
  const keys = ['ALL', 'BUSINESS', 'SHIPPING_MARK'] as const
  const counts = value.purposeCounts
  if (counts.length !== 3 || counts.some((entry, index) =>
    !isRecord(entry) || entry.value !== keys[index]
    || !Number.isSafeInteger(entry.count) || Number(entry.count) < 0)) {
    throw new Error('编号分类统计响应无效，请刷新后重试')
  }
  if (counts[0].count !== counts[1].count + counts[2].count
    || value.total !== counts[keys.indexOf(purpose ?? 'ALL')].count
    || !Number.isSafeInteger(value.page) || Number(value.page) < 1
    || !Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1
    || Number(value.pageSize) > 100 || value.items.length > Number(value.pageSize)) {
    throw new Error('编号分类统计响应不一致，请刷新后重试')
  }
  for (const item of value.items) {
    assertNumberingRulePurpose(item)
    if (purpose !== undefined && item.purpose !== purpose) {
      throw new Error('编号列表用途与筛选不一致，请刷新后重试')
    }
  }
}
