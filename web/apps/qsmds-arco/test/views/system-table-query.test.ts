import type { PermissionDto, RoleDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面查询逻辑是无浏览器依赖的纯函数，使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  filterPermissionTableRows,
  filterRoleTableRows,
  hasVisibleTableColumn,
  permissionResourceOptions,
} from '../../src/views/system/shared/table-query'

const roles: RoleDto[] = [
  {
    id: 'role-system',
    code: 'SYSTEM_ADMIN',
    name: '系统管理员',
    description: '平台内置角色',
    isSystem: true,
    permissionIds: ['permission-system'],
  },
  {
    id: 'role-sales',
    code: 'SALES_MANAGER',
    name: '销售主管',
    description: '负责 华东 区域',
    isSystem: false,
    permissionIds: ['permission-business'],
  },
  {
    id: 'role-empty-description',
    code: 'AUDITOR',
    name: '审计员',
    description: null,
    isSystem: false,
    permissionIds: [],
  },
]

const permissions: PermissionDto[] = [
  {
    id: 'permission-role-read',
    code: 'roles:read',
    name: '查看角色',
    description: '读取角色目录',
    systemOnly: false,
  },
  {
    id: 'permission-user-manage',
    code: 'users:update',
    name: '修改用户',
    description: '维护业务账号',
    systemOnly: false,
  },
  {
    id: 'permission-audit-purge',
    code: 'audit:purge',
    name: '清理审计事件',
    description: null,
    systemOnly: true,
  },
]

test('角色表格搜索覆盖名称、编码和说明，并与角色类型筛选共同生效', () => {
  assert.deepEqual(
    filterRoleTableRows(roles, '  sales  ', {}).map(role => role.id),
    ['role-sales'],
  )
  assert.deepEqual(
    filterRoleTableRows(roles, '华东', {}).map(role => role.id),
    ['role-sales'],
  )
  assert.deepEqual(
    filterRoleTableRows(roles, '管理员', {}).map(role => role.id),
    ['role-system'],
  )
  assert.deepEqual(
    filterRoleTableRows(roles, '', { roleType: 'custom' }).map(role => role.id),
    ['role-sales', 'role-empty-description'],
  )
  assert.deepEqual(
    filterRoleTableRows(roles, '审计', { roleType: 'system' }),
    [],
  )
  assert.deepEqual(
    roles.map(role => role.id),
    ['role-system', 'role-sales', 'role-empty-description'],
    '本地查询不得改变 Server 返回数组的顺序或内容',
  )
})

test('权限表格搜索覆盖权限字段和资源，并支持资源、权限范围联合筛选', () => {
  assert.deepEqual(
    filterPermissionTableRows(permissions, 'USERS', {}).map(permission => permission.id),
    ['permission-user-manage'],
  )
  assert.deepEqual(
    filterPermissionTableRows(permissions, '安全审计', {}).map(permission => permission.id),
    ['permission-audit-purge'],
  )
  assert.deepEqual(
    filterPermissionTableRows(permissions, '业务账号', {}).map(permission => permission.id),
    ['permission-user-manage'],
  )
  assert.deepEqual(
    filterPermissionTableRows(permissions, '', {
      permissionScope: 'business',
      resource: 'roles',
    }).map(permission => permission.id),
    ['permission-role-read'],
  )
  assert.deepEqual(
    filterPermissionTableRows(permissions, '清理', {
      permissionScope: 'system',
      resource: 'audit',
    }).map(permission => permission.id),
    ['permission-audit-purge'],
  )
})

test('权限资源筛选项按资源键稳定排序且复用面向用户的中文名称', () => {
  assert.deepEqual(permissionResourceOptions(permissions), [
    { label: '安全审计', value: 'audit' },
    { label: '角色管理', value: 'roles' },
    { label: '用户管理', value: 'users' },
  ])
})

test('自定义移动卡片根据通用表格传入的可见列决定字段显隐', () => {
  const visibleColumns = [{ id: 'name' }, { id: 'description' }]

  assert.equal(hasVisibleTableColumn(visibleColumns, 'name'), true)
  assert.equal(hasVisibleTableColumn(visibleColumns, 'code'), false)
})
