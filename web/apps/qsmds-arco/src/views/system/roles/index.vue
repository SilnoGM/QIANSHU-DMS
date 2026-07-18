<script setup lang="ts">
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

const columns = [
  { title: '角色', dataIndex: 'name', slotName: 'role', width: 220 },
  { title: '说明', dataIndex: 'description', slotName: 'description' },
  { title: '权限数量', dataIndex: 'permissionIds', slotName: 'permissionCount', width: 110 },
  { title: '操作', slotName: 'actions', width: 180, fixed: 'right' as const },
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
      <ASpace>
        <AButton :loading="loading" @click="loadData">
          <template #icon>
            <FaIcon name="i-mdi:refresh" />
          </template>
          刷新
        </AButton>
        <AButton v-if="auth('roles:create')" type="primary" @click="openCreate">
          <template #icon>
            <FaIcon name="i-mdi:plus" />
          </template>
          创建角色
        </AButton>
      </ASpace>
    </FaPageHeader>

    <FaPageMain>
      <AAlert v-if="pageError" type="error" class="mb-4">
        {{ pageError }}
        <AButton type="text" size="small" @click="loadData">
          重试
        </AButton>
      </AAlert>

      <div class="desktop-list">
        <ATable
          row-key="id"
          :columns="columns"
          :data="roles"
          :loading="loading"
          :pagination="false"
          :scroll="{ x: 860 }"
        >
          <template #role="{ record }">
            <div class="role-title">
              <strong>{{ record.name }}</strong>
              <ATag v-if="record.isSystem" size="small" color="arcoblue">
                系统角色
              </ATag>
              <code>{{ record.code }}</code>
            </div>
          </template>
          <template #description="{ record }">
            <span class="secondary-text">{{ record.description || '—' }}</span>
          </template>
          <template #permissionCount="{ record }">
            {{ record.permissionIds.length }}
          </template>
          <template #actions="{ record }">
            <ASpace v-if="hasRoleAction(record)" :size="4">
              <AButton v-if="auth('roles:update')" type="text" size="small" @click="openEdit(record)">
                编辑
              </AButton>
              <AButton
                v-if="auth('roles:assign-permissions')"
                type="text"
                size="small"
                :disabled="!permissionCatalogReady"
                @click="openPermissions(record)"
              >
                分配权限
              </AButton>
            </ASpace>
            <span v-else class="secondary-text">{{ record.isSystem ? '系统角色只读' : '—' }}</span>
          </template>
        </ATable>
      </div>

      <div class="mobile-list" :aria-busy="loading">
        <AEmpty v-if="!loading && roles.length === 0" description="暂无角色" />
        <ACard v-for="role in roles" :key="role.id" class="role-card" :bordered="true">
          <template #title>
            <div class="card-title">
              <span>{{ role.name }}</span>
              <ATag v-if="role.isSystem" size="small" color="arcoblue">
                系统角色
              </ATag>
            </div>
          </template>
          <div class="card-fields">
            <div><span>编码</span><code>{{ role.code }}</code></div>
            <div><span>权限数量</span><strong>{{ role.permissionIds.length }}</strong></div>
            <div><span>说明</span><p>{{ role.description || '—' }}</p></div>
          </div>
          <template v-if="hasRoleAction(role)" #actions>
            <AButton v-if="auth('roles:update')" type="text" @click="openEdit(role)">
              编辑
            </AButton>
            <AButton
              v-if="auth('roles:assign-permissions')"
              type="text"
              :disabled="!permissionCatalogReady"
              @click="openPermissions(role)"
            >
              分配权限
            </AButton>
          </template>
        </ACard>
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

<style scoped>
.role-title,
.card-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.role-title code {
  display: block;
  width: 100%;
  color: var(--color-text-3);
}

.secondary-text {
  color: var(--color-text-3);
}

.mobile-list {
  display: none;
}

.card-fields {
  display: grid;
  gap: 10px;
}

.card-fields > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
}

.card-fields span {
  color: var(--color-text-3);
}

.card-fields p {
  margin: 0;
  overflow-wrap: anywhere;
}

@media (width <= 767px) {
  .desktop-list {
    display: none;
  }

  .mobile-list {
    display: grid;
    gap: 12px;
  }
}
</style>
