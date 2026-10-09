import {
  SlhBillLineMatchSourceDto, SlhReconciliationBatchFilterDto,
  SlhReconciliationBatchStatusDto,
} from './slh-reconciliation-batch.dto'

/**
 * 接口层枚举取值稳定：前端按枚举值映射文案，多一个或少一个都会在页面上表现为空白或丢失原因。
 * 对账功能冻结期间这些取值仍是契约的一部分（DTO 原样保留），因此继续守住。
 */
describe('对账批次的接口枚举取值稳定', () => {
  it('匹配来源与持久化枚举取值一致', () => {
    expect(Object.values(SlhBillLineMatchSourceDto).sort()).toEqual(['MARK', 'NAME'])
  })

  it('批次状态与筛选取值稳定', () => {
    expect(Object.values(SlhReconciliationBatchStatusDto).sort()).toEqual(['COMPLETED', 'IN_PROGRESS'])
    // `all` 沿用账单筛选的小写约定，ASCII 排序在末尾。
    expect(Object.values(SlhReconciliationBatchFilterDto).sort()).toEqual(['COMPLETED', 'IN_PROGRESS', 'all'])
  })
})
