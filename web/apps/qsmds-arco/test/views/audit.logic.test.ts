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
