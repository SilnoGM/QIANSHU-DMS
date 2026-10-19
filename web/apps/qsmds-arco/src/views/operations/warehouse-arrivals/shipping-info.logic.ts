import type { PurchaseShipmentListItemDto, SalesOrderDetailDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

type Translate = (key: string) => string

/** 出货信息弹窗的固定字段顺序：货物 / 收货人 / 收款与费用 / 备注。 */
export interface ShipmentShippingInfo {
  shippingMark: string | null
  productNames: string | null
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  /** 约定尾款（不是未付尾款），含币种，例如 `90000.00 TWD`。 */
  balanceText: string | null
  freightBearer: string
  /** 本期没有来源，固定为空；保留字段以便后续接入时不改复制模板。 */
  remark: string | null
}

/** 货件品名按出货口径连成一行：`产品名+产品名`，不留空格。 */
export function joinShippingInfoProductNames(names: readonly string[]): string | null {
  const values = names.map(name => name.trim()).filter(name => name !== '')
  return values.length === 0 ? null : values.join('+')
}

/** 约定尾款按两位小数展示；不转 Number，避免大额丢失有效位。 */
export function formatShippingInfoBalance(value: string | null | undefined, currencyCode: string): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const result = validateMoneyString(value, { precision: 2 })
  if (!result.valid || result.normalizedValue === null) {
    return null
  }
  return `${new Decimal(result.normalizedValue).toFixed(2, Decimal.ROUND_HALF_UP)} ${currencyCode}`
}

/**
 * 客户与代收资料只取关联销售订单：到仓时货件尚未装柜，装柜明细还不存在。
 * 销售订单缺失时对应字段留空，不用货件行上的客户名冒充完整资料。
 */
export function buildShipmentShippingInfo(
  shipment: Pick<PurchaseShipmentListItemDto, 'shippingMarkText' | 'lineSummary'>,
  salesOrder: Pick<SalesOrderDetailDto, 'currencyCode' | 'customer' | 'amounts'> | null,
  freightBearer: string,
): ShipmentShippingInfo {
  return {
    shippingMark: shipment.shippingMarkText,
    productNames: joinShippingInfoProductNames(shipment.lineSummary.previews.map(preview => preview.productName)),
    customerName: salesOrder?.customer.name ?? null,
    customerPhone: salesOrder?.customer.phone ?? null,
    customerAddress: salesOrder?.customer.fullAddress ?? null,
    balanceText: salesOrder === null ? null : formatShippingInfoBalance(salesOrder.amounts.balanceDueAmount, salesOrder.currencyCode),
    freightBearer,
    remark: null,
  }
}

/**
 * 复制收货地址时依次去掉国家和地区前缀（「中国台湾」→「台湾」）：地址快照是
 * 「国家+省+市+详情」拼的，顺联航在台湾端收货，这两级前缀对对方多余。
 * 只按国家、省各剥离一次且必须落在开头，地址详情里的同名文字原样保留。
 */
export function formatShippingInfoAddress(address: string | null): string | null {
  const value = address?.trim()
  if (!value) {
    return null
  }
  const withoutCountry = value.replace(/^(?:中国台湾|中國台灣)\s*/u, '')
  return withoutCountry.replace(/^(?:台湾|臺灣)\s*/u, '') || null
}

/** 复制文本与弹窗展示同源：同一个标签键、同样的分组空行；缺值留空，不把界面占位符发给对方。 */
export function buildShipmentShippingInfoText(info: ShipmentShippingInfo, translate: Translate): string {
  const value = (text: string | null) => text?.trim() ?? ''
  const label = (field: keyof ShipmentShippingInfo) => translate(`warehouseArrivals.shippingInfoFields.${field}`)
  return [
    `【${translate('warehouseArrivals.shippingInfo')}】`,
    `${label('shippingMark')}：${value(info.shippingMark)}`,
    `${label('productNames')}：${value(info.productNames)}`,
    '',
    `${label('customerName')}：${value(info.customerName)}`,
    `${label('customerPhone')}：${value(info.customerPhone)}`,
    `${label('customerAddress')}：${value(formatShippingInfoAddress(info.customerAddress))}`,
    '',
    `${label('balanceText')}：${value(info.balanceText)}`,
    `${label('freightBearer')}：${value(info.freightBearer)}`,
    '',
    `${label('remark')}：${value(info.remark)}`,
  ].join('\n')
}

/** 弹窗的字段顺序与分组：货物 / 收货人 / 收款与费用 / 备注；groupStart 决定组间分隔线。 */
export const SHIPPING_INFO_LAYOUT: readonly { key: keyof ShipmentShippingInfo, groupStart: boolean }[] = [
  { key: 'shippingMark', groupStart: false },
  { key: 'productNames', groupStart: false },
  { key: 'customerName', groupStart: true },
  { key: 'customerPhone', groupStart: false },
  { key: 'customerAddress', groupStart: false },
  { key: 'balanceText', groupStart: true },
  { key: 'freightBearer', groupStart: false },
  { key: 'remark', groupStart: true },
]

export interface ShipmentShippingInfoField {
  key: keyof ShipmentShippingInfo
  label: string
  value: string | null
  groupStart: boolean
}

export function shippingInfoFields(info: ShipmentShippingInfo, translate: Translate): ShipmentShippingInfoField[] {
  return SHIPPING_INFO_LAYOUT.map(entry => ({
    ...entry,
    label: translate(`warehouseArrivals.shippingInfoFields.${entry.key}`),
    value: info[entry.key],
  }))
}

/** 资料齐备才允许复制：把半份资料发到顺联航群比复制失败更难发现。 */
export function canCopyShipmentShippingInfo(input: { info: ShipmentShippingInfo | null, loading: boolean, error: string | null }): boolean {
  return input.info !== null && !input.loading && input.error === null
}

/**
 * 复制动作只写剪贴板，不修改任何业务数据；剪贴板不可用与用户拒绝都返回失败，
 * 由调用方按当前身份反馈，禁止把失败当成已复制。
 */
export async function copyShipmentShippingInfo(
  info: ShipmentShippingInfo,
  translate: Translate,
  clipboard: { writeText: (text: string) => Promise<unknown> } | undefined,
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return false
  }
  try {
    await clipboard.writeText(buildShipmentShippingInfoText(info, translate))
    return true
  }
  catch {
    return false
  }
}
