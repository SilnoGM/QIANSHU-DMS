<script setup lang="ts">
import type { RoleDto, UserDto } from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import { useMediaQuery } from '@vueuse/core'

import managementApi from '@/api/modules/management'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'

import { hasVisibleTableColumn } from '../shared/table-query'
import PasswordResetModal from './password-reset-modal.vue'
import RoleAssignmentModal from './role-assignment-modal.vue'
import StatusChangeModal from './status-change-modal.vue'
import UserFormModal from './user-form-modal.vue'
import {
  buildUserListQuery,
  getApiFailure,
  refreshAfterRoleAssignment,
  refreshAfterUserUpdate,
  canManageUserRoles as resolveCanManageUserRoles,
  resolveUserAdminActions,
} from './users.logic'

defineOptions({ name: 'SystemUsers' })

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const isNarrow = useMediaQuery('(max-width: 767px)')

const canRead = computed(() => auth('users:read'))
const canCreate = computed(() => auth('users:create'))
const canUpdate = computed(() => auth('users:update'))
const canEnable = computed(() => auth('users:enable'))
const canDisable = computed(() => auth('users:disable'))
const canAssignRoles = computed(() => auth('users:assign-roles'))
const canResetPassword = computed(() => auth('users:reset-password'))
const canReadRoles = computed(() => auth('roles:read'))
const canManageUserRoles = computed(() =>
  resolveCanManageUserRoles(canAssignRoles.value, canReadRoles.value))

const loading = ref(false)
const users = ref<UserDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchKeyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const listErrorMessage = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let queryRefreshPending = false

const roles = ref<RoleDto[]>([])
const rolesLoading = ref(false)
const rolesErrorMessage = ref('')

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formTarget = ref<UserDto | null>(null)
const passwordVisible = ref(false)
const passwordTarget = ref<UserDto | null>(null)
const rolesVisible = ref(false)
const rolesTarget = ref<UserDto | null>(null)
const statusVisible = ref(false)
const statusTarget = ref<UserDto | null>(null)
const statusAction = ref<'enable' | 'disable'>('disable')
const mobileActionsVisible = ref(false)
const mobileActionTarget = ref<UserDto | null>(null)
const createdWithoutRole = ref<UserDto | null>(null)

const columns: QsGenericTableColumn<UserDto>[] = [
  { accessorKey: 'username', id: 'username', title: '用户名', width: 180 },
  { accessorKey: 'displayName', id: 'displayName', minWidth: 150, title: '显示名称' },
  { accessorKey: 'status', id: 'status', title: '状态', width: 100 },
  { accessorKey: 'roleIds', id: 'roles', minWidth: 200, title: '角色' },
  {
    accessorKey: 'mustChangePassword',
    id: 'password-requirement',
    title: '改密要求',
    width: 120,
  },
  {
    accessorKey: 'lastLoginAt',
    id: 'last-login',
    title: '最近登录',
    width: 170,
  },
  {
    accessorKey: 'createdAt',
    id: 'created-at',
    title: '创建时间',
    width: 170,
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'status',
    label: '用户状态',
    options: [
      { label: '启用', value: 'ACTIVE' },
      { label: '禁用', value: 'DISABLED' },
    ],
  },
]

/**
 * 用户页沿用 computed setter 作为分页请求入口；setter 与搜索/筛选事件共用同一个
 * 微任务合并器，因此 pageSize + page 的连续更新也只会产生一次查询。
 */
const paginationPage = computed({
  get: () => page.value,
  set: (nextPage: number) => {
    if (nextPage === page.value) {
      return
    }
    page.value = nextPage
    scheduleListRefresh(false)
  },
})
const paginationSize = computed({
  get: () => pageSize.value,
  set: (nextPageSize: number) => {
    if (nextPageSize === pageSize.value) {
      return
    }
    pageSize.value = nextPageSize
    page.value = 1
    scheduleListRefresh(false)
  },
})
const mobileDrawerTitle = computed(() => mobileActionTarget.value === null
  ? '用户操作'
  : `用户操作 · ${mobileActionTarget.value.username}`)

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatDate(value: string | null): string {
  if (value === null) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date)
}

