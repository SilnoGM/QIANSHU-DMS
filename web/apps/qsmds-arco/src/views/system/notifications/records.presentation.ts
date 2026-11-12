import type { NotificationDeliveryDto, NotificationRecordDto } from '@/api/generated/types.gen'
import { templateDomainLabel } from './template-key-grouping.logic'

export type RecordTone = 'danger' | 'info' | 'muted' | 'success' | 'warning'

const TONE_CLASSES: Record<RecordTone, string> = {
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  muted: 'border-border bg-muted text-muted-foreground',
  success: 'border-green-600/30 bg-green-600/10 text-green-700 dark:border-green-400/30 dark:bg-green-400/10 dark:text-green-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
}

const NOTIFICATION_STATUS_LABELS: Record<NotificationRecordDto['status'], string> = {
  PENDING: '待发',
  COMPLETED: '完成',
  PARTIAL: '部分',
  FAILED: '失败',
  SKIPPED: '跳过',
  EXPIRED: '过期',
  CANCELLED: '取消',
}

const NOTIFICATION_STATUS_TONES: Record<NotificationRecordDto['status'], RecordTone> = {
  PENDING: 'info',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  SKIPPED: 'muted',
  EXPIRED: 'danger',
  CANCELLED: 'muted',
}

const DELIVERY_STATUS_LABELS: Record<NotificationDeliveryDto['status'], string> = {
  PENDING: '待发',
  SENDING: '发送中',
  ACCEPTED: '已接受',
  FAILED: '失败',
  SKIPPED: '跳过',
  EXPIRED: '过期',
  CANCELLED: '取消',
}

const DELIVERY_STATUS_TONES: Record<NotificationDeliveryDto['status'], RecordTone> = {
  PENDING: 'info',
  SENDING: 'info',
  ACCEPTED: 'success',
  FAILED: 'danger',
  SKIPPED: 'muted',
  EXPIRED: 'danger',
  CANCELLED: 'muted',
}

export const NOTIFICATION_STATUS_OPTIONS = Object.keys(NOTIFICATION_STATUS_LABELS).map(value => ({
  label: NOTIFICATION_STATUS_LABELS[value as NotificationRecordDto['status']],
  value,
}))

export const PRIORITY_OPTIONS = [
  { label: '普通', value: 'NORMAL' },
  { label: '高', value: 'HIGH' },
] as const

export const CHANNEL_OPTIONS = [
  { label: '站内', value: 'IN_APP' },
  { label: '小助理', value: 'ASSISTANT' },
] as const

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ADVERTISING_RECHARGE_REQUEST: '广告充值申请',
  ASSISTANT_ACCOUNT: 'GeWe 公司号',
  FUND_POSTING_BATCH: '资金记账批次',
  FUND_WITHDRAWAL_REQUEST: '提款申请',
  INVOICE_REQUEST: '开票申请',
  MACHINE_VIEWING_APPOINTMENT: '看机预约',
  PACKAGING_COST_REQUEST: '打木架费用',
  PACKAGING_PAYMENT_DIGEST: '包装款日汇总',
  PROXY_NODE: '静态节点',
  PURCHASE_ORDER: '采购订单',
  PURCHASE_PAYABLE_DIGEST: '采购应付款日汇总',
  PURCHASE_SHIPMENT: '采购货件',
  SALES_ORDER: '销售订单',
  SALES_RECEIPT_REQUEST: '销售收款申请',
  SHIPMENT_STORAGE_CLAIM_REQUEST: '调货申请',
  SHIPMENT_STORAGE_RELEASE: '货件转寄仓',
  SLH_RECONCILIATION_BATCH: '顺联航对账批次',
}

export function notificationStatusLabel(status: string): string {
  return NOTIFICATION_STATUS_LABELS[status as NotificationRecordDto['status']] ?? status
}

export function notificationStatusClass(status: string): string {
  return TONE_CLASSES[NOTIFICATION_STATUS_TONES[status as NotificationRecordDto['status']] ?? 'muted']
}

export function deliveryStatusLabel(status: string): string {
  return DELIVERY_STATUS_LABELS[status as NotificationDeliveryDto['status']] ?? status
}

export function deliveryStatusClass(status: string): string {
  return TONE_CLASSES[DELIVERY_STATUS_TONES[status as NotificationDeliveryDto['status']] ?? 'muted']
}

export function priorityLabel(priority: string): string {
  return priority === 'HIGH' ? '高' : '普通'
}

export function priorityClass(priority: string): string {
  return priority === 'HIGH' ? TONE_CLASSES.warning : TONE_CLASSES.muted
}

export function channelLabel(channel: 'IN_APP' | 'ASSISTANT'): string {
  return channel === 'IN_APP' ? '站内' : '小助理'
}

export function channelClass(channel: 'IN_APP' | 'ASSISTANT'): string {
  return channel === 'IN_APP'
    ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    : 'border-primary/30 bg-primary/10 text-primary'
}

export function domainLabel(domain: string): string {
  return templateDomainLabel(domain)
}

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType
}
