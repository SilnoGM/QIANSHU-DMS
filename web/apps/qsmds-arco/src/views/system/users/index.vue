<script setup lang="ts">
import type { TableColumnData } from '@arco-design/web-vue'
import type { RoleDto, UserDto } from '@/api/generated/types.gen'

import { useMediaQuery } from '@vueuse/core'

import managementApi from '@/api/modules/management'

import PasswordResetModal from './password-reset-modal.vue'
import RoleAssignmentModal from './role-assignment-modal.vue'
import StatusChangeModal from './status-change-modal.vue'
import UserFormModal from './user-form-modal.vue'
import {
  buildUserListQuery,
  getApiFailure,
  canManageUserRoles as resolveCanManageUserRoles,
} from './users.logic'

defineOptions({ name: 'SystemUsers' })

const { auth } = useAppAuth()
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
const usernameInput = ref('')
const appliedUsername = ref('')
const listErrorMessage = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0

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

const columns: TableColumnData[] = [
  { title: '用户名', dataIndex: 'username', slotName: 'username', width: 180 },
  { title: '显示名称', dataIndex: 'displayName', minWidth: 150 },
  { title: '状态', dataIndex: 'status', slotName: 'status', width: 100 },
  { title: '角色', dataIndex: 'roleIds', slotName: 'roles', minWidth: 200 },
  { title: '改密要求', dataIndex: 'mustChangePassword', slotName: 'mustChangePassword', width: 120 },
  { title: '最近登录', dataIndex: 'lastLoginAt', slotName: 'lastLoginAt', width: 170 },
  { title: '创建时间', dataIndex: 'createdAt', slotName: 'createdAt', width: 170 },
  { title: '操作', slotName: 'actions', fixed: 'right', width: 150 },
]

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
      appliedUsername.value,
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

async function search(): Promise<void> {
  appliedUsername.value = usernameInput.value
  page.value = 1
  await loadUsers()
}

async function resetSearch(): Promise<void> {
  usernameInput.value = ''
  appliedUsername.value = ''
  page.value = 1
  await loadUsers()
}

async function changePage(nextPage: number): Promise<void> {
  page.value = nextPage
  await loadUsers()
}

