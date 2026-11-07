import { inspectNotificationTemplate, renderNotificationTemplate } from './notification-template.renderer'

describe('renderNotificationTemplate', () => {
  const allowed = [
    { name: 'orderNo', required: true },
    { name: 'buyerName', required: true, sensitive: true },
    { name: 'totalAmount', required: true, sensitive: true },
    { name: 'lineCount', required: false },
  ]

  it('renders variables and link url', () => {
    const result = renderNotificationTemplate({
      body: '采购单 {{orderNo}} 待审核\n客户：{{buyerName}}',
      linkUrlTemplate: '/purchase/{{orderNo}}',
      variables: { orderNo: 'CG20261106-0001', buyerName: '赖文寿', totalAmount: 1234, lineCount: 2 },
      allowed,
      allowSensitive: true,
      maxLength: 200,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain('CG20261106-0001')
      expect(result.content).toContain('赖文寿')
      expect(result.linkUrl).toBe('/purchase/CG20261106-0001')
      expect(result.truncated).toBe(false)
      expect(result.warnings).toEqual([])
    }
  })

  it('fails when a required variable is missing', () => {
    const result = renderNotificationTemplate({
      body: '采购单 {{orderNo}} 待审核',
      variables: {},
      allowed,
      allowSensitive: true,
    })

    expect(result).toEqual({
      ok: false,
      code: 'TEMPLATE_VARIABLE_MISSING',
      message: '模板变量缺失：orderNo',
    })
  })

  it('allows optional variables to be empty', () => {
    const result = renderNotificationTemplate({
      body: '采购单 {{orderNo}}，明细 {{lineCount}} 行',
      variables: { orderNo: 'CG-1' },
      allowed,
      allowSensitive: true,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('采购单 CG-1，明细  行')
    }
  })

  it('rejects undeclared placeholders', () => {
    const result = renderNotificationTemplate({
      body: '采购单 {{orderNo}} {{unknown}}',
      variables: { orderNo: 'CG-1' },
      allowed,
      allowSensitive: true,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('TEMPLATE_VARIABLE_MISSING')
      expect(result.message).toContain('unknown')
    }
  })

  it('masks sensitive variables when the policy does not allow them', () => {
    const result = renderNotificationTemplate({
      body: '客户：{{buyerName}}，金额：{{totalAmount}}',
      variables: { buyerName: '赖文寿', totalAmount: 1234 },
      allowed,
      allowSensitive: false,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('客户：***，金额：***')
      expect(result.warnings).toEqual(['SENSITIVE_VARIABLE_MASKED'])
    }
  })

  it('truncates the rendered body to maxLength', () => {
    const result = renderNotificationTemplate({
      body: '{{orderNo}}',
      variables: { orderNo: 'X'.repeat(30) },
      allowed,
      allowSensitive: true,
      maxLength: 10,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.length).toBe(10)
      expect(result.content.endsWith('…')).toBe(true)
      expect(result.truncated).toBe(true)
    }
  })
})

describe('inspectNotificationTemplate', () => {
  it('returns placeholders and undeclared names', () => {
    const result = inspectNotificationTemplate({
      body: '{{a}} {{b}} {{c}}',
      linkUrlTemplate: '/x/{{a}}',
      allowed: [{ name: 'a' }, { name: 'b' }],
    })

    expect(result.placeholders).toEqual(['a', 'b', 'c'])
    expect(result.undeclared).toEqual(['c'])
    expect(result.singleBrace).toEqual([])
  })

  it('detects single-brace placeholders without treating them as valid placeholders', () => {
    const result = inspectNotificationTemplate({
      body: '采购单 {orderNo} {{buyerName}}',
      allowed: [{ name: 'orderNo' }, { name: 'buyerName' }],
    })

    expect(result.placeholders).toEqual(['buyerName'])
    expect(result.singleBrace).toEqual(['orderNo'])
  })
})