function roleById(roleId: string): RoleDto | undefined {
  return roles.value.find(role => role.id === roleId)
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value
}

async function loadRoles(): Promise<void> {
  if (!canReadRoles.value || rolesLoading.value) {
    return
  }
  rolesLoading.value = true
  rolesErrorMessage.value = ''
  try {
    const response = await managementApi.roles.list()
    roles.value = response.data
  }
  catch (error) {
    rolesErrorMessage.value = getApiFailure(error).message
  }
  finally {
    rolesLoading.value = false
  }
}

async function loadUsers(): Promise<void> {
  if (!canRead.value) {
    return
  }
  const requestVersion = ++listRequestVersion
  loading.value = true
  listErrorMessage.value = ''
  listRequestId.value = undefined
  try {
    const response = await managementApi.users.list(buildUserListQuery(
      page.value,
      pageSize.value,
      searchKeyword.value,
      filters.value.status,
    ))
    if (requestVersion !== listRequestVersion) {
      return
    }
    users.value = response.data.items
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (requestVersion !== listRequestVersion) {
      return
    }
    const failure = getApiFailure(error)
    listErrorMessage.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === listRequestVersion) {
      loading.value = false
    }
  }
}

/**
 * QsGenericTable 的“清除查询条件”会在同一轮交互连续发出 search 和
 * filterChange。分页 setter 也复用该合并器，确保搜索、筛选、分页及同时清空
 * 都只请求一次。
 */
function scheduleListRefresh(resetPage: boolean): void {
  if (resetPage) {
    page.value = 1
  }
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    void loadUsers()
  })
}

function scheduleQueryRefresh(): void {
  scheduleListRefresh(true)
}

function openCreate(): void {
  formMode.value = 'create'
  formTarget.value = null
  formVisible.value = true
}

function openEdit(user: UserDto): void {
  closeMobileActions()
  formMode.value = 'edit'
  formTarget.value = user
  formVisible.value = true
}

function openPasswordReset(user: UserDto): void {
  if (!userActions(user).canResetPassword) {
    return
  }
  closeMobileActions()
  passwordTarget.value = user
  passwordVisible.value = true
}

function openRoleAssignment(user: UserDto): void {
  if (!canManageUserRoles.value) {
    return
  }
  closeMobileActions()
  rolesTarget.value = user
  rolesVisible.value = true
  void loadRoles()
}

function openStatusChange(user: UserDto, action: 'enable' | 'disable'): void {
  const actions = userActions(user)
  if (
    (action === 'enable' && !actions.canEnable)
    || (action === 'disable' && !actions.canDisable)
  ) {
    return
  }
  closeMobileActions()
  statusTarget.value = user
  statusAction.value = action
  statusVisible.value = true
}

function openMobileActions(user: UserDto): void {
  mobileActionTarget.value = user
  mobileActionsVisible.value = true
}

function closeMobileActions(): void {
  mobileActionsVisible.value = false
}

function userActions(user: UserDto) {
  return resolveUserAdminActions({
    canAssignRoles: canManageUserRoles.value,
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canResetPassword: canResetPassword.value,
    currentUserId: appAccountStore.userId,
    status: user.status,
    userId: user.id,
  })
}

function hasMoreAction(user: UserDto): boolean {
  return userActions(user).hasMoreAction
}

/** 移动端统一操作入口还需覆盖已从“更多”提升为直接操作的角色分配。 */
function hasAvailableAction(user: UserDto): boolean {
  const actions = userActions(user)
  return canUpdate.value || actions.canAssignRoles || actions.hasMoreAction
}

interface UserActionMenuItem {
  label: string
  handle: () => void
  variant?: 'default' | 'destructive'
}

function moreActionItems(user: UserDto): UserActionMenuItem[][] {
  const actions = userActions(user)
  const items: UserActionMenuItem[] = []
  if (actions.canResetPassword) {
    items.push({ label: '设置密码', handle: () => openPasswordReset(user) })
  }
  if (actions.canDisable) {
    items.push({
      label: '禁用用户',
      variant: 'destructive',
      handle: () => openStatusChange(user, 'disable'),
    })
  }
  if (actions.canEnable) {
    items.push({ label: '启用用户', handle: () => openStatusChange(user, 'enable') })
  }
  return [items]
}

