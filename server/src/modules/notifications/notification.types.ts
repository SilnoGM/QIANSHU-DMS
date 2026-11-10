import type { Prisma } from '../../generated/prisma/client'

export const NOTIFICATION_EVENT_TYPES = [
  'PURCHASE_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'SLH_RECONCILIATION_COMPLETED',
  'SHIPMENT_ARRIVED',
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'PACKAGING_COST_PAYMENT_PENDING',
  'PURCHASE_PAYABLE_PENDING',
  'SALES_RECEIPT_REVIEW_PENDING',
  'SALES_RECEIPT_APPROVED',
  'SALES_RECEIPT_REJECTED',
  'PURCHASE_REVIEW_APPROVED',
  'PURCHASE_REVIEW_REJECTED',
  'PURCHASE_ORDER_CANCELLED',
  'STORAGE_CLAIM_REQUEST_PENDING',
  'STORAGE_CLAIM_REQUEST_APPROVED',
  'STORAGE_CLAIM_REQUEST_REJECTED',
  'SHIPMENT_RELEASED_TO_STORAGE',
  'FUND_WITHDRAWAL_APPROVED',
  'FUND_WITHDRAWAL_REJECTED',
  'PACKAGING_COST_PAID',
  'INVOICE_REQUEST_RETURNED',
  'INVOICE_REQUEST_NOTIFIED',
  'INVOICE_REQUEST_ISSUED',
  'INVOICE_REQUEST_SETTLED',
  'INVOICE_REQUEST_CANCELLED',
  'MACHINE_VIEWING_APPOINTMENT_CREATED',
  'PROXY_NODE_EXPIRING',
  'ADVERTISING_RECHARGE_PAYMENT_PENDING',
  'ADVERTISING_RECHARGE_PAID',
  'ADVERTISING_RECHARGE_REJECTED',
  'ADVERTISING_RECHARGE_VOIDED',
  'SALES_ORDER_COMPLETED',
  'PURCHASE_ORDER_COMPLETED',
  'SHIPMENT_SIGNED',
  'SALES_ORDER_TERMINATED',
  'FUND_ACCOUNT_ADJUSTED',
  'PROXY_NODE_EXPIRED',
  'ASSISTANT_ACCOUNT_OFFLINE',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export type NotificationChannel = 'IN_APP' | 'ASSISTANT'

export type NotificationPriority = 'NORMAL' | 'HIGH'

export const NOTIFICATION_DOMAINS = [
  'sales',
  'purchase',
  'shipment',
  'finance',
  'invoice',
  'reconciliation',
  'operations',
  'system',
] as const

export type NotificationDomain = (typeof NOTIFICATION_DOMAINS)[number]

export const NOTIFICATION_DOMAIN_LABELS: Readonly<Record<NotificationDomain, string>> = Object.freeze({
  sales: '销售',
  purchase: '采购',
  shipment: '货件运输',
  finance: '财务',
  invoice: '发票',
  reconciliation: '对账',
  operations: '运营',
  system: '系统',
})

/** 站内通知的业务域筛选由事件类型派生，不单独落库。 */
export const NOTIFICATION_EVENT_DOMAIN: Readonly<Record<NotificationEventType, NotificationDomain>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'purchase',
  INVOICE_REQUEST_REVIEW_PENDING: 'invoice',
  SLH_RECONCILIATION_COMPLETED: 'reconciliation',
  SHIPMENT_ARRIVED: 'shipment',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'finance',
  PACKAGING_COST_PAYMENT_PENDING: 'finance',
  PURCHASE_PAYABLE_PENDING: 'finance',
  SALES_RECEIPT_REVIEW_PENDING: 'sales',
  SALES_RECEIPT_APPROVED: 'sales',
  SALES_RECEIPT_REJECTED: 'sales',
  PURCHASE_REVIEW_APPROVED: 'purchase',
  PURCHASE_REVIEW_REJECTED: 'purchase',
  PURCHASE_ORDER_CANCELLED: 'purchase',
  STORAGE_CLAIM_REQUEST_PENDING: 'shipment',
  STORAGE_CLAIM_REQUEST_APPROVED: 'shipment',
  STORAGE_CLAIM_REQUEST_REJECTED: 'shipment',
  SHIPMENT_RELEASED_TO_STORAGE: 'shipment',
  FUND_WITHDRAWAL_APPROVED: 'finance',
  FUND_WITHDRAWAL_REJECTED: 'finance',
  PACKAGING_COST_PAID: 'finance',
  INVOICE_REQUEST_RETURNED: 'invoice',
  INVOICE_REQUEST_NOTIFIED: 'invoice',
  INVOICE_REQUEST_ISSUED: 'invoice',
  INVOICE_REQUEST_SETTLED: 'invoice',
  INVOICE_REQUEST_CANCELLED: 'invoice',
  MACHINE_VIEWING_APPOINTMENT_CREATED: 'operations',
  PROXY_NODE_EXPIRING: 'operations',
  ADVERTISING_RECHARGE_PAYMENT_PENDING: 'operations',
  ADVERTISING_RECHARGE_PAID: 'operations',
  ADVERTISING_RECHARGE_REJECTED: 'operations',
  ADVERTISING_RECHARGE_VOIDED: 'operations',
  SALES_ORDER_COMPLETED: 'sales',
  PURCHASE_ORDER_COMPLETED: 'purchase',
  SHIPMENT_SIGNED: 'shipment',
  SALES_ORDER_TERMINATED: 'sales',
  FUND_ACCOUNT_ADJUSTED: 'finance',
  PROXY_NODE_EXPIRED: 'operations',
  ASSISTANT_ACCOUNT_OFFLINE: 'system',
})

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEventType, string>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: '采购审核',
  INVOICE_REQUEST_REVIEW_PENDING: '开票申请',
  SLH_RECONCILIATION_COMPLETED: '对账完成',
  SHIPMENT_ARRIVED: '货件到仓',
  FUND_WITHDRAWAL_REVIEW_PENDING: '提现审核',
  PACKAGING_COST_PAYMENT_PENDING: '包装待付款',
  PURCHASE_PAYABLE_PENDING: '采购待付款',
  SALES_RECEIPT_REVIEW_PENDING: '收款审核',
  SALES_RECEIPT_APPROVED: '收款通过',
  SALES_RECEIPT_REJECTED: '收款驳回',
  PURCHASE_REVIEW_APPROVED: '采购审核通过',
  PURCHASE_REVIEW_REJECTED: '采购审核驳回',
  PURCHASE_ORDER_CANCELLED: '采购取消',
  STORAGE_CLAIM_REQUEST_PENDING: '调货申请',
  STORAGE_CLAIM_REQUEST_APPROVED: '调货通过',
  STORAGE_CLAIM_REQUEST_REJECTED: '调货驳回',
  SHIPMENT_RELEASED_TO_STORAGE: '货件转寄仓',
  FUND_WITHDRAWAL_APPROVED: '提现通过',
  FUND_WITHDRAWAL_REJECTED: '提现驳回',
  PACKAGING_COST_PAID: '包装已付款',
  INVOICE_REQUEST_RETURNED: '开票退回',
  INVOICE_REQUEST_NOTIFIED: '已通知开票',
  INVOICE_REQUEST_ISSUED: '发票已开具',
  INVOICE_REQUEST_SETTLED: '开票已结算',
  INVOICE_REQUEST_CANCELLED: '开票取消',
  MACHINE_VIEWING_APPOINTMENT_CREATED: '看机预约',
  PROXY_NODE_EXPIRING: '节点即将到期',
  ADVERTISING_RECHARGE_PAYMENT_PENDING: '广告充值待付款',
  ADVERTISING_RECHARGE_PAID: '广告充值已付款',
  ADVERTISING_RECHARGE_REJECTED: '广告充值驳回',
  ADVERTISING_RECHARGE_VOIDED: '广告充值作废',
  SALES_ORDER_COMPLETED: '销售订单完成',
  PURCHASE_ORDER_COMPLETED: '采购订单完成',
  SHIPMENT_SIGNED: '货件签收',
  SALES_ORDER_TERMINATED: '销售订单终止',
  FUND_ACCOUNT_ADJUSTED: '资金账户调整',
  PROXY_NODE_EXPIRED: '节点已过期',
  ASSISTANT_ACCOUNT_OFFLINE: '小助理离线',
})

