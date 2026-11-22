<script lang="ts" setup>
import type { AdAccountAssigneeDto, AdAccountDto } from '@/api/generated/types.gen'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import { getApiClientFailureMessage } from '@/api/errors'
import adAccountsApi from '@/api/modules/ad-accounts'
import QsAdAccountCard from '@/components/business/QsAdAccountCard/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAdAccountBadgeStore } from '@/store/modules/app/ad-account-badge'

defineOptions({ name: 'QsPurchaseTransportLeopardAdAccounts' })

const { auth } = useAppAuth()
const badgeStore = useAdAccountBadgeStore()

const canManage = computed(() => auth('ad-accounts:manage'))

const rows = ref<AdAccountDto[]>([])
const loading = ref(false)
const error = ref('')
const activeFilter = ref('all')

let controller: AbortController | null = null

const filters = computed<QsStatusSwitchItem[]>(() => [
  { value: 'all', label: '全部', count: rows.value.length },
  { value: 'low', label: '余额预警 <$30', count: rows.value.filter(row => row.lowBalance).length },
  { value: 'exhausted', label: '已耗尽', count: rows.value.filter(row => row.sustainableDays === 0).length },
  { value: 'frozen', label: '冻结', count: rows.value.filter(row => row.freeze === 1).length },
  { value: 'unbound', label: '未绑定', count: rows.value.filter(row => row.assignedUser === null).length },
])

const visibleRows = computed(() => {
  switch (activeFilter.value) {
    case 'low':
      return rows.value.filter(row => row.lowBalance)
    case 'exhausted':
      return rows.value.filter(row => row.sustainableDays === 0)
    case 'frozen':
      return rows.value.filter(row => row.freeze === 1)
    case 'unbound':
      return rows.value.filter(row => row.assignedUser === null)
    default:
      return rows.value
  }
})

