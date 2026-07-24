<script setup lang="ts">
import type {
  CreateRoleRequestDto,
  PermissionDto,
  RoleDto,
  UpdateRoleRequestDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import managementApi from '@/api/modules/management'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import {
  filterRoleTableRows,
  hasVisibleTableColumn,
} from '@/views/system/shared/table-query'
import PermissionAssignmentDrawer from './permission-assignment-modal.vue'
import { canAssignRolePermissions, canEditRole } from './presentation'
import RoleEditorModal from './role-editor-modal.vue'

defineOptions({ name: 'SystemRoles' })

const { auth } = useAppAuth()
const roles = ref<RoleDto[]>([])
const permissions = ref<PermissionDto[]>([])
const permissionCatalogReady = ref(false)
const loading = ref(false)
const pageError = ref('')
const tableSearch = ref('')
const tableFilters = ref<QsGenericTableFilterValues>({})

const editorVisible = ref(false)
const editorRole = ref<RoleDto | null>(null)
const editorLoading = ref(false)
const editorError = ref('')

const permissionDrawerVisible = ref(false)
const permissionRole = ref<RoleDto | null>(null)
const permissionLoading = ref(false)
const permissionError = ref('')

const columns: QsGenericTableColumn<RoleDto>[] = [
  { id: 'role', accessorKey: 'name', title: '角色', width: 220 },
  { id: 'description', accessorKey: 'description', title: '说明', minWidth: 240 },
  {
    id: 'permissionCount',
    accessorFn: role => role.permissionIds.length,
    title: '权限数量',
    width: 110,
  },
]
const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'roleType',
    label: '角色类型',
    options: [
      { label: '系统角色', value: 'system' },
      { label: '自定义角色', value: 'custom' },
    ],
  },
]
const tableRows = computed(() =>
  filterRoleTableRows(roles.value, tableSearch.value, tableFilters.value))

function safeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) {
    return fallback
  }
  const candidate = error as {
    body?: { message?: unknown, requestId?: unknown }
    message?: unknown
    requestId?: unknown
  }
  const message = typeof candidate.body?.message === 'string'
    ? candidate.body.message
    : typeof candidate.message === 'string'
      ? candidate.message
      : fallback
  const requestId = typeof candidate.body?.requestId === 'string'
    ? candidate.body.requestId
    : typeof candidate.requestId === 'string'
      ? candidate.requestId
      : undefined
  return requestId === undefined ? message : `${message}（requestId: ${requestId}）`
}

function replaceRole(updated: RoleDto): void {
  const index = roles.value.findIndex(role => role.id === updated.id)
  if (index === -1) {
    roles.value = [...roles.value, updated].sort((left, right) => left.code.localeCompare(right.code))
    return
  }
  roles.value = roles.value.map(role => role.id === updated.id ? updated : role)
}

async function loadData(): Promise<void> {
  if (loading.value) {
    return
  }
  loading.value = true
  pageError.value = ''
  permissionCatalogReady.value = false
  const [roleResult, permissionResult] = await Promise.allSettled([
    managementApi.roles.list(),
    managementApi.permissions.list(),
  ])

  const errors: string[] = []
  if (roleResult.status === 'fulfilled') {
    roles.value = roleResult.value.data
  }
  else {
    errors.push(safeErrorMessage(roleResult.reason, '角色列表加载失败'))
  }
  if (permissionResult.status === 'fulfilled') {
    permissions.value = permissionResult.value.data
    permissionCatalogReady.value = true
  }
  else {
    errors.push(safeErrorMessage(permissionResult.reason, '权限目录加载失败'))
  }
  if (errors.length > 0) {
    pageError.value = errors.join('；')
  }
  loading.value = false
}

function openCreate(): void {
  editorRole.value = null
  editorError.value = ''
  editorVisible.value = true
}

function openEdit(role: RoleDto): void {
  if (!canEditRole(role)) {
    return
  }
  editorRole.value = role
  editorError.value = ''
  editorVisible.value = true
}

async function saveRole(payload:
  | { mode: 'create', data: CreateRoleRequestDto }
  | { mode: 'edit', roleId: string, data: UpdateRoleRequestDto }): Promise<void> {
  if (editorLoading.value) {
    return
  }
  editorLoading.value = true
  editorError.value = ''
  try {
    const response = payload.mode === 'create'
      ? await managementApi.roles.create(payload.data)
      : await managementApi.roles.update(payload.roleId, payload.data)
    replaceRole(response.data)
    editorVisible.value = false
    useFaToast().success(payload.mode === 'create' ? '角色创建成功' : '角色修改成功')
  }
  catch (error) {
    editorError.value = safeErrorMessage(error, '角色保存失败，请稍后重试')
  }
  finally {
    editorLoading.value = false
  }
}

function openPermissions(role: RoleDto): void {
  if (!canAssignRolePermissions(role)) {
    return
  }
  if (!permissionCatalogReady.value) {
    useFaToast().warning('权限目录尚未就绪', {
      description: '请先刷新并确认权限目录加载成功，再为角色分配权限。',
    })
    return
  }
  permissionRole.value = role
  permissionError.value = ''
  permissionDrawerVisible.value = true
}