/** 事件在管理端归入的模板业务域，与模板 domain 枚举保持一致。 */
export const NOTIFICATION_EVENT_TEMPLATE_DOMAIN: Readonly<Record<NotificationEventType, 'SALES' | 'PURCHASE' | 'SHIPMENT' | 'FINANCE' | 'INVOICE' | 'RECONCILIATION' | 'OPERATIONS' | 'SYSTEM'>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'PURCHASE',
  INVOICE_REQUEST_REVIEW_PENDING: 'INVOICE',
  SLH_RECONCILIATION_COMPLETED: 'RECONCILIATION',
  SHIPMENT_ARRIVED: 'SHIPMENT',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'FINANCE',
  PACKAGING_COST_PAYMENT_PENDING: 'FINANCE',
  PURCHASE_PAYABLE_PENDING: 'FINANCE',
  SALES_RECEIPT_REVIEW_PENDING: 'SALES',
  SALES_RECEIPT_APPROVED: 'SALES',
  SALES_RECEIPT_REJECTED: 'SALES',
  PURCHASE_REVIEW_APPROVED: 'PURCHASE',
  PURCHASE_REVIEW_REJECTED: 'PURCHASE',
  PURCHASE_ORDER_CANCELLED: 'PURCHASE',
  STORAGE_CLAIM_REQUEST_PENDING: 'SHIPMENT',
  STORAGE_CLAIM_REQUEST_APPROVED: 'SHIPMENT',
  STORAGE_CLAIM_REQUEST_REJECTED: 'SHIPMENT',
  SHIPMENT_RELEASED_TO_STORAGE: 'SHIPMENT',
  FUND_WITHDRAWAL_APPROVED: 'FINANCE',
  FUND_WITHDRAWAL_REJECTED: 'FINANCE',
  PACKAGING_COST_PAID: 'FINANCE',
  INVOICE_REQUEST_RETURNED: 'INVOICE',
  INVOICE_REQUEST_NOTIFIED: 'INVOICE',
  INVOICE_REQUEST_ISSUED: 'INVOICE',
  INVOICE_REQUEST_SETTLED: 'INVOICE',
  INVOICE_REQUEST_CANCELLED: 'INVOICE',
  MACHINE_VIEWING_APPOINTMENT_CREATED: 'OPERATIONS',
  PROXY_NODE_EXPIRING: 'OPERATIONS',
  ADVERTISING_RECHARGE_PAYMENT_PENDING: 'OPERATIONS',
  ADVERTISING_RECHARGE_PAID: 'OPERATIONS',
  ADVERTISING_RECHARGE_REJECTED: 'OPERATIONS',
  ADVERTISING_RECHARGE_VOIDED: 'OPERATIONS',
  SALES_ORDER_COMPLETED: 'SALES',
  PURCHASE_ORDER_COMPLETED: 'PURCHASE',
  SHIPMENT_SIGNED: 'SHIPMENT',
  SALES_ORDER_TERMINATED: 'SALES',
  FUND_ACCOUNT_ADJUSTED: 'FINANCE',
  PROXY_NODE_EXPIRED: 'OPERATIONS',
  ASSISTANT_ACCOUNT_OFFLINE: 'SYSTEM',
})

