<script setup lang="ts">
import type {
  AssignableUserDto,
  ProxyNodeDto,
  SyncProxyNodesResultDto,
} from '@/api/generated/types.gen'
import type { ProxyNodeStatusFilter } from '@/components/business/QsProxyNodeCard/logic'
import { getApiClientFailureMessage } from '@/api/errors'
import proxyNodesApi from '@/api/modules/proxy-nodes'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsProxyNodeCard from '@/components/business/QsProxyNodeCard/index.vue'
import {
  countProxyNodes,
  filterProxyNodes,
} from '@/components/business/QsProxyNodeCard/logic'
import { PROXY_NODE_NOW_KEY } from '@/components/business/QsProxyNodeCard/now'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useNowTicker } from '@/composables/app/use-now-ticker'
import { recordServerClockSample, serverNowEpochMs } from '@/utils/server-clock'

defineOptions({ name: 'QsPurchaseTransportProxyNodes' })

const { auth } = useAppAuth()
const toast = useQsToast()
const canManage = computed(() => auth('proxy-nodes:manage'))
const { nowMs } = useNowTicker()
provide(PROXY_NODE_NOW_KEY, nowMs)

const rows = ref<ProxyNodeDto[]>([])
const lastSyncedAt = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const syncing = ref(false)
const syncError = ref('')
const syncWarnings = ref<string[]>([])
const statusFilter = ref<ProxyNodeStatusFilter>('ALL')
const keyword = ref('')

let controller: AbortController | null = null
let syncController: AbortController | null = null

const counts = computed(() => countProxyNodes(rows.value, nowMs.value))
const visibleRows = computed(() => filterProxyNodes(
  rows.value,
  statusFilter.value,
  keyword.value,
  nowMs.value,
))

const summaryItems = computed(() => [
  { label: '节点总数', value: counts.value.total },
  { label: '已绑定', value: counts.value.assigned },
  { label: '未绑定', value: counts.value.unassigned },
  { label: '7 天内到期', value: counts.value.expiring, tone: 'text-amber-700 dark:text-amber-400' },
  { label: '已过期', value: counts.value.expired, tone: 'text-destructive' },
])

const statusItems = computed(() => [
  { value: 'ACTIVE', label: '正常', count: counts.value.active },
  { value: 'EXPIRING', label: '7 天内到期', count: counts.value.expiring },
  { value: 'EXPIRED', label: '已过期', count: counts.value.expired },
  { value: 'UNASSIGNED', label: '未绑定', count: counts.value.unassigned },
  { value: 'ALL', label: '全部', count: counts.value.total },
])

const assignOpen = ref(false)
const assignTarget = ref<ProxyNodeDto | null>(null)
const assignKeyword = ref('')
const assignUsers = ref<AssignableUserDto[]>([])
const assignSelectedUserId = ref('')
const assignUsersLoading = ref(false)
const assignSubmitting = ref(false)
const assignError = ref('')
let assignUsersController: AbortController | null = null

const releaseOpen = ref(false)
const releaseTarget = ref<ProxyNodeDto | null>(null)
const releaseSubmitting = ref(false)
const releaseError = ref('')

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
    const response = await proxyNodesApi.list(request.signal)
    if (!request.signal.aborted) {
      rows.value = response.data.items
      lastSyncedAt.value = response.data.lastSyncedAt
      recordServerClockSample(response.data.serverNow)
      nowMs.value = serverNowEpochMs()
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getApiClientFailureMessage(failure, '静态节点加载失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      loading.value = false
    }
  }
}

async function sync(): Promise<void> {
  if (syncing.value) {
    return
  }

  syncController?.abort()
  const request = new AbortController()
  syncController = request
  syncing.value = true
  syncError.value = ''
  syncWarnings.value = []

  try {
    const response = await proxyNodesApi.sync(request.signal)
    if (!request.signal.aborted) {
      const result: SyncProxyNodesResultDto = response.data
      syncWarnings.value = result.warnings
      toast.success(`同步完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`)
      await load()
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      syncError.value = getApiClientFailureMessage(failure, '同步 IPFoxy 失败')
      toast.error(syncError.value)
    }
  }
  finally {
    if (!request.signal.aborted) {
      syncing.value = false
    }
  }
}

function openAssign(node: ProxyNodeDto): void {
  assignTarget.value = node
  assignOpen.value = true
  assignKeyword.value = ''
  assignSelectedUserId.value = ''
  assignError.value = ''
  void loadAssignableUsers()
}

