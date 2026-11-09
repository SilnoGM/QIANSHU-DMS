<script setup lang="ts">
import type { AssistantAccountDto, AssistantBindingDto, AssistantContactDto, AssistantTargetDto, AssistantTargetMemberDto, UserDto } from '@/api/generated/types.gen'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'

import { computed, onMounted, ref } from 'vue'

import { getApiClientErrorMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { qrImageSrc } from './qr-image'

const toast = useQsToast()
const { auth } = useAppAuth()

const canUpdateChannel = computed(() => auth('assistant-channel:update'))
const canOperateAccount = computed(() => auth('assistant-account:operate'))
const canManageBinding = computed(() => auth('assistant-binding:manage'))
const canReadTarget = computed(() => auth('assistant-target:read'))
const canManageTarget = computed(() => auth('assistant-target:manage'))

const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)
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
const reassignOpen = ref(false)
const reassignSourceBinding = ref<AssistantBindingDto | null>(null)
const reassignUserId = ref<string | undefined>(undefined)
const verifyOpen = ref(false)
const verifyTarget = ref<AssistantBindingDto | null>(null)
const verifyContent = ref('')
const verifyError = ref<string | null>(null)
const verifySubmitting = ref(false)
const VERIFY_CONTENT_LIMIT = 500
const canSubmitVerify = computed(() => !verifySubmitting.value
  && verifyContent.value.trim().length > 0
  && verifyContent.value.length <= VERIFY_CONTENT_LIMIT)
const verifyRecipientLabel = computed(() => {
  const binding = verifyTarget.value
  if (binding === null) {
    return '—'
  }
  const nickname = binding.wechatNickname?.trim()
  return nickname === undefined || nickname.length === 0
    ? binding.userName
    : `${binding.userName}（微信昵称：${nickname}）`
})
const targetEditOpen = ref(false)
const targetEditId = ref<string | null>(null)
const targetDraft = ref({ key: '', name: '', purpose: '' })
type TargetFilter = 'all' | 'disabled' | 'external' | 'internal'
const targetFilter = ref<TargetFilter>('all')
const targetMemberCache = new Map<string, AssistantTargetMemberDto[]>()
const flippedTargetId = ref<string | null>(null)
const flippedMembers = ref<AssistantTargetMemberDto[]>([])
const flippedMembersLoading = ref(false)
const flippedMembersError = ref<string | null>(null)
const memberDetailOpen = ref(false)
const memberDetail = ref<AssistantTargetMemberDto | null>(null)
const groupMembersOpen = ref(false)
const groupMembersTarget = ref<AssistantTargetDto | null>(null)
const groupMembers = ref<AssistantTargetMemberDto[]>([])
const groupMembersLoading = ref(false)
const groupMembersError = ref<string | null>(null)
const groupMemberKeyword = ref('')

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

const targetInternalCount = computed(() => targets.value.filter(target => target.internalOnly).length)
const editingTarget = computed(() => targets.value.find(target => target.id === targetEditId.value) ?? null)
const targetFilterItems = computed(() => [
  { value: 'all', label: '全部', count: targets.value.length },
  { value: 'internal', label: '仅内部', count: targetInternalCount.value },
  { value: 'external', label: '非内部', count: targets.value.length - targetInternalCount.value },
  { value: 'disabled', label: '已停用', count: targets.value.filter(target => !target.enabled).length },
])
const filteredTargets = computed(() => {
  return targets.value.filter((target) => {
    if (targetFilter.value === 'internal' && !target.internalOnly) {
      return false
    }
    if (targetFilter.value === 'external' && target.internalOnly) {
      return false
    }
    if (targetFilter.value === 'disabled' && target.enabled) {
      return false
    }
    return true
  })
})
const filteredGroupMembers = computed(() => {
  const keyword = groupMemberKeyword.value.trim().toLowerCase()
  if (keyword.length === 0) {
    return groupMembers.value
  }
  return groupMembers.value.filter(member => [member.displayName ?? '', member.nickname ?? '', member.wxid]
    .some(value => value.toLowerCase().includes(keyword)))
})

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

function isOnlineStatus(status: string): boolean {
  return status === 'ONLINE' || status === 'ACTIVE'
}

function statusDotClass(status: string): string {
  if (isOnlineStatus(status)) {
    return 'bg-emerald-500'
  }
  if (status === 'OFFLINE' || status === 'DISABLED') {
    return 'bg-red-500'
  }
  if (status === 'REQUIRES_LOGIN' || status === 'INVALID') {
    return 'bg-amber-500'
  }
  return 'bg-slate-400'
}

function isPendingAccount(account: AssistantAccountDto): boolean {
  return account.appId.startsWith('pending-') || account.status === 'REQUIRES_LOGIN'
}

function verifyButtonClass(status: string): string {
  return status === 'DISABLED'
    ? 'text-destructive border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
    : 'text-primary border-primary/20 bg-primary/5 hover:bg-primary/10'
}