async function handleFormSuccess(user: UserDto): Promise<void> {
  if (formMode.value === 'create' && user.roleIds.length === 0) {
    createdWithoutRole.value = user
  }
  await refreshAfterUserUpdate({
    currentUserId: appAccountStore.userId,
    refreshCurrentProfile: () => appAccountStore.refreshProfileAfterMutation(),
    reloadUsers: loadUsers,
    revalidateCurrentAuth: () => appAccountStore.revalidateAfterMutation(),
    userId: user.id,
  })
}

async function verifyUnknownCreate(username: string): Promise<void> {
  searchKeyword.value = username
  filters.value = {}
  page.value = 1
  await loadUsers()
}

async function handleMutationSuccess(): Promise<void> {
  await loadUsers()
}

async function handleRoleAssignmentSuccess(user: UserDto): Promise<void> {
  if (createdWithoutRole.value?.id === user.id && user.roleIds.length > 0) {
    createdWithoutRole.value = null
  }
  await refreshAfterRoleAssignment({
    currentUserId: appAccountStore.userId,
    reloadUsers: loadUsers,
    revalidateCurrentAuth: () => appAccountStore.revalidateAfterMutation(),
    userId: user.id,
  })
}

onMounted(() => {
  if (canRead.value) {
    void Promise.all([loadUsers(), loadRoles()])
  }
})
</script>

