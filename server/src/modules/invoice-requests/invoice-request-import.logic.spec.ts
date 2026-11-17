import {
  buildInvoiceRequestImportKey,
  INVOICE_REQUEST_IMPORT_ITEM_ERROR,
  InvoiceRequestImportItemError,
  isUnreachableTotalAmount,
  planInvoiceRequestImportItem,
  type InvoiceRequestImportItemInput,
} from './invoice-request-import.logic'

const NOW = new Date('2026-11-17T03:00:00.000Z')

function item(overrides: Partial<InvoiceRequestImportItemInput> = {}): InvoiceRequestImportItemInput {
  return {
    sourceRef: 'srcrow-2',
    ownerUserId: '00000000-0000-4000-8000-000000000201',
    buyerName: '大坑古厝白馬有限公司',
    buyerTaxId: '42927875',
    invoiceRemark: null,
    internalRemark: '历史导入 INVOICE-HISTORY-20261117｜源表行 2',
    recipientName: '李弇義',
    recipientPhone: '0939298738',
    recipientAddress: '台南市新化區大坑里大坑尾18-6號',
    lines: [{ productName: '历史开票导入', quantity: 1, unitPrice: '47619' }],
    expected: { salesAmount: '47619', taxAmount: '2381', totalAmount: '50000' },
    totalAmount: null,
    targetStatus: 'ISSUED',
    occurredAt: { submittedAt: '2026-06-01T02:00:00.000Z', notifiedAt: '2026-06-01T03:00:00.000Z', documentUploadedAt: '2026-06-02T03:00:00.000Z' },
    documentMediaAssetId: '00000000-0000-4000-8000-000000000301',
    ...overrides,
  }
}

function expectItemError(action: () => unknown, code: string): void {
  try {
    action()
  }
  catch (error) {
    expect(error).toBeInstanceOf(InvoiceRequestImportItemError)
    expect((error as InvoiceRequestImportItemError).code).toBe(code)
    return
  }
  throw new Error(['expected import item error ', code].join(''))
}

