import type { AuditEventDto } from '@/api/generated/types.gen'

export interface AuditMetadataEntry {
  key: string
  value: string
}

export interface AuditOutcomeTagPresentation {
  class?: string
  variant: 'destructive' | 'outline'
}

const SUCCESS_TAG_CLASS = [
  'border-green-600/30 bg-green-600/10 text-green-700',
  'dark:border-green-400/30 dark:bg-green-400/10 dark:text-green-400',
].join(' ')

const EVENT_LABELS: Readonly<Record<AuditEventDto['eventType'], string>> = {
  AUTH_LOGIN_SUCCEEDED: '登录成功',
  AUTH_LOGIN_FAILED: '登录失败',
  AUTH_LOGOUT: '退出登录',
  AUTH_LOGOUT_ALL: '退出全部登录',
  USER_CREATED: '用户已创建',
  USER_UPDATED: '用户已更新',
  USER_ENABLED: '用户已启用',
  USER_DISABLED: '用户已禁用',
  USER_PASSWORD_CHANGED: '用户密码已修改',
  USER_PASSWORD_RESET: '用户密码已重置',
  USER_ROLES_CHANGED: '用户角色已变更',
  ROLE_CREATED: '角色已创建',
  ROLE_UPDATED: '角色已更新',
  ROLE_PERMISSIONS_CHANGED: '角色权限已变更',
  REGION_CREATED: '地区已创建',
  REGION_UPDATED: '地区已更新',
  REGION_ENABLED: '地区已启用',
  REGION_DISABLED: '地区已停用',
  CURRENCY_CREATED: '货币已创建',
  CURRENCY_UPDATED: '货币已更新',
  CURRENCY_ENABLED: '货币已启用',
  CURRENCY_DISABLED: '货币已停用',
  EXCHANGE_RATE_CREATED: '汇率已创建',
  EXCHANGE_RATE_UPDATED: '汇率已更新',
  NUMBERING_RULE_CREATED: '编号规则已创建',
  NUMBERING_RULE_UPDATED: '编号规则已更新',
  NUMBERING_RULE_VERSION_PUBLISHED: '编号规则版本已发布',
  NUMBERING_RULE_ENABLED: '编号规则已启用',
  NUMBERING_RULE_DISABLED: '编号规则已停用',
  SHIPPING_MARK_BINDING_CREATED: '供应商唛头规则已绑定',
  SHIPPING_MARK_BINDING_UPDATED: '供应商唛头规则已改绑',
  SUPPLIER_PAYMENT_PROFILE_SAVED: '供应商收款资料已保存',
  PACKAGING_PAYMENT_PROFILE_SAVED: '包装厂商收款资料已保存',
  DICTIONARY_TYPE_CREATED: '字典类型已创建',
  DICTIONARY_TYPE_UPDATED: '字典类型已更新',
  DICTIONARY_TYPE_ENABLED: '字典类型已启用',
  DICTIONARY_TYPE_DISABLED: '字典类型已停用',
  DICTIONARY_ITEM_CREATED: '字典项已创建',
  DICTIONARY_ITEM_UPDATED: '字典项已更新',
  DICTIONARY_ITEM_ENABLED: '字典项已启用',
  DICTIONARY_ITEM_DISABLED: '字典项已停用',
  SYSTEM_BOOTSTRAP: '系统管理员已初始化',
  SYSTEM_ADMIN_RECOVERED: '系统管理员已恢复',
  AUTH_RETENTION_PURGED: '认证保留数据已清理',
  PRODUCT_CREATED: '产品已创建',
  PRODUCT_UPDATED: '产品已更新',
  FUND_ACCOUNT_CREATED: '资金账户已创建',
  FUND_ACCOUNT_SHARE_RATE_UPDATED: '资金账户分成比例已更新',
  FUND_POSTING_TYPE_CREATED: '资金业务类型已创建',
  FUND_POSTING_TYPE_UPDATED: '资金业务类型已更新',
  FUND_POSTING_TYPE_ENABLED: '资金业务类型已启用',
  FUND_POSTING_TYPE_DISABLED: '资金业务类型已停用',
  FUND_POSTING_RULE_PUBLISHED: '资金动账规则已发布',
  FUND_BUSINESS_SOURCE_CREATED: '资金业务来源已创建',
  FUND_BUSINESS_SOURCE_UPDATED: '资金业务来源已更新',
  FUND_BUSINESS_SOURCE_ENABLED: '资金业务来源已启用',
  FUND_BUSINESS_SOURCE_DISABLED: '资金业务来源已停用',
  FUND_MANUAL_ADJUSTMENT_POSTED: '管理员手动调账已记账',
  FUND_BUSINESS_POSTED: '资金业务已记账',
  FUND_POSTING_REVERSED: '资金动账已冲账',
  SALES_RECEIPT_SUBMITTED: '销售收款申请已提交',
  SALES_RECEIPT_APPROVED: '销售收款审核已通过',
  SALES_RECEIPT_REJECTED: '销售收款申请已驳回',
  SALES_ORDER_CREATED: '销售订单已创建',
  SALES_ORDER_ORDER_STATUS_CHANGED: '销售订单状态已变更',
  SALES_ORDER_FULFILLMENT_STATUS_CHANGED: '销售订单履约状态已变更',
  SALES_ORDER_PAYMENT_TERMS_UPDATED: '销售订单付款约定已修改',
  SALES_ORDER_PAYMENT_RECORDED: '销售订单收款已记录',
  SALES_ORDER_PAYMENT_VOIDED: '销售订单收款已作废',
  SALES_ORDER_DOCUMENT_ATTACHED: '销售订单凭证已关联',
  SALES_ORDER_DOCUMENT_DETACHED: '销售订单凭证已解除',
  SALES_ORDER_PRODUCT_APPENDED: '销售订单产品已追加',
  SALES_ORDER_PRODUCTS_CHANGED: '销售订单产品已修改',
  PACKAGING_COST_SUBMITTED: '打木架费用已提报',
  PACKAGING_COST_PAID: '打木架费用已付款',
  PACKAGING_COST_AMOUNT_UPDATED: '打木架费用金额已修改',
  CONTAINER_BATCH_CREATED: '柜次已创建',
  CONTAINER_LOADING_ITEM_CREATED: '装柜明细已创建',
  OCEAN_FREIGHT_BILL_CREATED: '海运账单已创建',
  OCEAN_FREIGHT_BILL_LINE_CREATED: '海运账单明细已创建',
  PURCHASE_ORDER_CREATED: '采购订单已创建',
  PURCHASE_ORDER_REVIEW_MARKS_PREPARED: '采购审核唛头已派发',
  PURCHASE_ORDER_IMAGE_GENERATED: '采购单图片已生成',
  PURCHASE_SHIPMENT_NUMBER_ASSIGNED: '采购货件编号已派发',
  PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED: '采购货件已入仓',
  PURCHASE_ORDER_ORDER_STATUS_CHANGED: '采购订单状态已变更',
  PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED: '采购订单履约状态已变更',
  PURCHASE_ORDER_PAYMENT_RECORDED: '采购订单付款已记录',
  PURCHASE_ORDER_PAYMENT_VOIDED: '采购订单付款已作废',
  PURCHASE_ORDER_DOCUMENT_ATTACHED: '采购订单凭证已关联',
  PURCHASE_ORDER_DOCUMENT_DETACHED: '采购订单凭证已解除',
}

