import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'

interface DecimalValue {
  toFixed(decimalPlaces: number): string
}

export interface SalesOrderProductOptionRow {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly category: { readonly name: string } | null
  readonly productHead: { readonly name: string } | null
  readonly supplierValue: string
  readonly attributes: unknown
  readonly twdSalePriceAmount: DecimalValue | null
  readonly myrSalePriceAmount: DecimalValue | null
  readonly media: readonly { readonly id: string }[]
}

function attributes(value: unknown): readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value)
    || value.some(item => (
      typeof item !== 'object' || item === null || Array.isArray(item)
    ))
  ) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'SALES_ORDER_STATE_CHANGED',
      '产品状态已变化，请重试',
    )
  }
  return value as readonly Record<string, unknown>[]
}

/** 创建销售订单与海运前加购共享同一目录产品映射和主图唯一性校验。 */
export function mapSalesOrderProductOption(
  row: SalesOrderProductOptionRow,
  currencyCode: 'TWD' | 'MYR',
  contentUrl: (productId: string, productMediaId: string) => string,
) {
  if (row.media.length > 1) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'SALES_ORDER_STATE_CHANGED',
      '产品状态已变化，请重试',
    )
  }
  const standardPrice = currencyCode === 'TWD'
    ? row.twdSalePriceAmount
    : row.myrSalePriceAmount
  const mainImage = row.media[0]
  return {
    id: row.id,
    productNo: row.productNo,
    name: row.name,
    categoryName: row.category?.name ?? null,
    productHeadName: row.productHead?.name ?? null,
    supplierValue: row.supplierValue,
    attributes: attributes(row.attributes),
    standardUnitPriceAmount: standardPrice === null
      ? null
      : standardPrice.toFixed(2),
    currencyCode,
    mainImage: mainImage === undefined
      ? null
      : {
          id: mainImage.id,
          contentUrl: contentUrl(row.id, mainImage.id),
        },
  }
}
