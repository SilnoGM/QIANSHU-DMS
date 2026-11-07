<script setup lang="ts">
import type { AssistantAccountDto, AssistantBindingDto, AssistantChannelDto, AssistantContactDto, AssistantTargetDto, UserDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import { computed, onMounted, ref } from 'vue'

import { getApiClientErrorMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { qrImageSrc } from './qr-image'

const toast = useQsToast()
const { auth } = useAppAuth()

const canUpdateChannel = computed(() => auth('assistant-channel:update'))
const canOperateAccount = computed(() => auth('assistant-account:operate'))
const canManageBinding = computed(() => auth('assistant-binding:manage'))
const canManageTarget = computed(() => auth('assistant-target:manage'))

const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)
const channel = ref<AssistantChannelDto | null>(null)
const channelEnabled = ref(false)
const accounts = ref<AssistantAccountDto[]>([])
const bindings = ref<AssistantBindingDto[]>([])
const targets = ref<AssistantTargetDto[]>([])
const users = ref<UserDto[]>([])
const contacts = ref<AssistantContactDto[]>([])

const accountDialogOpen = ref(false)
const accountDialogMode = ref<'create' | 'update'>('create')
const editingAccountId = ref<string | null>(null)
const accountDraft = ref({ name: '', appId: '', wxid: '', nickname: '' })
const ownQrOpen = ref(false)
const ownQrImage = ref('')
const bindingOpen = ref(false)
const bindingUserId = ref<string | undefined>(undefined)
const bindingContactWxid = ref<string | undefined>(undefined)

const editingAccount = computed(() => accounts.value.find(account => account.id === editingAccountId.value) ?? null)
const accountDialogTitle = computed(() => accountDialogMode.value === 'create' ? '导入公司号' : '更新公司号节点')
const accountDialogDescription = computed(() => accountDialogMode.value === 'create'
  ? '在 GeWe 控制台打开节点详情，复制 appId 与 wxid。系统会调用 checkOnline 验证，离线节点不能导入。'
  : 'appId 与 wxid 留空表示不修改。修改 appId 时会重新校验节点在线；控制台负责登录与重连。')
const appIdPlaceholder = computed(() => accountDialogMode.value === 'create' ? 'wx_...' : '留空表示不修改')
const wxidPlaceholder = computed(() => accountDialogMode.value === 'create'
  ? 'wxid_...'
  : `留空表示不修改；当前 ${editingAccount.value?.wxidMasked ?? '未记录'}`)
const canSubmitAccount = computed(() => accountDialogMode.value === 'create'
  ? accountDraft.value.name.trim().length > 0
  && accountDraft.value.appId.trim().length > 0
  && accountDraft.value.wxid.trim().length > 0
  : true)

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

function formatDate(value: string | null): string {
  return value === null ? '—' : dateTimeFormatter.format(new Date(value))
}

function statusClass(status: string): string {
  if (status === 'ONLINE' || status === 'ACTIVE') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (status === 'REQUIRES_LOGIN' || status === 'INVALID') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  return 'border-border bg-muted text-muted-foreground'
}

const STATUS_LABELS: Record<string, string> = {
  ONLINE: '在线',
  OFFLINE: '离线',
  REQUIRES_LOGIN: '待导入',
  DISABLED: '已停用',
  ACTIVE: '有效',
  INVALID: '已失效',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function isPendingAccount(account: AssistantAccountDto): boolean {
  return account.appId.startsWith('pending-') || account.status === 'REQUIRES_LOGIN'
}

const userOptions = computed(() => users.value.map(user => ({ label: `${user.displayName}（${user.username}）`, value: user.id })))
const contactOptions = computed(() => contacts.value.map(contact => ({
  label: contact.remark ?? contact.nickname ?? contact.wxid,
  value: contact.wxid,
})))

const bindingColumns: QsGenericTableColumn<AssistantBindingDto>[] = [
  { accessorKey: 'userName', id: 'userName', title: '员工', minWidth: 140 },
  { accessorKey: 'accountName', id: 'accountName', title: '公司号', minWidth: 120 },
  { accessorKey: 'wxidMasked', id: 'wxidMasked', title: '微信', width: 160 },
  { accessorKey: 'wechatNickname', id: 'wechatNickname', title: '昵称', minWidth: 120 },
  { accessorKey: 'status', id: 'status', title: '状态', width: 100 },
  { accessorKey: 'verifiedAt', id: 'verifiedAt', title: '验证时间', width: 160 },
]

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const signal = new AbortController().signal
    const [channelResult, accountResult, bindingResult, targetResult] = await Promise.all([
      notificationsApi.assistant.channel.get(signal),
      notificationsApi.assistant.accounts.list(signal),
      notificationsApi.assistant.bindings.list({ page: 1, pageSize: 50 }, signal),
      notificationsApi.assistant.targets.list(signal),
    ])
    channel.value = channelResult.data
    channelEnabled.value = channelResult.data.enabled
    accounts.value = accountResult.data
    bindings.value = bindingResult.data.items
    targets.value = targetResult.data
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    loading.value = false
  }
}