async function savePermissions(roleId: string, permissionIds: string[]): Promise<void> {
  if (permissionLoading.value) {
    return
  }
  permissionLoading.value = true
  permissionError.value = ''
  let saved = false
  try {
    const response = await managementApi.roles.replacePermissions(roleId, { permissionIds })
    replaceRole(response.data)
    saved = true
  }
  catch (error) {
    permissionError.value = safeErrorMessage(error, '权限保存失败，请稍后重试')
  }
  finally {
    permissionLoading.value = false
  }

  if (saved) {
    // QsGenericDrawer 在 submitting 期间拒绝所有关闭。先让子组件收到提交态结束，
    // 再发起受控关闭，避免抽屉按关闭守卫回写 true 而与页面状态分叉。
    await nextTick()
    permissionDrawerVisible.value = false
    useFaToast().success('角色权限已更新')
  }
}

function hasRoleAction(role: RoleDto): boolean {
  return canEditRole(role) && (
    auth('roles:update') || auth('roles:assign-permissions')
  )
}

onMounted(loadData)
</script>

<template>
  <div>
    <FaPageHeader description="创建普通角色、维护角色信息并分配业务权限。系统角色只读，服务端始终执行最终权限校验。">
      <template #title>
        角色管理
      </template>
      <div class="flex flex-wrap gap-2">
        <FaButton variant="outline" :loading="loading" @click="loadData">
          <FaIcon v-if="!loading" name="i-lucide:refresh-cw" />
          刷新
        </FaButton>
        <FaButton v-if="auth('roles:create')" @click="openCreate">
          <FaIcon name="i-lucide:plus" />
          创建角色
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain>
      <FaAlert
        v-if="pageError"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="角色数据加载失败"
        class="mb-4"
      >
        <template #description>
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <span class="min-w-0 [overflow-wrap:anywhere]">{{ pageError }}</span>
            <FaButton variant="outline" size="sm" @click="loadData">
              重试
            </FaButton>
          </div>
        </template>
      </FaAlert>

      <QsGenericTable
        v-model:search="tableSearch"
        v-model:filters="tableFilters"
        data-testid="role-table"
        row-key="id"
        :columns="columns"
        :data="tableRows"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :action-column="{ width: 180 }"
        :searchable="true"
        :addable="false"
        :show-column-settings="true"
        :show-pagination="false"
        empty-title="暂无角色"
        empty-description="创建角色后可在此维护角色信息与权限。"
        search-placeholder="搜索角色名称、编码或说明"
        table-class="min-w-[860px]"
      >
        <template #cell-role="{ row }">
          <div class="flex flex-wrap gap-2 items-center">
            <strong class="qs-type-body-medium">{{ row.original.name }}</strong>
            <FaTag v-if="row.original.isSystem" variant="secondary" class="qs-type-status-tag">
              系统角色
            </FaTag>
            <code class="qs-type-data-emphasis w-full block">{{ row.original.code }}</code>
          </div>
        </template>
        <template #cell-description="{ row }">
          <span class="qs-type-description">{{ row.original.description || '—' }}</span>
        </template>
        <template #cell-permissionCount="{ row }">
          <span class="qs-type-data">{{ row.original.permissionIds.length }}</span>
        </template>

        <template #actions="{ row: role }">
          <template v-if="hasRoleAction(role)">
            <FaButton
              v-if="auth('roles:update')"
              variant="ghost"
              size="sm"
              :disabled="loading"
              @click="openEdit(role)"
            >
              编辑
            </FaButton>
            <FaButton
              v-if="auth('roles:assign-permissions')"
              variant="ghost"
              size="sm"
              :disabled="loading || !permissionCatalogReady"
              @click="openPermissions(role)"
            >
              分配权限
            </FaButton>
          </template>
          <span v-else class="text-muted-foreground">{{ role.isSystem ? '系统角色只读' : '—' }}</span>
        </template>

        <!-- 通用表格统一控制断点和卡片外壳；页面只描述角色字段，操作区复用 actions 插槽。 -->
        <template #mobile-row="{ columns: visibleColumns, row: role, rowNumber }">
          <div data-testid="role-card" class="gap-4 grid">
            <div class="flex gap-3 items-start justify-between">
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'role')"
                class="flex flex-wrap gap-2 min-w-0 items-center"
              >
                <strong class="qs-type-compact-title">{{ role.name }}</strong>
                <FaTag v-if="role.isSystem" variant="secondary" class="qs-type-status-tag">
                  系统角色
                </FaTag>
              </div>
              <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
            </div>
            <div class="qs-type-body gap-2.5 grid">
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'role')"
                class="gap-2 grid [grid-template-columns:88px_minmax(0,1fr)]"
              >
                <span class="qs-type-compact-label">编码</span>
                <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">{{ role.code }}</code>
              </div>
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'permissionCount')"
                class="gap-2 grid [grid-template-columns:88px_minmax(0,1fr)]"
              >
                <span class="qs-type-compact-label">权限数量</span>
                <span class="qs-type-data">{{ role.permissionIds.length }}</span>
              </div>
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'description')"
                class="gap-2 grid [grid-template-columns:88px_minmax(0,1fr)]"
              >
                <span class="qs-type-compact-label">说明</span>
                <p class="qs-type-body m-0 [overflow-wrap:anywhere]">
                  {{ role.description || '—' }}
                </p>
              </div>
            </div>
          </div>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <RoleEditorModal
      v-model:visible="editorVisible"
      :role="editorRole"
      :loading="editorLoading"
      :error-message="editorError"
      @submit="saveRole"
    />
    <PermissionAssignmentDrawer
      v-model:visible="permissionDrawerVisible"
      :role="permissionRole"
      :permissions="permissions"
      :loading="permissionLoading"
      :error-message="permissionError"
      @submit="savePermissions"
    />
  </div>
</template>
