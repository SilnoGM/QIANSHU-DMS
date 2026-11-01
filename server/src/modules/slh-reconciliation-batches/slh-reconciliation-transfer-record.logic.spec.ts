import {
  readTransferAllocationSummary,
  readTransferChangeCounts,
  readTransferChangeItems,
  readTransferClaimLines,
  readTransferCostTotal,
  selectCurrentTransferRecord,
} from './slh-reconciliation-transfer-record.logic'

describe('slh reconciliation transfer record logic', () => {
  it('counts recipient and COD changes from the claim snapshot', () => {
    expect(readTransferChangeCounts([
      { recipientChanged: true, codChanged: false },
      { recipientChanged: true, codChanged: true },
      { recipientChanged: false, codChanged: false },
      null,
      'invalid',
    ])).toEqual({ recipientChangeCount: 2, codChangeCount: 1 })
    expect(readTransferChangeCounts(null)).toEqual({ recipientChangeCount: 0, codChangeCount: 0 })
  })

  it('lists claim products and full change before/after values', () => {
    expect(readTransferClaimLines([
      { lineNumber: 2, productName: '1号炉', quantity: 2, productMatchMode: 'AUTO' },
      { lineNumber: 3, productName: '', quantity: 1, productMatchMode: 'MANUAL_OVERRIDE' },
      { lineNumber: 4, productName: '2号炉', quantity: 0, productMatchMode: null },
    ])).toEqual([
      { lineNumber: 2, productName: '1号炉', quantity: 2, productMatchMode: 'AUTO' },
    ])
    expect(readTransferClaimLines(null)).toEqual([])

    expect(readTransferChangeItems([
      {
        lineNumber: 2,
        oceanShippingMarkText: 'J-01',
        containerBatchName: '0305柜',
        recipientChanged: true,
        codChanged: true,
        beforeRecipientName: '鄭家銘',
        afterRecipientName: '测试AA',
        beforeRecipientPhone: '973216146',
        afterRecipientPhone: '222222',
        beforeRecipientAddress: '龜山鄉',
        afterRecipientAddress: '南投縣',
        beforeCodAmountTwd: '40000.00',
        afterCodAmountTwd: '41000.00',
      },
      { lineNumber: 3, recipientChanged: false, codChanged: false },
    ])).toEqual([{
      lineNumber: 2,
      shippingMark: 'J-01',
      containerBatchName: '0305柜',
      recipientChanged: true,
      codChanged: true,
      beforeRecipientName: '鄭家銘',
      afterRecipientName: '测试AA',
      beforeRecipientPhone: '973216146',
      afterRecipientPhone: '222222',
      beforeRecipientAddress: '龜山鄉',
      afterRecipientAddress: '南投縣',
      beforeCodAmountTwd: '40000.00',
      afterCodAmountTwd: '41000.00',
    }])
    expect(readTransferChangeItems(null)).toEqual([])
  })

  it('summarizes claim lines and falls back to the application allocations', () => {
    expect(readTransferAllocationSummary([
      { quantity: 2, productMatchMode: 'AUTO' },
      { quantity: 1, productMatchMode: 'MANUAL_OVERRIDE' },
    ], null)).toEqual({ lineCount: 2, totalQuantity: 3, manualMatchCount: 1 })

    expect(readTransferAllocationSummary([], [
      { quantity: 1, productMatchMode: 'AUTO' },
      { quantity: 4, productMatchMode: 'MANUAL_OVERRIDE' },
    ])).toEqual({ lineCount: 2, totalQuantity: 5, manualMatchCount: 1 })
    expect(readTransferAllocationSummary([], null)).toEqual({ lineCount: 0, totalQuantity: 0, manualMatchCount: 0 })
  })

  it('reads the total cost from the snapshot without inventing a zero', () => {
    expect(readTransferCostTotal({ totalCostCny: '2600.00' })).toBe('2600.00')
    expect(readTransferCostTotal({ totalCostCny: 2600 })).toBe('2600.00')
    expect(readTransferCostTotal({ totalCostCny: null })).toBeNull()
    expect(readTransferCostTotal(null)).toBeNull()
  })

  it('selects the record claimed by the current sales order, not an earlier claim or correction', () => {
    const records = [
      { id: 'older-other', claimedSalesOrderId: 'other', claimedAt: new Date('2026-10-30T08:55:42Z'), createdAt: new Date('2026-10-28T00:00:00Z') },
      { id: 'current', claimedSalesOrderId: 'current', claimedAt: new Date('2026-10-30T08:55:42Z'), createdAt: new Date('2026-10-29T00:00:00Z') },
      { id: 'current-older', claimedSalesOrderId: 'current', claimedAt: new Date('2026-10-29T00:00:00Z'), createdAt: new Date('2026-10-28T00:00:00Z') },
    ]
    expect(selectCurrentTransferRecord(records, 'current')?.id).toBe('current')
    expect(selectCurrentTransferRecord(records, 'missing')).toBeNull()
  })
})
