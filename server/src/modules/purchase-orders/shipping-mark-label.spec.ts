import {
  buildShippingMarkSuffix,
  formatShippingMark,
  normalizeShippingMarkLabel,
  SHIPPING_MARK_ALIAS_BLOCK_MAX_LENGTH,
  SHIPPING_MARK_LABEL_MAX_LENGTH,
  STOCK_SHIPPING_MARK_SUFFIX,
  type ShippingMarkLabelProduct,
  type ShippingMarkLabelSource,
} from './shipping-mark-label'

function product(
  lineNumber: number,
  productId: string | null,
  productName: string,
  quantity = 1,
): ShippingMarkLabelProduct {
  return { lineNumber, productId, productName, quantity }
}

function source(
  products: readonly ShippingMarkLabelProduct[],
  aliases: ReadonlyMap<string, string> = new Map(),
  issuerPrefix: string | null = '李华',
  customerName: string | null = '赖文寿',
): ShippingMarkLabelSource {
  return { issuerPrefix, customerName, products, aliases }
}

describe('shipping mark label', () => {
  it('normalizes surrounding and repeated whitespace without touching characters', () => {
    expect(normalizeShippingMarkLabel('  李 华  ')).toBe('李 华')
    expect(normalizeShippingMarkLabel('赖\t文寿')).toBe('赖 文寿')
    expect(normalizeShippingMarkLabel('')).toBe('')
  })

  it('uses the alias first and falls back to the purchase product name', () => {
    const products = [
      product(1, 'a', '木桌'),
      product(2, 'b', '椅子'),
    ]
    expect(buildShippingMarkSuffix('SALES_LINKED', source(products, new Map([['b', '靠椅']]))))
      .toBe('木桌+靠椅（李华-赖文寿）')
  })

  it('keeps the purchase line order, not product ID order', () => {
    const products = [
      product(3, 'b', '椅子'),
      product(1, 'a', '木桌'),
      product(2, null, '定制架'),
    ]
    expect(buildShippingMarkSuffix('SALES_LINKED', source(products)))
      .toBe('木桌+定制架+椅子（李华-赖文寿）')
  })

  it('aggregates catalog products by productId inside one part', () => {
    const products = [
      product(1, 'a', '破碎机', 2),
      product(3, null, '定制架', 1),
      product(2, 'a', '破碎机', 3),
    ]
    expect(buildShippingMarkSuffix('SALES_LINKED', source(products)))
      .toBe('破碎机×5+定制架（李华-赖文寿）')
  })

  it('keeps custom lines separate even when their names are identical', () => {
    const products = [
      product(1, null, '定制架', 2),
      product(2, null, '定制架', 3),
      product(3, null, '定制架', 1),
    ]
    expect(buildShippingMarkSuffix('SALES_LINKED', source(products)))
      .toBe('定制架×2+定制架×3+定制架（李华-赖文寿）')
  })

  it('omits ×1 and adds ×N only when quantity is greater than one', () => {
    expect(buildShippingMarkSuffix('SALES_LINKED', source([
      product(1, 'a', '木桌', 1),
      product(2, 'b', '椅子', 80),
    ]))).toBe('木桌+椅子×80（李华-赖文寿）')
  })

  it('wraps the sales suffix in full-width parentheses and omits empty parts', () => {
    expect(buildShippingMarkSuffix('SALES_LINKED', source([product(1, 'a', '木桌')], new Map(), null, '赖文寿')))
      .toBe('木桌（赖文寿）')
    expect(buildShippingMarkSuffix('SALES_LINKED', source([product(1, 'a', '木桌')], new Map(), '李华', null)))
      .toBe('木桌（李华）')
    expect(buildShippingMarkSuffix('SALES_LINKED', source([product(1, 'a', '木桌')], new Map(), null, null)))
      .toBe('木桌')
    expect(buildShippingMarkSuffix('SALES_LINKED', null)).toBe('')
  })

  it('uses product names only for stock and ignores aliases', () => {
    const products = [product(1, 'a', '破碎机', 2), product(2, 'b', '木桌', 1)]
    const aliases = new Map([['a', '别名破碎机'], ['b', '别名木桌']])
    expect(buildShippingMarkSuffix('STOCK', source(products, aliases)))
      .toBe('破碎机×2+木桌（公司囤货采购）')
    expect(buildShippingMarkSuffix('STOCK', null)).toBe('（公司囤货采购）')
    expect(STOCK_SHIPPING_MARK_SUFFIX).toBe('公司囤货采购')
  })

  it('truncates at whole alias items with an ellipsis and never exceeds 438', () => {
    const products = Array.from({ length: 15 }, (_, index) => (
      product(index + 1, `p${index}`, '产'.repeat(36), 80)
    ))
    const suffix = buildShippingMarkSuffix('SALES_LINKED', source(products))
    const aliasBlock = suffix.slice(0, suffix.indexOf('（'))
    expect(aliasBlock.endsWith('…')).toBe(true)
    expect(aliasBlock.length).toBeLessThanOrEqual(SHIPPING_MARK_ALIAS_BLOCK_MAX_LENGTH)
    expect(aliasBlock).not.toContain('×…')
  })

  it('keeps the full label within the 500 character budget for maximum realistic fields', () => {
    const products = Array.from({ length: 10 }, (_, index) => (
      product(index + 1, `p${index}`, '产'.repeat(36), 80)
    ))
    const suffix = buildShippingMarkSuffix('SALES_LINKED', source(
      products,
      new Map(),
      '李'.repeat(3),
      '客'.repeat(24),
    ))
    const label = formatShippingMark('唛'.repeat(30), suffix)
    expect(label.length).toBeLessThanOrEqual(SHIPPING_MARK_LABEL_MAX_LENGTH)
  })

  it('keeps the bracket only around the shipment mark', () => {
    expect(formatShippingMark('QSM-20261116-0001/货件-01', '李华-赖文寿'))
      .toBe('【QSM-20261116-0001/货件-01】李华-赖文寿')
    expect(formatShippingMark('QSM-20261116-0001', '（公司囤货采购）'))
      .toBe('【QSM-20261116-0001】（公司囤货采购）')
    expect(formatShippingMark('QSM-20261116-0001', '')).toBe('【QSM-20261116-0001】')
  })
})
