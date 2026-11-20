import type { RegionLevel } from '../../../generated/prisma/enums'

import { salesOrderRuleFailure } from './sales-order-errors'

export interface SalesOrderRegionSnapshot {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly level: RegionLevel
  readonly parentId: string | null
}

export interface SalesOrderRegionPathInput {
  readonly countryRegionId: string
  readonly provinceStateId: string
  readonly cityId: string
}

export interface SalesOrderRegionPath {
  readonly countryRegion: SalesOrderRegionSnapshot
  readonly provinceState: SalesOrderRegionSnapshot
  readonly city: SalesOrderRegionSnapshot
}

/**
 * 销售订单只接受严格三级地区：国家/地区无父级、省/州挂在国家下、城市挂在省/州下。
 * 创建与订单编辑共用同一判定，避免两条写入路径出现不同口径。
 */
export function requireSalesOrderRegionPath(
  rows: readonly SalesOrderRegionSnapshot[],
  ids: SalesOrderRegionPathInput,
): SalesOrderRegionPath {
  const byId = new Map(rows.map(row => [row.id, row]))
  const countryRegion = byId.get(ids.countryRegionId)
  const provinceState = byId.get(ids.provinceStateId)
  const city = byId.get(ids.cityId)
  if (
    countryRegion?.level !== 'COUNTRY_REGION'
    || countryRegion.parentId !== null
    || provinceState?.level !== 'PROVINCE_STATE'
    || provinceState.parentId !== countryRegion.id
    || city?.level !== 'CITY'
    || city.parentId !== provinceState.id
  ) {
    return salesOrderRuleFailure(
      'SALES_ORDER_REGION_UNAVAILABLE',
      '所选客户地区当前不可用或层级无效',
    )
  }
  return { countryRegion, provinceState, city }
}