async function loadAssignableUsers(): Promise<void> {
  assignUsersController?.abort()
  const request = new AbortController()
  assignUsersController = request
  assignUsersLoading.value = true
  assignError.value = ''

  try {
    const response = await proxyNodesApi.assignableUsers(
      assignKeyword.value,
      request.signal,
    )
    if (!request.signal.aborted) {
      assignUsers.value = response.data
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      assignError.value = getApiClientFailureMessage(failure, '用户列表加载失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      assignUsersLoading.value = false
    }
  }
}

async function submitAssign(): Promise<void> {
  const target = assignTarget.value
  if (target === null || assignSelectedUserId.value === '') {
    assignError.value = '请选择要绑定的用户'
    return
  }

  assignSubmitting.value = true
  assignError.value = ''

  try {
    await proxyNodesApi.assign(
      target.id,
      {
        userId: assignSelectedUserId.value,
        replace: target.assignedUser !== null,
      },
      new AbortController().signal,
    )
    toast.success(target.assignedUser === null ? '已绑定' : '已改绑')
    // 先释放 submitting，再关闭；QsGenericModal 在提交期会拒绝受控关闭。
    assignSubmitting.value = false
    assignOpen.value = false
    await load()
  }
  catch (failure) {
    assignError.value = getApiClientFailureMessage(failure, '绑定失败')
    // 节点可能已被其他管理员改绑；刷新让卡片和当前状态保持一致。
    void load()
  }
  finally {
    assignSubmitting.value = false
  }
}

function openRelease(node: ProxyNodeDto): void {
  releaseTarget.value = node
  releaseOpen.value = true
  releaseError.value = ''
}

async function submitRelease(): Promise<void> {
  const target = releaseTarget.value
  if (target === null) {
    return
  }

  releaseSubmitting.value = true
  releaseError.value = ''

  try {
    await proxyNodesApi.release(target.id, new AbortController().signal)
    toast.success('已解绑')
    // 先释放 submitting，再关闭；QsGenericModal 在提交期会拒绝受控关闭。
    releaseSubmitting.value = false
    releaseOpen.value = false
    await load()
  }
  catch (failure) {
    releaseError.value = getApiClientFailureMessage(failure, '解绑失败')
    void load()
  }
  finally {
    releaseSubmitting.value = false
  }
}

onMounted(load)
onUnmounted(() => {
  controller?.abort()
  syncController?.abort()
  assignUsersController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader title="IPFoxy静态节点" description="">
      <template #description>
        <span v-if="lastSyncedAt">
          最后同步 <DateTimeDisplay :value="lastSyncedAt" format="datetime" />
        </span>
        <span v-else>尚未同步，点击右上角从 IPFoxy 拉取已购静态节点。</span>
      </template>
      <FaButton :loading="syncing" :disabled="!canManage" @click="sync">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        同步 IPFoxy
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <FaEmpty
        v-if="!canManage"
        icon="i-lucide:shield-alert"
        title="无权限管理静态节点"
        description="请联系管理员分配 proxy-nodes:manage 权限。"
        class="py-12"
      />

      <template v-else>
        <FaAlert
          v-if="syncError"
          variant="destructive"
          title="同步 IPFoxy 失败"
          :description="syncError"
          class="mb-4"
        />
        <FaAlert
          v-if="syncWarnings.length"
          title="同步完成，但存在提示"
          :description="syncWarnings.join('；')"
          class="mb-4"
        />
        <FaAlert
          v-if="counts.expiring > 0"
          :title="`${counts.expiring} 个节点将在 7 天内到期`"
          description="请在 IPFoxy 控制台续费后重新同步，避免倒计时与供应商实际有效期不一致。"
          class="mb-4"
        />

        <div class="mb-4 gap-3 grid sm:grid-cols-2 xl:grid-cols-5">
          <div
            v-for="item in summaryItems"
            :key="item.label"
            class="p-3 border border-border rounded-lg bg-card flex flex-col gap-1"
          >
            <span class="qs-type-meta text-muted-foreground">{{ item.label }}</span>
            <span class="text-lg qs-type-data-emphasis" :class="item.tone">{{ item.value }}</span>
          </div>
        </div>

        <QsStatusSwitchToolbar
          :model-value="statusFilter"
          :items="statusItems"
          aria-label="节点状态"
          class="mb-4"
          @update:model-value="statusFilter = String($event) as ProxyNodeStatusFilter"
        />

        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span class="qs-type-meta text-muted-foreground">
            显示 {{ visibleRows.length }} / 共 {{ rows.length }}
          </span>
          <FaInput
            v-model="keyword"
            type="search"
            clearable
            class="w-full sm:w-80"
            placeholder="搜索 IP、账号或绑定人"
            aria-label="搜索 IP、账号或绑定人"
          >
            <template #start>
              <FaIcon name="i-lucide:search" />
            </template>
          </FaInput>
        </div>

        <div v-if="error" class="py-12 flex flex-col gap-4 items-center">
          <FaEmpty
            icon="i-lucide:circle-alert"
            title="静态节点加载失败"
            :description="error"
          />
          <FaButton variant="outline" @click="load">
            重试
          </FaButton>
        </div>

        <div v-else-if="loading" class="gap-4 grid xl:grid-cols-2" aria-busy="true">
          <div
            v-for="index in 4"
            :key="index"
            aria-hidden="true"
            class="border border-border rounded-xl bg-card h-48 motion-safe:animate-pulse"
          />
        </div>

        <FaEmpty
          v-else-if="!rows.length"
          icon="i-lucide:server"
          title="尚未同步静态节点"
          description="点击右上角「同步 IPFoxy」拉取已购代理。"
          class="py-12"
        />

        <FaEmpty
          v-else-if="!visibleRows.length"
          icon="i-lucide:filter-x"
          title="没有匹配的节点"
          description="调整状态筛选或搜索关键字。"
          class="py-12"
        />

        <div v-else class="gap-4 grid xl:grid-cols-2" aria-live="polite">
          <QsProxyNodeCard
            v-for="row in visibleRows"
            :key="row.id"
            :node="row"
            mode="management"
            :busy="assignSubmitting || releaseSubmitting"
            @assign="openAssign(row)"
            @release="openRelease(row)"
          />
        </div>
      </template>
    </FaPageMain>

    <QsGenericModal
      v-model="assignOpen"
      title="绑定静态节点"
      description="选择要接收该节点的启用用户。"
      size="md"
      error-title="绑定失败"
      :error="assignError || null"
      :submitting="assignSubmitting"
    >
      <div class="flex flex-col gap-4">
        <div class="text-sm flex flex-wrap gap-2 items-center">
          <span class="text-muted-foreground">节点</span>
          <span class="text-foreground font-mono">{{ assignTarget?.host }}:{{ assignTarget?.port }}</span>
          <template v-if="assignTarget?.assignedUser">
            <span class="text-muted-foreground">当前绑定</span>
            <QsPersonDisplay
              :display-name="assignTarget.assignedUser.displayName"
              :avatar-url="assignTarget.assignedUser.avatarUrl"
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
          >
            <template #start>
              <FaIcon name="i-lucide:search" />
            </template>
          </FaInput>
          <FaButton
            variant="outline"
            :loading="assignUsersLoading"
            @click="loadAssignableUsers"
          >
            查询
          </FaButton>
        </div>

        <div
          v-if="assignUsersLoading"
          class="text-sm text-muted-foreground py-8 text-center"
        >
          正在加载用户...
        </div>
        <div
          v-else-if="!assignUsers.length"
          class="text-sm text-muted-foreground py-8 text-center"
        >
          没有匹配的启用用户
        </div>
        <div
          v-else
          class="border border-border rounded-lg max-h-64 overflow-y-auto divide-border divide-y"
        >
          <button
            v-for="user in assignUsers"
            :key="user.id"
            type="button"
            class="p-3 text-left flex gap-3 w-full items-center"
            :class="user.id === assignSelectedUserId ? 'bg-primary/5' : 'hover:bg-muted/50'"
            @click="assignSelectedUserId = user.id"
          >
            <QsPersonDisplay
              :display-name="user.displayName"
              :avatar-url="user.avatarUrl"
              size="sm"
            />
            <span class="qs-type-meta text-muted-foreground">{{ user.username }}</span>
            <FaIcon
              v-if="user.id === assignSelectedUserId"
              name="i-lucide:check"
              class="text-primary ml-auto size-4"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <template #footer>
        <FaButton
          variant="outline"
          :disabled="assignSubmitting"
          @click="assignOpen = false"
        >
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
      description="解除后该用户将无法在运营工作台看到此节点。"
      size="sm"
      error-title="解绑失败"
      :error="releaseError || null"
      :submitting="releaseSubmitting"
    >
      <p class="text-sm m-0">
        确定解除
        <span class="font-mono">{{ releaseTarget?.host }}:{{ releaseTarget?.port }}</span>
        与以下用户的绑定吗？
      </p>
      <QsPersonDisplay
        v-if="releaseTarget?.assignedUser"
        class="mt-3"
        :display-name="releaseTarget.assignedUser.displayName"
        :avatar-url="releaseTarget.assignedUser.avatarUrl"
        size="sm"
      />

      <template #footer>
        <FaButton
          variant="outline"
          :disabled="releaseSubmitting"
          @click="releaseOpen = false"
        >
          取消
        </FaButton>
        <FaButton
          variant="destructive"
          :loading="releaseSubmitting"
          @click="submitRelease"
        >
          确认解绑
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
