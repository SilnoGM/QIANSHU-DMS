import { createSalesOrderDocumentTitle } from './sales-order-document-title'

describe('createSalesOrderDocumentTitle', () => {
  const occurredAt = new Date('2026-08-25T01:02:03.004Z')

  it.each([
    ['ORDER_ISSUANCE_VOUCHER', '出单凭证'],
    ['DEPOSIT', '定金凭证'],
    ['PROGRESS', '过程款凭证'],
    ['INVOICE_TAX', '开票税金凭证'],
    ['BALANCE', '尾款凭证'],
    ['OTHER', '其他收款凭证'],
    ['DELIVERY_RECEIPT', '签收单'],
  ] as const)('generates a canonical %s title', (kind, label) => {
    expect(createSalesOrderDocumentTitle('  王小明  ', kind, occurredAt))
      .toBe(`王小明-${label}-20260825090203004`)
  })

  it('normalizes and truncates only the customer name to 128 code points', () => {
    const title = createSalesOrderDocumentTitle(
      `  ${'客'.repeat(200)}  `,
      'ORDER_ISSUANCE_VOUCHER',
      occurredAt,
    )

    expect([...title]).toHaveLength(128)
    expect(title).toMatch(/-出单凭证-20260825090203004$/u)
  })
})