async function load(): Promise<void> {
  if (!canManage.value) {
    return
  }

  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''

  try {
    const response = await adAccountsApi.list(request.signal)
    if (!request.signal.aborted) {
      rows.value = response.data.list
      void badgeStore.refreshAll()
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getApiClientFailureMessage(failure, '加载广告账户失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      loading.value = false
    }
  }
}

const syncSubmitting = ref(false)
const syncError = ref('')

async function runSync(): Promise<void> {
  syncSubmitting.value = true
  syncError.value = ''

  const request = new AbortController()

  try {
    const response = await adAccountsApi.sync(request.signal)
    const result = response.data
    await load()
    if (result.status === 'completed' && !result.spendSynced) {
      syncError.value = '账户已同步，但本轮日消耗拉取失败，续航数据可能滞后。'
    }
  }
  catch (failure) {
    syncError.value = getApiClientFailureMessage(failure, '同步失败')
  }
  finally {
    syncSubmitting.value = false
  }
}

const assignOpen = ref(false)
const assignTarget = ref<AdAccountDto | null>(null)
const assignKeyword = ref('')
const assignUsers = ref<AdAccountAssigneeDto[]>([])
const assignSelectedUserId = ref('')
const assignSubmitting = ref(false)
const assignError = ref('')
let assignController: AbortController | null = null

async function loadAssignableUsers(): Promise<void> {
  assignController?.abort()
  const request = new AbortController()
  assignController = request

  try {
    const response = await adAccountsApi.assignableUsers(assignKeyword.value, request.signal)
    if (!request.signal.aborted) {
      assignUsers.value = response.data
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      assignError.value = getApiClientFailureMessage(failure, '加载用户失败')
    }
  }
}

function openAssign(account: AdAccountDto): void {
  assignTarget.value = account
  assignKeyword.value = ''
  assignSelectedUserId.value = account.assignedUser?.id ?? ''
  assignError.value = ''
  assignOpen.value = true
  void loadAssignableUsers()
}

async function submitAssign(): Promise<void> {
  if (assignTarget.value === null || assignSelectedUserId.value === '') {
    return
  }

  assignSubmitting.value = true
  assignError.value = ''
  const request = new AbortController()

  try {
    await adAccountsApi.assign(
      assignTarget.value.id,
      {
        userId: assignSelectedUserId.value,
        replace: assignTarget.value.assignedUser !== null,
      },
      request.signal,
    )
    assignOpen.value = false
    await load()
  }
  catch (failure) {
    assignError.value = getApiClientFailureMessage(failure, '绑定失败')
  }
  finally {
    assignSubmitting.value = false
  }
}

const releaseOpen = ref(false)
const releaseTarget = ref<AdAccountDto | null>(null)
const releaseSubmitting = ref(false)
const releaseError = ref('')

function openRelease(account: AdAccountDto): void {
  releaseTarget.value = account
  releaseError.value = ''
  releaseOpen.value = true
}

async function submitRelease(): Promise<void> {
  if (releaseTarget.value === null) {
    return
  }

  releaseSubmitting.value = true
  releaseError.value = ''
  const request = new AbortController()

  try {
    await adAccountsApi.release(releaseTarget.value.id, request.signal)
    releaseOpen.value = false
    await load()
  }
  catch (failure) {
    releaseError.value = getApiClientFailureMessage(failure, '解绑失败')
  }
  finally {
    releaseSubmitting.value = false
  }
}

onMounted(load)
onUnmounted(() => {
  controller?.abort()
  assignController?.abort()
})
</script>

<template>
  <FaPageHeader
    title="猎豹广告户管理"
    description="维护广告账户与运营人员的绑定关系；可用余额低于 $30 计入余额预警。"
  >
    <FaButton v-if="canManage" :loading="syncSubmitting" @click="runSync">
      立即同步
    </FaButton>
  </FaPageHeader>

  <FaPageMain>
    <FaEmpty
      v-if="!canManage"
      icon="i-lucide:shield-alert"
      title="无权限访问猎豹广告户管理"
      description="请联系管理员分配 ad-accounts:manage 权限。"
      class="py-12"
    />

    <template v-else>
      <FaAlert v-if="syncError" variant="destructive" class="mb-4">
        {{ syncError }}
      </FaAlert>

      <QsStatusSwitchToolbar
        v-model="activeFilter"
        :items="filters"
        aria-label="广告账户筛选"
        class="mb-4"
      />

      <div v-if="error" class="text-sm text-destructive mb-4 px-4 py-3 border border-destructive/35 rounded-md bg-destructive/10 flex gap-3 items-center">
        <span class="flex-1">{{ error }}</span>
        <FaButton size="sm" variant="outline" @click="load">
          重试
        </FaButton>
      </div>

      <div v-if="loading" class="space-y-3">
        <div v-for="index in 3" :key="index" class="border rounded-lg bg-muted/40 h-40 motion-safe:animate-pulse" />
      </div>

      <FaEmpty
        v-else-if="rows.length === 0"
        icon="i-lucide:megaphone-off"
        title="还没有同步到广告账户"
        description="点击右上角「立即同步」从猎豹拉取账户，或等待定时任务。"
        class="py-12"
      />

      <FaEmpty
        v-else-if="visibleRows.length === 0"
        icon="i-lucide:filter-x"
        title="当前筛选条件下没有广告账户"
        description="切换上方筛选项查看其他账户。"
        class="py-12"
      />

      <div v-else class="space-y-3">
        <QsAdAccountCard
          v-for="row in visibleRows"
          :key="row.id"
          :account="row"
          mode="management"
          @assign="openAssign(row)"
          @release="openRelease(row)"
        />
      </div>
    </template>
  </FaPageMain>

  <QsGenericModal
    v-model="assignOpen"
    title="绑定广告账户"
    description="选择要接收该账户的启用用户。"
    size="md"
    error-title="绑定失败"
    :error="assignError || null"
    :submitting="assignSubmitting"
  >
    <div class="flex flex-col gap-4">
      <div class="text-sm flex flex-wrap gap-2 items-center">
        <span class="text-muted-foreground">账户</span>
        <span class="text-foreground font-mono">{{ assignTarget?.accountName }}</span>
        <template v-if="assignTarget?.assignedUser">
          <span class="text-muted-foreground">当前绑定</span>
          <QsPersonDisplay
            :display-name="assignTarget.assignedUser.displayName"
            size="sm"
          />
          <span class="text-muted-foreground">确认后执行改绑</span>
        </template>
      </div>

      <div class="flex gap-2">
        <FaInput
          v-model="assignKeyword"
          type="search"
          clearable
          class="flex-1 min-w-0"
          placeholder="搜索姓名或账号，回车查询"
          aria-label="搜索用户"
          @keyup.enter="loadAssignableUsers"
        />
        <FaButton variant="outline" @click="loadAssignableUsers">
          查询
        </FaButton>
      </div>

      <div class="max-h-72 overflow-y-auto space-y-1">
        <button
          v-for="user in assignUsers"
          :key="user.id"
          type="button"
          class="text-sm px-2 py-2 text-left rounded-md flex gap-2 w-full items-center hover:bg-muted"
          @click="assignSelectedUserId = user.id"
        >
          <QsPersonDisplay :display-name="user.displayName" size="sm" />
          <FaIcon
            v-if="user.id === assignSelectedUserId"
            name="i-lucide:check"
            class="text-primary ml-auto size-4"
            aria-hidden="true"
          />
        </button>
        <div v-if="assignUsers.length === 0" class="text-sm text-muted-foreground py-6 text-center">
          没有匹配的用户
        </div>
      </div>
    </div>

    <template #footer>
      <FaButton variant="outline" :disabled="assignSubmitting" @click="assignOpen = false">
        取消
      </FaButton>
      <FaButton
        :loading="assignSubmitting"
        :disabled="assignSelectedUserId === ''"
        @click="submitAssign"
      >
        {{ assignTarget?.assignedUser ? '确认改绑' : '确认绑定' }}
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    v-model="releaseOpen"
    title="解除绑定"
    description="解除后该账户将不再出现在对方的运营工作台。"
    size="sm"
    error-title="解绑失败"
    :error="releaseError || null"
    :submitting="releaseSubmitting"
  >
    <div class="text-sm text-muted-foreground">
      确认解除「{{ releaseTarget?.accountName }}」与
      {{ releaseTarget?.assignedUser?.displayName ?? '当前用户' }} 的绑定？
    </div>

    <template #footer>
      <FaButton variant="outline" :disabled="releaseSubmitting" @click="releaseOpen = false">
        取消
      </FaButton>
      <FaButton variant="destructive" :loading="releaseSubmitting" @click="submitRelease">
        确认解绑
      </FaButton>
    </template>
  </QsGenericModal>
</template>
