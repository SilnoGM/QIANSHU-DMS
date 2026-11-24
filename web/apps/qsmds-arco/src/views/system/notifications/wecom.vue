<script setup lang="ts">
import type {
  NotificationEventDto,
  UserDto,
  WecomAppDto,
  WecomBindingDto,
  WecomChannelDto,
  WecomMembershipDto,
  WecomTargetDto,
} from '@/api/generated/types.gen'

import { computed, onMounted, ref } from 'vue'

import { getApiClientFailureMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useAppAuth } from '@/composables/app/auth'

defineOptions({ name: 'SystemNotificationWecom' })

const toast = useQsToast()
const { auth } = useAppAuth()

const canUpdateChannel = computed(() => auth('wecom-channel:update'))
const canManageApp = computed(() => auth('wecom-app:manage'))
const canUpdateSecret = computed(() => auth('wecom-app-secret:update'))
const canReadMembers = computed(() => auth('wecom-membership:read'))
const canManageMembers = computed(() => auth('wecom-membership:manage'))
const canManageTargets = computed(() => auth('wecom-target:manage'))

const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)
const channel = ref<WecomChannelDto | null>(null)
const apps = ref<WecomAppDto[]>([])
const bindings = ref<WecomBindingDto[]>([])
const targets = ref<WecomTargetDto[]>([])
const users = ref<UserDto[]>([])
const events = ref<NotificationEventDto[]>([])

const appModalOpen = ref(false)
const appModalMode = ref<'create' | 'edit'>('create')
const editingApp = ref<WecomAppDto | null>(null)
const appDraft = ref({ key: '', name: '', corpId: '', agentId: '', secret: '', isDefault: false })
const secretModalOpen = ref(false)
const secretApp = ref<WecomAppDto | null>(null)
const secretDraft = ref('')
const eventModalOpen = ref(false)
const eventApp = ref<WecomAppDto | null>(null)
const selectedEventTypes = ref<string[]>([])
const memberModalOpen = ref(false)
const memberApp = ref<WecomAppDto | null>(null)
const members = ref<WecomMembershipDto[]>([])
const memberUserId = ref<string | undefined>(undefined)
const bindingModalOpen = ref(false)
const bindingDraft = ref({ userId: undefined as string | undefined, wecomUserId: '', displayName: '' })
const targetModalOpen = ref(false)
const targetModalMode = ref<'create' | 'edit'>('create')
const editingTarget = ref<WecomTargetDto | null>(null)
const targetDraft = ref({ key: '', name: '', purpose: '', webhookKey: '', enabled: true })

const userOptions = computed(() => users.value.map(user => ({
  label: `${user.displayName}（${user.username}）`,
  value: user.id,
})))

const eventOptions = computed(() => events.value.map(event => ({
  label: `${event.label}（${event.eventType}）`,
  value: event.eventType,
})))

function statusLabel(status: string): string {
  if (status === 'ACTIVE') {
    return '正常'
  }
  if (status === 'INVALID') {
    return '异常'
  }
  if (status === 'DISABLED') {
    return '已停用'
  }
  return '待验证'
}

function statusClass(status: string): string {
  if (status === 'ACTIVE') {
    return 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400'
  }
  if (status === 'INVALID') {
    return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
  }
  if (status === 'DISABLED') {
    return 'text-muted-foreground border-border bg-muted'
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function membershipLabel(status: string): string {
  if (status === 'ACTIVE') {
    return '可用'
  }
  if (status === 'INVALID') {
    return '失效'
  }
  return '停用'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  const signal = new AbortController().signal
  try {
    const [channelResult, appResult, bindingResult, targetResult, eventResult, userResult] = await Promise.all([
      notificationsApi.wecom.channel.get(signal),
      notificationsApi.wecom.apps.list(signal),
      notificationsApi.wecom.bindings.list(signal),
      notificationsApi.wecom.targets.list(signal),
      notificationsApi.events.list(signal),
      managementApi.users.list({ page: 1, pageSize: 100, status: 'ACTIVE' }, signal),
    ])
    channel.value = channelResult.data
    apps.value = appResult.data
    bindings.value = bindingResult.data
    targets.value = targetResult.data
    events.value = eventResult.data
    users.value = userResult.data.items
  }
  catch (failure) {
    error.value = getApiClientFailureMessage(failure, '企业微信通知配置加载失败')
  }
  finally {
    loading.value = false
  }
}

async function run(action: () => Promise<void>, fallback: string): Promise<void> {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    await action()
    toast.success('操作成功')
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, fallback))
  }
  finally {
    busy.value = false
  }
}

