import type { PermissionDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 抽屉纯逻辑使用 Node.js 内置 runner 验证，无需浏览器环境。
import test from 'node:test'

import { groupPermissions } from '../../src/views/system/permissions/catalog'
import {
  buildAssignmentGroups,
  selectPermissions,
  summarizeGroup,
  summarizeSelection,
  toggleGroupSelection,
} from '../../src/views/system/roles/permission-assignment.logic'

function permission(code: string, systemOnly = false): PermissionDto {
  return {
    code,
    description: `${code} 说明`,
    id: `id-${code}`,
    name: code,
    systemOnly,
  }
}

const CATALOG: PermissionDto[] = [
  permission('audit:read', true),
  permission('purchase-orders:create'),
  permission('purchase-orders:create-stock', true),
  permission('purchase-orders:document'),
  permission('purchase-orders:read'),
  permission('sales-orders:document'),
  permission('sales-orders:read'),
  permission('users:read', true),
]

const GROUPS = groupPermissions(CATALOG)

test('组级勾选只作用于可分配成员，systemOnly 与其它组不受影响', () => {
  const purchase = GROUPS.find(group => group.key === 'purchase-orders')!
  const sales = GROUPS.find(group => group.key === 'sales-orders')!

  const selected = toggleGroupSelection(purchase, ['id-sales-orders:read'])
  assert.deepEqual(selected.sort(), [
    'id-purchase-orders:create',
    'id-purchase-orders:document',
    'id-purchase-orders:read',
    'id-sales-orders:read',
  ])
  assert.equal(selected.includes('id-purchase-orders:create-stock'), false, 'systemOnly 不得被组级勾选带入')

  const cleared = toggleGroupSelection(purchase, selected)
  assert.deepEqual(cleared, ['id-sales-orders:read'], '再次点击整组取消，且保留其它组的选择')

  assert.notEqual(sales.key, purchase.key)
})

test('组级三态覆盖全部可分配 / 部分 / 无 / 无可分配四种状态', () => {
  const purchase = GROUPS.find(group => group.key === 'purchase-orders')!

  assert.deepEqual(summarizeGroup(purchase, []), {
    assignable: 3,
    selected: 0,
    state: 'none',
    systemOnly: 1,
  })
  assert.deepEqual(summarizeGroup(purchase, ['id-purchase-orders:read']), {
    assignable: 3,
    selected: 1,
    state: 'partial',
    systemOnly: 1,
  })
  assert.equal(summarizeGroup(purchase, [
    'id-purchase-orders:create',
    'id-purchase-orders:document',
    'id-purchase-orders:read',
  ]).state, 'all')

  const users = GROUPS.find(group => group.key === 'users')!
  assert.deepEqual(summarizeGroup(users, []), {
    assignable: 0,
    selected: 0,
    state: 'unavailable',
    systemOnly: 1,
  })
})

test('已选摘要统计总数、涉及组数与相对当前配置的增删', () => {
  const baselineIds = ['id-sales-orders:read', 'id-purchase-orders:read']

  assert.deepEqual(
    summarizeSelection(GROUPS, ['id-sales-orders:read', 'id-purchase-orders:read'], baselineIds),
    { added: 0, groupCount: 2, removed: 0, total: 2 },
  )
  assert.deepEqual(
    summarizeSelection(GROUPS, ['id-purchase-orders:read', 'id-purchase-orders:document'], baselineIds),
    { added: 1, groupCount: 1, removed: 1, total: 2 },
  )
  assert.deepEqual(
    summarizeSelection(GROUPS, [], baselineIds),
    { added: 0, groupCount: 0, removed: 2, total: 0 },
  )
})

test('搜索与范围筛选复用权限目录口径，只看已选不改变分组归属', () => {
  const byKeyword = buildAssignmentGroups(CATALOG, {
    keyword: 'create',
    onlySelected: false,
    scope: 'all',
    selectedIds: [],
  })
  assert.deepEqual(byKeyword.map(group => group.key), ['purchase-orders'])
  assert.deepEqual(
    byKeyword[0]!.permissions.map(item => item.code),
    ['purchase-orders:create', 'purchase-orders:create-stock'],
  )

  const businessOnly = buildAssignmentGroups(CATALOG, {
    keyword: '',
    onlySelected: false,
    scope: 'business',
    selectedIds: [],
  })
  assert.deepEqual(
    businessOnly.flatMap(group => group.permissions.map(item => item.code)),
    [
      'purchase-orders:create',
      'purchase-orders:document',
      'purchase-orders:read',
      'sales-orders:document',
      'sales-orders:read',
    ],
  )

  const selectedOnly = buildAssignmentGroups(CATALOG, {
    keyword: 'orders',
    onlySelected: true,
    scope: 'all',
    selectedIds: ['id-sales-orders:document'],
  })
  assert.deepEqual(selectedOnly.map(group => group.key), ['sales-orders'])
  assert.deepEqual(selectedOnly[0]!.permissions.map(item => item.code), ['sales-orders:document'])

  const byChineseResourceLabel = buildAssignmentGroups(CATALOG, {
    keyword: '采购订单',
    onlySelected: false,
    scope: 'all',
    selectedIds: [],
  })
  assert.deepEqual(byChineseResourceLabel.map(group => group.key), ['purchase-orders'])
})

test('批量并入当前结果只追加缺失项，不删除既有选择', () => {
  const merged = selectPermissions(
    ['id-sales-orders:read', 'id-purchase-orders:read'],
    ['id-sales-orders:read', 'id-purchase-orders:document'],
  )

  assert.deepEqual(merged.sort(), [
    'id-purchase-orders:document',
    'id-purchase-orders:read',
    'id-sales-orders:read',
  ])
})
