import type { PermissionDto, RoleDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner 验证，无需浏览器环境。
import test from 'node:test'

import {
  auditMetadataEntries,
  formatAuditEvent,
  formatAuditOutcome,
} from '../../src/views/system/audit/presentation'
import {
  groupPermissions,
  sanitizePermissionSelection,
} from '../../src/views/system/permissions/catalog'
import {
  canAssignRolePermissions,
  canEditRole,
} from '../../src/views/system/roles/presentation'

const permissions: PermissionDto[] = [
  {
    id: 'permission-3',
    code: 'warehouse:read',
    name: '查询仓库',
    description: null,
    systemOnly: false,
  },
  {
    id: 'permission-2',
    code: 'roles:update',
    name: '编辑角色',
    description: '编辑普通角色',
    systemOnly: true,
  },
  {
    id: 'permission-1',
    code: 'roles:read',
    name: '查询角色',
    description: null,
    systemOnly: true,
  },
]

test('权限目录按资源和 code 稳定排序，并为已知资源提供中文名称', () => {
  assert.deepEqual(groupPermissions(permissions), [
    {
      key: 'roles',
      label: '角色管理',
      permissions: [permissions[2], permissions[1]],
    },
    {
      key: 'warehouse',
      label: 'warehouse',
      permissions: [permissions[0]],
    },
  ])
})

test('普通角色提交权限时剔除 systemOnly、未知 ID 和重复 ID', () => {
  assert.deepEqual(
    sanitizePermissionSelection(
      ['permission-3', 'permission-2', 'unknown', 'permission-3'],
      permissions,
    ),
    ['permission-3'],
  )
})

test('系统角色在角色编辑和权限分配入口均不可操作', () => {
  const systemRole: RoleDto = {
    id: 'role-system',
    code: 'system_admin',
    name: '系统管理员',
    description: null,
    isSystem: true,
    permissionIds: [],
  }
  const regularRole: RoleDto = {
    ...systemRole,
    id: 'role-regular',
    code: 'warehouse_reader',
    isSystem: false,
  }

  assert.equal(canEditRole(systemRole), false)
  assert.equal(canAssignRolePermissions(systemRole), false)
  assert.equal(canEditRole(regularRole), true)
  assert.equal(canAssignRolePermissions(regularRole), true)
})

test('审计 metadata 仅把契约标量按 key 排序并转换为可读文本', () => {
  assert.deepEqual(auditMetadataEntries({
    username: 'operator',
    success: true,
    retryCount: 0,
    reason: null,
  }), [
    { key: 'reason', value: 'null' },
    { key: 'retryCount', value: '0' },
    { key: 'success', value: 'true' },
    { key: 'username', value: 'operator' },
  ])
})

test('审计事件和结果使用稳定中文文案，未知值保留原值便于排查', () => {
  assert.equal(formatAuditEvent('ROLE_UPDATED'), '角色已更新')
  assert.equal(formatAuditEvent('DOMAIN_EVENT'), 'DOMAIN_EVENT')
  assert.equal(formatAuditOutcome('SUCCESS'), '成功')
  assert.equal(formatAuditOutcome('FAILURE'), '失败')
})
