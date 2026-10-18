import type { CurrencyDescriptor } from '@/components/base/currency'
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type {
  ProductPageLoader,
  ProductSelectorCurrency,
  ProductSelectorItem,
} from '@/components/business/QsProductSelector/types'
import type {
  DictionaryCatalog,
  DictionaryCatalogProvider,
} from '@/dictionary-catalog/types'
import productFrontSrc from '@/assets/images/component-library/image-group/product-front.svg?url'

const SUPPLIERS = [{
  effectiveEnabled: true,
  enabled: true,
  label: '岛屿织造',
  sortOrder: 10,
  tone: 'PRIMARY' as const,
  value: 'ISLAND_WEAVE',
}, {
  effectiveEnabled: true,
  enabled: true,
  label: '南岸器物',
  sortOrder: 20,
  tone: 'INFO' as const,
  value: 'SOUTH_COAST',
}, {
  effectiveEnabled: false,
  enabled: false,
  label: '旧港供应',
  sortOrder: 30,
  tone: 'DEFAULT' as const,
  value: 'OLD_HARBOR',
}] as const

const SUPPLIER_CATALOG: DictionaryCatalog = Object.freeze({
  code: 'service_provider.supplier',
  name: '供应商',
  enabled: true,
  items: Object.freeze(SUPPLIERS),
})

function taxonomyFor(index: number): {
  readonly categoryName: string | null
  readonly productHeadName: string | null
} {
  // 保留少量未分类样本，验收存量留空补录的展示与筛选。
  if (index % 11 === 0) {
    return { categoryName: null, productHeadName: null }
  }
  if (index % 6 === 0 || index % 6 === 1) {
    return {
      categoryName: '配件',
      productHeadName: index % 6 === 0 ? '挂件' : '肩带',
    }
  }
  return {
    categoryName: '收纳包',
    productHeadName: index % 6 === 5 ? '商务通勤' : '城市旅行',
  }
}

function product(index: number, currencyCode: ProductSelectorCurrency): ProductSelectorItem {
  const ordinal = String(index).padStart(3, '0')
  const supplier = SUPPLIERS[(index - 1) % SUPPLIERS.length]!
  const stableOrdinal = currencyCode === 'TWD' ? index : index + 100
  return Object.freeze({
    id: `00000000-0000-4000-8000-${String(stableOrdinal).padStart(12, '0')}`,
    productNo: `SKU-${currencyCode}-TRAVEL-${ordinal}`,
    name: index % 3 === 0 ? `城市旅行收纳包 长款限定版 ${ordinal}` : `城市旅行收纳包 ${ordinal}`,
    ...taxonomyFor(index),
    supplierValue: supplier.value,
    attributes: Object.freeze([]),
    // 每七个产品保留一个当前币种无标准价样本，用于验收“全部可选、售价手填”。
    standardUnitPriceAmount: index % 7 === 0
      ? null
      : currencyCode === 'TWD'
        ? `${1200 + index}.0000`
        : `${180 + index}.0000`,
    currencyCode,
    mainImage: index % 4 === 0
      ? null
      : { id: `media-${ordinal}`, contentUrl: productFrontSrc },
  })
}

export const ORDER_PRODUCT_FIXTURE_PRODUCTS = Object.freeze(
  (['TWD', 'MYR'] as const).flatMap(currencyCode => (
    Array.from({ length: 37 }, (_, index) => product(index + 1, currencyCode))
  )),
)

export const ORDER_PRODUCT_FIXTURE_CURRENCIES = Object.freeze<CurrencyDescriptor[]>([{
  code: 'TWD',
  enabled: true,
  minorUnit: 2,
  name: '新台币',
  symbol: 'NT$',
}, {
  code: 'MYR',
  enabled: true,
  minorUnit: 2,
  name: '马来西亚林吉特',
  symbol: 'RM',
}])

export const ORDER_PRODUCT_FIXTURE_EXISTING_LINES = Object.freeze([{
  key: 'fixture-existing-line',
  productId: ORDER_PRODUCT_FIXTURE_PRODUCTS[0]!.id,
  productNo: ORDER_PRODUCT_FIXTURE_PRODUCTS[0]!.productNo,
  name: ORDER_PRODUCT_FIXTURE_PRODUCTS[0]!.name,
  quantity: '2',
  supplierValue: ORDER_PRODUCT_FIXTURE_PRODUCTS[0]!.supplierValue,
}])