async function toggleChannel(value: boolean | undefined): Promise<void> {
  const current = channel.value
  if (current === null || value === undefined) {
    return
  }
  await run(async () => {
    const result = await notificationsApi.wecom.channel.update({
      enabled: value,
      expectedVersion: current.version,
    })
    channel.value = result.data
  }, '渠道开关更新失败')
}

function openCreateApp(): void {
  appModalMode.value = 'create'
  editingApp.value = null
  appDraft.value = {
    key: '',
    name: '千树 DMS',
    corpId: '',
    agentId: '',
    secret: '',
    isDefault: apps.value.length === 0,
  }
  appModalOpen.value = true
}

function openEditApp(app: WecomAppDto): void {
  appModalMode.value = 'edit'
  editingApp.value = app
  appDraft.value = {
    key: app.key,
    name: app.name,
    corpId: app.corpId ?? '',
    agentId: app.agentId === null ? '' : String(app.agentId),
    secret: '',
    isDefault: app.isDefault,
  }
  appModalOpen.value = true
}

async function saveApp(): Promise<void> {
  const agentId = Number(appDraft.value.agentId)
  if (!Number.isInteger(agentId) || agentId <= 0) {
    toast.error('agentId 必须是正整数')
    return
  }
  await run(async () => {
    if (appModalMode.value === 'create') {
      await notificationsApi.wecom.apps.create({
        key: appDraft.value.key.trim(),
        name: appDraft.value.name.trim(),
        corpId: appDraft.value.corpId.trim(),
        agentId,
        secret: appDraft.value.secret.trim(),
        isDefault: appDraft.value.isDefault,
      })
    }
    else if (editingApp.value !== null) {
      await notificationsApi.wecom.apps.update(editingApp.value.id, {
        name: appDraft.value.name.trim(),
        corpId: appDraft.value.corpId.trim(),
        agentId,
        isDefault: appDraft.value.isDefault,
        expectedVersion: editingApp.value.version,
      })
    }
    appModalOpen.value = false
    await load()
  }, '应用保存失败')
}

async function toggleApp(app: WecomAppDto): Promise<void> {
  await run(async () => {
    await notificationsApi.wecom.apps.update(app.id, {
      enabled: !app.enabled,
      expectedVersion: app.version,
    })
    await load()
  }, '应用状态更新失败')
}

async function testApp(app: WecomAppDto): Promise<void> {
  await run(async () => {
    await notificationsApi.wecom.apps.test(app.id)
    await load()
  }, '应用测试失败')
}

function openSecret(app: WecomAppDto): void {
  secretApp.value = app
  secretDraft.value = ''
  secretModalOpen.value = true
}

async function saveSecret(): Promise<void> {
  const app = secretApp.value
  if (app === null) {
    return
  }
  await run(async () => {
    await notificationsApi.wecom.apps.updateSecret(app.id, { secret: secretDraft.value.trim() })
    secretModalOpen.value = false
    await load()
  }, 'Secret 更新失败')
}

async function openEvents(app: WecomAppDto): Promise<void> {
  eventApp.value = app
  selectedEventTypes.value = []
  try {
    const result = await notificationsApi.wecom.apps.events.get(app.id, new AbortController().signal)
    selectedEventTypes.value = result.data.eventTypes
    eventModalOpen.value = true
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '事件分配加载失败'))
  }
}

function toggleEvent(eventType: string): void {
  selectedEventTypes.value = selectedEventTypes.value.includes(eventType)
    ? selectedEventTypes.value.filter(item => item !== eventType)
    : [...selectedEventTypes.value, eventType]
}

async function saveEvents(): Promise<void> {
  const app = eventApp.value
  if (app === null) {
    return
  }
  await run(async () => {
    await notificationsApi.wecom.apps.events.update(app.id, { eventTypes: selectedEventTypes.value })
    eventModalOpen.value = false
    await load()
  }, '事件分配保存失败')
}

async function openMembers(app: WecomAppDto): Promise<void> {
  memberApp.value = app
  memberUserId.value = undefined
  try {
    const result = await notificationsApi.wecom.apps.members.list(app.id, new AbortController().signal)
    members.value = result.data
    memberModalOpen.value = true
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '应用成员加载失败'))
  }
}

async function addMember(): Promise<void> {
  const app = memberApp.value
  if (app === null || memberUserId.value === undefined) {
    return
  }
  await run(async () => {
    await notificationsApi.wecom.apps.members.add(app.id, { userId: memberUserId.value! })
    memberUserId.value = undefined
    await openMembers(app)
  }, '添加应用成员失败')
}

