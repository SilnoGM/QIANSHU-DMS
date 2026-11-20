import type {
  SalesOrderEditContextDto,
  SalesOrderInfoUpdateRequestDto,
} from '@/api/generated/types.gen'
import type { RegionSelectorValue } from '@/components/business/QsRegionSelector/types'

export type SalesOrderEditTab = 'info' | 'products'

export interface SalesOrderInfoDraft {
  readonly name: string
  readonly phone: string
  readonly fbName: string
  readonly lineName: string
  readonly region: RegionSelectorValue
  readonly addressDetail: string
  readonly orderDate: string
  readonly remark: string
  readonly reason: string
}

export type SalesOrderEditBuildResult<T>
  = | { readonly valid: true, readonly request: T }
    | { readonly valid: false, readonly fieldErrors: Readonly<Record<string, string>> }

/** 产品页签仍沿用既有的“已确认 + 海运前”资格；客户与出单信息不受此限制。 */
export const SALES_ORDER_PRODUCT_EDIT_FULFILLMENT_STATUSES: ReadonlySet<string> = new Set([
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
])

const CODE_POINT_LIMITS = {
  name: 24,
  phone: 64,
  socialName: 128,
  addressDetail: 1000,
  remark: 1000,
  reason: 500,
} as const

function codePointLength(value: string): number {
  return [...value].length
}

export function createSalesOrderInfoDraft(
  context: SalesOrderEditContextDto,
): SalesOrderInfoDraft {
  return {
    name: context.customer.name,
    phone: context.customer.phone,
    fbName: context.customer.fbName ?? '',
    lineName: context.customer.lineName ?? '',
    region: {
      countryRegionId: context.customer.countryRegion.id,
      provinceStateId: context.customer.provinceState.id,
      cityId: context.customer.city.id,
    },
    addressDetail: context.customer.addressDetail,
    orderDate: context.salesInfo.orderDate,
    remark: context.salesInfo.remark ?? '',
    reason: '',
  }
}

function validateReason(reason: string, fieldErrors: Record<string, string>): string {
  const normalized = reason.trim()
  if (normalized.length === 0) {
    fieldErrors.reason = '请填写本次修改原因'
  }
  else if (codePointLength(normalized) > CODE_POINT_LIMITS.reason) {
    fieldErrors.reason = `修改原因不能超过 ${CODE_POINT_LIMITS.reason} 个字符`
  }
  return normalized
}

function validateOptionalSocialName(
  value: string,
  field: 'fbName' | 'lineName',
  label: string,
  fieldErrors: Record<string, string>,
): string | null {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }
  if (codePointLength(normalized) > CODE_POINT_LIMITS.socialName) {
    fieldErrors[`customer.${field}`] = `${label}不能超过 ${CODE_POINT_LIMITS.socialName} 个字符`
  }
  return normalized
}

/** 客户信息与出单信息合成一次请求；任一字段不合法都会整体拦下。 */
export function buildSalesOrderInfoUpdatePayload(
  context: SalesOrderEditContextDto,
  draft: SalesOrderInfoDraft,
): SalesOrderEditBuildResult<SalesOrderInfoUpdateRequestDto> {
  const fieldErrors: Record<string, string> = {}
  const name = draft.name.trim()
  const phone = draft.phone.trim()
  const addressDetail = draft.addressDetail.trim()
  const orderDate = draft.orderDate.trim()
  const remark = draft.remark.trim()
  const reason = validateReason(draft.reason, fieldErrors)
  const fbName = validateOptionalSocialName(draft.fbName, 'fbName', '客户FB名称', fieldErrors)
  const lineName = validateOptionalSocialName(draft.lineName, 'lineName', '客户LINE名称', fieldErrors)

  if (name.length === 0) {
    fieldErrors['customer.name'] = '请填写客户姓名'
  }
  else if (codePointLength(name) > CODE_POINT_LIMITS.name) {
    fieldErrors['customer.name'] = `客户姓名不能超过 ${CODE_POINT_LIMITS.name} 个字符`
  }
  if (phone.length === 0) {
    fieldErrors['customer.phone'] = '请填写客户电话'
  }
  else if (codePointLength(phone) > CODE_POINT_LIMITS.phone) {
    fieldErrors['customer.phone'] = `客户电话不能超过 ${CODE_POINT_LIMITS.phone} 个字符`
  }
  if (addressDetail.length === 0) {
    fieldErrors['customer.addressDetail'] = '请填写详细地址'
  }
  else if (codePointLength(addressDetail) > CODE_POINT_LIMITS.addressDetail) {
    fieldErrors['customer.addressDetail'] = `详细地址不能超过 ${CODE_POINT_LIMITS.addressDetail} 个字符`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(orderDate)) {
    fieldErrors.orderDate = '请选择出单日期'
  }
  if (codePointLength(remark) > CODE_POINT_LIMITS.remark) {
    fieldErrors.remark = `订单备注不能超过 ${CODE_POINT_LIMITS.remark} 个字符`
  }
  const { countryRegionId, provinceStateId, cityId } = draft.region
  if (countryRegionId === null || provinceStateId === null || cityId === null) {
    fieldErrors['customer.cityId'] = '请选择完整的三级地区'
    return { valid: false, fieldErrors }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors }
  }
  return {
    valid: true,
    request: {
      expectedVersion: context.version,
      reason,
      orderDate,
      // 服务端把空串视为非法；清空备注必须显式提交 null。
      remark: remark.length === 0 ? null : remark,
      customer: {
        name,
        phone,
        countryRegionId,
        provinceStateId,
        cityId,
        addressDetail,
        fbName,
        lineName,
      },
    },
  }
}

export function salesOrderInfoDraftChanged(
  context: SalesOrderEditContextDto,
  draft: SalesOrderInfoDraft,
): boolean {
  return draft.name.trim() !== context.customer.name
    || draft.phone.trim() !== context.customer.phone
    || (draft.fbName.trim() || null) !== context.customer.fbName
    || (draft.lineName.trim() || null) !== context.customer.lineName
    || draft.region.countryRegionId !== context.customer.countryRegion.id
    || draft.region.provinceStateId !== context.customer.provinceState.id
    || draft.region.cityId !== context.customer.city.id
    || draft.addressDetail.trim() !== context.customer.addressDetail
    || draft.orderDate.trim() !== context.salesInfo.orderDate
    || (draft.remark.trim() || null) !== context.salesInfo.remark
}

export function salesOrderProductEditUnavailableReason(order: {
  readonly orderStatus: string
  readonly fulfillmentStatus: string
}): string | null {
  if (order.orderStatus !== 'CONFIRMED') {
    return '只有已确认订单可以修改产品'
  }
  return SALES_ORDER_PRODUCT_EDIT_FULFILLMENT_STATUSES.has(order.fulfillmentStatus)
    ? null
    : '订单已进入海运或已签收，不能修改产品'
}
