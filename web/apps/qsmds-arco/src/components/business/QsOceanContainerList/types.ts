import type { CurrencyDescriptor } from '@/components/base/currency'

/** 整柜概览与个人明细计数分开；调用方提供经过服务端授权的数据。 */
export interface OceanContainerSummary {
  id: string
  containerBatchNo: string
  containerBatchName: string
  /** YYYY-MM-DD 日历日期，沿用柜次数据口径，不进行时区转换。 */
  loadingDate: string
  warehouseName: string
  itemCount: number
  myItemCount: number
  grossWeightKgTotal: string | null
  volumeCaiTotal: string | null
}

/** 一行对应一条装柜明细，不按包装件数或关联货件合并、拆分。 */
export interface OceanContainerLine {
  id: string
  oceanShippingMarkText: string | null
  goodsName: string
  shippingMark: string | null
  salesOrderNo: string | null
  recipientName: string | null
  codAmountTwd: string | null
}

export interface OceanContainerDetailPage {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly OceanContainerLine[]
  total: number
  page: number
  pageSize: number
  error?: string
}

export interface OceanContainerItemsRequest {
  containerId: string
  page: number
  pageSize: number
}

export interface OceanContainerListProps {
  items: readonly OceanContainerSummary[]
  details: Readonly<Record<string, OceanContainerDetailPage | undefined>>
  currencies: readonly CurrencyDescriptor[]
  total: number
  page?: number
  pageSize?: number
  loading?: boolean
  error?: string | null
}
