import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  AUDIT_EVENT_TYPES,
  buildAuditEventListQuery,
} from '../../src/views/system/audit/audit.logic'
import { formatAuditEvent } from '../../src/views/system/audit/presentation'

test('审计列表发送分页、规范化后的精确请求 ID 和已应用筛选', () => {
  assert.deepEqual(buildAuditEventListQuery(
    3,
    50,
    '  req-20260724  ',
    'USER_UPDATED',
    'FAILURE',
  ), {
    eventType: 'USER_UPDATED',
    outcome: 'FAILURE',
    page: 3,
    pageSize: 50,
    requestId: 'req-20260724',
  })

  assert.deepEqual(buildAuditEventListQuery(
    1,
    20,
    '   ',
    undefined,
    undefined,
  ), {
    page: 1,
    pageSize: 20,
  })

  assert.deepEqual(buildAuditEventListQuery(
    1,
    20,
    'req-1',
    'UNKNOWN_EVENT',
    'UNKNOWN_OUTCOME',
  ), {
    page: 1,
    pageSize: 20,
    requestId: 'req-1',
  })
})

test('审计事件筛选选项覆盖当前公开契约的全部事件类型', () => {
  assert.deepEqual(AUDIT_EVENT_TYPES, [
    'AUTH_LOGIN_SUCCEEDED',
    'AUTH_LOGIN_FAILED',
    'AUTH_LOGOUT',
    'AUTH_LOGOUT_ALL',
    'USER_CREATED',
    'USER_UPDATED',
    'USER_ENABLED',
    'USER_DISABLED',
    'USER_PASSWORD_CHANGED',
    'USER_PASSWORD_RESET',
    'USER_ROLES_CHANGED',
    'ROLE_CREATED',
    'ROLE_UPDATED',
    'ROLE_PERMISSIONS_CHANGED',
    'REGION_CREATED',
    'REGION_UPDATED',
    'REGION_ENABLED',
    'REGION_DISABLED',
    'CURRENCY_CREATED',
    'CURRENCY_UPDATED',
    'CURRENCY_ENABLED',
    'CURRENCY_DISABLED',
    'EXCHANGE_RATE_CREATED',
    'EXCHANGE_RATE_UPDATED',
    'NUMBERING_RULE_CREATED',
    'NUMBERING_RULE_UPDATED',
    'NUMBERING_RULE_VERSION_PUBLISHED',
    'NUMBERING_RULE_ENABLED',
    'NUMBERING_RULE_DISABLED',
    'DICTIONARY_TYPE_CREATED',
    'DICTIONARY_TYPE_UPDATED',
    'DICTIONARY_TYPE_ENABLED',
    'DICTIONARY_TYPE_DISABLED',
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_UPDATED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_DISABLED',
    'SYSTEM_BOOTSTRAP',
    'SYSTEM_ADMIN_RECOVERED',
    'AUTH_RETENTION_PURGED',
    'PRODUCT_CREATED',
    'PACKAGING_COST_SUBMITTED',
    'PACKAGING_COST_PAID',
    'PACKAGING_COST_AMOUNT_UPDATED',
    'CONTAINER_BATCH_CREATED',
    'CONTAINER_BATCH_UPDATED',
    'CONTAINER_LOADING_ITEM_UPDATED',
    'CONTAINER_LOADING_ITEM_CREATED',
  ])
})

test('产品创建审计事件使用中文名称并保留稳定事件代码', () => {
  assert.equal(formatAuditEvent('PRODUCT_CREATED'), '产品已创建')
})

test('编号规则审计事件使用现有中文展示管道', () => {
  assert.equal(formatAuditEvent('NUMBERING_RULE_CREATED'), '编号规则已创建')
  assert.equal(formatAuditEvent('NUMBERING_RULE_UPDATED'), '编号规则已更新')
  assert.equal(
    formatAuditEvent('NUMBERING_RULE_VERSION_PUBLISHED'),
    '编号规则版本已发布',
  )
  assert.equal(formatAuditEvent('NUMBERING_RULE_ENABLED'), '编号规则已启用')
  assert.equal(formatAuditEvent('NUMBERING_RULE_DISABLED'), '编号规则已停用')
})

test('系统字典审计事件使用现有中文展示管道', () => {
  assert.equal(formatAuditEvent('DICTIONARY_TYPE_CREATED'), '字典类型已创建')
  assert.equal(formatAuditEvent('DICTIONARY_TYPE_UPDATED'), '字典类型已更新')
  assert.equal(formatAuditEvent('DICTIONARY_TYPE_ENABLED'), '字典类型已启用')
  assert.equal(formatAuditEvent('DICTIONARY_TYPE_DISABLED'), '字典类型已停用')
  assert.equal(formatAuditEvent('DICTIONARY_ITEM_CREATED'), '字典项已创建')
  assert.equal(formatAuditEvent('DICTIONARY_ITEM_UPDATED'), '字典项已更新')
  assert.equal(formatAuditEvent('DICTIONARY_ITEM_ENABLED'), '字典项已启用')
  assert.equal(formatAuditEvent('DICTIONARY_ITEM_DISABLED'), '字典项已停用')
})