async function changePageSize(nextPageSize: number): Promise<void> {
  pageSize.value = nextPageSize
  page.value = 1
  await loadUsers()
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

function hasMoreAction(user: UserDto): boolean {
  return canManageUserRoles.value
    || canResetPassword.value
    || (user.status === 'ACTIVE' ? canDisable.value : canEnable.value)
}

function handleMoreAction(action: unknown, user: UserDto): void {
  if (action === 'roles') {
    openRoleAssignment(user)
  }
  else if (action === 'password') {
    openPasswordReset(user)
  }
  else if (action === 'enable' || action === 'disable') {
    openStatusChange(user, action)
  }
}

async function handleFormSuccess(user: UserDto): Promise<void> {
  if (formMode.value === 'create' && user.roleIds.length === 0) {
    createdWithoutRole.value = user
  }
  await loadUsers()
}

async function verifyUnknownCreate(username: string): Promise<void> {
  usernameInput.value = username
  appliedUsername.value = username
  page.value = 1
  await loadUsers()
}

async function handleMutationSuccess(user: UserDto): Promise<void> {
  if (createdWithoutRole.value?.id === user.id && user.roleIds.length > 0) {
    createdWithoutRole.value = null
  }
  await loadUsers()
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
      <AButton v-if="canCreate" type="primary" @click="openCreate">
        <template #icon>
          <FaIcon name="i-lucide:user-plus" />
        </template>
        新建用户
      </AButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <AResult status="403" title="无权查看用户" subtitle="当前身份缺少 users:read 权限。" />
    </FaPageMain>

    <template v-else>
      <FaPageMain>
        <AAlert v-if="createdWithoutRole" type="warning" closable class="mb-4" @close="createdWithoutRole = null">
          用户 <strong class="font-mono">{{ createdWithoutRole.username }}</strong> 已创建，当前无业务权限。
          <template v-if="canManageUserRoles" #action>
            <AButton size="mini" @click="openRoleAssignment(createdWithoutRole)">
              分配角色
            </AButton>
          </template>
        </AAlert>

        <AAlert v-if="rolesErrorMessage" type="warning" closable class="mb-4" @close="rolesErrorMessage = ''">
          角色名称暂时无法加载：{{ rolesErrorMessage }}。列表仍可使用角色 ID 核查。
        </AAlert>

        <div class="user-filter-bar">
          <AInput
            v-model="usernameInput"
            class="user-filter-input"
            allow-clear
            placeholder="精确用户名"
            @press-enter="search"
          >
            <template #prefix>
              <FaIcon name="i-lucide:search" />
            </template>
          </AInput>
          <AButton type="primary" :loading="loading" @click="search">
            查询
          </AButton>
          <AButton :disabled="loading" @click="resetSearch">
            重置
          </AButton>
        </div>

        <AAlert v-if="listErrorMessage" type="error" class="mt-4">
          {{ listErrorMessage }}
          <template #action>
            <ASpace>
              <span v-if="listRequestId" class="text-xs font-mono">requestId: {{ listRequestId }}</span>
              <AButton size="mini" @click="loadUsers">
                重试
              </AButton>
            </ASpace>
          </template>
        </AAlert>
      </FaPageMain>

      <FaPageMain>
        <ATable
          v-if="!isNarrow"
          :columns="columns"
          :data="users"
          :loading="loading"
          :pagination="false"
          row-key="id"
          :scroll="{ x: 1320 }"
        >
          <template #username="{ record }">
            <span class="font-medium font-mono">{{ record.username }}</span>
          </template>
          <template #status="{ record }">
            <ATag :color="record.status === 'ACTIVE' ? 'green' : 'gray'">
              {{ record.status === 'ACTIVE' ? '启用' : '禁用' }}
            </ATag>
          </template>
          <template #roles="{ record }">
            <ASpace v-if="record.roleIds.length > 0" wrap :size="4">
              <ATag v-for="roleId in record.roleIds" :key="roleId" :color="roleById(roleId)?.isSystem ? 'orangered' : undefined">
                {{ roleById(roleId)?.name ?? shortId(roleId) }}
              </ATag>
            </ASpace>
            <ATag v-else color="orange">
              无角色
            </ATag>
          </template>
          <template #mustChangePassword="{ record }">
            <ATag :color="record.mustChangePassword ? 'orange' : 'green'">
              {{ record.mustChangePassword ? '需要改密' : '无需改密' }}
            </ATag>
          </template>
          <template #lastLoginAt="{ record }">
            {{ formatDate(record.lastLoginAt) }}
          </template>
          <template #createdAt="{ record }">
            {{ formatDate(record.createdAt) }}
          </template>
          <template #actions="{ record }">
            <ASpace :size="4">
              <AButton v-if="canUpdate" type="text" size="small" @click="openEdit(record)">
                编辑
              </AButton>
              <ADropdown v-if="hasMoreAction(record)" trigger="click" @select="handleMoreAction($event, record)">
                <AButton type="text" size="small">
                  更多
                  <FaIcon name="i-lucide:chevron-down" class="ml-1" />
                </AButton>
                <template #content>
                  <ADoption v-if="canManageUserRoles" value="roles">
                    分配角色
                  </ADoption>
                  <ADoption v-if="canResetPassword" value="password">
                    设置密码
                  </ADoption>
                  <ADoption v-if="record.status === 'ACTIVE' && canDisable" value="disable">
                    禁用用户
                  </ADoption>
                  <ADoption v-if="record.status === 'DISABLED' && canEnable" value="enable">
                    启用用户
                  </ADoption>
                </template>
              </ADropdown>
            </ASpace>
          </template>
        </ATable>

        <div v-else class="user-card-list" :aria-busy="loading">
          <ASpin v-if="loading" class="py-12" />
          <AEmpty v-else-if="users.length === 0" description="暂无用户" />
          <ACard v-for="user in users" v-else :key="user.id" class="user-card" :bordered="true">
            <template #title>
              <div class="flex gap-2 min-w-0 items-center">
                <span class="font-mono truncate">{{ user.username }}</span>
                <ATag :color="user.status === 'ACTIVE' ? 'green' : 'gray'">
                  {{ user.status === 'ACTIVE' ? '启用' : '禁用' }}
                </ATag>
              </div>
            </template>
            <template #extra>
              <AButton type="text" @click="openMobileActions(user)">
                操作
              </AButton>
            </template>

            <dl class="user-card-fields">
              <div>
                <dt>显示名称</dt>
                <dd>{{ user.displayName }}</dd>
              </div>
              <div>
                <dt>改密要求</dt>
                <dd>{{ user.mustChangePassword ? '下次登录必须改密' : '无需改密' }}</dd>
              </div>
              <div class="user-card-field-wide">
                <dt>角色</dt>
                <dd>
                  <ASpace v-if="user.roleIds.length > 0" wrap :size="4">
                    <ATag v-for="roleId in user.roleIds" :key="roleId">
                      {{ roleById(roleId)?.name ?? shortId(roleId) }}
                    </ATag>
                  </ASpace>
                  <span v-else>无角色</span>
                </dd>
              </div>
              <div>
                <dt>最近登录</dt>
                <dd>{{ formatDate(user.lastLoginAt) }}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{{ formatDate(user.createdAt) }}</dd>
              </div>
            </dl>
          </ACard>
        </div>

        <div v-if="total > 0" class="mt-5 flex justify-end">
          <APagination
            :current="page"
            :page-size="pageSize"
            :total="total"
            :page-size-options="[20, 50, 100]"
            show-total
            show-page-size
            :simple="isNarrow"
            @change="changePage"
            @page-size-change="changePageSize"
          />
        </div>
      </FaPageMain>
    </template>

    <ADrawer
      :visible="mobileActionsVisible"
      placement="bottom"
      :height="360"
      :footer="false"
      unmount-on-close
      @cancel="closeMobileActions"
    >
      <template #title>
        用户操作 · <span class="font-mono">{{ mobileActionTarget?.username }}</span>
      </template>
      <div class="mobile-action-list">
        <AButton v-if="canUpdate" long @click="openEdit(mobileActionTarget!)">
          编辑显示名称
        </AButton>
        <AButton v-if="canManageUserRoles" long @click="openRoleAssignment(mobileActionTarget!)">
          分配角色
        </AButton>
        <AButton v-if="canResetPassword" long @click="openPasswordReset(mobileActionTarget!)">
          设置或重置密码
        </AButton>
        <AButton
          v-if="mobileActionTarget?.status === 'ACTIVE' && canDisable"
          long
          status="danger"
          @click="openStatusChange(mobileActionTarget, 'disable')"
        >
          禁用用户
        </AButton>
        <AButton
          v-if="mobileActionTarget?.status === 'DISABLED' && canEnable"
          long
          status="success"
          @click="openStatusChange(mobileActionTarget, 'enable')"
        >
          启用用户
        </AButton>
      </div>
    </ADrawer>

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
      @success="handleMutationSuccess"
    />
    <StatusChangeModal
      v-model="statusVisible"
      :user="statusTarget"
      :action="statusAction"
      @success="handleMutationSuccess"
    />
  </div>
</template>

<style scoped>
.user-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.user-filter-input {
  width: min(360px, 100%);
}

.user-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 96px;
}

.user-card-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
  margin: 0;
}

.user-card-fields div {
  min-width: 0;
}

.user-card-fields dt {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--color-text-3);
}

.user-card-fields dd {
  margin: 0;
  color: var(--color-text-1);
  overflow-wrap: anywhere;
}

.user-card-field-wide {
  grid-column: 1 / -1;
}

.mobile-action-list {
  display: grid;
  gap: 12px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

@media (width <= 479px) {
  .user-filter-bar > * {
    flex: 1 1 auto;
  }

  .user-filter-input {
    flex-basis: 100%;
  }

  .user-card-fields {
    grid-template-columns: 1fr;
  }

  .user-card-field-wide {
    grid-column: auto;
  }
}
</style>
