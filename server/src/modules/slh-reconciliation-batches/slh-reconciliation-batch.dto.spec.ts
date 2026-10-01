import { SLH_BILL_LINE_UNMATCHED_REASONS } from './slh-bill-line-matching'
import {
  SlhBillLineMatchSourceDto, SlhBillLineUnmatchedReasonDto, SlhReconciliationBatchFilterDto,
  SlhReconciliationBatchStatusDto,
} from './slh-reconciliation-batch.dto'

/**
 * 接口层枚举镜像规则层取值：两边是两份声明，靠这里的断言保证不漂移。
 * 前端按枚举值映射文案，多一个或少一个都会在页面上表现为空白或丢失原因。
 */
describe('对账批次的接口枚举镜像规则层取值', () => {
  it('未匹配合格的原因码与规则层一一对应', () => {
    expect(Object.values(SlhBillLineUnmatchedReasonDto).sort()).toEqual([...SLH_BILL_LINE_UNMATCHED_REASONS].sort())
  })

  it('匹配来源与持久化枚举取值一致', () => {
    expect(Object.values(SlhBillLineMatchSourceDto).sort()).toEqual(['MARK', 'NAME'])
  })

  it('批次状态与筛选取值稳定', () => {
    expect(Object.values(SlhReconciliationBatchStatusDto).sort()).toEqual(['COMPLETED', 'IN_PROGRESS'])
    // `all` 沿用账单筛选的小写约定，ASCII 排序在末尾。
    expect(Object.values(SlhReconciliationBatchFilterDto).sort()).toEqual(['COMPLETED', 'IN_PROGRESS', 'all'])
  })
})