<template>
  <div>
    <FaPageHeader title="用户管理" description="查询用户并管理基础信息、状态、角色和登录密码。">
      <FaButton v-if="canCreate" @click="openCreate">
        <FaIcon name="i-lucide:user-plus" />
        新建用户
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权查看用户"
        description="当前身份缺少 users:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <template v-else>
      <FaPageMain v-if="createdWithoutRole || rolesErrorMessage || listErrorMessage">
        <FaAlert
          v-if="createdWithoutRole"
          icon="i-lucide:triangle-alert"
          class="mb-4 border-primary/30 bg-primary/5"
        >
          <template #description>
            <div class="flex flex-wrap gap-3 items-center justify-between">
              <span>
                用户 <strong class="qs-type-data-emphasis">{{ createdWithoutRole.username }}</strong> 已创建，当前无业务权限。
              </span>
              <div class="flex gap-2 items-center">
                <FaButton
                  v-if="canManageUserRoles"
                  variant="outline"
                  size="sm"
                  @click="openRoleAssignment(createdWithoutRole)"
                >
                  分配角色
                </FaButton>
                <FaButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label="关闭无角色提示"
                  @click="createdWithoutRole = null"
                >
                  <FaIcon name="i-lucide:x" />
                </FaButton>
              </div>
            </div>
          </template>
        </FaAlert>

        <FaAlert
          v-if="rolesErrorMessage"
          icon="i-lucide:triangle-alert"
          class="mb-4 border-primary/30 bg-primary/5"
        >
          <template #description>
            <div class="flex gap-3 items-center justify-between">
              <span>角色名称暂时无法加载：{{ rolesErrorMessage }}。列表仍可使用角色 ID 核查。</span>
              <FaButton
                variant="ghost"
                size="icon-sm"
                class="shrink-0"
                aria-label="关闭角色目录错误提示"
                @click="rolesErrorMessage = ''"
              >
                <FaIcon name="i-lucide:x" />
              </FaButton>
            </div>
          </template>
        </FaAlert>

        <FaAlert
          v-if="listErrorMessage"
          variant="destructive"
          icon="i-lucide:circle-alert"
        >
          <template #description>
            <div class="flex flex-wrap gap-3 items-center justify-between">
              <span>{{ listErrorMessage }}</span>
              <div class="flex gap-2 items-center">
                <span v-if="listRequestId" class="qs-type-meta font-mono">requestId: {{ listRequestId }}</span>
                <FaButton variant="outline" size="sm" @click="loadUsers">
                  重试
                </FaButton>
              </div>
            </div>
          </template>
        </FaAlert>
      </FaPageMain>

      <FaPageMain>
        <QsGenericTable
          v-model:page="paginationPage"
          v-model:page-size="paginationSize"
          v-model:search="searchKeyword"
          v-model:filters="filters"
          data-testid="user-table"
          row-key="id"
          :action-column="{ width: 230 }"
          :addable="false"
          :columns="columns"
          :data="users"
          :filter-definitions="filterDefinitions"
          :loading="loading"
          :page-size-options="[20, 50, 100]"
          :total="total"
          empty-title="暂无用户"
          empty-description="当前没有可展示的用户。"
          search-placeholder="输入完整用户名搜索"
          table-class="min-w-[1320px]"
          @filter-change="scheduleQueryRefresh"
          @search="scheduleQueryRefresh"
        >
          <template #cell-username="{ row }">
            <span class="qs-type-data-emphasis">{{ row.original.username }}</span>
          </template>
          <template #cell-status="{ row }">
            <FaTag
              variant="outline"
              class="qs-type-status-tag"
              :class="row.original.status === 'ACTIVE'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground'"
            >
              {{ row.original.status === 'ACTIVE' ? '启用' : '禁用' }}
            </FaTag>
          </template>
          <template #cell-roles="{ row }">
            <div v-if="row.original.roleIds.length > 0" class="flex flex-wrap gap-1">
              <FaTag
                v-for="roleId in row.original.roleIds"
                :key="roleId"
                variant="outline"
                :class="roleById(roleId)?.isSystem
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-border bg-muted/50 text-foreground'"
              >
                {{ roleById(roleId)?.name ?? shortId(roleId) }}
              </FaTag>
            </div>
            <FaTag v-else variant="outline" class="text-destructive border-destructive/30 bg-destructive/5">
              无角色
            </FaTag>
          </template>
          <template #cell-password-requirement="{ row }">
            <FaTag
              variant="outline"
              class="qs-type-status-tag"
              :class="row.original.mustChangePassword
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-border bg-muted text-muted-foreground'"
            >
              {{ row.original.mustChangePassword ? '需要改密' : '无需改密' }}
            </FaTag>
          </template>
          <template #cell-last-login="{ row }">
            <span class="qs-type-data">{{ formatDate(row.original.lastLoginAt) }}</span>
          </template>
          <template #cell-created-at="{ row }">
            <span class="qs-type-data">{{ formatDate(row.original.createdAt) }}</span>
          </template>

          <!-- 移动卡片显式声明字段语义，防止桌面表格的结构化数据角色在窄屏回退为普通正文。 -->
          <template #mobile-row="{ columns: visibleColumns, row: user, rowNumber }">
            <div data-testid="user-card" class="user-card gap-4 grid">
              <div class="flex gap-3 items-start justify-between">
                <div class="flex gap-2 min-w-0 items-center">
                  <template v-if="hasVisibleTableColumn(visibleColumns, 'username')">
                    <span class="qs-type-data-emphasis truncate">{{ user.username }}</span>
                  </template>
                  <FaTag
                    v-if="hasVisibleTableColumn(visibleColumns, 'status')"
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="user.status === 'ACTIVE'
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-muted text-muted-foreground'"
                  >
                    {{ user.status === 'ACTIVE' ? '启用' : '禁用' }}
                  </FaTag>
                </div>
                <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
              </div>

              <dl class="m-0 gap-x-4 gap-y-3.5 grid grid-cols-2 max-[479px]:grid-cols-1">
                <div v-if="hasVisibleTableColumn(visibleColumns, 'displayName')">
                  <dt class="qs-type-compact-label mb-1">
                    显示名称
                  </dt>
                  <dd class="qs-type-body m-0 [overflow-wrap:anywhere]">
                    {{ user.displayName }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'password-requirement')">
                  <dt class="qs-type-compact-label mb-1">
                    改密要求
                  </dt>
                  <dd class="qs-type-body m-0 [overflow-wrap:anywhere]">
                    {{ user.mustChangePassword ? '下次登录必须改密' : '无需改密' }}
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'roles')"
                  class="col-span-full max-[479px]:col-span-1"
                >
                  <dt class="qs-type-compact-label mb-1">
                    角色
                  </dt>
                  <dd class="qs-type-body m-0 [overflow-wrap:anywhere]">
                    <div v-if="user.roleIds.length > 0" class="flex flex-wrap gap-1">
                      <FaTag v-for="roleId in user.roleIds" :key="roleId" variant="outline">
                        {{ roleById(roleId)?.name ?? shortId(roleId) }}
                      </FaTag>
                    </div>
                    <span v-else>无角色</span>
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'last-login')">
                  <dt class="qs-type-compact-label mb-1">
                    最近登录
                  </dt>
                  <dd class="qs-type-data m-0 [overflow-wrap:anywhere]">
                    {{ formatDate(user.lastLoginAt) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'created-at')">
                  <dt class="qs-type-compact-label mb-1">
                    创建时间
                  </dt>
                  <dd class="qs-type-data m-0 [overflow-wrap:anywhere]">
                    {{ formatDate(user.createdAt) }}
                  </dd>
                </div>
              </dl>
            </div>
          </template>

          <template #actions="{ row: user }">
            <FaButton
              v-if="isNarrow && hasAvailableAction(user)"
              class="w-full"
              variant="outline"
              size="sm"
              @click="openMobileActions(user)"
            >
              操作
            </FaButton>
            <div v-else-if="!isNarrow" class="flex gap-1 items-center">
              <FaButton v-if="canUpdate" variant="ghost" size="sm" @click="openEdit(user)">
                编辑
              </FaButton>
              <FaButton
                v-if="userActions(user).canAssignRoles"
                variant="ghost"
                size="sm"
                @click="openRoleAssignment(user)"
              >
                分配角色
              </FaButton>
              <FaDropdown v-if="hasMoreAction(user)" :items="moreActionItems(user)" align="end">
                <FaButton variant="ghost" size="sm">
                  更多
                  <FaIcon name="i-lucide:chevron-down" />
                </FaButton>
              </FaDropdown>
            </div>
            <span v-else class="qs-type-meta">无可用操作</span>
          </template>
        </QsGenericTable>
      </FaPageMain>
    </template>

    <FaDrawer
      v-model="mobileActionsVisible"
      :title="mobileDrawerTitle"
      side="bottom"
      :footer="false"
      content-class="h-[min(22.5rem,calc(100dvh-1.5rem))]"
      destroy-on-close
    >
      <div data-testid="user-actions-drawer" class="pb-[max(0.75rem,env(safe-area-inset-bottom))] gap-3 grid">
        <FaButton v-if="canUpdate" class="w-full" variant="outline" @click="openEdit(mobileActionTarget!)">
          编辑用户资料
        </FaButton>
        <FaButton
          v-if="mobileActionTarget && userActions(mobileActionTarget).canAssignRoles"
          class="w-full"
          variant="outline"
          @click="openRoleAssignment(mobileActionTarget)"
        >
          分配角色
        </FaButton>
        <FaButton
          v-if="mobileActionTarget && userActions(mobileActionTarget).canResetPassword"
          class="w-full"
          variant="outline"
          @click="openPasswordReset(mobileActionTarget)"
        >
          设置或重置密码
        </FaButton>
        <FaButton
          v-if="mobileActionTarget && userActions(mobileActionTarget).canDisable"
          class="w-full"
          variant="destructive"
          @click="openStatusChange(mobileActionTarget, 'disable')"
        >
          禁用用户
        </FaButton>
        <FaButton
          v-if="mobileActionTarget && userActions(mobileActionTarget).canEnable"
          class="w-full"
          @click="openStatusChange(mobileActionTarget, 'enable')"
        >
          启用用户
        </FaButton>
      </div>
    </FaDrawer>

    <UserFormModal
      v-model="formVisible"
      :mode="formMode"
      :user="formTarget"
      @success="handleFormSuccess"
      @unknown-result="verifyUnknownCreate"
    />
    <PasswordResetModal
      v-model="passwordVisible"
      :user="passwordTarget"
      @success="handleMutationSuccess"
    />
    <RoleAssignmentModal
      v-model="rolesVisible"
      :user="rolesTarget"
      :roles="roles"
      :roles-loading="rolesLoading"
      :roles-error-message="rolesErrorMessage"
      @success="handleRoleAssignmentSuccess"
    />
    <StatusChangeModal
      v-model="statusVisible"
      :user="statusTarget"
      :action="statusAction"
      @success="handleMutationSuccess"
    />
  </div>
</template>