export function auditMetadataEntries(
  metadata: AuditEventDto['metadata'],
): AuditMetadataEntry[] {
  return Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      value: value === null ? 'null' : String(value),
    }))
}

export function formatAuditEvent(eventType: string): string {
  // 公开契约内的事件必须具备中文名称；未知历史值仍保留原文，便于管理员排查数据漂移。
  return Object.hasOwn(EVENT_LABELS, eventType)
    ? EVENT_LABELS[eventType as AuditEventDto['eventType']]
    : eventType
}

export function formatAuditOutcome(outcome: string): string {
  if (outcome === 'SUCCESS') {
    return '成功'
  }
  if (outcome === 'FAILURE') {
    return '失败'
  }
  return outcome
}

/**
 * 展示名帮助管理员快速识别操作者，稳定的用户 ID 仍由页面相邻列完整保留。
 * USER 理论上总能通过受 Restrict 保护的外键找到用户；若数据异常则显式提示，
 * SYSTEM 与 ANONYMOUS 本来就没有用户展示名，因此使用中性占位符。
 */
export function formatAuditActorDisplayName(
  actorType: string,
  displayName: string | null,
): string {
  const normalizedDisplayName = displayName?.trim()
  if (normalizedDisplayName) {
    return normalizedDisplayName
  }
  return actorType === 'USER' ? '未知用户' : '—'
}

/** 桌面表格与移动卡片共享同一状态语义，避免两套视图出现颜色漂移。 */
export function auditOutcomeTagPresentation(
  outcome: string,
): AuditOutcomeTagPresentation {
  if (outcome === 'SUCCESS') {
    return {
      class: SUCCESS_TAG_CLASS,
      variant: 'outline',
    }
  }
  return { variant: 'destructive' }
}

export function formatAuditTime(value: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
}