/** 已有业务发布点的事件；未登记的事件允许提前配置但不会触发。 */
export const IMPLEMENTED_NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = Object.freeze([
  'PURCHASE_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'SLH_RECONCILIATION_COMPLETED',
  'SHIPMENT_ARRIVED',
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'PACKAGING_COST_PAYMENT_PENDING',
  'PURCHASE_PAYABLE_PENDING',
  'SALES_RECEIPT_REVIEW_PENDING',
  'SALES_RECEIPT_APPROVED',
  'SALES_RECEIPT_REJECTED',
  'PURCHASE_REVIEW_APPROVED',
  'PURCHASE_REVIEW_REJECTED',
  'PURCHASE_ORDER_CANCELLED',
  'STORAGE_CLAIM_REQUEST_PENDING',
  'STORAGE_CLAIM_REQUEST_APPROVED',
  'STORAGE_CLAIM_REQUEST_REJECTED',
  'SHIPMENT_RELEASED_TO_STORAGE',
  'FUND_WITHDRAWAL_APPROVED',
  'FUND_WITHDRAWAL_REJECTED',
  'PACKAGING_COST_PAID',
  'INVOICE_REQUEST_RETURNED',
  'INVOICE_REQUEST_NOTIFIED',
  'INVOICE_REQUEST_ISSUED',
  'INVOICE_REQUEST_SETTLED',
  'INVOICE_REQUEST_CANCELLED',
  'MACHINE_VIEWING_APPOINTMENT_CREATED',
  'PROXY_NODE_EXPIRING',
  'ADVERTISING_RECHARGE_PAYMENT_PENDING',
  'ADVERTISING_RECHARGE_PAID',
  'ADVERTISING_RECHARGE_REJECTED',
  'ADVERTISING_RECHARGE_VOIDED',
  'SALES_ORDER_COMPLETED',
  'PURCHASE_ORDER_COMPLETED',
  'SHIPMENT_SIGNED',
  'SALES_ORDER_TERMINATED',
  'FUND_ACCOUNT_ADJUSTED',
  'PROXY_NODE_EXPIRED',
  'ASSISTANT_ACCOUNT_OFFLINE',
])