function accountMenuItems(account: AssistantAccountDto): ActionMenuItem[][] {
  return [[
    {
      disabled: isPendingAccount(account) || !canUpdateChannel.value || busy.value,
      handle: () => void testChannel(),
      label: '发送测试',
    },
    {
      disabled: !canOperateAccount.value || busy.value,
      handle: () => openUpdateAccount(account),
      label: '更新节点',
    },
  ]]
}

const userOptions = computed(() => users.value.map(user => ({ label: `${user.displayName}（${user.username}）`, value: user.id })))
const contactOptions = computed(() => contacts.value.map(contact => ({
  label: contact.remark ?? contact.nickname ?? contact.wxid,
  value: contact.wxid,
})))

function bindingMenuItems(binding: AssistantBindingDto): ActionMenuItem[][] {
  return [[
    {
      disabled: !canManageBinding.value || busy.value,
      handle: () => void openReassign(binding),
      label: '改绑',
    },
    {
      disabled: !canManageBinding.value || busy.value,
      handle: () => void revokeBinding(binding),
      label: '停用',
      variant: 'destructive',
    },
  ]]
}

function targetMenuItems(target: AssistantTargetDto): ActionMenuItem[][] {
  return [[
    {
      disabled: !canReadTarget.value || busy.value,
      handle: () => toggleTargetFlip(target),
      label: '查看成员',
    },
    {
      disabled: !canReadTarget.value || busy.value,
      handle: () => openGroupMembers(target),
      label: '查看群组',
    },
    {
      disabled: !canManageTarget.value || busy.value,
      handle: () => openTargetEdit(target),
      label: '编辑信息',
    },
  ]]
}

function targetStatusDotClass(enabled: boolean): string {
  return enabled ? 'bg-emerald-500' : 'bg-red-500'
}

