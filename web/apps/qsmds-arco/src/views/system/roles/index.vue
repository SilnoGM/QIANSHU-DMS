<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'
import type {
  CreateRoleRequestDto,
  PermissionDto,
  RoleDto,
  UpdateRoleRequestDto,
} from '@/api/generated/types.gen'
import managementApi from '@/api/modules/management'
import PermissionAssignmentModal from './permission-assignment-modal.vue'
import { canAssignRolePermissions, canEditRole } from './presentation'
import RoleEditorModal from './role-editor-modal.vue'

defineOptions({ name: 'SystemRoles' })

const { auth } = useAppAuth()
const roles = ref<RoleDto[]>([])
const permissions = ref<PermissionDto[]>([])
const permissionCatalogReady = ref(false)
const loading = ref(false)
const pageError = ref('')

const editorVisible = ref(false)
const editorRole = ref<RoleDto | null>(null)
const editorLoading = ref(false)
const editorError = ref('')

const permissionModalVisible = ref(false)
const permissionRole = ref<RoleDto | null>(null)
const permissionLoading = ref(false)
const permissionError = ref('')

const columns: TableColumn<RoleDto>[] = [
  { id: 'role', accessorKey: 'name', header: '角色', width: 220 },
  { id: 'description', accessorKey: 'description', header: '说明', minWidth: 240 },
  { id: 'permissionCount', accessorKey: 'permissionIds', header: '权限数量', width: 110 },
  { id: 'actions', header: '操作', width: 180, fixed: 'right' },
]

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
  permissionModalVisible.value = true
}

async function savePermissions(roleId: string, permissionIds: string[]): Promise<void> {
  if (permissionLoading.value) {
    return
  }
  permissionLoading.value = true
  permissionError.value = ''
  try {
    const response = await managementApi.roles.replacePermissions(roleId, { permissionIds })
    replaceRole(response.data)
    permissionModalVisible.value = false
    useFaToast().success('角色权限已更新')
  }
  catch (error) {
    permissionError.value = safeErrorMessage(error, '权限保存失败，请稍后重试')
  }
  finally {
    permissionLoading.value = false
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

      <div data-testid="role-table" class="hidden md:block">
        <FaTable
          row-key="id"
          :columns="columns"
          :data="roles"
          :empty-text="loading ? '正在加载角色…' : '暂无角色'"
          table-class="min-w-[860px]"
          :aria-busy="loading"
          :class="loading && 'pointer-events-none opacity-60'"
        >
          <template #cell-role="{ row }">
            <div class="flex flex-wrap gap-2 items-center">
              <strong>{{ row.original.name }}</strong>
              <FaTag v-if="row.original.isSystem" variant="secondary">
                系统角色
              </FaTag>
              <code class="text-xs text-muted-foreground w-full block">{{ row.original.code }}</code>
            </div>
          </template>
          <template #cell-description="{ row }">
            <span class="text-muted-foreground">{{ row.original.description || '—' }}</span>
          </template>
          <template #cell-permissionCount="{ row }">
            {{ row.original.permissionIds.length }}
          </template>
          <template #cell-actions="{ row }">
            <div v-if="hasRoleAction(row.original)" class="flex flex-wrap gap-1">
              <FaButton
                v-if="auth('roles:update')"
                variant="ghost"
                size="sm"
                :disabled="loading"
                @click="openEdit(row.original)"
              >
                编辑
              </FaButton>
              <FaButton
                v-if="auth('roles:assign-permissions')"
                variant="ghost"
                size="sm"
                :disabled="loading || !permissionCatalogReady"
                @click="openPermissions(row.original)"
              >
                分配权限
              </FaButton>
            </div>
            <span v-else class="text-muted-foreground">{{ row.original.isSystem ? '系统角色只读' : '—' }}</span>
          </template>
        </FaTable>
      </div>

      <div class="gap-3 grid md:hidden" :aria-busy="loading">
        <div
          v-if="loading && roles.length === 0"
          class="text-muted-foreground py-12 flex-center gap-2"
          role="status"
        >
          <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
          <span>正在加载角色…</span>
        </div>
        <FaEmpty
          v-if="!loading && roles.length === 0"
          icon="i-lucide:shield-check"
          title="暂无角色"
          description="创建角色后可在此维护角色信息与权限。"
        />
        <FaCard
          v-for="role in roles"
          :key="role.id"
          data-testid="role-card"
          class="py-4 gap-4"
          :class="loading && 'pointer-events-none opacity-60'"
          header-class="px-4"
          content-class="px-4"
          footer-class="flex-wrap gap-2 px-4"
        >
          <template #header>
            <div class="flex flex-wrap gap-2 items-center">
              <strong>{{ role.name }}</strong>
              <FaTag v-if="role.isSystem" variant="secondary">
                系统角色
              </FaTag>
            </div>
          </template>
          <div class="text-sm gap-2.5 grid">
            <div class="gap-2 grid [grid-template-columns:88px_minmax(0,1fr)]">
              <span class="text-muted-foreground">编码</span>
              <code class="[overflow-wrap:anywhere]">{{ role.code }}</code>
            </div>
            <div class="gap-2 grid [grid-template-columns:88px_minmax(0,1fr)]">
              <span class="text-muted-foreground">权限数量</span>
              <strong>{{ role.permissionIds.length }}</strong>
            </div>
            <div class="gap-2 grid [grid-template-columns:88px_minmax(0,1fr)]">
              <span class="text-muted-foreground">说明</span>
              <p class="m-0 [overflow-wrap:anywhere]">
                {{ role.description || '—' }}
              </p>
            </div>
          </div>
          <template v-if="hasRoleAction(role)" #footer>
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
        </FaCard>
      </div>
    </FaPageMain>

    <RoleEditorModal
      v-model:visible="editorVisible"
      :role="editorRole"
      :loading="editorLoading"
      :error-message="editorError"
      @submit="saveRole"
    />
    <PermissionAssignmentModal
      v-model:visible="permissionModalVisible"
      :role="permissionRole"
      :permissions="permissions"
      :loading="permissionLoading"
      :error-message="permissionError"
      @submit="savePermissions"
    />
  </div>
</template>
