import type { PermissionDto, RoleDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const systemViewContracts = [
  {
    files: [
      '../../src/views/system/users/index.vue',
      '../../src/views/system/users/password-reset-modal.vue',
      '../../src/views/system/users/role-assignment-modal.vue',
      '../../src/views/system/users/status-change-modal.vue',
      '../../src/views/system/users/user-form-modal.vue',
    ],
    label: '用户管理',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaCard',
      'FaCheckbox',
      'FaCheckboxGroup',
      'FaDrawer',
      'FaDropdown',
      'FaEmpty',
      'FaForm',
      'FaFormItem',
      'FaInput',
      'FaModal',
      'FaPageHeader',
      'FaPageMain',
      'FaPagination',
      'FaTable',
      'FaTag',
    ],
  },
  {
    files: [
      '../../src/views/system/roles/index.vue',
      '../../src/views/system/roles/permission-assignment-modal.vue',
      '../../src/views/system/roles/role-editor-modal.vue',
    ],
    label: '角色管理',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaCard',
      'FaCheckboxGroup',
      'FaEmpty',
      'FaForm',
      'FaFormItem',
      'FaInput',
      'FaModal',
      'FaPageHeader',
      'FaPageMain',
      'FaTable',
      'FaTag',
      'FaTextarea',
    ],
  },
  {
    files: ['../../src/views/system/permissions/index.vue'],
    label: '权限目录',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaCard',
      'FaEmpty',
      'FaIcon',
      'FaPageHeader',
      'FaPageMain',
      'FaTable',
      'FaTag',
    ],
  },
  {
    files: ['../../src/views/system/audit/index.vue'],
    label: '审计日志',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaCard',
      'FaEmpty',
      'FaIcon',
      'FaPageHeader',
      'FaPageMain',
      'FaPagination',
      'FaTable',
      'FaTag',
    ],
  },
] as const

function readRelativeSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

for (const contract of systemViewContracts) {
  test(`${contract.label}优先使用 Fantastic Admin 内置组件和当前主题 token`, () => {
    const source = contract.files.map(readRelativeSource).join('\n')

    assert.doesNotMatch(
      source,
      /<A[A-Z][A-Za-z0-9]*\b/u,
      `${contract.label}不得继续使用 Arco 业务组件；Fantastic Admin 无法满足时必须先记录例外证据`,
    )
    assert.doesNotMatch(
      source,
      /(?:\.arco-|--color-|--warning-)/u,
      `${contract.label}不得绑定 Arco 内部 class 或 Arco 主题变量`,
    )
    assert.doesNotMatch(
      source,
      /(?:#[\dA-Fa-f]{3,8}\b|rgba?\(\s*[\d.]+|hsla?\(\s*[\d.]+)/u,
      `${contract.label}不得硬编码颜色值`,
    )
    assert.match(
      source,
      /(?:bg|text|border)-(?:background|foreground|card|muted|primary|secondary|accent|destructive|border)|oklch\(var\(--(?:background|foreground|card|muted|primary|secondary|accent|destructive|border)\)\)/u,
      `${contract.label}的自定义展示结构必须复用当前主题语义 token`,
    )

    for (const component of contract.requiredComponents) {
      assert.match(
        source,
        new RegExp(`<${component}\\b`, 'u'),
        `${contract.label}缺少已审定的 ${component} 迁移`,
      )
    }
  })
}

const clearableStringModelContracts = [
  { file: '../../src/views/system/users/index.vue', model: 'usernameInput' },
  { file: '../../src/views/system/users/password-reset-modal.vue', model: 'model.newPassword' },
  { file: '../../src/views/system/users/password-reset-modal.vue', model: 'model.confirmPassword' },
  { file: '../../src/views/system/users/role-assignment-modal.vue', model: 'roleSearch' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.username' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.displayName' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.newPassword' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.confirmPassword' },
  { file: '../../src/views/system/roles/role-editor-modal.vue', model: 'form.code' },
  { file: '../../src/views/system/roles/role-editor-modal.vue', model: 'form.name' },
] as const

for (const contract of clearableStringModelContracts) {
  test(`FaInput 清空 ${contract.model} 后仍保持字符串模型`, () => {
    const source = readRelativeSource(contract.file)
    const escapedModel = contract.model.replaceAll('.', '\\.')

    assert.match(
      source,
      new RegExp(
        `<FaInput\\b(?=[^>]*\\bv-model="${escapedModel}")(?=[^>]*\\bclearable\\b)(?=[^>]*@clear="${escapedModel} = ''")([^>]*>)`,
        'u',
      ),
      `FaInput 的 clear 事件会把 ${contract.model} 设为 undefined；页面必须立即恢复为空字符串`,
    )
  })
}

test('角色分配提交期间锁定 auto-bind 之外的交互控件', () => {
  const source = readRelativeSource('../../src/views/system/users/role-assignment-modal.vue')

  assert.match(
    source,
    /<FaInput[^>]+v-model="roleSearch"[^>]+:disabled="loading"[^>]*>/u,
  )
  assert.match(
    source,
    /<FaCheckboxGroup[^>]+v-model="model\.roleIds"[^>]+:disabled="loading"[^>]*>/u,
  )
})

test('系统管理浏览器测试使用组件无关的可访问性选择器', () => {
  const browserSources = [
    '../browser/auth.browser.test.mjs',
    '../browser/management.browser.test.mjs',
  ].map(readRelativeSource).join('\n')

  assert.doesNotMatch(
    browserSources,
    /\.arco-(?:drawer|modal|select|table)[\w-]*/u,
    '浏览器测试不得绑定 Arco 私有 DOM class，迁移后应使用 role 或稳定业务标识',
  )
})

test('审计分页只通过受控 model 发起查询，切换 pageSize 不叠加 change 监听', () => {
  const source = readRelativeSource('../../src/views/system/audit/index.vue')

  assert.match(source, /const paginationPage = computed\(/u)
  assert.match(source, /const paginationSize = computed\(/u)
  assert.match(source, /currentPage\.value = 1\s+void loadEvents\(1, size\)/u)
  assert.doesNotMatch(
    source,
    /@(?:page|size)-change=/u,
    'FaPagination 的 v-model 与 change 事件不得同时驱动查询，否则 pageSize 变化可能重复请求',
  )
})

test('角色列表为窄屏加载状态提供反馈并禁用操作', () => {
  const source = readRelativeSource('../../src/views/system/roles/index.vue')

  assert.match(
    source,
    /v-if="loading && roles\.length === 0"[\s\S]{0,320}<FaIcon[^>]+name="i-lucide:loader-circle"/u,
  )
  assert.match(source, /:disabled="loading"[^>]*>\s*编辑/u)
  assert.match(source, /:disabled="loading \|\| !permissionCatalogReady"/u)
})

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
