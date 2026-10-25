import type { PermissionDto, RoleDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner 验证，无需浏览器环境。
import test from 'node:test'

import {
  auditMetadataEntries,
  auditOutcomeTagPresentation,
  formatAuditActorDisplayName,
  formatAuditEvent,
  formatAuditOutcome,
} from '../../src/views/system/audit/presentation'
import {
  groupPermissions,
  permissionResourceLabel,
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
      'FaCheckbox',
      'FaCheckboxGroup',
      'FaDrawer',
      'FaDropdown',
      'FaEmpty',
      'FaForm',
      'FaFormItem',
      'FaInput',
      'FaPageHeader',
      'FaPageMain',
      'FaTag',
      'FaTextarea',
      'QsGenericModal',
      'QsGenericTable',
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
      'FaCheckboxGroup',
      'FaEmpty',
      'FaForm',
      'FaFormItem',
      'FaInput',
      'FaPageHeader',
      'FaPageMain',
      'FaTag',
      'FaTextarea',
      'QsGenericDrawer',
      'QsGenericModal',
      'QsGenericTable',
    ],
  },
  {
    files: ['../../src/views/system/permissions/index.vue'],
    label: '权限目录',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaEmpty',
      'FaIcon',
      'FaPageHeader',
      'FaPageMain',
      'FaTag',
      'QsGenericTable',
    ],
  },
  {
    files: ['../../src/views/system/audit/index.vue'],
    label: '审计日志',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaEmpty',
      'FaIcon',
      'FaPageHeader',
      'FaPageMain',
      'FaTag',
      'QsGenericTable',
    ],
  },
  {
    files: [
      '../../src/views/system/basic-data/regions/index.vue',
      '../../src/views/system/basic-data/regions/region-scope-tree.vue',
    ],
    label: '地区管理',
    requiredComponents: [
      'FaAlert',
      'FaButton',
      'FaEmpty',
      'FaIcon',
      'FaPageHeader',
      'FaPageMain',
      'FaTag',
      'FaTree',
      'QsGenericDrawer',
      'QsGenericTable',
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

test('角色权限分配使用业务通用抽屉并由抽屉统一管理滚动与提交状态', () => {
  const roleSource = readRelativeSource('../../src/views/system/roles/index.vue')
  const assignmentSource = readRelativeSource(
    '../../src/views/system/roles/permission-assignment-modal.vue',
  )
  const drawerTag = assignmentSource.match(/<QsGenericDrawer\b[\s\S]*?>/u)?.[0]

  assert.match(
    assignmentSource,
    /import QsGenericDrawer from '@\/components\/business\/QsGenericDrawer\/index\.vue'/u,
  )
  assert.match(assignmentSource, /defineOptions\(\{ name: 'PermissionAssignmentDrawer' \}\)/u)
  assert.ok(drawerTag)
  assert.match(drawerTag, /\bplacement="right"/u)
  assert.match(drawerTag, /\bsize="xl"/u)
  assert.match(drawerTag, /:submitting="loading"/u)
  assert.doesNotMatch(
    drawerTag,
    /:loading=/u,
    '权限保存是提交态，不得误触发通用抽屉的内容加载骨架',
  )
  assert.match(assignmentSource, /<template #header-leading>/u)
  assert.match(assignmentSource, /<template #footer>/u)
  assert.doesNotMatch(assignmentSource, /<FaModal\b/u)
  assert.doesNotMatch(
    assignmentSource,
    /max-h-\[[^\]]+\][^"]*overflow-y-auto/u,
    '抽屉内容区应由 QsGenericDrawer 统一滚动，避免权限列表出现嵌套滚动条',
  )
  assert.match(roleSource, /import PermissionAssignmentDrawer from '\.\/permission-assignment-modal\.vue'/u)
  assert.match(roleSource, /<PermissionAssignmentDrawer\b/u)
  assert.doesNotMatch(roleSource, /\bpermissionModalVisible\b/u)
})

test('五个系统管理页面统一使用 QsGenericTable 内置搜索、筛选和列设置', () => {
  for (const contract of systemViewContracts) {
    const entrySource = readRelativeSource(contract.files[0])
    const tableTags = entrySource.match(/<QsGenericTable\b[\s\S]*?>/gu) ?? []

    assert.match(
      entrySource,
      /import QsGenericTable from '@\/components\/business\/QsGenericTable\/index\.vue'/u,
      `${contract.label}必须显式导入 QsGenericTable`,
    )
    assert.match(entrySource, /<QsGenericTable\b/u)
    assert.doesNotMatch(entrySource, /<FaTable\b/u)
    assert.doesNotMatch(entrySource, /<FaPagination\b/u)
    assert.doesNotMatch(entrySource, /<FaCard\b/u)
    assert.doesNotMatch(
      entrySource,
      /import type \{ TableColumn \} from '@fantastic-admin\/components'/u,
      `${contract.label}列定义必须切换到 QsGenericTableColumn`,
    )
    assert.match(
      entrySource,
      /import type \{[\s\S]{0,240}?\bQsGenericTableColumn\b[\s\S]{0,240}?\} from '@\/components\/business\/QsGenericTable\/logic'/u,
      `${contract.label}必须使用通用表格的列契约`,
    )
    assert.ok(tableTags.length > 0, `${contract.label}缺少 QsGenericTable`)
    for (const tableTag of tableTags) {
      assert.match(tableTag, /v-model:search="[^"]+"/u)
      assert.match(tableTag, /v-model:filters="[^"]+"/u)
      assert.match(tableTag, /:filter-definitions="[^"]+"/u)
      assert.match(tableTag, /:addable="false"/u)
      assert.doesNotMatch(tableTag, /:searchable="false"/u)
      assert.doesNotMatch(tableTag, /:show-column-settings="false"/u)
    }
    assert.match(entrySource, /<template #mobile-row="\{[^"]*\bcolumns\b[^"]*\}">/u)
    assert.match(entrySource, /class="qs-type-meta[^"]*tabular-nums"[^>]*>#\{\{ rowNumber \}\}/u)
  }
})

test('用户管理只保留 QsGenericTable 内置查询工具栏', () => {
  const source = readRelativeSource('../../src/views/system/users/index.vue')

  assert.doesNotMatch(source, /const usernameInput = ref/u)
  assert.doesNotMatch(source, /async function resetSearch/u)
  assert.doesNotMatch(source, /<FaInput\b/u)
  assert.doesNotMatch(source, /@click="resetSearch"/u)
  assert.match(source, /search-placeholder="输入完整用户名搜索"/u)
})

test('用户管理将分配角色直接展示在桌面操作列', () => {
  const source = readRelativeSource('../../src/views/system/users/index.vue')
  const moreActionItemsSource = source.match(
    /function moreActionItems\(user: UserDto\): UserActionMenuItem\[\]\[\] \{[\s\S]*?\n\}/u,
  )?.[0]

  assert.ok(moreActionItemsSource)
  assert.doesNotMatch(moreActionItemsSource, /分配角色/u)
  assert.match(source, /:action-column="\{ minWidth: 176, width: 176 \}"/u)
  assert.match(
    source,
    /<FaButton\s+v-if="userActions\(user\)\.canAssignRoles"[\s\S]*?@click="openRoleAssignment\(user\)"[\s\S]*?>\s*授权\s*<\/FaButton>/u,
  )
})

test('权限目录合并为一个带资源列的通用表格', () => {
  const source = readRelativeSource('../../src/views/system/permissions/index.vue')

  assert.equal(source.match(/<QsGenericTable\b/gu)?.length, 1)
  assert.doesNotMatch(source, /v-for="group in groups"/u)
  assert.doesNotMatch(source, /data-testid="permission-section"/u)
  assert.match(source, /:data="paginatedPermissionRows"/u)
  assert.match(source, /id:\s*'resource'/u)
  assert.match(source, /<template #cell-resource=/u)
})

test('权限目录以中文展示现有业务资源', () => {
  const catalogSource = readRelativeSource(
    '../../src/views/system/permissions/catalog.ts',
  )
  const resourceKeys = [...catalogSource.matchAll(/^ {2}'([^']+)':/gmu)]
    .map(match => match[1])

  // 资源目录采用精确集合，避免已经退役的领域继续以孤立中文标签残留在权限 UI。
  // 2026-10-01 决策：权限分配抽屉的分组标题必须全部可读，因此补齐了后建领域的标签。
  assert.deepEqual(resourceKeys, [
    'audit',
    'container-batches',
    'currencies',
    'data-scope',
    'dictionaries',
    'exchange-rates',
    'fund-accounts',
    'fund-business-sources',
    'fund-posting-types',
    'fund-transactions',
    'fund-withdrawals',
    'invoice-requests',
    'numbering-rules',
    'packaging-costs',
    'product-media',
    'products',
    'purchase-orders',
    'purchase-shipping-marks',
    'regions',
    'roles',
    'sales-orders',
    'sales-receipts',
    'slh-bills',
    'supplier-payment-profiles',
    'users',
    'workbench',
  ])
  assert.equal(permissionResourceLabel('container-batches'), '柜次管理')
  assert.equal(permissionResourceLabel('currencies'), '货币管理')
  assert.equal(permissionResourceLabel('data-scope'), '数据范围')
  assert.equal(permissionResourceLabel('exchange-rates'), '当前汇率')
  assert.equal(permissionResourceLabel('fund-accounts'), '资金账户管理')
  assert.equal(permissionResourceLabel('fund-business-sources'), '资金业务来源')
  assert.equal(permissionResourceLabel('fund-posting-types'), '资金业务类型')
  assert.equal(permissionResourceLabel('fund-transactions'), '资金批次')
  assert.equal(permissionResourceLabel('fund-withdrawals'), '提款')
  assert.equal(permissionResourceLabel('packaging-costs'), '打木架费用')
  assert.equal(permissionResourceLabel('regions'), '地区管理')
  assert.equal(permissionResourceLabel('numbering-rules'), '编号规则')
  assert.equal(permissionResourceLabel('purchase-orders'), '采购订单')
  assert.equal(permissionResourceLabel('purchase-shipping-marks'), '唛头规则绑定')
  assert.equal(permissionResourceLabel('dictionaries'), '字典管理')
  assert.equal(permissionResourceLabel('product-media'), '产品媒体')
  assert.equal(permissionResourceLabel('products'), '产品管理')
  assert.equal(permissionResourceLabel('sales-orders'), '销售订单')
  assert.equal(permissionResourceLabel('sales-receipts'), '销售收款')
  assert.equal(permissionResourceLabel('slh-bills'), '顺联航账单')
  assert.equal(permissionResourceLabel('supplier-payment-profiles'), '供应商收款配置')
  assert.equal(permissionResourceLabel('workbench'), '工作台准入')
})

test('系统管理页面按现有业务能力配置通用表格操作列与分页', () => {
  const userSource = readRelativeSource('../../src/views/system/users/index.vue')
  const roleSource = readRelativeSource('../../src/views/system/roles/index.vue')
  const permissionSource = readRelativeSource('../../src/views/system/permissions/index.vue')
  const auditSource = readRelativeSource('../../src/views/system/audit/index.vue')

  assert.match(userSource, /<template #actions="\{ row: user \}">/u)
  assert.match(userSource, /v-model:page="paginationPage"/u)
  assert.match(userSource, /v-model:page-size="paginationSize"/u)
  assert.match(userSource, /:page-size-options="\[20, 50, 100\]"/u)
  assert.doesNotMatch(userSource, /@pagination-change=/u)

  assert.match(roleSource, /<template #actions="\{ row: role \}">/u)
  assert.match(roleSource, /:show-pagination="false"/u)
  assert.doesNotMatch(roleSource, /id:\s*'actions'/u)

  assert.match(permissionSource, /const paginationPage = ref\(1\)/u)
  assert.match(permissionSource, /const paginationSize = ref\(20\)/u)
  assert.match(
    permissionSource,
    /const paginatedPermissionRows = computed\(\(\) => \{[\s\S]*?filteredPermissionRows\.value\.slice\(start, start \+ paginationSize\.value\)/u,
  )
  assert.match(permissionSource, /v-model:page="paginationPage"/u)
  assert.match(permissionSource, /v-model:page-size="paginationSize"/u)
  assert.match(permissionSource, /:data="paginatedPermissionRows"/u)
  assert.match(permissionSource, /:total="filteredPermissionRows\.length"/u)
  assert.match(permissionSource, /:page-size-options="\[20, 50, 100, 200\]"/u)
  assert.doesNotMatch(permissionSource, /:show-pagination="false"/u)
  assert.doesNotMatch(permissionSource, /<template #actions=/u)

  assert.match(auditSource, /v-model:page="currentPage"/u)
  assert.match(auditSource, /v-model:page-size="pageSize"/u)
  assert.match(auditSource, /@pagination-change="handlePaginationChange"/u)
  assert.match(auditSource, /:page-size-options="\[20, 50, 100\]"/u)
})

const clearableStringModelContracts = [
  { file: '../../src/views/system/users/password-reset-modal.vue', model: 'model.newPassword' },
  { file: '../../src/views/system/users/password-reset-modal.vue', model: 'model.confirmPassword' },
  { file: '../../src/views/system/users/role-assignment-modal.vue', model: 'roleSearch' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.username' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.displayName' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.email' },
  { file: '../../src/views/system/users/user-form-modal.vue', model: 'model.issuerPrefix' },
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

test('管理端手机号清空后恢复 E.164 字符串模型', () => {
  const source = readRelativeSource(
    '../../src/views/system/users/user-form-modal.vue',
  )

  assert.match(source, /@clear="clearMobile"/u)
  assert.match(source, /model\.mobileE164 = ''/u)
  assert.match(source, /:model-value="mobileNational"/u)
  assert.match(source, /:auto-bind="false"/u)
})

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

test('用户表单只在 edit 模式展示 Profile 字段，并保持一次原子 PATCH', () => {
  const source = readRelativeSource(
    '../../src/views/system/users/user-form-modal.vue',
  )

  assert.match(
    source,
    /<template v-if="mode === 'edit'">[\s\S]*?model\.email[\s\S]*?:model-value="mobileNational"[\s\S]*?v-model="model\.avatarUrl"[\s\S]*?model\.remark[\s\S]*?<\/template>/u,
  )
  assert.match(source, /props\.user\.profile\.email/u)
  assert.doesNotMatch(source, /props\.user\.profile\s*\?\?/u)
  assert.match(source, /buildAdminUserProfilePatch/u)
  assert.match(source, /getProfileConflictField/u)
  assert.match(source, /managementApi\.users\.update\(/u)
  assert.doesNotMatch(source, /profileApi\.(?:get|update)\(/u)
  assert.match(
    source,
    /Object\.keys\(updatePatch\)\.length === 0/u,
    '无差异时必须在发起管理 PATCH 前返回',
  )
})

test('用户表单按权限展示可选资金账户，勾选后才要求分成比例', () => {
  const formSource = readRelativeSource(
    '../../src/views/system/users/user-form-modal.vue',
  )
  const listSource = readRelativeSource('../../src/views/system/users/index.vue')

  assert.match(
    formSource,
    /<FaCheckbox[\s\S]*?v-model="model\.createFundAccount"[\s\S]*?:disabled="!canCreateFundAccount"/u,
  )
  assert.match(formSource, /需要「新增资金账户」权限（fund-accounts:create）/u)
  assert.match(
    formSource,
    /v-if="model\.createFundAccount"[\s\S]*?v-model="model\.userShareRate"/u,
  )
  assert.match(formSource, /validateFundAccountFields/u)
  assert.match(formSource, /buildCreateUserFundAccountInput/u)
  assert.match(formSource, /createsFundAccount[\s\S]*?fundAccount:/u)
  assert.match(listSource, /auth\('fund-accounts:create'\)/u)
  assert.match(listSource, /:can-create-fund-account="canCreateFundAccount"/u)
})

test('管理员编辑本人后刷新 AuthContext 与 Profile，移动端使用完整资料名称', () => {
  const source = readRelativeSource('../../src/views/system/users/index.vue')

  assert.match(source, /refreshAfterUserUpdate/u)
  assert.match(source, /revalidateCurrentAuth:\s*\(\) => appAccountStore\.revalidateAfterMutation\(\)/u)
  assert.match(source, /refreshCurrentProfile:\s*\(\) => appAccountStore\.refreshProfileAfterMutation\(\)/u)
  assert.match(source, />\s*编辑用户资料\s*</u)
  assert.doesNotMatch(source, />\s*编辑显示名称\s*</u)
})

test('管理员资料表单使用 QsGenericModal lg 响应式布局和 FaTextarea 备注', () => {
  const source = readRelativeSource(
    '../../src/views/system/users/user-form-modal.vue',
  )

  assert.match(
    source,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(source, /<QsGenericModal[\s\S]+?size="lg"/u)
  assert.match(source, /:submitting="loading"/u)
  assert.match(source, /grid-cols-1/u)
  assert.match(source, /md:grid-cols-2/u)
  assert.match(source, /<FaTextarea[^>]+v-model="model\.remark"/u)
  assert.doesNotMatch(source, /overflow-x-(?:auto|scroll)/u)
  assert.doesNotMatch(source, /<FaModal\b/u)
})

test('自由文本输入不使用会拆分 Emoji 的原生 maxlength，角色说明按字素簇显示计数', () => {
  const userFormSource = readRelativeSource(
    '../../src/views/system/users/user-form-modal.vue',
  )
  const roleFormSource = readRelativeSource(
    '../../src/views/system/roles/role-editor-modal.vue',
  )

  function findControl(source: string, tag: string, model: string): string {
    const escapedModel = model.replaceAll('.', '\\.')
    const match = source.match(
      new RegExp(`<${tag}[^>]+v-model="${escapedModel}"[^>]*>`, 'u'),
    )
    assert.ok(match, `未找到 ${tag} 的 ${model} 绑定`)
    return match[0]
  }

  for (const model of ['model.username', 'model.displayName']) {
    assert.doesNotMatch(
      findControl(userFormSource, 'FaInput', model),
      /maxlength/u,
    )
  }

  assert.doesNotMatch(
    findControl(roleFormSource, 'FaInput', 'form.name'),
    /maxlength/u,
  )
  assert.doesNotMatch(
    findControl(roleFormSource, 'FaTextarea', 'form.description'),
    /maxlength/u,
  )
  assert.match(
    roleFormSource,
    /:description="`\$\{countGraphemes\(form\.description\)\} \/ 2000`"/u,
  )
  assert.match(
    findControl(roleFormSource, 'FaInput', 'form.code'),
    /maxlength="128"/u,
    '角色编码只允许 ASCII，继续使用原生 maxlength 与 Server 契约一致',
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
  for (const tableTestId of ['user-table', 'role-table', 'permission-table', 'audit-table']) {
    assert.match(
      browserSources,
      new RegExp(`\\[data-testid="${tableTestId}"\\] table`, 'u'),
      `${tableTestId} 的窄屏断言必须检查通用组件内的原生表格，而不是始终可见的组件根节点`,
    )
  }
})

test('审计分页只通过 QsGenericTable 的单一 paginationChange 事件发起查询', () => {
  const source = readRelativeSource('../../src/views/system/audit/index.vue')

  assert.match(
    source,
    /function handlePaginationChange\(pagination: \{ page: number, pageSize: number \}\)[\s\S]*?void loadEvents\(pagination\.page, pagination\.pageSize\)/u,
  )
  assert.doesNotMatch(source, /const pagination(?:Page|Size) = computed\(/u)
  assert.doesNotMatch(
    source,
    /@(?:page|size)-change=|@update:(?:page|page-size)=/u,
    '分页只能由 QsGenericTable 的 paginationChange 驱动查询，避免页码与页容量分别重复请求',
  )
})

test('角色列表把加载状态交给通用表格并继续禁用业务操作', () => {
  const source = readRelativeSource('../../src/views/system/roles/index.vue')

  assert.match(
    source,
    /<QsGenericTable(?=[\s\S]{0,500}?:loading="loading")/u,
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
  assert.equal(formatAuditEvent('REGION_CREATED'), '地区已创建')
  assert.equal(formatAuditEvent('REGION_UPDATED'), '地区已更新')
  assert.equal(formatAuditEvent('REGION_ENABLED'), '地区已启用')
  assert.equal(formatAuditEvent('REGION_DISABLED'), '地区已停用')
  assert.equal(formatAuditEvent('CURRENCY_CREATED'), '货币已创建')
  assert.equal(formatAuditEvent('CURRENCY_UPDATED'), '货币已更新')
  assert.equal(formatAuditEvent('CURRENCY_ENABLED'), '货币已启用')
  assert.equal(formatAuditEvent('CURRENCY_DISABLED'), '货币已停用')
  assert.equal(formatAuditEvent('EXCHANGE_RATE_CREATED'), '汇率已创建')
  assert.equal(formatAuditEvent('EXCHANGE_RATE_UPDATED'), '汇率已更新')
  assert.equal(formatAuditEvent('DOMAIN_EVENT'), 'DOMAIN_EVENT')
  assert.equal(formatAuditOutcome('SUCCESS'), '成功')
  assert.equal(formatAuditOutcome('FAILURE'), '失败')
})

test('审计操作者展示名保留真实名称并区分异常用户', () => {
  assert.equal(formatAuditActorDisplayName('USER', '系统管理员'), '系统管理员')
  assert.equal(formatAuditActorDisplayName('USER', null), '未知用户')
  assert.equal(formatAuditActorDisplayName('SYSTEM', null), '—')
  assert.equal(formatAuditActorDisplayName('ANONYMOUS', null), '—')
})

test('审计成功标签使用绿色成功语义，失败仍使用 destructive', () => {
  const success = auditOutcomeTagPresentation('SUCCESS')
  assert.equal(success.variant, 'outline')
  assert.equal(
    success.class,
    'border-green-600/30 bg-green-600/10 text-green-700 dark:border-green-400/30 dark:bg-green-400/10 dark:text-green-400',
  )
  assert.deepEqual(auditOutcomeTagPresentation('FAILURE'), {
    variant: 'destructive',
  })
})

test('用户管理桌面数据与移动卡片显式区分普通值、标识、日期和状态', () => {
  const source = readRelativeSource('../../src/views/system/users/index.vue')

  assert.match(
    source,
    /<template #cell-username[\s\S]*?<span class="qs-type-data-emphasis">/u,
  )
  assert.equal(
    source.match(/<template #cell-(?:last-login|created-at)[\s\S]*?<span class="qs-type-data">/gu)?.length,
    2,
  )
  assert.match(
    source,
    /<span class="qs-type-data-emphasis truncate">\{\{ user\.username \}\}<\/span>/u,
  )
  assert.equal(
    source.match(/<dt class="qs-type-compact-label mb-1">/gu)?.length,
    5,
  )
  assert.equal(
    source.match(/<dd class="qs-type-body m-0 \[overflow-wrap:anywhere\]">/gu)?.length,
    3,
  )
  assert.equal(
    source.match(/<dd class="qs-type-data m-0 \[overflow-wrap:anywhere\]">/gu)?.length,
    2,
  )
  assert.match(
    source,
    /<FaTag[\s\S]{0,260}?class="qs-type-status-tag"[\s\S]{0,260}?\{\{ user\.status/u,
  )
  assert.match(
    source,
    /<FaButton[^>]*@click="openMobileActions\(user\)"[^>]*>\s*操作\s*<\/FaButton>/u,
  )
  assert.doesNotMatch(source, /<dt class="text-xs text-muted-foreground/u)
})

test('角色管理移动卡片使用 compact、data 与 body 角色且保留既有操作入口', () => {
  const source = readRelativeSource('../../src/views/system/roles/index.vue')

  assert.match(
    source,
    /<template #cell-role[\s\S]*?<strong class="qs-type-body-medium">/u,
  )
  assert.match(
    source,
    /<code class="qs-type-data-emphasis w-full block">\{\{ row\.original\.code \}\}<\/code>/u,
  )
  assert.match(
    source,
    /<template #cell-permissionCount[\s\S]*?<span class="qs-type-data">/u,
  )
  assert.match(
    source,
    /<template #mobile-row="\{ columns: visibleColumns, row: role, rowNumber \}">[\s\S]{0,500}?<strong class="qs-type-compact-title">\{\{ role\.name \}\}<\/strong>/u,
  )
  assert.equal(
    source.match(/<span class="qs-type-compact-label">/gu)?.length,
    3,
  )
  assert.match(
    source,
    /<code class="qs-type-data-emphasis \[overflow-wrap:anywhere\]">\{\{ role\.code \}\}<\/code>/u,
  )
  assert.match(
    source,
    /<span class="qs-type-data">\{\{ role\.permissionIds\.length \}\}<\/span>/u,
  )
  assert.match(
    source,
    /<p class="qs-type-body m-0 \[overflow-wrap:anywhere\]">/u,
  )
  assert.match(source, /<FaTag[^>]*class="qs-type-status-tag"/u)
  assert.match(
    source,
    /<FaButton[^>]*@click="openEdit\(role\)"[^>]*>\s*编辑\s*<\/FaButton>/u,
  )
  assert.doesNotMatch(source, /<div class="text-sm gap-2\.5 grid">/u)
})

test('权限目录单表使用资源、标识、说明和状态排版角色', () => {
  const source = readRelativeSource('../../src/views/system/permissions/index.vue')

  assert.match(
    source,
    /<template #cell-resource[\s\S]*?<span class="qs-type-body-medium">[\s\S]*?<code class="qs-type-meta">/u,
  )
  assert.match(
    source,
    /<template #cell-code[\s\S]*?<code class="qs-type-data-emphasis">/u,
  )
  assert.match(
    source,
    /<strong\s[^>]*class="qs-type-compact-title min-w-0 break-words"[^>]*>[\s\S]{0,80}?\{\{ permission\.name \}\}[\s\S]{0,40}?<\/strong>/u,
  )
  assert.match(
    source,
    /<code\s[^>]*class="qs-type-data-emphasis break-all"[^>]*>[\s\S]{0,80}?\{\{ permission\.code \}\}[\s\S]{0,40}?<\/code>/u,
  )
  assert.match(
    source,
    /<p\s[^>]*class="qs-type-description m-0"[^>]*>/u,
  )
  assert.match(
    source,
    /<FaTag[^>]*:variant="permission\.systemOnly \? 'secondary' : 'outline'"[^>]*class="qs-type-status-tag"/u,
  )
  assert.doesNotMatch(
    source,
    /<(?:h2|code|p|strong) class="[^"]*(?:text-(?:xs|sm|base)|font-semibold)[^"]*"/u,
  )
})

test('审计日志桌面与移动卡片区分时间、标识、普通重点值和状态', () => {
  const source = readRelativeSource('../../src/views/system/audit/index.vue')

  assert.match(
    source,
    /<template #cell-occurredAt[\s\S]*?<span class="qs-type-data">/u,
  )
  assert.match(
    source,
    /<template #cell-eventType[\s\S]*?<strong class="qs-type-body-medium">[\s\S]*?<code class="qs-type-data-emphasis">/u,
  )
  assert.match(
    source,
    /<template #cell-actorDisplayName[\s\S]*?<QsPersonDisplay/u,
  )
  assert.equal(
    source.match(/<template #cell-(?:target|requestId)[\s\S]*?<code class="qs-type-data-emphasis break-all">/gu)?.length,
    2,
  )
  assert.doesNotMatch(source, /actorUserId/u)
  assert.match(
    source,
    /<strong class="qs-type-compact-title block break-words">/u,
  )
  assert.match(
    source,
    /<code class="qs-type-data-emphasis break-all">\{\{ event\.eventType \}\}<\/code>/u,
  )
  assert.equal(
    source.match(/<dt class="qs-type-compact-label">/gu)?.length,
    5,
  )
  assert.match(
    source,
    /<dd class="qs-type-data m-0">[\s\S]*?formatAuditTime/u,
  )
  assert.match(
    source,
    /<dd class="qs-type-body-medium m-0">[\s\S]*?<QsPersonDisplay/u,
  )
  assert.equal(
    source.match(/<dd class="qs-type-data-emphasis m-0">/gu)?.length,
    2,
  )
  assert.match(
    source,
    /<FaTag v-bind="auditOutcomeTagPresentation\(event\.outcome\)" class="qs-type-status-tag">/u,
  )
  assert.doesNotMatch(source, /<dl class="text-sm m-0 gap-3 grid">/u)
})