async function saveChannel(): Promise<void> {
  if (channel.value === null) {
    return
  }
  busy.value = true
  try {
    channel.value = (await notificationsApi.assistant.channel.update({
      enabled: channelEnabled.value,
      expectedVersion: channel.value.version,
    })).data
    toast.success(channel.value.enabled ? '千树小助理已启用' : '千树小助理已停用')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function testChannel(): Promise<void> {
  busy.value = true
  try {
    await notificationsApi.assistant.channel.test()
    toast.success('测试消息已提交，请确认公司号文件传输助手已收到')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

function openCreateAccount(): void {
  accountDialogMode.value = 'create'
  editingAccountId.value = null
  accountDraft.value = { name: '', appId: '', wxid: '', nickname: '' }
  accountDialogOpen.value = true
}

function openUpdateAccount(account: AssistantAccountDto): void {
  accountDialogMode.value = 'update'
  editingAccountId.value = account.id
  accountDraft.value = {
    name: account.name,
    appId: isPendingAccount(account) ? '' : account.appId,
    wxid: '',
    nickname: account.nickname ?? '',
  }
  accountDialogOpen.value = true
}

async function submitAccount(): Promise<void> {
  const draft = accountDraft.value
  const name = draft.name.trim()
  const appId = draft.appId.trim()
  const wxid = draft.wxid.trim()
  const nickname = draft.nickname.trim()

  if (accountDialogMode.value === 'create' && (name.length === 0 || appId.length === 0 || wxid.length === 0)) {
    toast.warning('请填写备注名、appId 与 wxid')
    return
  }

  busy.value = true
  try {
    if (accountDialogMode.value === 'create') {
      await notificationsApi.assistant.accounts.create({
        name,
        appId,
        wxid,
        ...(nickname.length > 0 ? { nickname } : {}),
      })
      toast.success('公司号已导入，节点在线')
    }
    else {
      const account = editingAccount.value
      if (account === null) {
        return
      }
      const input: { expectedVersion: number, name?: string, appId?: string, wxid?: string, nickname?: string } = {
        expectedVersion: account.version,
      }
      if (name.length > 0 && name !== account.name) {
        input.name = name
      }
      if (appId.length > 0 && appId !== account.appId) {
        input.appId = appId
      }
      if (wxid.length > 0) {
        input.wxid = wxid
      }
      if (nickname !== (account.nickname ?? '')) {
        input.nickname = nickname
      }
      if (input.name === undefined && input.appId === undefined && input.wxid === undefined && input.nickname === undefined) {
        toast.warning('没有需要保存的修改')
        return
      }
      await notificationsApi.assistant.accounts.update(account.id, input)
      toast.success('公司号节点已更新')
    }
    accountDialogOpen.value = false
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function checkAccountStatus(account: AssistantAccountDto): Promise<void> {
  busy.value = true
  try {
    const updated = (await notificationsApi.assistant.accounts.checkStatus(account.id)).data
    accounts.value = accounts.value.map(item => item.id === updated.id ? updated : item)
    toast.success(updated.status === 'ONLINE' ? '节点在线' : '节点离线，请在 GeWe 控制台重连')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function setAccountEnabled(account: AssistantAccountDto, enabled: boolean): Promise<void> {
  busy.value = true
  try {
    const updated = (await notificationsApi.assistant.accounts.update(account.id, {
      enabled,
      expectedVersion: account.version,
    })).data
    accounts.value = accounts.value.map(item => item.id === updated.id ? updated : item)
    toast.success(enabled ? '公司号已启用派发' : '公司号已停用派发')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function showOwnQr(account: AssistantAccountDto): Promise<void> {
  busy.value = true
  try {
    ownQrImage.value = qrImageSrc((await notificationsApi.assistant.accounts.qrcode(
      account.id,
      new AbortController().signal,
    )).data.qrCodeBase64)
    ownQrOpen.value = true
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function openBinding(): Promise<void> {
  bindingUserId.value = undefined
  bindingContactWxid.value = undefined
  bindingOpen.value = true
  try {
    const signal = new AbortController().signal
    const [userResult, contactResult] = await Promise.all([
      managementApi.users.list({ page: 1, pageSize: 100, status: 'ACTIVE' }, signal),
      notificationsApi.assistant.contacts.list(undefined, signal),
    ])
    users.value = userResult.data.items
    contacts.value = contactResult.data
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

async function createBinding(): Promise<void> {
  if (bindingUserId.value === undefined || bindingContactWxid.value === undefined) {
    toast.warning('请选择员工与公司号好友')
    return
  }
  const contact = contacts.value.find(item => item.wxid === bindingContactWxid.value)
  busy.value = true
  try {
    await notificationsApi.assistant.bindings.create({
      userId: bindingUserId.value,
      wxid: bindingContactWxid.value,
      ...(contact?.nickname ? { wechatNickname: contact.nickname } : {}),
    })
    bindingOpen.value = false
    toast.success('绑定已创建，请发送测试消息并确认')
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function verifyBinding(binding: AssistantBindingDto): Promise<void> {
  busy.value = true
  try {
    await notificationsApi.assistant.bindings.verify(binding.id)
    toast.success('测试消息已发送，请在员工确认后标记为已验证')
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function revokeBinding(binding: AssistantBindingDto): Promise<void> {
  busy.value = true
  try {
    await notificationsApi.assistant.bindings.remove(binding.id)
    toast.success('绑定已停用')
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function checkBindings(): Promise<void> {
  busy.value = true
  try {
    const result = (await notificationsApi.assistant.bindings.check()).data
    toast.success(`已检查 ${result.checked} 条绑定，${result.invalidated} 条失效`)
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function syncTargets(): Promise<void> {
  busy.value = true
  try {
    targets.value = (await notificationsApi.assistant.targets.sync()).data
    toast.success('群目标已同步')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function updateTarget(target: AssistantTargetDto, input: { internalOnly?: boolean, enabled?: boolean }): Promise<void> {
  busy.value = true
  try {
    const updated = (await notificationsApi.assistant.targets.update(target.id, input)).data
    targets.value = targets.value.map(item => item.id === updated.id ? updated : item)
    toast.success('群目标已更新')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <FaAlert v-if="error !== null" variant="destructive" :title="error">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="loadAll">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div v-else-if="loading" class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
      正在加载千树小助理配置…
    </div>

    <template v-else>
      <section class="p-4 border border-border rounded-lg bg-background">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h3 class="qs-type-body-medium m-0">
              渠道
            </h3>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              {{ channel?.tokenConfigured ? 'Token 已配置' : 'Token 未配置，无法发送' }} · 关闭后所有站外交付停止派发
            </p>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <FaSwitch v-model="channelEnabled" :disabled="!canUpdateChannel || busy" />
            <FaButton size="sm" :disabled="!canUpdateChannel || busy" @click="saveChannel">
              保存
            </FaButton>
            <FaButton variant="outline" size="sm" :disabled="!canUpdateChannel || busy" @click="testChannel">
              测试发送
            </FaButton>
          </div>
        </div>
      </section>

      <section class="p-4 border border-border rounded-lg bg-background">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h3 class="qs-type-body-medium m-0">
              公司号
            </h3>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              节点登录、掉线与重连都在 GeWe 控制台完成；这里只导入 appId 与 wxid，并检查在线状态。
            </p>
          </div>
          <FaButton size="sm" :disabled="!canOperateAccount || busy" @click="openCreateAccount">
            导入公司号
          </FaButton>
        </div>

        <div v-if="accounts.length === 0" class="qs-type-meta text-muted-foreground mt-4">
          还没有公司号。先在 GeWe 控制台确认节点在线，再点击「导入公司号」。
        </div>
        <div v-else class="mt-4 gap-3 grid lg:grid-cols-2">
          <div v-for="account in accounts" :key="account.id" class="p-3 border border-border rounded-lg">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <div>
                <p class="qs-type-body-medium m-0">
                  {{ account.name }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0">
                  {{ account.nickname ?? account.name }} · {{ account.appId }}
                </p>
              </div>
              <FaTag variant="outline" :class="statusClass(account.status)">
                {{ statusLabel(account.status) }}
              </FaTag>
            </div>
            <div class="mt-2 flex flex-wrap gap-3 items-center justify-between">
              <p class="qs-type-meta text-muted-foreground m-0">
                最后在线：{{ formatDate(account.lastOnlineAt) }}
              </p>
              <label v-if="!isPendingAccount(account)" class="qs-type-meta flex gap-2 items-center">
                <FaSwitch
                  :model-value="account.enabled"
                  :disabled="!canOperateAccount || busy"
                  @update:model-value="setAccountEnabled(account, Boolean($event))"
                />
                启用派发
              </label>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <FaButton variant="outline" size="sm" :disabled="!canOperateAccount || busy" @click="openUpdateAccount(account)">
                更新节点
              </FaButton>
              <FaButton
                v-if="!isPendingAccount(account)"
                variant="outline"
                size="sm"
                :disabled="!canOperateAccount || busy"
                @click="checkAccountStatus(account)"
              >
                检查状态
              </FaButton>
              <FaButton
                v-if="!isPendingAccount(account)"
                variant="outline"
                size="sm"
                :disabled="!canOperateAccount || busy"
                @click="showOwnQr(account)"
              >
                个人二维码
              </FaButton>
            </div>
          </div>
        </div>
      </section>

      <section class="p-4 border border-border rounded-lg bg-background">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h3 class="qs-type-body-medium m-0">
              员工绑定
            </h3>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              绑定完全由管理员维护；只有已验证绑定能接收金额与客户名称。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaButton size="sm" :disabled="!canManageBinding || busy" @click="openBinding">
              新增绑定
            </FaButton>
            <FaButton variant="outline" size="sm" :disabled="!canManageBinding || busy" @click="checkBindings">
              好友巡检
            </FaButton>
          </div>
        </div>

        <QsGenericTable
          class="mt-4"
          :columns="bindingColumns"
          :data="bindings"
          :addable="false"
          :show-pagination="false"
          row-key="id"
          data-testid="assistant-binding-table"
        >
          <template #cell-status="{ row }">
            <FaTag variant="outline" :class="statusClass(row.original.status)">
              {{ statusLabel(row.original.status) }}
            </FaTag>
          </template>
          <template #cell-verifiedAt="{ row }">
            {{ formatDate(row.original.verifiedAt) }}
          </template>
          <template #actions="{ row }">
            <div class="flex flex-wrap gap-2">
              <FaButton size="sm" :disabled="!canManageBinding || busy" @click="verifyBinding(row)">
                发送测试
              </FaButton>
              <FaButton variant="outline" size="sm" :disabled="!canManageBinding || busy" @click="revokeBinding(row)">
                停用
              </FaButton>
            </div>
          </template>
        </QsGenericTable>
      </section>

      <section class="p-4 border border-border rounded-lg bg-background">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h3 class="qs-type-body-medium m-0">
              群目标
            </h3>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              敏感内容只能发到「仅内部成员」的群；同步只包含已保存到通讯录的群。
            </p>
          </div>
          <FaButton variant="outline" size="sm" :disabled="!canManageTarget || busy" @click="syncTargets">
            同步群
          </FaButton>
        </div>

        <div v-if="targets.length === 0" class="qs-type-meta text-muted-foreground mt-4">
          还没有群目标。先同步群，再标记用途与内部群。
        </div>
        <div v-else class="mt-4 flex flex-col gap-2">
          <div v-for="target in targets" :key="target.id" class="p-3 border border-border rounded-lg flex flex-wrap gap-3 items-center justify-between">
            <div>
              <p class="qs-type-body-medium m-0">
                {{ target.name }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ target.key }} · {{ target.chatroomId }}
              </p>
            </div>
            <div class="flex flex-wrap gap-4 items-center">
              <label class="qs-type-meta flex gap-2 items-center">
                <FaSwitch
                  :model-value="target.internalOnly"
                  :disabled="!canManageTarget || busy"
                  @update:model-value="updateTarget(target, { internalOnly: Boolean($event) })"
                />
                仅内部成员
              </label>
              <label class="qs-type-meta flex gap-2 items-center">
                <FaSwitch
                  :model-value="target.enabled"
                  :disabled="!canManageTarget || busy"
                  @update:model-value="updateTarget(target, { enabled: Boolean($event) })"
                />
                启用
              </label>
            </div>
          </div>
        </div>
      </section>
    </template>

    <QsGenericModal
      v-model="accountDialogOpen"
      :title="accountDialogTitle"
      size="md"
      :submitting="busy"
      @update:model-value="accountDialogOpen = $event"
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">备注名</span>
          <FaInput v-model="accountDraft.name" placeholder="公司号-01" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">appId</span>
          <FaInput v-model="accountDraft.appId" :placeholder="appIdPlaceholder" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">wxid</span>
          <FaInput v-model="accountDraft.wxid" :placeholder="wxidPlaceholder" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">微信昵称（可选）</span>
          <FaInput v-model="accountDraft.nickname" placeholder="千树小助理" />
        </label>
        <p class="qs-type-meta text-muted-foreground">
          {{ accountDialogDescription }}
        </p>
        <p class="qs-type-meta text-muted-foreground">
          不要在系统里下线或退出节点；控制台负责登录与重连。
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="accountDialogOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="!canSubmitAccount" @click="submitAccount">
          {{ accountDialogMode === 'create' ? '导入' : '保存' }}
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="ownQrOpen" title="公司号个人二维码" size="md" @update:model-value="ownQrOpen = $event">
      <div class="flex flex-col gap-3 items-center">
        <img v-if="ownQrImage" :src="ownQrImage" alt="公司号个人二维码" class="border border-border rounded-lg size-64 object-contain">
        <p class="qs-type-meta text-muted-foreground text-center">
          员工先扫码添加公司号为好友，管理员同意后再创建绑定。
        </p>
      </div>
    </QsGenericModal>

    <QsGenericModal v-model="bindingOpen" title="新增员工绑定" size="lg" :submitting="busy" @update:model-value="bindingOpen = $event">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">员工</span>
          <FaSelect v-model="bindingUserId" :options="userOptions" placeholder="选择员工" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">公司号好友</span>
          <FaSelect v-model="bindingContactWxid" :options="contactOptions" placeholder="从公司号好友列表选择" />
        </label>
        <p class="qs-type-meta text-muted-foreground">
          创建后点「发送测试」，员工确认收到后再视为已验证。绑定错人会导致敏感内容发错对象。
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="bindingOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="bindingUserId === undefined || bindingContactWxid === undefined" @click="createBinding">
          创建绑定
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
