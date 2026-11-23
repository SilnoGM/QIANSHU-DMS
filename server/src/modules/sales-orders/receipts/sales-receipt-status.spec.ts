import { SALES_RECEIPT_ENTRY_STATUS, SALES_RECEIPT_POSTING_STATUS, isSalesReceiptInFlight } from './sales-receipt-status'

describe('销售收款三步状态', () => {
  it('把三个未落终态的状态都视为在途，占用订单额度', () => {
    expect(['PENDING_REVIEW', 'PENDING_CONFIRM', 'PENDING_POSTING'].every(isSalesReceiptInFlight)).toBe(true)
  })

  it('终态与未知状态都不算在途', () => {
    expect(isSalesReceiptInFlight('APPROVED')).toBe(false)
    expect(isSalesReceiptInFlight('REJECTED')).toBe(false)
    expect(isSalesReceiptInFlight('VOIDED')).toBe(false)
  })

  it('入口与入账状态与数据库枚举顺序一致', () => {
    expect(SALES_RECEIPT_ENTRY_STATUS).toBe('PENDING_REVIEW')
    expect(SALES_RECEIPT_POSTING_STATUS).toBe('PENDING_POSTING')
  })
})
