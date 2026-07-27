import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  AUDIT_EVENT_TYPES,
  buildAuditEventListQuery,
} from '../../src/views/system/audit/audit.logic'

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
    'SYSTEM_BOOTSTRAP',
    'SYSTEM_ADMIN_RECOVERED',
    'AUTH_RETENTION_PURGED',
  ])
})