export function createOrderProductFixtureEditorLines(
  currencyCode: ProductSelectorCurrency,
): readonly OrderProductLineModel[] {
  const catalogProduct = ORDER_PRODUCT_FIXTURE_PRODUCTS.find(item => (
    item.currencyCode === currencyCode && item.standardUnitPriceAmount !== null
  ))!
  const unpricedCatalogProduct = ORDER_PRODUCT_FIXTURE_PRODUCTS.find(item => (
    item.currencyCode === currencyCode && item.standardUnitPriceAmount === null
  ))!
  const catalogActualPrice = currencyCode === 'TWD' ? '1168.5000' : '176.5000'
  const temporaryActualPrice = currencyCode === 'TWD' ? '85.2500' : '12.2500'

  return Object.freeze([{
    key: `fixture-catalog-line-${currencyCode}`,
    lineType: 'CATALOG' as const,
    productId: catalogProduct.id,
    productNo: catalogProduct.productNo,
    name: '城市旅行收纳包 限量墨绿色可扩展多隔层版本',
    description: '客户要求保留原包装并在外箱标记配送楼层，此处用于验收单行 Tooltip。',
    standardUnitPriceAmount: catalogProduct.standardUnitPriceAmount,
    actualUnitPriceAmount: catalogActualPrice,
    quantity: '2',
    mainImage: catalogProduct.mainImage,
  }, {
    key: `fixture-unpriced-catalog-line-${currencyCode}`,
    lineType: 'CATALOG' as const,
    productId: unpricedCatalogProduct.id,
    productNo: unpricedCatalogProduct.productNo,
    name: '当前订单币种暂无标准价的数据库产品',
    description: '用于验收标准价显示暂无、本单售价手填和汇总未计入提示。',
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: catalogActualPrice,
    quantity: '1',
    mainImage: unpricedCatalogProduct.mainImage,
  }, {
    key: `fixture-temporary-line-${currencyCode}`,
    lineType: 'CUSTOM' as const,
    productId: null,
    productNo: null,
    name: '本单专用防潮外包装',
    description: '仅用于这张订单，不写入产品资料。',
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: temporaryActualPrice,
    quantity: '3',
    mainImage: null,
  }])
}

export const ORDER_PRODUCT_FIXTURE_EDITOR_LINES = createOrderProductFixtureEditorLines('TWD')

export function createOrderProductFixtureProvider(): DictionaryCatalogProvider {
  return {
    get({ code, signal }) {
      if (signal.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      }
      return Promise.resolve(code === SUPPLIER_CATALOG.code ? SUPPLIER_CATALOG : null)
    },
    async prefetch({ codes, signal }) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      if (!codes.includes(SUPPLIER_CATALOG.code)) {
        return
      }
      await Promise.resolve()
    },
    subscribeInvalidation() {
      return () => undefined
    },
  }
}

export function createOrderProductFixtureLoader(): ProductPageLoader {
  return async (query, signal) => {
    await Promise.resolve()
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const keyword = query.keyword?.toLocaleLowerCase() ?? ''
    const facetBase = ORDER_PRODUCT_FIXTURE_PRODUCTS.filter(item => (
      item.currencyCode === query.currencyCode
      && (query.supplierValue === undefined || item.supplierValue === query.supplierValue)
    ))
    const filtered = facetBase.filter(item => (
      (query.categoryName === undefined || item.categoryName === query.categoryName)
      && (query.unclassified !== true || item.categoryName === null)
      && (keyword === '' || item.name.toLocaleLowerCase().includes(keyword)
        || item.productNo.toLocaleLowerCase().includes(keyword))
    )).sort((left, right) => (
      (left.categoryName ?? '').localeCompare(right.categoryName ?? '', 'zh-Hans-CN')
      || (left.productHeadName ?? '').localeCompare(right.productHeadName ?? '', 'zh-Hans-CN')
      || left.name.localeCompare(right.name, 'zh-Hans-CN')
    ))
    const categoryCounts = new Map<string, number>()
    let unclassifiedCount = 0
    for (const item of facetBase) {
      if (item.categoryName === null) {
        unclassifiedCount += 1
      }
      else {
        categoryCounts.set(item.categoryName, (categoryCounts.get(item.categoryName) ?? 0) + 1)
      }
    }
    const start = (query.page - 1) * query.pageSize
    return {
      items: filtered.slice(start, start + query.pageSize),
      categories: [...categoryCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
        .map(([name, count]) => ({ name, count })),
      unclassifiedCount,
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
    }
  }
}
