import { buildShippingMarkSuffix, formatShippingMark, normalizeShippingMarkLabel, STOCK_SHIPPING_MARK_SUFFIX } from './shipping-mark-label'

describe('shipping mark label', () => {
  it('normalizes surrounding and repeated whitespace without touching characters', () => {
    expect(normalizeShippingMarkLabel('  李 华  ')).toBe('李 华')
    expect(normalizeShippingMarkLabel('赖\t文寿')).toBe('赖 文寿')
    expect(normalizeShippingMarkLabel('')).toBe('')
  })

  it('joins issuer prefix and customer name, leaving no separator for missing parts', () => {
    expect(buildShippingMarkSuffix('SALES_LINKED', { issuerPrefix: '李华', customerName: '赖文寿' })).toBe('李华-赖文寿')
    expect(buildShippingMarkSuffix('SALES_LINKED', { issuerPrefix: null, customerName: '  赖 文寿 ' })).toBe('赖 文寿')
    expect(buildShippingMarkSuffix('SALES_LINKED', { issuerPrefix: '李华', customerName: '' })).toBe('李华')
    expect(buildShippingMarkSuffix('SALES_LINKED', null)).toBe('')
  })

  it('always labels stock purchases so every mark keeps the complete format', () => {
    expect(buildShippingMarkSuffix('STOCK', null)).toBe(STOCK_SHIPPING_MARK_SUFFIX)
    expect(buildShippingMarkSuffix('STOCK', { issuerPrefix: '李华', customerName: '赖文寿' })).toBe(STOCK_SHIPPING_MARK_SUFFIX)
    expect(STOCK_SHIPPING_MARK_SUFFIX).toBe('公司囤货采购')
  })

  it('keeps the bracket only around the shipment mark', () => {
    expect(formatShippingMark('QSM-20261116-0001/货件-01', '李华-赖文寿')).toBe('【QSM-20261116-0001/货件-01】李华-赖文寿')
    expect(formatShippingMark('QSM-20261116-0001', '公司囤货采购')).toBe('【QSM-20261116-0001】公司囤货采购')
    expect(formatShippingMark('QSM-20261116-0001', '')).toBe('【QSM-20261116-0001】')
  })
})