describe('invoice request import planning', () => {
  it('computes amounts from lines and matches the paper totals', () => {
    const plan = planInvoiceRequestImportItem(item(), NOW)
    expect(plan.salesAmount).toBe(47_619n)
    expect(plan.taxAmount).toBe(2_381n)
    expect(plan.totalAmount).toBe(50_000n)
    expect(plan.taxAdjusted).toBe(false)
    expect(plan.computedTaxAmount).toBe(2_381n)
    expect(plan.lines[0].amount).toBe(47_619n)
    expect(plan.documentMediaAssetId).toBe('00000000-0000-4000-8000-000000000301')
  })

  it('sums multiple lines before applying the tax rate', () => {
    const plan = planInvoiceRequestImportItem(item({
      lines: [{ productName: 'A', quantity: 3, unitPrice: '12345' }, { productName: 'B', quantity: 1, unitPrice: '1000' }],
      expected: { salesAmount: '38035', taxAmount: '1902', totalAmount: '39937' },
    }), NOW)
    expect(plan.salesAmount).toBe(38_035n)
    expect(plan.taxAmount).toBe(1_902n)
    expect(plan.totalAmount).toBe(39_937n)
  })

  it('keeps the paper amount when the total is provided', () => {
    // 源行 55：43,810 × 5% = 2,190.5 → 系统进位 2,191，票面是 2,190 / 合计 46,000。
    // 与普通提交共用 totalAmount 口径：税额作残差。
    const plan = planInvoiceRequestImportItem(item({
      lines: [{ productName: '历史开票导入', quantity: 1, unitPrice: '43810' }],
      expected: { salesAmount: '43810', taxAmount: '2190', totalAmount: '46000' },
      totalAmount: '46000',
    }), NOW)
    expect(plan.taxAmount).toBe(2_190n)
    expect(plan.totalAmount).toBe(46_000n)
    expect(plan.computedTaxAmount).toBe(2_191n)
    expect(plan.taxAdjusted).toBe(true)
  })

  it('rejects an amount that differs from the expected paper values', () => {
    expectItemError(
      () => planInvoiceRequestImportItem(item({ expected: { salesAmount: '47619', taxAmount: '2381', totalAmount: '49999' } }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.AMOUNT_MISMATCH,
    )
    // 不传总计又期望 46,000：按 5% 复算得到 46,001，期望不符。
    expectItemError(
      () => planInvoiceRequestImportItem(item({
        lines: [{ productName: '历史开票导入', quantity: 1, unitPrice: '43810' }],
        expected: { salesAmount: '43810', taxAmount: '2190', totalAmount: '46000' },
      }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.AMOUNT_MISMATCH,
    )
    // 票面总计本身越界（差 2 元）同样失败。
    expectItemError(
      () => planInvoiceRequestImportItem(item({
        lines: [{ productName: '历史开票导入', quantity: 1, unitPrice: '43810' }],
        totalAmount: '46002',
      }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.AMOUNT_MISMATCH,
    )
  })

  it('marks totals that no integer sales amount can produce', () => {
    // 合计每跨过一个 21k+10 就跳 2 元，这类票面只能靠覆盖保真。
    expect(isUnreachableTotalAmount(46_000n)).toBe(true)
    expect(isUnreachableTotalAmount(340_000n)).toBe(true)
    expect(isUnreachableTotalAmount(45_999n)).toBe(false)
    expect(isUnreachableTotalAmount(50_000n)).toBe(false)
  })

  it('requires a document exactly when the target status is ISSUED', () => {
    expectItemError(
      () => planInvoiceRequestImportItem(item({ documentMediaAssetId: null }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.DOCUMENT_REQUIRED,
    )
    expectItemError(
      () => planInvoiceRequestImportItem(item({ targetStatus: 'NOTIFIED' }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID,
    )
    const notified = planInvoiceRequestImportItem(item({
      targetStatus: 'NOTIFIED',
      documentMediaAssetId: null,
      occurredAt: { submittedAt: '2026-06-01T02:00:00.000Z', notifiedAt: '2026-06-01T03:00:00.000Z' },
    }), NOW)
    expect(notified.documentUploadedAt).toBeNull()
    expect(notified.notifiedAt?.toISOString()).toBe('2026-06-01T03:00:00.000Z')
  })

  it('keeps the timeline monotonic and never in the future', () => {
    expectItemError(
      () => planInvoiceRequestImportItem(item({ occurredAt: { submittedAt: '2026-06-02T00:00:00.000Z', notifiedAt: '2026-06-01T00:00:00.000Z', documentUploadedAt: '2026-06-03T00:00:00.000Z' } }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID,
    )
    expectItemError(
      () => planInvoiceRequestImportItem(item({ occurredAt: { submittedAt: '2026-12-01T00:00:00.000Z' } }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID,
    )
    expectItemError(
      () => planInvoiceRequestImportItem(item({ occurredAt: { submittedAt: 'not-a-date' } }), NOW),
      INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID,
    )
  })

  it('falls back to the import instant when no timeline is provided', () => {
    const plan = planInvoiceRequestImportItem(item({ occurredAt: null }), NOW)
    expect(plan.submittedAt.toISOString()).toBe(NOW.toISOString())
    expect(plan.notifiedAt?.toISOString()).toBe(NOW.toISOString())
    expect(plan.documentUploadedAt?.toISOString()).toBe(NOW.toISOString())
  })

  it('builds a deterministic idempotency key per batch and source row', () => {
    expect(buildInvoiceRequestImportKey('B1', 'srcrow-2')).toBe('import:B1:srcrow-2')
    expect(buildInvoiceRequestImportKey('B1', 'srcrow-2')).toBe(buildInvoiceRequestImportKey('B1', 'srcrow-2'))
    expect(buildInvoiceRequestImportKey('B1', 'srcrow-2')).not.toBe(buildInvoiceRequestImportKey('B1', 'srcrow-3'))
    expect(buildInvoiceRequestImportKey('B1', 'srcrow-2')).not.toBe(buildInvoiceRequestImportKey('B2', 'srcrow-2'))
  })
})