async function removeMember(member: WecomMembershipDto): Promise<void> {
  const app = memberApp.value
  if (app === null) {
    return
  }
  await run(async () => {
    await notificationsApi.wecom.apps.members.remove(app.id, member.userId)
    await openMembers(app)
  }, '移除应用成员失败')
}

function openCreateBinding(): void {
  bindingDraft.value = { userId: undefined, wecomUserId: '', displayName: '' }
  bindingModalOpen.value = true
}

async function saveBinding(): Promise<void> {
  const draft = bindingDraft.value
  if (draft.userId === undefined || draft.wecomUserId.trim().length === 0) {
    toast.error('请选择员工并填写企业微信 userid')
    return
  }
  await run(async () => {
    await notificationsApi.wecom.bindings.create({
      userId: draft.userId!,
      wecomUserId: draft.wecomUserId.trim(),
      ...(draft.displayName.trim().length > 0 ? { displayName: draft.displayName.trim() } : {}),
    })
    bindingModalOpen.value = false
    await load()
  }, '员工绑定创建失败')
}

async function verifyBinding(binding: WecomBindingDto): Promise<void> {
  await run(async () => {
    await notificationsApi.wecom.bindings.verify(binding.id, {})
    await load()
  }, '绑定验证失败')
}

async function removeBinding(binding: WecomBindingDto): Promise<void> {
  await run(async () => {
    await notificationsApi.wecom.bindings.remove(binding.id)
    await load()
  }, '解绑失败')
}

function openCreateTarget(): void {
  targetModalMode.value = 'create'
  editingTarget.value = null
  targetDraft.value = { key: '', name: '', purpose: '', webhookKey: '', enabled: true }
  targetModalOpen.value = true
}

function openEditTarget(target: WecomTargetDto): void {
  targetModalMode.value = 'edit'
  editingTarget.value = target
  targetDraft.value = {
    key: target.key,
    name: target.name,
    purpose: target.purpose ?? '',
    webhookKey: '',
    enabled: target.enabled,
  }
  targetModalOpen.value = true
}

async function saveTarget(): Promise<void> {
  const draft = targetDraft.value
  if (targetModalMode.value === 'create' && draft.webhookKey.trim().length === 0) {
    toast.error('请填写群机器人 webhook key')
    return
  }
  await run(async () => {
    if (targetModalMode.value === 'create') {
      await notificationsApi.wecom.targets.create({
        key: draft.key.trim(),
        name: draft.name.trim(),
        ...(draft.purpose.trim().length > 0 ? { purpose: draft.purpose.trim() } : {}),
        webhookKey: draft.webhookKey.trim(),
        enabled: draft.enabled,
      })
    }
    else if (editingTarget.value !== null) {
      await notificationsApi.wecom.targets.update(editingTarget.value.id, {
        name: draft.name.trim(),
        ...(draft.purpose.trim().length > 0 ? { purpose: draft.purpose.trim() } : { purpose: null }),
        ...(draft.webhookKey.trim().length > 0 ? { webhookKey: draft.webhookKey.trim() } : {}),
        enabled: draft.enabled,
        expectedVersion: editingTarget.value.version,
      })
    }
    targetModalOpen.value = false
    await load()
  }, '群目标保存失败')
}

async function testTarget(target: WecomTargetDto): Promise<void> {
  await run(async () => {
    await notificationsApi.wecom.targets.test(target.id)
    await load()
  }, '群目标测试失败')
}

async function removeTarget(target: WecomTargetDto): Promise<void> {
  await run(async () => {
    await notificationsApi.wecom.targets.remove(target.id)
    await load()
  }, '群目标删除失败')
}

onMounted(load)
</script>

