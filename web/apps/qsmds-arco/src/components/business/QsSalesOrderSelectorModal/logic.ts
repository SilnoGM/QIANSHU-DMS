import type {
  SalesOrderSelectorFulfillmentStatus,
  SalesOrderSelectorItem,
  SalesOrderSelectorLinePreview,
  SalesOrderSelectorPaymentStatus,
} from './types'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'

interface SelectorPaginationInput {
  page: number
  pageSize: number
  total: number
}

export interface SelectorPagination {
  page: number
  pageCount: number
  pageSize: number
  rangeEnd: number
  rangeStart: number
  total: number
}

export interface SelectorStatusMeta {
  className: string
  label: string
}

const fulfillmentStatusMeta: Record<SalesOrderSelectorFulfillmentStatus, SelectorStatusMeta> = {
  LAND_TRANSIT: {
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    label: '陆运中',
  },
  PENDING: {
    className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
    label: '待采购',
  },
  PREPARING: {
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    label: '备货中',
  },
  SEA_TRANSIT: {
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    label: '海运中',
  },
  SIGNED: {
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    label: '已签收',
  },
  WAREHOUSE_ARRIVED: {
    className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    label: '已到仓',
  },
}

const paymentStatusMeta: Record<SalesOrderSelectorPaymentStatus, SelectorStatusMeta> = {
  PAID: {
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    label: '已付清',
  },
  PARTIALLY_PAID: {
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    label: '部分付款',
  },
  UNPAID: {
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    label: '未付款',
  },
}

export function filterEligibleSalesOrders(
  items: readonly SalesOrderSelectorItem[],
): SalesOrderSelectorItem[] {
  return items.filter(item => item.orderStatus === 'CONFIRMED')
}

export function resolveSalesOrderSelection(
  items: readonly SalesOrderSelectorItem[],
  selectedOrderId: string | null | undefined,
): SalesOrderSelectorItem | null {
  if (!selectedOrderId) {
    return null
  }

  return filterEligibleSalesOrders(items).find(item => item.id === selectedOrderId) ?? null
}

export function normalizeSalesOrderSelectorKeyword(keyword: string): string {
  return keyword.normalize('NFKC').trim()
}

export function buildSalesOrderProductImageItems(
  previews: readonly SalesOrderSelectorLinePreview[],
): ImageGroupItem[] {
  return previews.flatMap((preview) => {
    const source = preview.mainImage?.contentUrl.trim()
    if (!source) {
      return []
    }
    const productName = preview.productName.trim() || '未命名产品'
    return [{
      alt: productName,
      key: preview.lineId,
      src: source,
      tooltip: productName,
    }]
  })
}

export function filterSalesOrderProductsWithoutImage(
  previews: readonly SalesOrderSelectorLinePreview[],
): SalesOrderSelectorLinePreview[] {
  return previews.filter(preview => !preview.mainImage?.contentUrl.trim())
}

export function resolveSalesOrderProductPreview(
  previews: readonly SalesOrderSelectorLinePreview[],
  image: ImageGroupItem | null | undefined,
): SalesOrderSelectorLinePreview | null {
  if (image?.key === undefined) {
    return null
  }
  const lineId = String(image.key)
  return previews.find(preview => preview.lineId === lineId) ?? null
}

export function resolveSelectorPagination(input: SelectorPaginationInput): SelectorPagination {
  const total = Number.isFinite(input.total) ? Math.max(0, Math.trunc(input.total)) : 0
  const pageSize = Number.isFinite(input.pageSize) && input.pageSize > 0
    ? Math.trunc(input.pageSize)
    : 20
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const requestedPage = Number.isFinite(input.page) ? Math.trunc(input.page) : 1
  const page = Math.min(pageCount, Math.max(1, requestedPage))

  return {
    page,
    pageCount,
    pageSize,
    rangeEnd: total === 0 ? 0 : Math.min(total, page * pageSize),
    rangeStart: total === 0 ? 0 : (page - 1) * pageSize + 1,
    total,
  }
}

export function formatSalesOrderLineCount(value: number): string {
  return `${Math.max(0, Math.trunc(value))} 项产品`
}

export function formatSalesOrderQuantity(value: number): string {
  return `共 ${Math.max(0, Math.trunc(value))} 件`
}

export function getSalesOrderFulfillmentStatusMeta(
  status: SalesOrderSelectorFulfillmentStatus,
): SelectorStatusMeta {
  return fulfillmentStatusMeta[status]
}

export function getSalesOrderPaymentStatusMeta(
  status: SalesOrderSelectorPaymentStatus,
): SelectorStatusMeta {
  return paymentStatusMeta[status]
}