test('资金账户审计事件使用稳定中文名称', () => {
  assert.equal(formatAuditEvent('FUND_ACCOUNT_CREATED'), '资金账户已创建')
  assert.equal(
    formatAuditEvent('FUND_ACCOUNT_SHARE_RATE_UPDATED'),
    '资金账户分成比例已更新',
  )
  assert.equal(formatAuditEvent('FUND_POSTING_TYPE_CREATED'), '资金业务类型已创建')
  assert.equal(formatAuditEvent('FUND_POSTING_TYPE_UPDATED'), '资金业务类型已更新')
  assert.equal(formatAuditEvent('FUND_POSTING_TYPE_ENABLED'), '资金业务类型已启用')
  assert.equal(formatAuditEvent('FUND_POSTING_TYPE_DISABLED'), '资金业务类型已停用')
  assert.equal(formatAuditEvent('FUND_POSTING_RULE_PUBLISHED'), '资金动账规则已发布')
  assert.equal(formatAuditEvent('FUND_BUSINESS_SOURCE_CREATED'), '资金业务来源已创建')
  assert.equal(formatAuditEvent('FUND_BUSINESS_SOURCE_UPDATED'), '资金业务来源已更新')
  assert.equal(formatAuditEvent('FUND_BUSINESS_SOURCE_ENABLED'), '资金业务来源已启用')
  assert.equal(formatAuditEvent('FUND_BUSINESS_SOURCE_DISABLED'), '资金业务来源已停用')
  assert.equal(formatAuditEvent('FUND_MANUAL_ADJUSTMENT_POSTED'), '管理员手动调账已记账')
  assert.equal(formatAuditEvent('FUND_BUSINESS_POSTED'), '资金业务已记账')
  assert.equal(formatAuditEvent('FUND_POSTING_REVERSED'), '资金动账已冲账')
})

test('销售订单产品修改审计事件使用销售语义中文名称', () => {
  assert.equal(
    formatAuditEvent('SALES_ORDER_PRODUCTS_CHANGED'),
    '销售订单产品已修改',
  )
})

test('采购订单审计事件使用采购语义中文名称', () => {
  assert.equal(formatAuditEvent('PURCHASE_ORDER_CREATED'), '采购订单已创建')
  assert.equal(formatAuditEvent('PURCHASE_SHIPMENT_NUMBER_ASSIGNED'), '采购货件编号已派发')
  assert.equal(
    formatAuditEvent('PURCHASE_ORDER_ORDER_STATUS_CHANGED'),
    '采购订单状态已变更',
  )
  assert.equal(
    formatAuditEvent('PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED'),
    '采购订单履约状态已变更',
  )
  assert.equal(
    formatAuditEvent('PURCHASE_ORDER_PAYMENT_RECORDED'),
    '采购订单付款已记录',
  )
  assert.equal(
    formatAuditEvent('PURCHASE_ORDER_PAYMENT_VOIDED'),
    '采购订单付款已作废',
  )
  assert.equal(
    formatAuditEvent('PURCHASE_ORDER_DOCUMENT_ATTACHED'),
    '采购订单凭证已关联',
  )
  assert.equal(
    formatAuditEvent('PURCHASE_ORDER_DOCUMENT_DETACHED'),
    '采购订单凭证已解除',
  )
})

test('包装金额修改事件可筛选并使用中文名称', () => {
  assert.equal(formatAuditEvent('PACKAGING_COST_AMOUNT_UPDATED'), '打木架费用金额已修改')
  assert.equal(buildAuditEventListQuery(1, 20, '', 'PACKAGING_COST_AMOUNT_UPDATED', undefined).eventType, 'PACKAGING_COST_AMOUNT_UPDATED')
})

test('柜次相关事件使用中文名称且支持独立筛选', () => {
  for (const [code, label] of [
    ['CONTAINER_BATCH_CREATED', '柜次已创建'],
    ['CONTAINER_BATCH_UPDATED', '柜次已修改'],
    ['CONTAINER_LOADING_ITEM_UPDATED', '装柜明细已修改'],
    ['CONTAINER_LOADING_ITEM_CREATED', '装柜明细已创建'],
  ] as const) {
    assert.equal(formatAuditEvent(code), label)
    assert.equal(buildAuditEventListQuery(1, 20, '', code, undefined).eventType, code)
  }
})