/** 业务命令实际传入的默认模板键；没有触发源的事件留空。 */
export const NOTIFICATION_EVENT_DEFAULT_TEMPLATE_KEY: Readonly<Partial<Record<NotificationEventType, string>>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'purchase.review.pending',
  INVOICE_REQUEST_REVIEW_PENDING: 'invoice.review.pending',
  SLH_RECONCILIATION_COMPLETED: 'slh.reconciliation.completed',
  SHIPMENT_ARRIVED: 'shipment.arrived',
  PURCHASE_REVIEW_APPROVED: 'purchase.review.approved',
  PURCHASE_REVIEW_REJECTED: 'purchase.review.rejected',
  PURCHASE_ORDER_CANCELLED: 'purchase.order.cancelled',
  SALES_RECEIPT_REVIEW_PENDING: 'sales.receipt.pending',
  SALES_RECEIPT_APPROVED: 'sales.receipt.approved',
  SALES_RECEIPT_REJECTED: 'sales.receipt.rejected',
  STORAGE_CLAIM_REQUEST_PENDING: 'shipment.storage-claim.pending',
  STORAGE_CLAIM_REQUEST_APPROVED: 'shipment.storage-claim.approved',
  STORAGE_CLAIM_REQUEST_REJECTED: 'shipment.storage-claim.rejected',
  SHIPMENT_RELEASED_TO_STORAGE: 'shipment.released-to-storage',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'fund.withdrawal.pending',
  FUND_WITHDRAWAL_APPROVED: 'fund.withdrawal.approved',
  FUND_WITHDRAWAL_REJECTED: 'fund.withdrawal.rejected',
  PACKAGING_COST_PAYMENT_PENDING: 'packaging.payment.pending',
  PACKAGING_COST_PAID: 'packaging.payment.paid',
  PURCHASE_PAYABLE_PENDING: 'purchase.payable.pending',
  INVOICE_REQUEST_RETURNED: 'invoice.returned',
  INVOICE_REQUEST_NOTIFIED: 'invoice.notified',
  INVOICE_REQUEST_ISSUED: 'invoice.issued',
  INVOICE_REQUEST_SETTLED: 'invoice.settled',
  INVOICE_REQUEST_CANCELLED: 'invoice.cancelled',
  MACHINE_VIEWING_APPOINTMENT_CREATED: 'operations.machine-viewing.created',
  PROXY_NODE_EXPIRING: 'operations.proxy-node.expiring',
  ADVERTISING_RECHARGE_PAYMENT_PENDING: 'operations.advertising-recharge.pending',
  ADVERTISING_RECHARGE_PAID: 'operations.advertising-recharge.paid',
  ADVERTISING_RECHARGE_REJECTED: 'operations.advertising-recharge.rejected',
  ADVERTISING_RECHARGE_VOIDED: 'operations.advertising-recharge.voided',
  SALES_ORDER_COMPLETED: 'sales.order.completed',
  PURCHASE_ORDER_COMPLETED: 'purchase.order.completed',
  SHIPMENT_SIGNED: 'shipment.signed',
  SALES_ORDER_TERMINATED: 'sales.order.terminated',
  FUND_ACCOUNT_ADJUSTED: 'fund.account.adjusted',
  PROXY_NODE_EXPIRED: 'operations.proxy-node.expired',
  ASSISTANT_ACCOUNT_OFFLINE: 'system.assistant-account.offline',
})

/**
 * 事件向模板承诺的变量集合，用于策略绑定模板时校验占位符兼容性。
 * 尚无触发源的事件不登记，避免阻断管理员提前配置；接入事件时同步补变量。
 */
