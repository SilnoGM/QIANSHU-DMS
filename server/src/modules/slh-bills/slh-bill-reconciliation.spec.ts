import { resolveSlhBillLineReconciliationStatus, resolveSlhBillReconciliationStatus } from './slh-bill-reconciliation'

describe('SLH bill reconciliation status', () => {
  it('derives the bill status from reconciled lines', () => {
    // 一条都没对 → 未对账；全对完 → 对账完成；中间 → 部分对账。
    expect(resolveSlhBillReconciliationStatus({ lineCount: 44, reconciledLineCount: 0 })).toBe('PENDING')
    expect(resolveSlhBillReconciliationStatus({ lineCount: 44, reconciledLineCount: 1 })).toBe('PARTIAL')
    expect(resolveSlhBillReconciliationStatus({ lineCount: 44, reconciledLineCount: 43 })).toBe('PARTIAL')
    expect(resolveSlhBillReconciliationStatus({ lineCount: 44, reconciledLineCount: 44 })).toBe('COMPLETED')
  })

  it('keeps the bill status valid on defensive inputs', () => {
    // 空账单按未对账处理，不影响「全部对账完成」的判定。
    expect(resolveSlhBillReconciliationStatus({ lineCount: 0, reconciledLineCount: 0 })).toBe('PENDING')
    // 脏数据（已对账行数超过总行数）按完成处理，不卡在部分对账。
    expect(resolveSlhBillReconciliationStatus({ lineCount: 3, reconciledLineCount: 5 })).toBe('COMPLETED')
    // 负数只作异常输入防御，不应被当成「部分对账」。
    expect(resolveSlhBillReconciliationStatus({ lineCount: 5, reconciledLineCount: -1 })).toBe('PENDING')
  })

  it('maps a line to two states by its reconciliation timestamp', () => {
    expect(resolveSlhBillLineReconciliationStatus(null)).toBe('PENDING')
    expect(resolveSlhBillLineReconciliationStatus(new Date('2026-09-27T00:00:00.000Z'))).toBe('RECONCILED')
  })
})