<template>
  <FaPageHeader title="企业微信" description="管理 WECOM 应用、员工绑定、群目标与渠道开关；Secret 与 webhook 只写不读。">
    <div class="flex gap-2 items-center">
      <FaSwitch
        :model-value="channel?.enabled ?? false"
        :disabled="!canUpdateChannel || busy || loading"
        @update:model-value="toggleChannel"
      />
      <span class="qs-type-meta text-muted-foreground">{{ channel?.enabled ? '渠道已启用' : '渠道已停用' }}</span>
    </div>
  </FaPageHeader>

  <FaAlert v-if="error !== null" variant="destructive" :title="error" class="mb-4" />

  <div v-if="loading" class="qs-type-meta text-muted-foreground py-12 text-center">
    加载中…
  </div>
  <div v-else class="flex flex-col gap-5">
    <section class="p-4 border border-border rounded-xl bg-background flex flex-col gap-3">
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <div>
          <h2 class="qs-type-section-title m-0">
            应用
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            一期默认应用“千树 DMS”；二期可手动添加更多应用并分配事件。
          </p>
        </div>
        <FaButton v-if="canManageApp" variant="outline" size="sm" :disabled="busy" @click="openCreateApp">
          <FaIcon name="i-lucide:plus" class="size-4" aria-hidden="true" />
          新增应用
        </FaButton>
      </div>
      <FaEmpty v-if="apps.length === 0" title="还没有企业微信应用" description="先新增应用并配置 Secret。" class="py-6" />
      <div v-else class="gap-3 grid xl:grid-cols-2">
        <article v-for="app in apps" :key="app.id" class="p-4 border border-border rounded-lg bg-muted/10 flex flex-col gap-3">
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-body-medium truncate">{{ app.name }}</span>
                <FaTag v-if="app.isDefault" variant="outline" class="text-primary border-primary/30 bg-primary/10">
                  默认
                </FaTag>
                <FaTag variant="outline" :class="statusClass(app.status)">
                  {{ statusLabel(app.status) }}
                </FaTag>
              </div>
              <p class="qs-type-meta text-muted-foreground font-mono m-0 mt-1 break-all">
                {{ app.key }}
              </p>
            </div>
            <span class="qs-type-meta text-muted-foreground">agentId {{ app.agentId ?? '—' }}</span>
          </div>
          <dl class="qs-type-meta text-muted-foreground m-0 gap-x-4 gap-y-1 grid grid-cols-2">
            <div class="flex gap-1">
              <dt class="m-0">
                Secret
              </dt><dd class="m-0">
                {{ app.hasSecret ? '已配置' : '未配置' }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="m-0">
                事件
              </dt><dd class="m-0">
                {{ app.eventCount }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="m-0">
                成员
              </dt><dd class="m-0">
                {{ app.memberCount }}
              </dd>
            </div>
            <div class="flex gap-1">
              <dt class="m-0">
                最近检查
              </dt><dd class="m-0">
                {{ app.lastCheckedAt ?? '—' }}
              </dd>
            </div>
          </dl>
          <p v-if="app.lastErrorMessage !== null" class="qs-type-meta text-destructive m-0 break-all">
            {{ app.lastErrorMessage }}
          </p>
          <div class="mt-auto flex flex-wrap gap-2">
            <FaButton variant="outline" size="sm" :disabled="busy" @click="testApp(app)">
              测试
            </FaButton>
            <FaButton v-if="canManageApp" variant="outline" size="sm" :disabled="busy" @click="openEditApp(app)">
              编辑
            </FaButton>
            <FaButton v-if="canManageApp" variant="outline" size="sm" :disabled="busy" @click="openEvents(app)">
              承担事件
            </FaButton>
            <FaButton v-if="canReadMembers" variant="outline" size="sm" :disabled="busy" @click="openMembers(app)">
              可见成员
            </FaButton>
            <FaButton v-if="canUpdateSecret" variant="outline" size="sm" :disabled="busy" @click="openSecret(app)">
              重置 Secret
            </FaButton>
            <FaButton v-if="canManageApp" variant="ghost" size="sm" :disabled="busy" @click="toggleApp(app)">
              {{ app.enabled ? '停用' : '启用' }}
            </FaButton>
          </div>
        </article>
      </div>
    </section>

    <section class="p-4 border border-border rounded-xl bg-background flex flex-col gap-3">
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <div>
          <h2 class="qs-type-section-title m-0">
            员工绑定
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            绑定 DMS 用户与企业微信 userid；验证会通过默认应用发送测试消息。
          </p>
        </div>
        <FaButton v-if="canManageMembers" variant="outline" size="sm" :disabled="busy" @click="openCreateBinding">
          <FaIcon name="i-lucide:plus" class="size-4" aria-hidden="true" />
          新增绑定
        </FaButton>
      </div>
      <FaEmpty v-if="bindings.length === 0" title="还没有员工绑定" description="先新增绑定并发送测试消息。" class="py-6" />
      <div v-else class="flex flex-col gap-2">
        <article v-for="binding in bindings" :key="binding.id" class="p-3 border border-border rounded-lg bg-muted/10 flex flex-wrap gap-2 items-center justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-body-medium">{{ binding.userName }}</span>
              <span class="qs-type-meta text-muted-foreground">{{ binding.username }}</span>
              <FaTag variant="outline" :class="binding.verifiedAt === null ? 'text-amber-700 border-amber-500/30 bg-amber-500/10' : 'text-green-700 border-green-600/30 bg-green-600/10 dark:text-green-400'">
                {{ binding.verifiedAt === null ? '未验证' : '已验证' }}
              </FaTag>
              <FaTag v-if="binding.status !== 'ACTIVE'" variant="outline" class="text-muted-foreground">
                {{ statusLabel(binding.status) }}
              </FaTag>
            </div>
            <p class="qs-type-meta text-muted-foreground font-mono m-0 mt-1 break-all">
              {{ binding.wecomUserId }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaButton v-if="canManageMembers" variant="outline" size="sm" :disabled="busy" @click="verifyBinding(binding)">
              发送测试
            </FaButton>
            <FaButton v-if="canManageMembers" variant="ghost" size="sm" :disabled="busy" @click="removeBinding(binding)">
              解绑
            </FaButton>
          </div>
        </article>
      </div>
    </section>

    <section class="p-4 border border-border rounded-xl bg-background flex flex-col gap-3">
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <div>
          <h2 class="qs-type-section-title m-0">
            内部群目标
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            只允许企业内部群机器人；webhook key 只写不读。
          </p>
        </div>
        <FaButton v-if="canManageTargets" variant="outline" size="sm" :disabled="busy" @click="openCreateTarget">
          <FaIcon name="i-lucide:plus" class="size-4" aria-hidden="true" />
          新增群目标
        </FaButton>
      </div>
      <FaEmpty v-if="targets.length === 0" title="还没有群目标" description="新增内部群机器人 webhook 后才能发群通知。" class="py-6" />
      <div v-else class="flex flex-col gap-2">
        <article v-for="target in targets" :key="target.id" class="p-3 border border-border rounded-lg bg-muted/10 flex flex-wrap gap-2 items-center justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-body-medium">{{ target.name }}</span>
              <span class="qs-type-meta text-muted-foreground font-mono">{{ target.key }}</span>
              <FaTag variant="outline" :class="target.enabled ? 'text-green-700 border-green-600/30 bg-green-600/10 dark:text-green-400' : 'text-muted-foreground'">
                {{ target.enabled ? '已启用' : '已停用' }}
              </FaTag>
              <FaTag variant="outline" class="text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-300">
                仅内部
              </FaTag>
            </div>
            <p v-if="target.purpose !== null" class="qs-type-meta text-muted-foreground m-0 mt-1">
              {{ target.purpose }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaButton v-if="canManageTargets" variant="outline" size="sm" :disabled="busy" @click="testTarget(target)">
              测试
            </FaButton>
            <FaButton v-if="canManageTargets" variant="outline" size="sm" :disabled="busy" @click="openEditTarget(target)">
              编辑
            </FaButton>
            <FaButton v-if="canManageTargets" variant="ghost" size="sm" :disabled="busy" @click="removeTarget(target)">
              删除
            </FaButton>
          </div>
        </article>
      </div>
    </section>
  </div>

  <QsGenericModal v-model="appModalOpen" :title="appModalMode === 'create' ? '新增企业微信应用' : '编辑企业微信应用'" size="lg" :submitting="busy" @update:model-value="appModalOpen = $event">
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">应用 key</span>
        <FaInput v-model="appDraft.key" :disabled="appModalMode === 'edit'" placeholder="default" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">应用名称</span>
        <FaInput v-model="appDraft.name" placeholder="千树 DMS" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">corpId</span>
        <FaInput v-model="appDraft.corpId" placeholder="ww..." />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">agentId</span>
        <FaInput v-model="appDraft.agentId" type="number" placeholder="1000001" />
      </label>
      <label v-if="appModalMode === 'create'" class="flex flex-col gap-1">
        <span class="qs-type-compact-label">Secret</span>
        <FaInput v-model="appDraft.secret" type="password" placeholder="只写不读" />
      </label>
      <label class="qs-type-meta flex gap-2 items-center">
        <FaSwitch v-model="appDraft.isDefault" />
        设为默认应用
      </label>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="busy" @click="appModalOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" @click="saveApp">
          保存
        </FaButton>
      </div>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="secretModalOpen" title="重置应用 Secret" size="md" :submitting="busy" @update:model-value="secretModalOpen = $event">
    <div class="flex flex-col gap-3">
      <p class="qs-type-meta text-muted-foreground m-0">
        应用：{{ secretApp?.name ?? '—' }}
      </p>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">新 Secret</span>
        <FaInput v-model="secretDraft" type="password" placeholder="只写不读" />
      </label>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="busy" @click="secretModalOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="secretDraft.trim().length === 0" @click="saveSecret">
          保存
        </FaButton>
      </div>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="eventModalOpen" title="承担事件" size="xl" :submitting="busy" @update:model-value="eventModalOpen = $event">
    <div class="flex flex-col gap-3">
      <p class="qs-type-meta text-muted-foreground m-0">
        应用：{{ eventApp?.name ?? '—' }}。一个事件只能属于一个应用。
      </p>
      <div class="pr-1 flex flex-col gap-1 max-h-[460px] overflow-auto">
        <label v-for="option in eventOptions" :key="option.value" class="p-2 border border-border rounded-md flex gap-2 items-center">
          <input
            type="checkbox"
            :checked="selectedEventTypes.includes(option.value)"
            @change="toggleEvent(option.value)"
          >
          <span class="qs-type-meta">{{ option.label }}</span>
        </label>
      </div>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="busy" @click="eventModalOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" @click="saveEvents">
          保存
        </FaButton>
      </div>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="memberModalOpen" title="应用可见成员" size="lg" :submitting="busy" @update:model-value="memberModalOpen = $event">
    <div class="flex flex-col gap-3">
      <p class="qs-type-meta text-muted-foreground m-0">
        应用：{{ memberApp?.name ?? '—' }}。成员还需要在企业微信后台处于应用可见范围。
      </p>
      <div v-if="canManageMembers" class="flex gap-2 items-end">
        <label class="flex flex-1 flex-col gap-1 min-w-0">
          <span class="qs-type-compact-label">添加员工</span>
          <FaSelect v-model="memberUserId" :options="userOptions" placeholder="选择员工" />
        </label>
        <FaButton variant="outline" :disabled="busy || memberUserId === undefined" @click="addMember">
          添加
        </FaButton>
      </div>
      <FaEmpty v-if="members.length === 0" title="还没有应用成员" description="添加成员后才能通过该应用发 1:1 通知。" class="py-4" />
      <div v-else class="flex flex-col gap-1 max-h-[420px] overflow-auto">
        <div v-for="member in members" :key="member.id" class="p-2 border border-border rounded-md flex gap-2 items-center justify-between">
          <div class="min-w-0">
            <span class="qs-type-body-medium">{{ member.userName }}</span>
            <span class="qs-type-meta text-muted-foreground ml-2">{{ member.username }}</span>
            <p class="qs-type-meta text-muted-foreground m-0">
              {{ membershipLabel(member.status) }}
            </p>
          </div>
          <FaButton v-if="canManageMembers" variant="ghost" size="sm" :disabled="busy" @click="removeMember(member)">
            移除
          </FaButton>
        </div>
      </div>
    </div>
  </QsGenericModal>

  <QsGenericModal v-model="bindingModalOpen" title="新增员工绑定" size="lg" :submitting="busy" @update:model-value="bindingModalOpen = $event">
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">员工</span>
        <FaSelect v-model="bindingDraft.userId" :options="userOptions" placeholder="选择员工" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">企业微信 userid</span>
        <FaInput v-model="bindingDraft.wecomUserId" placeholder="从企业微信通讯录复制" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">显示名（可选）</span>
        <FaInput v-model="bindingDraft.displayName" />
      </label>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="busy" @click="bindingModalOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" @click="saveBinding">
          保存
        </FaButton>
      </div>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="targetModalOpen" :title="targetModalMode === 'create' ? '新增群目标' : '编辑群目标'" size="lg" :submitting="busy" @update:model-value="targetModalOpen = $event">
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">目标 key</span>
        <FaInput v-model="targetDraft.key" :disabled="targetModalMode === 'edit'" placeholder="finance" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">群名称</span>
        <FaInput v-model="targetDraft.name" placeholder="财务群" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">用途（可选）</span>
        <FaInput v-model="targetDraft.purpose" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">{{ targetModalMode === 'create' ? 'webhook key' : '新 webhook key（留空不修改）' }}</span>
        <FaInput v-model="targetDraft.webhookKey" type="password" placeholder="只写不读" />
      </label>
      <label class="qs-type-meta flex gap-2 items-center">
        <FaSwitch v-model="targetDraft.enabled" />
        启用群目标
      </label>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="busy" @click="targetModalOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" @click="saveTarget">
          保存
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