export const NOTIFICATION_EVENT_VARIABLES: Readonly<Partial<Record<NotificationEventType, readonly string[]>>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: [
    'orderNo',
    'orderId',
    'vendorName',
    'totalAmount',
    'currencyCode',
    'lineCount',
    'partCount',
    'customerName',
  ],
  INVOICE_REQUEST_REVIEW_PENDING: [
    'invoiceNo',
    'invoiceRequestId',
    'buyerName',
    'totalAmount',
    'lineCount',
  ],
  SHIPMENT_ARRIVED: [
    'orderNo',
    'orderId',
    'partNumbers',
    'receivedPartCount',
    'receivedAt',
    'customerName',
  ],
  SLH_RECONCILIATION_COMPLETED: [
    'batchNo',
    'slhBillNo',
    'memberCount',
    'reconciledMemberCount',
    'settlementTotalCny',
    'fundPostingCount',
  ],
  FUND_WITHDRAWAL_REVIEW_PENDING: ['withdrawalNo', 'applicantName', 'amount'],
  PACKAGING_COST_PAYMENT_PENDING: ['requestCount', 'totalAmountCny'],
  PURCHASE_PAYABLE_PENDING: ['orderCount', 'totalDueAmountCny'],
  SALES_RECEIPT_REVIEW_PENDING: ['collectionNo', 'orderNo', 'customerName', 'amount', 'currencyCode', 'paymentType'],
  SALES_RECEIPT_APPROVED: ['collectionNo', 'orderNo', 'amount', 'currencyCode', 'paymentType'],
  SALES_RECEIPT_REJECTED: ['collectionNo', 'orderNo', 'amount', 'currencyCode', 'paymentType', 'reason'],
  PURCHASE_REVIEW_APPROVED: ['orderNo', 'vendorName', 'totalAmount', 'currencyCode'],
  PURCHASE_REVIEW_REJECTED: ['orderNo', 'vendorName', 'reason'],
  PURCHASE_ORDER_CANCELLED: ['orderNo', 'vendorName', 'reason'],
  STORAGE_CLAIM_REQUEST_PENDING: ['shipmentNo', 'salesOrderNo', 'storageRecordId'],
  STORAGE_CLAIM_REQUEST_APPROVED: ['shipmentNo', 'salesOrderNo', 'storageRecordId'],
  STORAGE_CLAIM_REQUEST_REJECTED: ['shipmentNo', 'salesOrderNo', 'storageRecordId', 'reason'],
  SHIPMENT_RELEASED_TO_STORAGE: ['shipmentNos', 'releaseCount', 'locationScope', 'originSalesOrderNo', 'reason'],
  FUND_WITHDRAWAL_APPROVED: ['withdrawalNo', 'applicantName', 'amount'],
  FUND_WITHDRAWAL_REJECTED: ['withdrawalNo', 'applicantName', 'amount', 'reason'],
  PACKAGING_COST_PAID: ['shipmentNo', 'amount', 'currencyCode'],
  INVOICE_REQUEST_RETURNED: ['invoiceNo', 'invoiceRequestId', 'buyerName', 'reason'],
  INVOICE_REQUEST_NOTIFIED: ['invoiceNo', 'invoiceRequestId', 'buyerName'],
  INVOICE_REQUEST_ISSUED: ['invoiceNo', 'invoiceRequestId', 'buyerName', 'occurredAt'],
  INVOICE_REQUEST_SETTLED: ['invoiceNo', 'invoiceRequestId', 'settleAmountCny', 'occurredAt'],
  INVOICE_REQUEST_CANCELLED: ['invoiceNo', 'invoiceRequestId', 'reason', 'occurredAt'],
  MACHINE_VIEWING_APPOINTMENT_CREATED: ['appointmentNo', 'appointmentDate', 'period', 'hour', 'site', 'machineType', 'customerName', 'contactPerson'],
  PROXY_NODE_EXPIRING: ['nodeLabel', 'host', 'expiresAt', 'daysRemaining', 'assignedUserName'],
  ADVERTISING_RECHARGE_PAYMENT_PENDING: ['rechargeNo', 'applicantName', 'accountType', 'adAccountName', 'rechargeAmount', 'rechargeCurrency'],
  ADVERTISING_RECHARGE_PAID: ['rechargeNo', 'paymentAmountCny', 'occurredAt'],
  ADVERTISING_RECHARGE_REJECTED: ['rechargeNo', 'reason', 'occurredAt'],
  ADVERTISING_RECHARGE_VOIDED: ['rechargeNo', 'reason', 'paymentAmountCny', 'occurredAt'],
  SALES_ORDER_COMPLETED: ['orderNo', 'customerName', 'occurredAt'],
  PURCHASE_ORDER_COMPLETED: ['orderNo', 'vendorName', 'occurredAt'],
  SHIPMENT_SIGNED: ['orderNo', 'customerName', 'occurredAt'],
  SALES_ORDER_TERMINATED: ['orderNo', 'customerName', 'reason', 'occurredAt'],
  FUND_ACCOUNT_ADJUSTED: ['amount', 'currencyCode', 'reason', 'occurredAt'],
  PROXY_NODE_EXPIRED: ['nodeLabel', 'host', 'expiresAt', 'assignedUserName'],
  ASSISTANT_ACCOUNT_OFFLINE: ['accountName', 'occurredAt', 'reason'],
})

export function notificationEventVariables(eventType: string): readonly string[] | null {
  if (!Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENT_VARIABLES, eventType)) {
    return null
  }
  return NOTIFICATION_EVENT_VARIABLES[eventType as NotificationEventType] ?? null
}

export interface NotificationVariableDefinition {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly example: string
  readonly sensitive: boolean
  readonly maxLength: number
  readonly required: boolean
}

/**
 * 变量说明的唯一真相，供管理端展示可用变量；变量名同时参与事件契约校验。
 * 新增或修改变量时必须同步更新这里，并保证事件变量列表中的名字都有定义。
 */