function targetScopeClass(internalOnly: boolean): string {
  return internalOnly
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function memberDisplayName(member: AssistantTargetMemberDto): string {
  return member.displayName?.trim() || member.nickname?.trim() || member.wxid
}

function memberRoleLabel(role: string): string {
  if (role === 'OWNER') {
    return '群主'
  }
  if (role === 'ADMIN') {
    return '管理员'
  }
  return '成员'
}

function memberRoleClass(role: string): string {
  if (role === 'OWNER') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (role === 'ADMIN') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'border-border bg-muted text-muted-foreground'
}

async function requestTargetMembers(target: AssistantTargetDto): Promise<AssistantTargetMemberDto[]> {
  const cached = targetMemberCache.get(target.id)
  if (cached !== undefined) {
    return cached
  }
  const members = (await notificationsApi.assistant.targets.members(target.id, new AbortController().signal)).data
  targetMemberCache.set(target.id, members)
  return members
}

async function loadFlippedMembers(target: AssistantTargetDto): Promise<void> {
  flippedMembersError.value = null
  flippedMembersLoading.value = true
  try {
    const members = await requestTargetMembers(target)
    if (flippedTargetId.value !== target.id) {
      return
    }
    flippedMembers.value = members
  }
  catch (failure) {
    if (flippedTargetId.value !== target.id) {
      return
    }
    flippedMembersError.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    if (flippedTargetId.value === target.id) {
      flippedMembersLoading.value = false
    }
  }
}

function toggleTargetFlip(target: AssistantTargetDto): void {
  if (flippedTargetId.value === target.id) {
    closeTargetFlip()
    return
  }
  flippedTargetId.value = target.id
  flippedMembers.value = []
  flippedMembersError.value = null
  void loadFlippedMembers(target)
}

function closeTargetFlip(): void {
  flippedTargetId.value = null
  flippedMembers.value = []
  flippedMembersError.value = null
  flippedMembersLoading.value = false
}

function openMemberDetail(member: AssistantTargetMemberDto): void {
  memberDetail.value = member
  memberDetailOpen.value = true
}

async function loadGroupMembers(target: AssistantTargetDto): Promise<void> {
  groupMembersError.value = null
  groupMembersLoading.value = true
  try {
    const members = await requestTargetMembers(target)
    if (groupMembersTarget.value?.id !== target.id) {
      return
    }
    groupMembers.value = members
  }
  catch (failure) {
    if (groupMembersTarget.value?.id !== target.id) {
      return
    }
    groupMembersError.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    if (groupMembersTarget.value?.id === target.id) {
      groupMembersLoading.value = false
    }
  }
}

function openGroupMembers(target: AssistantTargetDto): void {
  groupMembersTarget.value = target
  groupMembers.value = []
  groupMembersError.value = null
  groupMemberKeyword.value = ''
  groupMembersOpen.value = true
  void loadGroupMembers(target)
}

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const signal = new AbortController().signal
    const [accountResult, bindingResult, targetResult] = await Promise.all([
      notificationsApi.assistant.accounts.list(signal),
      notificationsApi.assistant.bindings.list({ page: 1, pageSize: 50 }, signal),
      notificationsApi.assistant.targets.list(signal),
    ])
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

async function openReassign(binding: AssistantBindingDto): Promise<void> {
  reassignSourceBinding.value = binding
  reassignUserId.value = undefined
  reassignOpen.value = true
  if (users.value.length > 0) {
    return
  }
  try {
    users.value = (await managementApi.users.list(
      { page: 1, pageSize: 100, status: 'ACTIVE' },
      new AbortController().signal,
    )).data.items
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

async function submitReassign(): Promise<void> {
  if (reassignSourceBinding.value === null || reassignUserId.value === undefined) {
    toast.warning('请选择要改绑的员工')
    return
  }
  busy.value = true
  try {
    await notificationsApi.assistant.bindings.reassign(reassignSourceBinding.value.id, {
      userId: reassignUserId.value,
    })
    reassignOpen.value = false
    toast.success('绑定已改绑，请重新发送测试消息完成验证')
    await loadAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

function randomVerifyToken(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 8)
  }
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomVerifyContent(): string {
  return `【千树小助理】测试消息 ${randomVerifyToken()}，请确认收到。`
}

function openVerify(binding: AssistantBindingDto): void {
  verifyTarget.value = binding
  verifyContent.value = randomVerifyContent()
  verifyError.value = null
  verifyOpen.value = true
}

function regenerateVerifyContent(): void {
  verifyContent.value = randomVerifyContent()
}

async function submitVerify(): Promise<void> {
  const binding = verifyTarget.value
  const content = verifyContent.value.trim()
  if (binding === null || content.length === 0) {
    verifyError.value = '测试内容不能为空'
    return
  }
  if (content.length > VERIFY_CONTENT_LIMIT) {
    verifyError.value = `测试内容不能超过 ${VERIFY_CONTENT_LIMIT} 个字符`
    return
  }
  verifySubmitting.value = true
  verifyError.value = null
  try {
    await notificationsApi.assistant.bindings.verify(binding.id, { content })
    // 先释放提交态再关闭；QsGenericModal 在提交期会拒绝受控关闭。
    verifySubmitting.value = false
    verifyOpen.value = false
    toast.success('测试消息已发送，并已标记为已验证')
    await loadAll()
  }
  catch (failure) {
    verifyError.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    verifySubmitting.value = false
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
    toast.success(`已检查 ${result.checked} 条绑定，已同步微信资料，${result.invalidated} 条失效`)
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

function openTargetEdit(target: AssistantTargetDto): void {
  targetEditId.value = target.id
  targetDraft.value = {
    key: target.key,
    name: target.name,
    purpose: target.purpose ?? '',
  }
  targetEditOpen.value = true
}

async function saveTargetEdit(): Promise<void> {
  if (targetEditId.value === null) {
    return
  }
  const key = targetDraft.value.key.trim()
  const name = targetDraft.value.name.trim()
  if (key.length === 0 || name.length === 0) {
    toast.warning('请填写群目标 key 与名称')
    return
  }
  busy.value = true
  try {
    const updated = (await notificationsApi.assistant.targets.update(targetEditId.value, {
      key,
      name,
      purpose: targetDraft.value.purpose.trim() || null,
    })).data
    targets.value = targets.value.map(item => item.id === updated.id ? updated : item)
    targetEditOpen.value = false
    toast.success('群目标已更新')
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
  <div class="flex flex-col">
    <FaPageMain v-if="error !== null">
      <FaAlert variant="destructive" :title="error">
        <template #actions>
          <FaButton variant="outline" size="sm" @click="loadAll">
            重试
          </FaButton>
        </template>
      </FaAlert>
    </FaPageMain>

    <FaPageMain v-else-if="loading">
      <div class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
        正在加载千树小助理配置…
      </div>
    </FaPageMain>

    <template v-else>
      <FaPageMain class="mb-2! mt-2!">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2 class="qs-type-section-title m-0">
              微信节点
            </h2>
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
          <div v-for="account in accounts" :key="account.id" class="p-4 border border-border rounded-lg overflow-hidden">
            <div class="flex gap-3 items-start">
              <span class="shrink-0 relative">
                <FaAvatar
                  :src="account.avatarUrl ?? ''"
                  :fallback="account.nickname?.trim() || account.name"
                  class="text-lg text-muted-foreground font-medium border border-border rounded-lg bg-muted size-16"
                />
                <span
                  class="border-2 border-background rounded-full size-3.5 absolute -bottom-0.5 -right-0.5"
                  :class="statusDotClass(account.status)"
                  :title="`节点状态：${statusLabel(account.status)}`"
                  :aria-label="`节点状态：${statusLabel(account.status)}`"
                  role="img"
                >
                  <span
                    v-if="isOnlineStatus(account.status)"
                    class="rounded-full bg-emerald-400 opacity-40 inset-0 absolute animate-ping"
                  />
                </span>
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap gap-2 items-start justify-between">
                  <div class="min-w-0">
                    <div class="flex gap-1 min-w-0 items-center">
                      <p class="qs-type-body-medium m-0 flex-1 min-w-0 truncate">
                        {{ account.name }}
                      </p>
                      <FaButton
                        v-if="!isPendingAccount(account)"
                        variant="ghost"
                        size="icon-sm"
                        class="shrink-0"
                        :aria-label="`查看 ${account.name} 的个人二维码`"
                        @click="showOwnQr(account)"
                      >
                        <FaIcon name="i-lucide:qr-code" class="size-4" aria-hidden="true" />
                      </FaButton>
                    </div>
                    <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                      微信昵称：{{ account.nickname?.trim() || '未同步' }}
                    </p>
                  </div>
                  <div v-if="!isPendingAccount(account)" class="flex shrink-0 gap-2 items-center">
                    <span class="qs-type-meta text-muted-foreground">启用派发</span>
                    <FaSwitch
                      :model-value="account.enabled"
                      :disabled="!canOperateAccount || busy"
                      @update:model-value="setAccountEnabled(account, Boolean($event))"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-3 px-4 py-2 bg-slate-50/70 flex flex-wrap gap-2 items-center justify-between -mx-4 -mb-4 dark:bg-slate-900/40">
              <p class="qs-type-meta text-muted-foreground m-0">
                最后在线：{{ formatDate(account.lastOnlineAt) }}
              </p>
              <div class="flex flex-wrap gap-2 items-center">
                <FaButton
                  v-if="!isPendingAccount(account)"
                  variant="outline"
                  size="sm"
                  class="text-xs! font-normal! px-2! h-7!"
                  :disabled="!canOperateAccount || busy"
                  @click="checkAccountStatus(account)"
                >
                  <FaIcon name="i-lucide:refresh-cw" class="size-3.5" aria-hidden="true" />
                  检查状态
                </FaButton>
                <FaDropdown :items="accountMenuItems(account)" align="end">
                  <FaButton variant="outline" size="sm" class="text-xs! font-normal! px-2! h-7!" :disabled="busy">
                    更多操作
                    <FaIcon name="i-lucide:chevron-down" class="size-3.5" aria-hidden="true" />
                  </FaButton>
                </FaDropdown>
              </div>
            </div>
          </div>
        </div>
      </FaPageMain>

      <FaPageMain class="my-2!">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2 class="qs-type-section-title m-0">
              用户微信绑定
            </h2>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              绑定完全由管理员维护；只有已验证绑定能接收金额与客户名称。好友巡检会同步微信昵称与头像。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaButton
              size="sm"
              class="text-white bg-amber-500 hover:bg-amber-600"
              :disabled="!canManageBinding || busy"
              @click="checkBindings"
            >
              好友巡检
            </FaButton>
            <FaButton size="sm" :disabled="!canManageBinding || busy" @click="openBinding">
              新增绑定
            </FaButton>
          </div>
        </div>

        <div v-if="bindings.length === 0" class="qs-type-meta text-muted-foreground mt-4">
          暂无用户微信绑定。
        </div>
        <div
          v-else
          class="mt-4 gap-3 grid grid-cols-1 2xl:grid-cols-6 lg:grid-cols-4 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-5"
          data-testid="assistant-binding-grid"
        >
          <div v-for="binding in bindings" :key="binding.id" class="p-3 border border-border rounded-lg bg-background flex flex-col gap-3 min-w-0 overflow-hidden">
            <div class="flex gap-2.5 items-start">
              <span class="shrink-0 relative">
                <FaAvatar
                  :src="binding.wechatAvatarUrl ?? ''"
                  :fallback="binding.wechatNickname?.trim() || binding.userName"
                  class="text-sm text-muted-foreground font-medium border border-border rounded-lg bg-muted size-10"
                />
                <span
                  class="border-2 border-background rounded-full size-3 absolute -bottom-0.5 -right-0.5"
                  :class="statusDotClass(binding.status)"
                  :title="`绑定状态：${statusLabel(binding.status)}`"
                  :aria-label="`绑定状态：${statusLabel(binding.status)}`"
                  role="img"
                />
              </span>
              <div class="flex-1 min-w-0">
                <p class="qs-type-body-medium m-0 min-w-0 truncate" :title="binding.userName">
                  {{ binding.userName }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-0.5 truncate" :title="binding.wechatNickname ?? ''">
                  昵称：{{ binding.wechatNickname?.trim() || '未同步' }}
                </p>
              </div>
            </div>

            <div class="px-2.5 py-1 rounded-md bg-slate-50 flex gap-1.5 min-w-0 items-center dark:bg-slate-900/40">
              <span class="text-xs text-slate-500 font-mono flex-1 min-w-0 truncate dark:text-slate-400" :title="binding.wxid">
                {{ binding.wxid }}
              </span>
              <CopyCellButton :text="binding.wxid" label="微信wxid" always-visible />
            </div>

            <dl class="m-0 flex flex-col gap-1">
              <div class="text-xs leading-4 flex gap-2 min-w-0 items-center justify-between">
                <dt class="text-slate-400 shrink-0">
                  所属节点
                </dt>
                <dd class="text-slate-600 m-0 text-right min-w-0 truncate dark:text-slate-300" :title="binding.accountName">
                  {{ binding.accountName }}
                </dd>
              </div>
              <div class="text-xs leading-4 flex gap-2 min-w-0 items-center justify-between">
                <dt class="text-slate-400 shrink-0">
                  验证时间
                </dt>
                <dd class="text-slate-600 m-0 dark:text-slate-300">
                  {{ formatDate(binding.verifiedAt) }}
                </dd>
              </div>
            </dl>

            <div class="mt-auto px-3 py-2 bg-slate-50/70 flex gap-2 items-center -mx-3 -mb-3 dark:bg-slate-900/40">
              <FaButton
                variant="outline"
                size="sm"
                class="flex-1 text-xs! font-normal!"
                :class="verifyButtonClass(binding.status)"
                :disabled="!canManageBinding || busy"
                @click="openVerify(binding)"
              >
                发送测试
              </FaButton>
              <FaDropdown :items="bindingMenuItems(binding)" align="end">
                <FaButton variant="outline" size="sm" class="text-xs! text-slate-600! font-normal! dark:text-slate-300!" :disabled="busy">
                  更多
                  <FaIcon name="i-lucide:chevron-down" class="size-3.5" aria-hidden="true" />
                </FaButton>
              </FaDropdown>
            </div>
          </div>
        </div>
      </FaPageMain>

      <FaPageMain class="my-2!">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2 class="qs-type-section-title m-0">
              群管理
            </h2>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              敏感内容只能发到「仅内部成员」的群；同步只包含已保存到通讯录的群。
            </p>
          </div>
          <FaButton size="sm" :disabled="!canManageTarget || busy" @click="syncTargets">
            同步群组
          </FaButton>
        </div>

        <div v-if="targets.length === 0" class="qs-type-meta text-muted-foreground mt-4">
          还没有群目标。先同步群组，再标记用途与内部群。
        </div>
        <div v-else class="mt-4 flex flex-col gap-3">
          <QsStatusSwitchToolbar
            :model-value="targetFilter"
            :items="targetFilterItems"
            aria-label="群目标筛选"
            stretch
            @update:model-value="targetFilter = $event as TargetFilter"
          />

          <div v-if="filteredTargets.length === 0" class="qs-type-meta text-muted-foreground">
            没有匹配的群目标。
          </div>
          <div
            v-else
            class="gap-3 grid grid-cols-1 2xl:grid-cols-4 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="assistant-target-grid"
          >
            <div
              v-for="target in filteredTargets"
              :key="target.id"
              class="min-w-0 [perspective:1200px]"
            >
              <div
                class="transition-transform duration-500 ease-out [transform-style:preserve-3d] relative motion-reduce:transition-none"
                :class="flippedTargetId === target.id ? '[transform:rotateY(180deg)]' : ''"
              >
                <div
                  class="p-3 border border-border rounded-lg bg-background flex flex-col gap-3 min-w-0 [backface-visibility:hidden] overflow-hidden"
                  :class="flippedTargetId === target.id ? 'pointer-events-none' : ''"
                  :aria-hidden="flippedTargetId === target.id ? 'true' : undefined"
                  :inert="flippedTargetId === target.id ? true : undefined"
                >
                  <div class="flex gap-2.5 items-start">
                    <span class="shrink-0 relative">
                      <FaAvatar
                        :src="target.avatarUrl ?? ''"
                        :fallback="target.name"
                        class="text-sm text-muted-foreground font-medium border border-border rounded-lg bg-muted size-10"
                      />
                      <span
                        class="border-2 border-background rounded-full size-3 absolute -bottom-0.5 -right-0.5"
                        :class="targetStatusDotClass(target.enabled)"
                        :title="`群状态：${target.enabled ? '已启用' : '已停用'}`"
                        :aria-label="`群状态：${target.enabled ? '已启用' : '已停用'}`"
                        role="img"
                      />
                    </span>
                    <div class="flex-1 min-w-0">
                      <div class="flex gap-2 items-start justify-between">
                        <p class="qs-type-body-medium m-0 min-w-0 truncate" :title="target.name">
                          {{ target.name }}
                        </p>
                        <FaTag variant="outline" class="shrink-0" :class="targetScopeClass(target.internalOnly)">
                          {{ target.internalOnly ? '仅内部' : '非内部' }}
                        </FaTag>
                      </div>
                      <p class="qs-type-meta text-muted-foreground m-0 mt-0.5 truncate" :title="target.purpose ?? ''">
                        用途：{{ target.purpose?.trim() || '未设置用途' }}
                      </p>
                    </div>
                  </div>

                  <div class="px-2.5 py-1 rounded-md bg-slate-50 flex gap-1.5 min-w-0 items-center dark:bg-slate-900/40">
                    <span class="text-xs text-slate-500 font-mono flex-1 min-w-0 truncate dark:text-slate-400" :title="target.chatroomId">
                      {{ target.chatroomId }}
                    </span>
                    <CopyCellButton :text="target.chatroomId" label="群 chatroomId" always-visible />
                  </div>

                  <dl class="m-0 flex flex-col gap-1">
                    <div class="text-xs leading-4 flex gap-2 min-w-0 items-center justify-between">
                      <dt class="text-slate-400 shrink-0">
                        语义 key
                      </dt>
                      <dd class="text-slate-600 m-0 min-w-0 truncate dark:text-slate-300" :title="target.key">
                        {{ target.key }}
                      </dd>
                    </div>
                    <div v-if="target.memberCount !== null" class="text-xs leading-4 flex gap-2 min-w-0 items-center justify-between">
                      <dt class="text-slate-400 shrink-0">
                        成员数
                      </dt>
                      <dd class="text-slate-600 m-0 dark:text-slate-300">
                        {{ target.memberCount }}
                      </dd>
                    </div>
                    <div class="text-xs leading-4 flex gap-2 min-w-0 items-center justify-between">
                      <dt class="text-slate-400 shrink-0">
                        同步时间
                      </dt>
                      <dd class="text-slate-600 m-0 dark:text-slate-300">
                        {{ formatDate(target.lastSyncedAt) }}
                      </dd>
                    </div>
                  </dl>

                  <div class="mt-auto px-3 py-2 bg-slate-50/70 flex flex-wrap gap-2 items-center justify-between -mx-3 -mb-3 dark:bg-slate-900/40">
                    <div class="flex flex-wrap gap-3 items-center">
                      <label class="qs-type-meta flex gap-1.5 items-center">
                        仅内部成员
                        <FaSwitch
                          :model-value="target.internalOnly"
                          :disabled="!canManageTarget || busy"
                          @update:model-value="updateTarget(target, { internalOnly: Boolean($event) })"
                        />
                      </label>
                      <label class="qs-type-meta flex gap-1.5 items-center">
                        启用
                        <FaSwitch
                          :model-value="target.enabled"
                          :disabled="!canManageTarget || busy"
                          @update:model-value="updateTarget(target, { enabled: Boolean($event) })"
                        />
                      </label>
                    </div>
                    <FaDropdown :items="targetMenuItems(target)" align="end">
                      <FaButton variant="outline" size="sm" class="text-xs! text-slate-600! font-normal! dark:text-slate-300!" :disabled="busy">
                        更多
                        <FaIcon name="i-lucide:chevron-down" class="size-3.5" aria-hidden="true" />
                      </FaButton>
                    </FaDropdown>
                  </div>
                </div>

                <div
                  class="p-3 border border-border rounded-lg bg-background flex flex-col gap-2 min-w-0 [backface-visibility:hidden] [transform:rotateY(180deg)] inset-0 absolute overflow-hidden"
                  :class="flippedTargetId === target.id ? '' : 'pointer-events-none'"
                  :aria-hidden="flippedTargetId === target.id ? undefined : 'true'"
                  :inert="flippedTargetId === target.id ? undefined : true"
                >
                  <div class="flex gap-2 items-start justify-between">
                    <div class="min-w-0">
                      <p class="qs-type-body-medium m-0 truncate" :title="target.name">
                        {{ target.name }}
                      </p>
                      <p class="qs-type-meta text-muted-foreground m-0 mt-0.5">
                        {{ flippedMembers.length > 0 ? flippedMembers.length : (target.memberCount ?? 0) }} 位成员
                      </p>
                    </div>
                    <FaButton variant="outline" size="sm" class="text-xs! text-slate-600! font-normal! dark:text-slate-300!" @click="closeTargetFlip">
                      返回
                    </FaButton>
                  </div>

                  <div class="flex-1 min-h-0 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden">
                    <p v-if="flippedMembersLoading" class="qs-type-meta text-muted-foreground m-0">
                      成员加载中…
                    </p>
                    <div v-else-if="flippedMembersError !== null" class="flex flex-col gap-2 items-start">
                      <p class="qs-type-meta text-destructive m-0">
                        {{ flippedMembersError }}
                      </p>
                      <FaButton variant="outline" size="sm" @click="loadFlippedMembers(target)">
                        重试
                      </FaButton>
                    </div>
                    <p v-else-if="flippedMembers.length === 0" class="qs-type-meta text-muted-foreground m-0">
                      暂无成员信息
                    </p>
                    <div v-else class="gap-2 grid grid-cols-6">
                      <button
                        v-for="member in flippedMembers"
                        :key="member.wxid"
                        type="button"
                        class="p-0.5 border-2 border-transparent rounded-full inline-flex size-10 transition-colors items-center justify-center justify-self-center focus-visible:outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                        :title="memberDisplayName(member)"
                        :aria-label="`查看成员：${memberDisplayName(member)}`"
                        @click="openMemberDetail(member)"
                      >
                        <FaAvatar
                          :src="member.avatarUrl ?? ''"
                          :fallback="memberDisplayName(member)"
                          class="text-xs text-muted-foreground font-medium border border-border rounded-full bg-muted size-8"
                        />
                      </button>
                    </div>
                  </div>

                  <p class="qs-type-meta text-muted-foreground m-0">
                    点击头像查看成员信息
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </FaPageMain>
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

    <QsGenericModal v-model="reassignOpen" title="改绑员工绑定" size="md" :submitting="busy" @update:model-value="reassignOpen = $event">
      <div class="flex flex-col gap-3">
        <p class="qs-type-meta text-muted-foreground m-0">
          当前微信：{{ reassignSourceBinding?.wxidMasked ?? '—' }}。改绑后原验证状态会清空，需要重新发送测试消息。
        </p>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">新员工</span>
          <FaSelect v-model="reassignUserId" :options="userOptions" placeholder="选择员工" />
        </label>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="reassignOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="reassignUserId === undefined" @click="submitReassign">
          确认改绑
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="verifyOpen" title="发送测试消息" size="md" :submitting="verifySubmitting" @update:model-value="verifyOpen = $event">
      <div class="flex flex-col gap-3">
        <p class="qs-type-meta text-muted-foreground m-0">
          发送至 {{ verifyRecipientLabel }}。发送成功后会标记为已验证。
        </p>
        <div class="flex flex-col gap-1">
          <div class="flex gap-2 items-center justify-between">
            <span class="qs-type-compact-label">测试内容</span>
            <FaButton variant="outline" size="sm" :disabled="verifySubmitting" @click="regenerateVerifyContent">
              随机内容
            </FaButton>
          </div>
          <FaTextarea
            v-model="verifyContent"
            :rows="4"
            :maxlength="VERIFY_CONTENT_LIMIT"
            placeholder="输入发送给该微信的测试内容"
          />
          <div class="flex gap-2 items-center justify-between">
            <span class="qs-type-meta text-muted-foreground">{{ verifyContent.length }} / {{ VERIFY_CONTENT_LIMIT }}</span>
            <span class="qs-type-meta text-muted-foreground">同一绑定 30 秒内只能发送一次</span>
          </div>
        </div>
        <p v-if="verifyError !== null" class="qs-type-meta text-destructive m-0">
          {{ verifyError }}
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="verifySubmitting" @click="verifyOpen = false">
          取消
        </FaButton>
        <FaButton :loading="verifySubmitting" :disabled="!canSubmitVerify" @click="submitVerify">
          确认发送
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="groupMembersOpen" title="查看群组" size="lg" @update:model-value="groupMembersOpen = $event">
      <div class="flex flex-col gap-3">
        <div class="flex gap-3 items-center">
          <FaAvatar
            :src="groupMembersTarget?.avatarUrl ?? ''"
            :fallback="groupMembersTarget?.name ?? ''"
            class="text-lg text-muted-foreground font-medium border border-border rounded-lg bg-muted shrink-0 size-12"
          />
          <div class="flex-1 min-w-0">
            <p class="qs-type-body-medium m-0 truncate" :title="groupMembersTarget?.name ?? ''">
              {{ groupMembersTarget?.name ?? '—' }}
            </p>
            <p class="qs-type-meta text-muted-foreground m-0 mt-0.5">
              {{ groupMembers.length > 0 ? groupMembers.length : (groupMembersTarget?.memberCount ?? 0) }} 位成员
            </p>
          </div>
        </div>

        <FaInput
          v-model="groupMemberKeyword"
          type="search"
          clearable
          placeholder="搜索昵称或 wxid"
          aria-label="搜索群成员"
        >
          <template #start>
            <FaIcon name="i-lucide:search" />
          </template>
        </FaInput>

        <p v-if="groupMembersLoading" class="qs-type-meta text-muted-foreground m-0">
          成员加载中…
        </p>
        <div v-else-if="groupMembersError !== null" class="flex flex-col gap-2 items-start">
          <p class="qs-type-meta text-destructive m-0">
            {{ groupMembersError }}
          </p>
          <FaButton v-if="groupMembersTarget !== null" variant="outline" size="sm" @click="loadGroupMembers(groupMembersTarget)">
            重试
          </FaButton>
        </div>
        <p v-else-if="filteredGroupMembers.length === 0" class="qs-type-meta text-muted-foreground m-0">
          {{ groupMembers.length === 0 ? '暂无成员信息' : '没有匹配的成员' }}
        </p>
        <div v-else class="max-h-96 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden">
          <div
            v-for="member in filteredGroupMembers"
            :key="member.wxid"
            class="py-2 border-b border-border/60 flex gap-2.5 items-center last:border-b-0"
          >
            <FaAvatar
              :src="member.avatarUrl ?? ''"
              :fallback="memberDisplayName(member)"
              class="text-sm text-muted-foreground font-medium border border-border rounded-full bg-muted shrink-0 size-9"
            />
            <div class="flex-1 min-w-0">
              <div class="flex gap-2 items-center">
                <span class="qs-type-body-medium min-w-0 truncate">{{ memberDisplayName(member) }}</span>
                <FaTag variant="outline" class="shrink-0" :class="memberRoleClass(member.role)">
                  {{ memberRoleLabel(member.role) }}
                </FaTag>
              </div>
              <p class="qs-type-meta text-muted-foreground font-mono m-0 truncate" :title="member.wxid">
                {{ member.wxid }}
              </p>
            </div>
          </div>
        </div>

        <p class="qs-type-meta text-amber-700 m-0 dark:text-amber-300">
          系统不判断成员是否内部员工，「仅内部成员」仍需人工核对。
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" @click="groupMembersOpen = false">
          关闭
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="memberDetailOpen" title="成员信息" size="md" @update:model-value="memberDetailOpen = $event">
      <div v-if="memberDetail !== null" class="flex flex-col gap-4">
        <div class="flex gap-3 items-center">
          <FaAvatar
            :src="memberDetail.avatarUrl ?? ''"
            :fallback="memberDisplayName(memberDetail)"
            class="text-lg text-muted-foreground font-medium border border-border rounded-full bg-muted shrink-0 size-14"
          />
          <div class="flex-1 min-w-0">
            <div class="flex gap-2 items-center">
              <p class="qs-type-body-medium m-0 min-w-0 truncate">
                {{ memberDisplayName(memberDetail) }}
              </p>
              <FaTag variant="outline" class="shrink-0" :class="memberRoleClass(memberDetail.role)">
                {{ memberRoleLabel(memberDetail.role) }}
              </FaTag>
            </div>
            <p class="qs-type-meta text-muted-foreground m-0 mt-0.5 truncate">
              微信昵称：{{ memberDetail.nickname?.trim() || '—' }}
            </p>
          </div>
        </div>

        <dl class="m-0 flex flex-col gap-2">
          <div class="text-xs leading-5 flex gap-3 items-center justify-between">
            <dt class="text-slate-400 shrink-0">
              群内昵称
            </dt>
            <dd class="text-slate-600 m-0 min-w-0 truncate dark:text-slate-300">
              {{ memberDetail.displayName?.trim() || '—' }}
            </dd>
          </div>
          <div class="text-xs leading-5 flex gap-3 items-center justify-between">
            <dt class="text-slate-400 shrink-0">
              微信 ID
            </dt>
            <dd class="text-slate-600 m-0 flex gap-1 min-w-0 items-center dark:text-slate-300">
              <span class="font-mono min-w-0 truncate" :title="memberDetail.wxid">
                {{ memberDetail.wxid }}
              </span>
              <CopyCellButton :text="memberDetail.wxid" label="微信wxid" always-visible />
            </dd>
          </div>
          <div v-if="memberDetail.inviterName !== null" class="text-xs leading-5 flex gap-3 items-center justify-between">
            <dt class="text-slate-400 shrink-0">
              邀请人
            </dt>
            <dd class="text-slate-600 m-0 min-w-0 truncate dark:text-slate-300">
              {{ memberDetail.inviterName }}
            </dd>
          </div>
        </dl>
      </div>
      <template #footer>
        <FaButton variant="outline" @click="memberDetailOpen = false">
          关闭
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="targetEditOpen" title="编辑群目标" size="md" :submitting="busy" @update:model-value="targetEditOpen = $event">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="qs-type-compact-label">群 chatroomId</span>
          <div class="px-2.5 py-1 rounded-md bg-slate-50 flex gap-1.5 min-w-0 items-center dark:bg-slate-900/40">
            <span class="text-xs text-slate-500 font-mono flex-1 min-w-0 truncate dark:text-slate-400" :title="editingTarget?.chatroomId ?? ''">
              {{ editingTarget?.chatroomId ?? '—' }}
            </span>
            <CopyCellButton v-if="editingTarget !== null" :text="editingTarget.chatroomId" label="群 chatroomId" always-visible />
          </div>
        </div>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">群目标 key</span>
          <FaInput v-model="targetDraft.key" placeholder="finance" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">名称</span>
          <FaInput v-model="targetDraft.name" placeholder="财务群" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">用途（可选）</span>
          <FaInput v-model="targetDraft.purpose" placeholder="对账完成通知" />
        </label>
        <p class="qs-type-meta text-muted-foreground m-0">
          修改 key 后，事件策略中引用旧 key 的 targetKeys 需要同步更新。
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="targetEditOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="targetDraft.key.trim().length === 0 || targetDraft.name.trim().length === 0" @click="saveTargetEdit">
          保存
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
