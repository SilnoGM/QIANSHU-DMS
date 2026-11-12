/**
 * 通知变量只允许放用户可读文案。业务发布点必须先经过这里把枚举转成显示值，
 * 未知值统一落到占位符，避免数据库枚举原值泄漏到站内消息或千树小助理。
 */
const NOTIFICATION_DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
})

function shanghaiDateTimeParts(value: Date): Map<string, string> {
  return new Map(NOTIFICATION_DATE_TIME_FORMAT.formatToParts(value).map(part => [part.type, part.value]))
}

/** 通知里的时间统一按上海墙钟输出，避免服务器时区影响文案。 */
export function formatNotificationDateTime(value: Date | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value.getTime())) {
    return '—'
  }
  const parts = shanghaiDateTimeParts(value)
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`
}

/** 仅日期部分，用于到仓、预约等自然日口径。 */
export function formatNotificationDate(value: Date | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value.getTime())) {
    return '—'
  }
  const parts = shanghaiDateTimeParts(value)
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`
}
const SALES_ORDER_PAYMENT_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  DEPOSIT: '定金',
  PROGRESS: '过程款',
  INVOICE_TAX: '开票税金',
  BALANCE: '尾款',
  OTHER: '其他',
  COD_BALANCE: '代收尾款',
})

const MACHINE_VIEWING_SITE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  NEW_TAIPEI_LINKOU: '新北林口',
  TAICHUNG_LONGJING: '台中龙井',
})

const MACHINE_VIEWING_MACHINE_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  MINI_TILLER: '微耕机',
  SHREDDER: '撕碎机',
  INCINERATOR: '焚烧炉',
})

const MACHINE_VIEWING_PERIOD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  AM: '上午',
  PM: '下午',
})

const MACHINE_VIEWING_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING_APPOINTMENT: '待预约',
  APPOINTED: '已预约',
  FEEDBACK_GIVEN: '已反馈',
  CANCELLED: '已取消',
})

const SALES_ORDER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  PENDING_RECONCILIATION: '待对账',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  TERMINATED: '已终止',
})

const SALES_ORDER_PAYMENT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  UNPAID: '未付款',
  PARTIALLY_PAID: '部分付款',
  PAID: '已付清',
})

const SALES_ORDER_FULFILLMENT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING: '待处理',
  PREPARING: '备货中',
  LAND_TRANSIT: '陆运中',
  WAREHOUSE_ARRIVED: '已到仓',
  SEA_TRANSIT: '海运中',
  SIGNED: '已签收',
})

const PURCHASE_ORDER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING_REVIEW: '待审核',
  CONFIRMED: '已确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
})

const PURCHASE_ORDER_PAYMENT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  UNPAID: '未付款',
  PARTIALLY_PAID: '部分付款',
  PAID: '已付清',
})

const PURCHASE_ORDER_FULFILLMENT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ORDERED: '已下单',
  PREPARING: '备货中',
  PARTIALLY_SHIPPED: '部分发货',
  SHIPPED: '已发货',
  SIGNED: '已签收',
})

const ADVERTISING_RECHARGE_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PENDING: '待付款',
  PAID: '已付款',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
  VOIDED: '已作废',
})

function labelOf(labels: Readonly<Record<string, string>>, value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '—'
  }
  return labels[value] ?? '—'
}

export function salesOrderPaymentTypeLabel(value: string | null | undefined): string {
  return labelOf(SALES_ORDER_PAYMENT_TYPE_LABELS, value)
}

export function machineViewingSiteLabel(value: string | null | undefined): string {
  return labelOf(MACHINE_VIEWING_SITE_LABELS, value)
}

export function machineViewingMachineTypeLabel(value: string | null | undefined): string {
  return labelOf(MACHINE_VIEWING_MACHINE_TYPE_LABELS, value)
}

export function machineViewingPeriodLabel(value: string | null | undefined): string {
  return labelOf(MACHINE_VIEWING_PERIOD_LABELS, value)
}

export function machineViewingStatusLabel(value: string | null | undefined): string {
  return labelOf(MACHINE_VIEWING_STATUS_LABELS, value)
}

export function salesOrderStatusLabel(value: string | null | undefined): string {
  return labelOf(SALES_ORDER_STATUS_LABELS, value)
}

export function salesOrderPaymentStatusLabel(value: string | null | undefined): string {
  return labelOf(SALES_ORDER_PAYMENT_STATUS_LABELS, value)
}

export function salesOrderFulfillmentStatusLabel(value: string | null | undefined): string {
  return labelOf(SALES_ORDER_FULFILLMENT_STATUS_LABELS, value)
}

export function purchaseOrderStatusLabel(value: string | null | undefined): string {
  return labelOf(PURCHASE_ORDER_STATUS_LABELS, value)
}

export function purchaseOrderPaymentStatusLabel(value: string | null | undefined): string {
  return labelOf(PURCHASE_ORDER_PAYMENT_STATUS_LABELS, value)
}

export function purchaseOrderFulfillmentStatusLabel(value: string | null | undefined): string {
  return labelOf(PURCHASE_ORDER_FULFILLMENT_STATUS_LABELS, value)
}

export function advertisingRechargeStatusLabel(value: string | null | undefined): string {
  return labelOf(ADVERTISING_RECHARGE_STATUS_LABELS, value)
}
