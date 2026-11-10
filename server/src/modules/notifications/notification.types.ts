import type { Prisma } from '../../generated/prisma/client'

export const NOTIFICATION_EVENT_TYPES = [
  'PURCHASE_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'SLH_RECONCILIATION_COMPLETED',
  'SHIPMENT_ARRIVED',
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'PACKAGING_COST_PAYMENT_PENDING',
  'PURCHASE_PAYABLE_PENDING',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export type NotificationChannel = 'IN_APP' | 'ASSISTANT'

export type NotificationPriority = 'NORMAL' | 'HIGH'

export type NotificationDomain =
  | 'purchase'
  | 'fund'
  | 'invoice'
  | 'reconciliation'
  | 'shipment'

export const NOTIFICATION_DOMAIN_LABELS: Readonly<Record<NotificationDomain, string>> = Object.freeze({
  purchase: '采购',
  fund: '资金',
  invoice: '发票',
  reconciliation: '对账',
  shipment: '货件',
})

/** 站内通知的业务域筛选由事件类型派生，不单独落库。 */
export const NOTIFICATION_EVENT_DOMAIN: Readonly<Record<NotificationEventType, NotificationDomain>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'purchase',
  INVOICE_REQUEST_REVIEW_PENDING: 'invoice',
  SLH_RECONCILIATION_COMPLETED: 'reconciliation',
  SHIPMENT_ARRIVED: 'shipment',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'fund',
  PACKAGING_COST_PAYMENT_PENDING: 'fund',
  PURCHASE_PAYABLE_PENDING: 'fund',
})

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEventType, string>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: '采购审核',
  INVOICE_REQUEST_REVIEW_PENDING: '开票申请',
  SLH_RECONCILIATION_COMPLETED: '对账完成',
  SHIPMENT_ARRIVED: '货件到仓',
  FUND_WITHDRAWAL_REVIEW_PENDING: '提现审核',
  PACKAGING_COST_PAYMENT_PENDING: '包装待付款',
  PURCHASE_PAYABLE_PENDING: '采购待付款',
})

/** 事件在管理端归入的模板业务域，与模板 domain 枚举保持一致。 */
export const NOTIFICATION_EVENT_TEMPLATE_DOMAIN: Readonly<Record<NotificationEventType, 'SALES' | 'PURCHASE' | 'SHIPMENT' | 'FINANCE' | 'INVOICE' | 'RECONCILIATION' | 'SYSTEM'>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'PURCHASE',
  INVOICE_REQUEST_REVIEW_PENDING: 'INVOICE',
  SLH_RECONCILIATION_COMPLETED: 'RECONCILIATION',
  SHIPMENT_ARRIVED: 'SHIPMENT',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'FINANCE',
  PACKAGING_COST_PAYMENT_PENDING: 'FINANCE',
  PURCHASE_PAYABLE_PENDING: 'FINANCE',
})

/** 已有业务发布点的事件；未登记的事件允许提前配置但不会触发。 */
export const IMPLEMENTED_NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = Object.freeze([
  'PURCHASE_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'SHIPMENT_ARRIVED',
])

/** 业务命令实际传入的默认模板键；没有触发源的事件留空。 */
export const NOTIFICATION_EVENT_DEFAULT_TEMPLATE_KEY: Readonly<Partial<Record<NotificationEventType, string>>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'purchase.review.pending',
  INVOICE_REQUEST_REVIEW_PENDING: 'invoice.review.pending',
  SHIPMENT_ARRIVED: 'shipment.arrived',
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
