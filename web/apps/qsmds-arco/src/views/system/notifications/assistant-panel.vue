<script setup lang="ts">
import type { AssistantAccountDto, AssistantBindingDto, AssistantChannelDto, AssistantContactDto, AssistantTargetDto, UserDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { getApiClientErrorMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useAppAuth } from '@/composables/app/auth'

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

const createAccountOpen = ref(false)
const accountDraft = ref({ name: '', regionId: '320000' })
const qrOpen = ref(false)
const qrImage = ref('')
const qrStatus = ref('正在获取二维码…')
const qrAccountId = ref<string | null>(null)
const qrUuid = ref<string | null>(null)
const ownQrOpen = ref(false)
const ownQrImage = ref('')
const bindingOpen = ref(false)
const bindingUserId = ref<string | undefined>(undefined)
const bindingContactWxid = ref<string | undefined>(undefined)

let qrTimer: ReturnType<typeof setInterval> | null = null

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
  REQUIRES_LOGIN: '需要登录',
  DISABLED: '已停用',
  ACTIVE: '有效',
  INVALID: '已失效',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
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

async function createAccount(): Promise<void> {
  busy.value = true
  try {
    await notificationsApi.assistant.accounts.create({
      name: accountDraft.value.name,
      regionId: accountDraft.value.regionId,
    })
    createAccountOpen.value = false
    accountDraft.value = { name: '', regionId: '320000' }
    toast.success('公司号已创建，请扫码登录')
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

function stopQrPolling(): void {
  if (qrTimer !== null) {
    clearInterval(qrTimer)
    qrTimer = null
  }
}

async function pollQr(): Promise<void> {
  if (qrAccountId.value === null || qrUuid.value === null) {
    return
  }
  try {
    const result = (await notificationsApi.assistant.accounts.loginStatus(
      qrAccountId.value,
      qrUuid.value,
      new AbortController().signal,
    )).data
    qrStatus.value = result.status === 'WAITING'
      ? '等待扫码'
      : result.status === 'SCANNED'
        ? '已扫码，请在手机上确认'
        : result.status === 'EXPIRED'
          ? '二维码已过期，请重新获取'
          : '登录成功'
    if (result.status === 'ONLINE') {
      stopQrPolling()
      qrOpen.value = false
      toast.success('公司号登录成功')
      await loadAll()
    }
    if (result.status === 'EXPIRED') {
      stopQrPolling()
    }
  }
  catch (failure) {
    stopQrPolling()
    qrStatus.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
}

async function startLogin(account: AssistantAccountDto): Promise<void> {
  busy.value = true
  try {
    const result = (await notificationsApi.assistant.accounts.loginStart(account.id)).data
    qrAccountId.value = account.id
    qrUuid.value = result.uuid
    qrImage.value = result.qrImgBase64
    qrStatus.value = '等待扫码'
    qrOpen.value = true
    stopQrPolling()
    qrTimer = setInterval(() => {
      void pollQr()
    }, 5_000)
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function reconnect(account: AssistantAccountDto): Promise<void> {
  busy.value = true
  try {
    await notificationsApi.assistant.accounts.reconnect(account.id)
    toast.success('重连请求已提交')
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

async function logout(account: AssistantAccountDto): Promise<void> {
  busy.value = true
  try {
    await notificationsApi.assistant.accounts.logout(account.id)
    toast.success('公司号已退出')
    await loadAll()
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
    ownQrImage.value = (await notificationsApi.assistant.accounts.qrcode(
      account.id,
      new AbortController().signal,
    )).data.qrCodeBase64
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

onBeforeUnmount(() => {
  stopQrPolling()
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
              扫码登录由持有公司手机的管理员完成；掉线后优先重连，失败再重新扫码。
            </p>
          </div>
          <FaButton size="sm" :disabled="!canOperateAccount || busy" @click="createAccountOpen = true">
            新增公司号
          </FaButton>
        </div>

        <div v-if="accounts.length === 0" class="qs-type-meta text-muted-foreground mt-4">
          还没有公司号。先新增，再扫码登录。
        </div>
        <div v-else class="mt-4 gap-3 grid lg:grid-cols-2">
          <div v-for="account in accounts" :key="account.id" class="p-3 border border-border rounded-lg">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <div>
                <p class="qs-type-body-medium m-0">
                  {{ account.name }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0">
                  {{ account.nickname ?? '未登录' }} · {{ account.appId }}
                </p>
              </div>
              <FaTag variant="outline" :class="statusClass(account.status)">
                {{ statusLabel(account.status) }}
              </FaTag>
            </div>
            <p class="qs-type-meta text-muted-foreground mt-2">
              最后在线：{{ formatDate(account.lastOnlineAt) }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <FaButton size="sm" :disabled="!canOperateAccount || busy" @click="startLogin(account)">
                扫码登录
              </FaButton>
              <FaButton variant="outline" size="sm" :disabled="!canOperateAccount || busy" @click="reconnect(account)">
                重连
              </FaButton>
              <FaButton variant="outline" size="sm" :disabled="!canOperateAccount || busy" @click="logout(account)">
                退出
              </FaButton>
              <FaButton variant="outline" size="sm" :disabled="!canOperateAccount || busy" @click="showOwnQr(account)">
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

    <QsGenericModal v-model="createAccountOpen" title="新增公司号" size="md" :submitting="busy" @update:model-value="createAccountOpen = $event">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">备注名</span>
          <FaInput v-model="accountDraft.name" placeholder="公司号-01" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">登录区域</span>
          <FaInput v-model="accountDraft.regionId" placeholder="320000" />
        </label>
        <p class="qs-type-meta text-muted-foreground">
          创建后点「扫码登录」，由持有公司手机的管理员扫码确认。
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="createAccountOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="accountDraft.name.trim().length === 0" @click="createAccount">
          创建
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      v-model="qrOpen"
      title="扫码登录公司号"
      size="md"
      @update:model-value="(value) => { qrOpen = value; if (!value) stopQrPolling() }"
    >
      <div class="flex flex-col gap-3 items-center">
        <img v-if="qrImage" :src="qrImage" alt="微信登录二维码" class="border border-border rounded-lg size-64 object-contain">
        <p class="qs-type-body m-0">
          {{ qrStatus }}
        </p>
        <p class="qs-type-meta text-muted-foreground text-center">
          用公司手机微信扫码并在手机上确认；二维码有效期约 150 秒，过期后重新扫码。
        </p>
      </div>
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