export const NOTIFICATION_VARIABLE_DEFINITIONS: Readonly<Record<string, NotificationVariableDefinition>> = Object.freeze({
  orderNo: {
    name: 'orderNo',
    label: '采购单号',
    description: '采购单编号，来自编号规则签发结果。',
    example: 'CG/20261109-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  orderId: {
    name: 'orderId',
    label: '采购单 ID',
    description: '采购单 UUID，用于站内详情跳转链接。',
    example: '5f0c2d8e-8d0f-4f0e-9a7a-0f1b2c3d4e5f',
    sensitive: false,
    maxLength: 64,
    required: false,
  },
  vendorName: {
    name: 'vendorName',
    label: '供货方',
    description: '采购单供货方名称，可能是自定义名称或字典显示值。',
    example: '千树设备有限公司',
    sensitive: false,
    maxLength: 128,
    required: true,
  },
  totalAmount: {
    name: 'totalAmount',
    label: '金额',
    description: '采购总额或开票金额，已按业务口径格式化。',
    example: '1,234.56',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  currencyCode: {
    name: 'currencyCode',
    label: '币种',
    description: '金额对应的币种代码。',
    example: 'CNY',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  lineCount: {
    name: 'lineCount',
    label: '明细行数',
    description: '采购单或开票申请的明细行数。',
    example: '3',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  partCount: {
    name: 'partCount',
    label: '货件数',
    description: '采购单包含的货件数量。',
    example: '2',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  customerName: {
    name: 'customerName',
    label: '客户名称',
    description: '关联销售单的客户名称；未关联或查询失败时为空。',
    example: '张三',
    sensitive: true,
    maxLength: 128,
    required: false,
  },
  invoiceNo: {
    name: 'invoiceNo',
    label: '开票申请号',
    description: '开票申请编号。',
    example: 'KP/20261109-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  invoiceRequestId: {
    name: 'invoiceRequestId',
    label: '开票申请 ID',
    description: '开票申请 UUID，用于站内详情跳转链接。',
    example: '8a4b1c2d-3e4f-4a5b-8c6d-7e8f9012a3b4',
    sensitive: false,
    maxLength: 64,
    required: false,
  },
  buyerName: {
    name: 'buyerName',
    label: '购买方',
    description: '开票申请的购买方名称。',
    example: '千树设备有限公司',
    sensitive: true,
    maxLength: 128,
    required: true,
  },
  partNumbers: {
    name: 'partNumbers',
    label: '到仓货件',
    description: '本次到仓的货件号，按数字升序格式化为 01、02。',
    example: '01、02',
    sensitive: false,
    maxLength: 128,
    required: true,
  },
  receivedPartCount: {
    name: 'receivedPartCount',
    label: '到仓件数',
    description: '本次到仓的货件数量。',
    example: '2',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  receivedAt: {
    name: 'receivedAt',
    label: '到仓时间',
    description: '按 Asia/Shanghai 时区格式化的到仓时间。',
    example: '2026-11-09 14:30',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  batchNo: {
    name: 'batchNo',
    label: '对账批次号',
    description: '顺联航对账批次编号。',
    example: 'DZ/20261109-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  slhBillNo: {
    name: 'slhBillNo',
    label: '账单号',
    description: '顺联航账单编号。',
    example: 'SLH-202611-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  memberCount: {
    name: 'memberCount',
    label: '明细行数',
    description: '对账批次的成员明细行数。',
    example: '12',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  reconciledMemberCount: {
    name: 'reconciledMemberCount',
    label: '已核对行数',
    description: '已完成核对的成员行数，完成时等于明细行数。',
    example: '12',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  settlementTotalCny: {
    name: 'settlementTotalCny',
    label: '结算金额',
    description: '结算金额合计，单位 CNY。',
    example: '12,345.67',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  fundPostingCount: {
    name: 'fundPostingCount',
    label: '资金批次数',
    description: '对账完成后生成的资金入账批次数。',
    example: '3',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  collectionNo: {
    name: 'collectionNo',
    label: '收款申请号',
    description: '销售收款申请编号。',
    example: 'SK/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  paymentType: {
    name: 'paymentType',
    label: '收款类型',
    description: '收款申请对应的款项类型。',
    example: '定金',
    sensitive: false,
    maxLength: 32,
    required: true,
  },
  reason: {
    name: 'reason',
    label: '原因',
    description: '驳回、退回、取消或释放时填写的原因。',
    example: '信息不完整，请补充凭证',
    sensitive: true,
    maxLength: 500,
    required: true,
  },
  amount: {
    name: 'amount',
    label: '金额',
    description: '业务单据金额，已按业务口径格式化。',
    example: '1,234.56',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  withdrawalNo: {
    name: 'withdrawalNo',
    label: '提现单号',
    description: '提现申请编号。',
    example: 'TX/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  applicantName: {
    name: 'applicantName',
    label: '申请人',
    description: '发起申请的员工姓名。',
    example: '张三',
    sensitive: true,
    maxLength: 128,
    required: true,
  },
  requestCount: {
    name: 'requestCount',
    label: '待付款笔数',
    description: '当日待付款的提报或申请数量。',
    example: '6',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  totalAmountCny: {
    name: 'totalAmountCny',
    label: '合计金额',
    description: '当日待付款金额合计，单位 CNY。',
    example: '12,345.67',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  orderCount: {
    name: 'orderCount',
    label: '待付款单数',
    description: '当日存在未付清款项的采购单数量。',
    example: '4',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  totalDueAmountCny: {
    name: 'totalDueAmountCny',
    label: '待付金额',
    description: '当日采购单未付金额合计，单位 CNY。',
    example: '56,789.00',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  appointmentNo: {
    name: 'appointmentNo',
    label: '看机预约号',
    description: '看机预约编号。',
    example: 'MV/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  appointmentDate: {
    name: 'appointmentDate',
    label: '预约日期',
    description: '看机预约日期，按 Asia/Shanghai 格式化。',
    example: '2026-11-12',
    sensitive: false,
    maxLength: 32,
    required: true,
  },
  period: {
    name: 'period',
    label: '预约时段',
    description: '上午或下午。',
    example: '上午',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  hour: {
    name: 'hour',
    label: '预约小时',
    description: '预约的具体小时；未知时为空。',
    example: '10',
    sensitive: false,
    maxLength: 8,
    required: false,
  },
  site: {
    name: 'site',
    label: '看机地点',
    description: '看机预约的地点。',
    example: '新北林口',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  machineType: {
    name: 'machineType',
    label: '看机机型',
    description: '客户预约查看的机型。',
    example: '微耕机',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  contactPerson: {
    name: 'contactPerson',
    label: '业务对接人',
    description: '负责跟进该预约的内部员工。',
    example: '李四',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  nodeLabel: {
    name: 'nodeLabel',
    label: '节点名称',
    description: '静态节点的可读名称或地址。',
    example: 'TW-01',
    sensitive: false,
    maxLength: 128,
    required: true,
  },
  host: {
    name: 'host',
    label: '节点地址',
    description: '静态节点主机地址。',
    example: '203.0.113.10',
    sensitive: false,
    maxLength: 255,
    required: true,
  },
  expiresAt: {
    name: 'expiresAt',
    label: '到期时间',
    description: '静态节点到期时间，按 Asia/Shanghai 格式化。',
    example: '2026-11-17 09:00',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  daysRemaining: {
    name: 'daysRemaining',
    label: '剩余天数',
    description: '距离到期还有多少天。',
    example: '1',
    sensitive: false,
    maxLength: 8,
    required: true,
  },
  assignedUserName: {
    name: 'assignedUserName',
    label: '绑定员工',
    description: '静态节点当前绑定的员工姓名。',
    example: '王五',
    sensitive: false,
    maxLength: 128,
    required: false,
  },
  rechargeNo: {
    name: 'rechargeNo',
    label: '充值申请号',
    description: '广告账户充值申请编号。',
    example: 'AD/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  accountType: {
    name: 'accountType',
    label: '账户类型',
    description: '广告账户是个人户还是非个人户。',
    example: '个人户',
    sensitive: false,
    maxLength: 32,
    required: true,
  },
  adAccountName: {
    name: 'adAccountName',
    label: '广告账户名称',
    description: '广告账户的显示名称。',
    example: '千树广告户',
    sensitive: true,
    maxLength: 128,
    required: true,
  },
  rechargeAmount: {
    name: 'rechargeAmount',
    label: '充值金额',
    description: '申请的广告充值金额。',
    example: '1,000.00',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  rechargeCurrency: {
    name: 'rechargeCurrency',
    label: '充值币种',
    description: '广告充值金额的币种。',
    example: 'USD',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  paymentAmountCny: {
    name: 'paymentAmountCny',
    label: '实付金额',
    description: '财务实际支付的人民币金额。',
    example: '7,200.00',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
  occurredAt: {
    name: 'occurredAt',
    label: '发生时间',
    description: '业务动作发生时间，按 Asia/Shanghai 格式化。',
    example: '2026-11-10 14:30',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  shipmentNo: {
    name: 'shipmentNo',
    label: '货件号',
    description: '采购货件编号。',
    example: 'SJ/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  salesOrderNo: {
    name: 'salesOrderNo',
    label: '销售单号',
    description: '货件当前归属的销售订单编号。',
    example: 'SO/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  storageRecordId: {
    name: 'storageRecordId',
    label: '寄仓记录 ID',
    description: '寄仓记录 UUID，用于站内跳转。',
    example: '5f0c2d8e-8d0f-4f0e-9a7a-0f1b2c3d4e5f',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  shipmentNos: {
    name: 'shipmentNos',
    label: '货件号列表',
    description: '本次释放到寄仓池的货件编号，以顿号连接。',
    example: 'SJ-01、SJ-02',
    sensitive: false,
    maxLength: 512,
    required: true,
  },
  releaseCount: {
    name: 'releaseCount',
    label: '释放件数',
    description: '本次释放到寄仓池的货件数量。',
    example: '2',
    sensitive: false,
    maxLength: 16,
    required: true,
  },
  locationScope: {
    name: 'locationScope',
    label: '仓库范围',
    description: '内地仓或海外仓。',
    example: '内地',
    sensitive: false,
    maxLength: 32,
    required: true,
  },
  originSalesOrderNo: {
    name: 'originSalesOrderNo',
    label: '原销售单号',
    description: '货件原归属的销售订单编号。',
    example: 'SO/20261110-0001',
    sensitive: false,
    maxLength: 64,
    required: false,
  },
  accountName: {
    name: 'accountName',
    label: '小助理公司号',
    description: '千树小助理公司号名称。',
    example: '千树小助理',
    sensitive: false,
    maxLength: 64,
    required: true,
  },
  settleAmountCny: {
    name: 'settleAmountCny',
    label: '结算金额',
    description: '开票结算入账的人民币金额。',
    example: '2,345.67',
    sensitive: true,
    maxLength: 32,
    required: true,
  },
})

export function notificationEventVariableDefinitions(eventType: string): readonly NotificationVariableDefinition[] | null {
  const names = notificationEventVariables(eventType)
  if (names === null) {
    return null
  }
  return names.flatMap(name => {
    const definition = NOTIFICATION_VARIABLE_DEFINITIONS[name]
    return definition === undefined ? [] : [definition]
  })
}

export type NotificationTarget =
  | { readonly kind: 'USERS', readonly userIds: readonly string[] }
  | { readonly kind: 'ROLE', readonly roleCodes: readonly string[] }
  | { readonly kind: 'PERMISSION', readonly permissionCode: string }

export interface SystemNotificationPublishCommand {
  readonly eventType: NotificationEventType
  readonly source: { readonly type: string, readonly id: string }
  readonly target: NotificationTarget
  readonly templateKey: string
  readonly variables: Readonly<Record<string, string | number | null>>
  readonly dedupeKey?: string
  readonly priority?: NotificationPriority
  readonly expiresAt?: string
  readonly channels?: readonly NotificationChannel[]
  readonly requestedByUserId?: string
}

export interface SystemNotificationPublishOptions {
  readonly transaction?: Prisma.TransactionClient
  readonly now?: Date
}

export type NotificationSkipReason =
  | 'NOT_BOUND'
  | 'USER_DISABLED'
  | 'NO_RECIPIENT'
  | 'TARGET_DISABLED'
  | 'CHANNEL_DISABLED'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'QUIET_HOURS_EXPIRED'

export type NotificationPublishWarningCode =
  | 'EVENT_NOT_CONFIGURED'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_VARIABLE_MISSING'
  | 'SENSITIVE_VARIABLE_MASKED'
  | 'NO_RECIPIENT'
  | 'DUPLICATE_IGNORED'

export interface SystemNotificationPublishChannelResult {
  readonly channel: NotificationChannel
  readonly status: 'CREATED' | 'PENDING' | 'SKIPPED'
  readonly recipientCount: number
  readonly skippedCount: number
  readonly skipReason?: NotificationSkipReason
}

export interface SystemNotificationPublishResult {
  readonly notificationId: string
  readonly duplicated: boolean
  readonly channels: readonly SystemNotificationPublishChannelResult[]
  readonly warnings: readonly { readonly code: NotificationPublishWarningCode, readonly message: string }[]
}

export const MAX_NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60
export const DEFAULT_NOTIFICATION_TTL_SECONDS = 24 * 60 * 60
export const MAX_NOTIFICATION_TEMPLATE_LENGTH = 2_000
export const MAX_NOTIFICATION_VARIABLES = 20
export const MAX_NOTIFICATION_VARIABLE_LENGTH = 200
export const MAX_NOTIFICATION_DEDUPE_KEY_LENGTH = 200

export function notificationDomainOf(eventType: string): NotificationDomain | null {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENT_DOMAIN, eventType)
    ? NOTIFICATION_EVENT_DOMAIN[eventType as NotificationEventType]
    : null
}

export type AssistantTransportResult =
  | { readonly ok: true, readonly msgId: string | null, readonly newMsgId: string | null }
  | {
    readonly ok: false
    readonly kind: 'TIMEOUT' | 'NETWORK' | 'REJECTED' | 'OFFLINE' | 'RATE_LIMITED' | 'UNKNOWN'
    readonly code: string
    readonly message: string
  }

export interface AssistantTransport {
  sendText(input: {
    readonly appId: string
    readonly toWxid: string
    readonly content: string
    readonly ats?: string
  }): Promise<AssistantTransportResult>
}

export const ASSISTANT_TRANSPORT = Symbol('ASSISTANT_TRANSPORT')
export const ASSISTANT_TRANSPORT_OPTIONS = Symbol('ASSISTANT_TRANSPORT_OPTIONS')
export const ASSISTANT_ADMIN_TRANSPORT = Symbol('ASSISTANT_ADMIN_TRANSPORT')

export interface AssistantBriefContact {
  readonly wxid: string
  readonly nickname: string | null
  readonly remark: string | null
  readonly alias: string | null
  readonly avatarUrl: string | null
}

export interface AssistantChatroomInfo {
  readonly nickname: string | null
  readonly avatarUrl: string | null
  readonly memberCount: number | null
}

export interface AssistantChatroomMember {
  readonly wxid: string
  readonly nickname: string | null
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly inviterName: string | null
  readonly role: 'ADMIN' | 'MEMBER' | 'OWNER'
}

export interface AssistantAdminTransport {
  /** 只读探测节点在线状态；账号登录、重连和退出都在 GeWe 控制台完成。 */
  checkOnline(appId: string): Promise<boolean>
  fetchContactIds(appId: string): Promise<{ readonly friends: readonly string[], readonly chatrooms: readonly string[] }>
  fetchBriefInfo(appId: string, wxids: readonly string[]): Promise<readonly AssistantBriefContact[]>
  fetchChatroomInfo(appId: string, chatroomId: string): Promise<AssistantChatroomInfo>
  fetchChatroomMembers(appId: string, chatroomId: string): Promise<readonly AssistantChatroomMember[]>
  getOwnQrCode(appId: string): Promise<string>
  checkRelations(appId: string, wxids: readonly string[]): Promise<readonly { readonly wxid: string, readonly relation: number }[]>
}

export class AssistantAdminError extends Error {
  constructor(
    readonly code: string,
    readonly kind: string,
    message: string,
  ) {
    super(message)
    this.name = 'AssistantAdminError'
  }
}
