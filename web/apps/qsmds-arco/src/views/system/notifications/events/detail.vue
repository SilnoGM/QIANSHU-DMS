<script setup lang="ts">
import type { MessageDraft, MessageKind, MessageServerIssue } from './message-editor.types'

import type { TargetValueOption } from './target-options'
import type {
  NotificationEventChannelConfigDto,
  NotificationEventConfigDto,
  NotificationEventConfigUpdateDto,
} from '@/api/generated/types.gen'
import { FaCombobox } from '@fantastic-admin/components'
import dayjs from 'dayjs'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getApiClientFailureIssues, getApiClientFailureMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useAppAuth } from '@/composables/app/auth'
import { notificationDomainLabel } from '../notification-domain.logic'
import MessageEditorModal from './components/editor/MessageEditorModal.vue'
import TargetValuePicker from './components/TargetValuePicker.vue'
import {
  DEFAULT_EVENT_QUIET_HOURS,
  quietHoursDraftFromDto,
  quietHoursPayload,
  quietHoursValidationError,
} from './event-quiet-hours'
import {
  imageMaxCount,
  imageSourceKeys,
  messageKindLabel,
  normalizeServerIssues,
  serverErrorsForMessage,
} from './message-editor.logic'
import { addMessageKindGroups, MESSAGE_KIND_ICONS } from './message-type-menu'

defineOptions({ name: 'SystemNotificationEventDetail' })

type Channel = 'IN_APP' | 'WECOM'
type SendMethod = 'IN_APP' | 'APP' | 'ROBOT'
type TargetMode = 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'

interface ChannelDraft {
  channel: Channel
  sendMethod: SendMethod
  enabled: boolean
  targetMode: TargetMode
  targetConfig: Record<string, unknown>
  ttlSeconds: number | null
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
  allowSensitive: boolean
  expectedVersion: number
  updatedAt: string
  updatedByName: string | null
  messages: MessageDraft[]
}

const route = useRoute()
const router = useRouter()
const toast = useQsToast()
const { auth } = useAppAuth()
const canUpdate = computed(() => auth('notification-policy:update'))

const event = ref<NotificationEventConfigDto | null>(null)
const drafts = ref<ChannelDraft[]>([])
const activeChannel = ref<Channel>('IN_APP')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const dirty = ref(false)
const userOptions = ref<TargetValueOption[]>([])
const roleOptions = ref<TargetValueOption[]>([])
const permissionOptions = ref<TargetValueOption[]>([])
const groupOptions = ref<TargetValueOption[]>([])
const targetOptionsLoading = ref(false)
const targetOptionsError = ref<string | null>(null)
const editorOpen = ref(false)
const editingIndex = ref<number | null>(null)
const editingKind = ref<MessageKind>('TEXT')
const editingSeed = ref<MessageDraft | null>(null)
const editingServerErrors = ref<Record<string, string>>({})
const saveIssues = ref<MessageServerIssue[]>([])
let targetOptionsController: AbortController | null = null

const eventType = computed(() => String(route.params.eventType ?? ''))
const activeDraft = computed(() => drafts.value.find(channel => channel.channel === activeChannel.value) ?? null)
const activeValidationError = computed(() => activeDraft.value === null ? null : validateDraft(activeDraft.value))
const mediaSourceKeys = computed(() => event.value?.media?.sources.map(source => source.key) ?? [])
const activeSaveIssues = computed(() => saveIssues.value.filter(issue => issue.channel === activeChannel.value))
const activeChannelSaveIssues = computed(() => activeSaveIssues.value.filter(issue => issue.itemIndex === null))

const TARGET_MODE_OPTIONS: Array<{ label: string, value: TargetMode }> = [
  { label: '动态目标', value: 'COMMAND_TARGET' },
  { label: '指定成员', value: 'USERS' },
  { label: '角色', value: 'ROLE' },
  { label: '权限', value: 'PERMISSION' },
  { label: '内部群', value: 'GROUP' },
]

const SEND_METHOD_OPTIONS: Array<{ label: string, value: SendMethod }> = [
  { label: '应用消息', value: 'APP' },
  { label: '群机器人', value: 'ROBOT' },
]

function channelFromDto(channel: NotificationEventChannelConfigDto): ChannelDraft {
  const quiet = quietHoursDraftFromDto(channel.quietHours)
  return {
    channel: channel.channel,
    sendMethod: channel.sendMethod,
    enabled: channel.enabled,
    targetMode: channel.targetMode,
    targetConfig: { ...channel.targetConfig },
    ttlSeconds: channel.ttlSeconds,
    quietEnabled: quiet.enabled,
    quietStart: quiet.start,
    quietEnd: quiet.end,
    allowSensitive: channel.allowSensitive,
    expectedVersion: channel.version,
    updatedAt: channel.updatedAt,
    updatedByName: channel.updatedByName,
    messages: channel.messages.map(message => ({
      kind: message.kind,
      payload: { ...message.payload },
      mediaPolicy: { ...message.mediaPolicy },
      enabled: message.enabled,
    })),
  }
}

function defaultChannel(channel: Channel): ChannelDraft {
  return {
    channel,
    sendMethod: channel === 'IN_APP' ? 'IN_APP' : 'APP',
    enabled: false,
    targetMode: channel === 'IN_APP' ? 'COMMAND_TARGET' : 'USERS',
    targetConfig: {},
    ttlSeconds: channel === 'WECOM' ? 86_400 : null,
    quietEnabled: channel === 'WECOM',
    quietStart: channel === 'WECOM' ? DEFAULT_EVENT_QUIET_HOURS.start : '',
    quietEnd: channel === 'WECOM' ? DEFAULT_EVENT_QUIET_HOURS.end : '',
    allowSensitive: false,
    expectedVersion: 0,
    updatedAt: '',
    updatedByName: null,
    messages: [],
  }
}

function applyConfig(config: NotificationEventConfigDto): void {
  event.value = config
  const byChannel = new Map(config.channels.map(channel => [channel.channel, channel]))
  drafts.value = (['IN_APP', 'WECOM'] as const).map((channel) => {
    const existing = byChannel.get(channel)
    return existing === undefined ? defaultChannel(channel) : channelFromDto(existing)
  })
  dirty.value = false
  saveIssues.value = []
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    applyConfig((await notificationsApi.eventConfigs.get(eventType.value, new AbortController().signal)).data)
  }
  catch (failure) {
    error.value = getApiClientFailureMessage(failure, '事件配置加载失败')
  }
  finally {
    loading.value = false
  }
}

async function loadActiveUsers(signal: AbortSignal): Promise<TargetValueOption[]> {
  const options: TargetValueOption[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (options.length < total && page <= 20) {
    const response = await managementApi.users.list({ page, pageSize: 100, status: 'ACTIVE' }, signal)
    options.push(...response.data.items.map(user => ({
      label: user.displayName,
      value: user.id,
      description: user.username,
    })))
    total = response.data.total
    page += 1
  }
  return options
}

async function loadTargetOptions(): Promise<void> {
  targetOptionsController?.abort()
  targetOptionsController = new AbortController()
  const signal = targetOptionsController.signal
  targetOptionsLoading.value = true
  targetOptionsError.value = null
  try {
    const [users, roles, permissions, groups] = await Promise.allSettled([
      loadActiveUsers(signal),
      managementApi.roles.list(),
      managementApi.permissions.list(),
      notificationsApi.wecom.targets.list(signal),
    ])
    if (signal.aborted) {
      return
    }
    let failed = false
    if (users.status === 'fulfilled') {
      userOptions.value = users.value.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    }
    else {
      failed = true
    }
    if (roles.status === 'fulfilled') {
      roleOptions.value = roles.value.data
        .map(role => ({
          label: role.name,
          value: role.code,
          description: role.isSystem ? `${role.code} · 系统角色` : role.code,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    }
    else {
      failed = true
    }
    if (permissions.status === 'fulfilled') {
      permissionOptions.value = permissions.value.data
        .map(permission => ({
          label: `${permission.name}（${permission.code}）`,
          value: permission.code,
          description: permission.code,
        }))
        .sort((left, right) => left.value.localeCompare(right.value))
    }
    else {
      failed = true
    }
    if (groups.status === 'fulfilled') {
      groupOptions.value = groups.value.data
        .filter(target => target.enabled && target.internalOnly)
        .map(target => ({
          label: target.name,
          value: target.key,
          description: target.purpose === null ? target.key : `${target.key} · ${target.purpose}`,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    }
    else {
      failed = true
    }
    if (failed) {
      targetOptionsError.value = '部分目标选项加载失败；仍可保存或移除已有值。'
    }
  }
  finally {
    if (!signal.aborted) {
      targetOptionsLoading.value = false
    }
  }
}

function markDirty(): void {
  dirty.value = true
}

function targetArray(draft: ChannelDraft, key: 'userIds' | 'roleCodes' | 'targetKeys'): string[] {
  const value = draft.targetConfig[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function setTargetArray(draft: ChannelDraft, key: 'userIds' | 'roleCodes' | 'targetKeys', values: string[]): void {
  draft.targetConfig = { ...draft.targetConfig, [key]: values }
  markDirty()
}

function permissionValue(draft: ChannelDraft): string | undefined {
  const value = draft.targetConfig.permissionCode
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function setPermissionValue(draft: ChannelDraft, value: unknown): void {
  const code = typeof value === 'string' ? value.trim() : ''
  draft.targetConfig = code.length > 0 ? { permissionCode: code } : {}
  markDirty()
}

function targetModeOptions(draft: ChannelDraft): Array<{ label: string, value: TargetMode }> {
  if (draft.channel === 'IN_APP' || draft.sendMethod === 'APP') {
    return TARGET_MODE_OPTIONS.filter(option => option.value !== 'GROUP')
  }
  return TARGET_MODE_OPTIONS.filter(option => option.value === 'GROUP')
}

function changeSendMethod(draft: ChannelDraft, method: SendMethod): void {
  draft.sendMethod = method
  draft.targetMode = method === 'ROBOT' ? 'GROUP' : 'USERS'
  draft.targetConfig = {}
  // 发送方式变化会让上一轮服务端内容问题失效，避免继续指向不兼容的消息类型。
  saveIssues.value = []
  markDirty()
}

function changeTargetMode(draft: ChannelDraft, mode: TargetMode): void {
  draft.targetMode = mode
  draft.targetConfig = {}
  markDirty()
}

function targetSummary(draft: ChannelDraft): string {
  switch (draft.targetMode) {
    case 'COMMAND_TARGET':
      return event.value?.dynamicTargetLabel ?? '由业务发布时传入'
    case 'USERS':
      return `指定成员（${targetArray(draft, 'userIds').length}）`
    case 'ROLE':
      return `角色（${targetArray(draft, 'roleCodes').length}）`
    case 'PERMISSION': {
      const permission = permissionValue(draft)
      return permission === undefined ? '权限未配置' : `权限 · ${permission}`
    }
    case 'GROUP':
      return `内部群（${targetArray(draft, 'targetKeys').length}）`
  }
}

function openCreateMessage(kind: MessageKind): void {
  const draft = activeDraft.value
  if (draft === null) {
    return
  }
  if (kind === 'TEXT' && draft.channel === 'IN_APP' && draft.messages.length >= 1) {
    return
  }
  if (kind === 'MPNEWS' && draft.messages.some(message => message.kind === 'MPNEWS')) {
    return
  }
  editingIndex.value = null
  editingKind.value = kind
  editingSeed.value = null
  editingServerErrors.value = {}
  editorOpen.value = true
}

function openEditMessage(index: number, serverErrors?: Record<string, string>): void {
  const draft = activeDraft.value
  const message = draft?.messages[index]
  if (draft === null || draft === undefined || message === undefined) {
    return
  }
  editingIndex.value = index
  editingKind.value = message.kind
  editingSeed.value = message
  editingServerErrors.value = serverErrors === undefined
    ? serverErrorsForMessage(saveIssues.value, draft.channel, index)
    : { ...serverErrors }
  editorOpen.value = true
}

function clearMessageIssues(channel: Channel, index: number): void {
  saveIssues.value = saveIssues.value.filter(issue => !(issue.channel === channel && issue.itemIndex === index))
}

function applyMessage(message: MessageDraft): void {
  const draft = activeDraft.value
  if (draft === null) {
    return
  }
  const index = editingIndex.value
  if (index === null) {
    draft.messages.push(message)
  }
  else {
    draft.messages.splice(index, 1, message)
    clearMessageIssues(draft.channel, index)
  }
  markDirty()
}

function removeMessage(index: number): void {
  activeDraft.value?.messages.splice(index, 1)
  saveIssues.value = []
  markDirty()
}

function moveMessage(index: number, delta: number): void {
  const messages = activeDraft.value?.messages
  if (messages === undefined) {
    return
  }
  const target = index + delta
  if (target < 0 || target >= messages.length) {
    return
  }
  const [item] = messages.splice(index, 1)
  if (item !== undefined) {
    messages.splice(target, 0, item)
  }
  saveIssues.value = []
  markDirty()
}

function textContent(message: MessageDraft): string {
  return typeof message.payload.content === 'string' ? message.payload.content : ''
}

function messageSummary(message: MessageDraft): string {
  if (message.kind === 'TEXT') {
    return textContent(message).trim().slice(0, 80) || '空内容'
  }
  if (message.kind === 'MARKDOWN' || message.kind === 'MARKDOWN_V2') {
    return textContent(message).trim().slice(0, 80) || '空内容'
  }
  if (message.kind === 'TEXTCARD') {
    return typeof message.payload.title === 'string' && message.payload.title.trim().length > 0
      ? message.payload.title
      : '未填写标题'
  }
  if (message.kind === 'MPNEWS') {
    return typeof message.payload.title === 'string' && message.payload.title.trim().length > 0
      ? message.payload.title
      : '未填写标题'
  }
  if (message.kind === 'NEWS') {
    const articles = Array.isArray(message.payload.articles) ? message.payload.articles : []
    const first = articles[0]
    const title = typeof first === 'object' && first !== null && !Array.isArray(first)
      ? (first as Record<string, unknown>).title
      : null
    const prefix = typeof title === 'string' && title.trim().length > 0 ? title : '未填写标题'
    return articles.length > 1 ? `${prefix} 等 ${articles.length} 篇` : prefix
  }
  if (message.kind === 'FILE') {
    return typeof message.payload.filename === 'string' && message.payload.filename.length > 0
      ? message.payload.filename
      : '文件消息'
  }
  if (message.kind === 'IMAGE') {
    const count = imageSourceKeys(message.mediaPolicy, mediaSourceKeys.value).length
    return `图片附件 · ${count} 个来源 · 最多 ${imageMaxCount(message.mediaPolicy)} 张`
  }
  return message.kind
}

function messageTypeDescription(message: MessageDraft): string {
  switch (message.kind) {
    case 'TEXT':
      return '文本消息'
    case 'MARKDOWN':
      return 'Markdown'
    case 'MARKDOWN_V2':
      return 'Markdown V2'
    case 'TEXTCARD':
      return '文本卡片'
    case 'MPNEWS':
      return '企微图文（封面 + 正文）'
    case 'NEWS':
      return '图文卡片（1–8 篇文章）'
    case 'FILE':
      return '文件'
    case 'IMAGE':
      return '业务附件图片'
    default:
      return messageKindLabel(message.kind)
  }
}

function messageIssueText(index: number): string {
  return activeSaveIssues.value
    .filter(issue => issue.itemIndex === index)
    .map(issue => issue.message)
    .join('；')
}

/**
 * 422 携带结构化 issues 时，切到首个可定位问题的渠道并直接打开对应消息弹窗；
 * 渠道级问题（例如缺少正文）没有 itemIndex，留在页面上方提示。
 */
function revealFirstServerIssue(issues: readonly MessageServerIssue[]): void {
  const first = issues.find(issue => issue.channel !== null && issue.itemIndex !== null)
  if (first === undefined || first.channel === null || first.itemIndex === null) {
    return
  }
  const channel = first.channel
  const itemIndex = first.itemIndex
  activeChannel.value = channel
  if (activeDraft.value?.messages[itemIndex] === undefined) {
    return
  }
  openEditMessage(itemIndex, serverErrorsForMessage(issues, channel, itemIndex))
}

function channelDescription(channel: Channel): string {
  return channel === 'IN_APP' ? '写入站内收件箱' : '发送到员工或内部群'
}

function draftUpdatedAt(draft: ChannelDraft): string {
  return draft.updatedAt === '' ? '尚未保存' : dayjs(draft.updatedAt).format('YYYY-MM-DD HH:mm')
}

function draftUpdatedBy(draft: ChannelDraft): string {
  return draft.updatedByName ?? '—'
}

function messageKindCounts(draft: ChannelDraft): Array<{ kind: MessageKind, count: number }> {
  const counts = new Map<MessageKind, number>()
  for (const message of draft.messages) {
    counts.set(message.kind, (counts.get(message.kind) ?? 0) + 1)
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }))
}

const addMessageMenu = computed(() => {
  const draft = activeDraft.value
  if (draft === null) {
    return []
  }
  return addMessageKindGroups({
    channel: draft.channel,
    sendMethod: draft.sendMethod,
    messageCount: draft.messages.length,
    hasMpnews: draft.messages.some(message => message.kind === 'MPNEWS'),
    hasMedia: event.value?.media != null,
  }).map(group => group.map(option => ({
    label: option.enabled
      ? messageKindLabel(option.kind)
      : `${messageKindLabel(option.kind)}（后续开放）`,
    icon: MESSAGE_KIND_ICONS[option.kind],
    // 未实现类型只展示，不允许加入消息组；后续开放时只需翻 enabled。
    disabled: !option.enabled,
    handle: () => openCreateMessage(option.kind),
  }))).filter(group => group.length > 0)
})

function validateDraft(draft: ChannelDraft): string | null {
  if (!draft.enabled && draft.messages.length === 0) {
    return null
  }
  if (draft.messages.length === 0) {
    return `${draft.channel === 'IN_APP' ? '站内通知' : '企业微信'}启用后必须配置消息内容`
  }
  if (draft.channel === 'IN_APP'
    && (draft.messages.length !== 1 || draft.messages[0]?.kind !== 'TEXT')) {
    return '站内通知必须配置且只配置一条文本消息'
  }
  if (draft.channel === 'WECOM') {
    const quietError = quietHoursValidationError({
      enabled: draft.quietEnabled,
      start: draft.quietStart,
      end: draft.quietEnd,
    })
    if (quietError !== null) {
      return quietError
    }
    if (draft.messages.filter(message => message.kind === 'MPNEWS').length > 1) {
      return '同一渠道只允许一条企微图文'
    }
    // 切换发送方式保留原内容，但群机器人不支持 mpnews；保存前必须显式处理不兼容消息。
    const allowedKinds: MessageKind[] = draft.sendMethod === 'ROBOT'
      ? ['TEXT', 'MARKDOWN', 'MARKDOWN_V2', 'NEWS', 'FILE', 'IMAGE']
      : ['TEXT', 'MARKDOWN', 'TEXTCARD', 'MPNEWS', 'NEWS', 'FILE', 'IMAGE']
    const unsupported = draft.messages.find(message => !allowedKinds.includes(message.kind))
    if (unsupported !== undefined) {
      return `企业微信${draft.sendMethod === 'ROBOT' ? '群机器人' : '应用消息'}不支持 ${messageKindLabel(unsupported.kind)} 消息，请删除或切换发送方式`
    }
    if (!draft.messages.some(message => message.kind !== 'IMAGE')) {
      return '企业微信渠道至少需要一条正文消息'
    }
    const maximum = event.value?.media?.maxCount ?? 0
    for (const message of draft.messages) {
      if (message.kind !== 'IMAGE') {
        continue
      }
      if (imageSourceKeys(message.mediaPolicy, mediaSourceKeys.value).length === 0) {
        return '图片附件至少选择一个来源'
      }
      if (imageMaxCount(message.mediaPolicy) > maximum) {
        return `图片附件数量上限不能超过 ${maximum}`
      }
    }
  }
  return null
}

async function save(): Promise<void> {
  if (!canUpdate.value || event.value === null) {
    return
  }
  for (const draft of drafts.value) {
    const validation = validateDraft(draft)
    if (validation !== null) {
      toast.error(validation)
      activeChannel.value = draft.channel
      return
    }
  }
  // 未启用的新渠道也要保存已配置的消息，否则弹窗里点「完成」后再保存会被静默丢弃。
  const toSave = drafts.value.filter(draft => draft.enabled || draft.expectedVersion > 0 || draft.messages.length > 0)
  if (toSave.length === 0) {
    toast.error('至少配置一个通知渠道')
    return
  }
  saving.value = true
  error.value = null
  try {
    const input: NotificationEventConfigUpdateDto = {
      channels: toSave.map(draft => ({
        channel: draft.channel,
        sendMethod: draft.sendMethod,
        enabled: draft.enabled,
        targetMode: draft.targetMode,
        targetConfig: draft.targetConfig,
        ttlSeconds: draft.channel === 'WECOM' ? draft.ttlSeconds : null,
        quietHours: draft.channel === 'WECOM'
          ? quietHoursPayload({
              enabled: draft.quietEnabled,
              start: draft.quietStart,
              end: draft.quietEnd,
            })
          : null,
        allowSensitive: draft.channel === 'WECOM' ? draft.allowSensitive : false,
        expectedVersion: draft.expectedVersion,
        messages: draft.messages.map(message => ({
          kind: message.kind,
          payload: message.payload,
          mediaPolicy: message.mediaPolicy,
          enabled: message.enabled,
        })),
      })),
    }
    const response = await notificationsApi.eventConfigs.update(eventType.value, input)
    applyConfig(response.data)
    toast.success('事件配置已保存')
  }
  catch (failure) {
    const issues = normalizeServerIssues(getApiClientFailureIssues(failure))
    saveIssues.value = issues
    if (issues.length > 0) {
      revealFirstServerIssue(issues)
    }
    error.value = getApiClientFailureMessage(failure, '事件配置保存失败')
    toast.error(error.value)
  }
  finally {
    saving.value = false
  }
}

function goBack(): void {
  void router.push({ name: 'systemNotificationEvents' })
}

onMounted(() => {
  void load()
  void loadTargetOptions()
})
watch(eventType, load)

onBeforeUnmount(() => {
  targetOptionsController?.abort()
})
</script>

<template>
  <FaPageHeader title="事件配置" description="配置站内与企业微信渠道、收件人与消息内容。">
    <div class="flex gap-2">
      <FaButton variant="outline" @click="goBack">
        <FaIcon name="i-lucide:arrow-left" />
        返回
      </FaButton>
      <FaButton
        v-if="canUpdate && event !== null"
        :loading="saving"
        :disabled="saving || !dirty"
        @click="save"
      >
        {{ dirty ? '保存修改' : '已保存' }}
      </FaButton>
    </div>
  </FaPageHeader>

  <FaPageMain main-class="min-w-0">
    <div v-if="loading && event === null" class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
      正在加载事件配置…
    </div>

    <FaAlert v-else-if="error !== null" variant="destructive" role="alert" :title="error" />

    <div v-else-if="event !== null" class="flex flex-col gap-4" data-testid="notification-event-detail">
      <div class="p-4 border border-border rounded-xl bg-card">
        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="text-lg font-semibold">{{ event.label }}</span>
              <span class="text-xs text-muted-foreground px-2 py-0.5 border border-border rounded-full bg-muted/50">
                {{ notificationDomainLabel(event.domain) }}
              </span>
              <span
                v-if="event.implemented"
                class="text-xs text-emerald-700 px-2 py-0.5 border border-emerald-600/25 rounded-full bg-emerald-500/10 dark:text-emerald-400"
              >
                已接入发布
              </span>
              <span
                v-else
                class="text-xs text-amber-700 px-2 py-0.5 border border-amber-500/25 rounded-full bg-amber-500/10 dark:text-amber-400"
              >
                未接入发布
              </span>
              <span
                v-if="dirty"
                class="text-xs text-amber-700 px-2 py-0.5 border border-amber-500/25 rounded-full bg-amber-500/10 dark:text-amber-400"
              >
                未保存
              </span>
            </div>
            <div class="text-xs text-muted-foreground font-mono mt-1.5 break-all">
              {{ event.eventType }}
            </div>
          </div>
          <span v-if="!canUpdate" class="text-xs text-muted-foreground px-2 py-0.5 border border-border rounded-full">
            只读
          </span>
        </div>
      </div>

      <div class="gap-3 grid sm:grid-cols-2">
        <button
          v-for="channel in (['IN_APP', 'WECOM'] as const)"
          :key="channel"
          type="button"
          class="p-4 text-left border rounded-xl flex gap-3 transition-colors items-center"
          :class="activeChannel === channel
            ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/15'
            : 'border-border bg-card hover:bg-muted/30'"
          @click="activeChannel = channel"
        >
          <span
            class="border border-border rounded-lg bg-background flex shrink-0 size-9 items-center justify-center"
            :class="activeChannel === channel ? 'text-primary' : 'text-muted-foreground'"
          >
            <FaIcon :name="channel === 'IN_APP' ? 'i-lucide:bell' : 'i-lucide:message-circle'" />
          </span>
          <span class="min-w-0">
            <span class="font-medium flex gap-2 items-center">
              {{ channel === 'IN_APP' ? '站内通知' : '企业微信' }}
              <span v-if="activeChannel === channel" class="text-[10px] text-primary font-normal">当前编辑</span>
            </span>
            <span class="text-xs text-muted-foreground mt-0.5 block">{{ channelDescription(channel) }}</span>
          </span>
          <span class="text-xs ml-auto inline-flex gap-1.5 whitespace-nowrap items-center">
            <span
              class="rounded-full size-1.5"
              :class="drafts.find(item => item.channel === channel)?.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
            />
            {{ drafts.find(item => item.channel === channel)?.enabled ? '已启用' : '未启用' }}
          </span>
        </button>
      </div>

      <div v-if="activeDraft !== null" class="gap-4 grid items-start xl:grid-cols-[minmax(0,1fr)_330px]">
        <div class="flex flex-col gap-4">
          <section class="border border-border rounded-xl bg-card">
            <div class="p-4 border-b border-border flex flex-wrap gap-2 items-center justify-between">
              <div>
                <div class="font-medium">
                  渠道设置
                </div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  收件人、发送方式与投递策略
                </div>
              </div>
              <label class="text-sm flex gap-2 items-center">
                <FaSwitch v-model="activeDraft.enabled" :disabled="!canUpdate" @update:model-value="markDirty" />
                <span :class="activeDraft.enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'">
                  {{ activeDraft.enabled ? '已启用' : '未启用' }}
                </span>
              </label>
            </div>

            <div class="p-4 flex flex-col gap-4">
              <div v-if="activeDraft.channel === 'WECOM'" class="flex flex-col gap-2">
                <span class="text-xs text-muted-foreground font-medium">发送方式</span>
                <div class="p-1 rounded-lg bg-muted inline-flex gap-1 w-fit">
                  <button
                    v-for="option in SEND_METHOD_OPTIONS"
                    :key="option.value"
                    type="button"
                    class="text-sm px-3 py-1.5 rounded-md transition-colors"
                    :class="activeDraft.sendMethod === option.value
                      ? 'bg-background text-foreground font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'"
                    :disabled="!canUpdate"
                    @click="changeSendMethod(activeDraft, option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <span class="text-xs text-muted-foreground">
                  {{ activeDraft.sendMethod === 'ROBOT' ? '发送到内部群，目标固定为群 key。' : '发送给已绑定企业微信的员工。' }}
                </span>
              </div>

              <div class="gap-3 grid md:grid-cols-2">
                <label class="text-sm flex flex-col gap-1">
                  <span class="font-medium">收件人/目标</span>
                  <FaSelect
                    :model-value="activeDraft.targetMode"
                    :options="targetModeOptions(activeDraft)"
                    :disabled="!canUpdate"
                    @update:model-value="value => changeTargetMode(activeDraft!, value as TargetMode)"
                  />
                </label>
                <div class="text-sm flex flex-col gap-1">
                  <span class="font-medium">目标值</span>
                  <TargetValuePicker
                    v-if="activeDraft.targetMode === 'USERS'"
                    :model-value="targetArray(activeDraft, 'userIds')"
                    :options="userOptions"
                    :loading="targetOptionsLoading"
                    :disabled="!canUpdate"
                    placeholder="选择成员"
                    empty-text="没有匹配的成员"
                    @update:model-value="values => setTargetArray(activeDraft!, 'userIds', values)"
                  />
                  <TargetValuePicker
                    v-else-if="activeDraft.targetMode === 'ROLE'"
                    :model-value="targetArray(activeDraft, 'roleCodes')"
                    :options="roleOptions"
                    :loading="targetOptionsLoading"
                    :disabled="!canUpdate"
                    placeholder="选择角色"
                    empty-text="没有匹配的角色"
                    @update:model-value="values => setTargetArray(activeDraft!, 'roleCodes', values)"
                  />
                  <FaCombobox
                    v-else-if="activeDraft.targetMode === 'PERMISSION'"
                    :model-value="permissionValue(activeDraft)"
                    :options="permissionOptions"
                    :disabled="!canUpdate || targetOptionsLoading"
                    clearable
                    class="w-full"
                    virtual-list
                    placeholder="选择权限"
                    empty-text="没有匹配的权限"
                    @change="value => setPermissionValue(activeDraft!, value)"
                  />
                  <TargetValuePicker
                    v-else-if="activeDraft.targetMode === 'GROUP'"
                    :model-value="targetArray(activeDraft, 'targetKeys')"
                    :options="groupOptions"
                    :loading="targetOptionsLoading"
                    :disabled="!canUpdate"
                    placeholder="选择内部群"
                    empty-text="没有可用的内部群"
                    @update:model-value="values => setTargetArray(activeDraft!, 'targetKeys', values)"
                  />
                  <span v-if="activeDraft.targetMode === 'GROUP'" class="text-xs text-muted-foreground">
                    仅列出已启用且标记为内部群的群机器人目标。
                  </span>
                  <div v-if="activeDraft.targetMode === 'COMMAND_TARGET'" class="text-sm px-3 border border-border rounded-md bg-muted/30 flex gap-2 h-9 items-center">
                    <FaIcon name="i-lucide:waypoints" class="text-muted-foreground shrink-0 size-4" />
                    <span class="truncate">{{ event?.dynamicTargetLabel ?? '由业务发布时传入' }}</span>
                  </div>
                  <span v-if="activeDraft.targetMode === 'COMMAND_TARGET'" class="text-xs text-muted-foreground">
                    发布时按业务单据解析，不是固定收件人。
                  </span>
                </div>
              </div>

              <p v-if="targetOptionsError !== null" class="text-xs text-destructive m-0">
                {{ targetOptionsError }}
              </p>

              <div v-if="activeDraft.channel === 'WECOM'" class="p-3 border border-border/70 rounded-lg bg-muted/20">
                <div class="text-xs text-muted-foreground font-medium">
                  投递策略
                </div>
                <label class="text-sm mt-3 flex flex-wrap gap-2 items-center">
                  <FaSwitch
                    :model-value="activeDraft.quietEnabled"
                    :disabled="!canUpdate"
                    @update:model-value="value => { activeDraft!.quietEnabled = value === true; markDirty() }"
                  />
                  静默时段
                  <span class="text-xs text-muted-foreground">
                    关闭后不静默；开启后必须设置开始和结束时间。
                  </span>
                </label>
                <div class="mt-3 gap-3 grid md:grid-cols-3">
                  <label class="text-sm flex flex-col gap-1">
                    <span class="font-medium">TTL（秒）</span>
                    <FaInput
                      :model-value="activeDraft.ttlSeconds === null ? '' : String(activeDraft.ttlSeconds)"
                      type="number"
                      :disabled="!canUpdate"
                      @update:model-value="value => { activeDraft!.ttlSeconds = (value ?? '') === '' ? null : Number(value); markDirty() }"
                    />
                  </label>
                  <label class="text-sm flex flex-col gap-1">
                    <span class="font-medium">静默开始</span>
                    <FaInput
                      :model-value="activeDraft.quietStart"
                      type="time"
                      :disabled="!canUpdate || !activeDraft.quietEnabled"
                      @update:model-value="value => { activeDraft!.quietStart = value ?? ''; markDirty() }"
                    />
                  </label>
                  <label class="text-sm flex flex-col gap-1">
                    <span class="font-medium">静默结束</span>
                    <FaInput
                      :model-value="activeDraft.quietEnd"
                      type="time"
                      :disabled="!canUpdate || !activeDraft.quietEnabled"
                      @update:model-value="value => { activeDraft!.quietEnd = value ?? ''; markDirty() }"
                    />
                  </label>
                </div>
                <label class="text-sm mt-3 flex flex-wrap gap-2 items-center">
                  <FaSwitch v-model="activeDraft.allowSensitive" :disabled="!canUpdate" @update:model-value="markDirty" />
                  允许敏感内容
                  <span class="text-xs text-muted-foreground">关闭时图片附件与敏感变量会被拦截</span>
                </label>
              </div>
              <div v-else class="text-xs text-muted-foreground p-3 border border-border rounded-lg border-dashed bg-muted/20">
                站内通知写入收件箱，不支持 TTL、静默时段与敏感内容开关。
              </div>
            </div>
          </section>

          <section class="border border-border rounded-xl bg-card">
            <div class="p-4 border-b border-border flex flex-wrap gap-2 items-center justify-between">
              <div>
                <div class="font-medium flex gap-2 items-center">
                  消息内容
                  <span class="text-xs text-muted-foreground font-normal px-1.5 py-0.5 rounded bg-muted">
                    {{ activeDraft.messages.length }} 条
                  </span>
                </div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  按消息顺序发送，图片附件同样参与排序；单条失败不影响后续消息。
                </div>
              </div>
              <FaDropdown
                v-if="canUpdate && addMessageMenu.length > 0"
                :items="addMessageMenu"
                align="end"
              >
                <FaButton
                  :variant="activeDraft.messages.length === 0 ? 'default' : 'outline'"
                  size="sm"
                >
                  <FaIcon name="i-lucide:plus" />
                  插入消息
                  <FaIcon name="i-lucide:chevron-down" />
                </FaButton>
              </FaDropdown>
            </div>

            <div class="p-4 flex flex-col gap-3">
              <FaAlert
                v-if="activeValidationError !== null"
                variant="destructive"
                :title="activeValidationError"
              />

              <div
                v-if="activeChannelSaveIssues.length > 0"
                class="px-3 py-2.5 border border-destructive/30 rounded-lg bg-destructive/5"
                role="alert"
              >
                <div class="text-xs text-destructive font-medium">
                  服务端校验未通过
                </div>
                <ul class="text-xs text-destructive/90 mt-1 pl-4 list-disc">
                  <li v-for="(issue, issueIndex) in activeChannelSaveIssues" :key="`${issue.code}-${issueIndex}`">
                    {{ issue.message }}
                  </li>
                </ul>
              </div>

              <div
                v-if="activeDraft.messages.length === 0"
                class="px-4 py-8 border border-border rounded-xl border-dashed flex flex-col gap-2 min-h-40 items-center justify-center"
              >
                <span class="text-muted-foreground rounded-full bg-muted flex size-10 items-center justify-center">
                  <FaIcon name="i-lucide:message-square-plus" class="size-5" />
                </span>
                <span class="text-sm font-medium">尚未配置消息内容</span>
                <span class="text-xs text-muted-foreground">从右上角添加文本消息、企微图文、图文卡片或图片附件。</span>
                <FaButton v-if="canUpdate && activeDraft.channel === 'IN_APP'" variant="outline" size="sm" @click="openCreateMessage('TEXT')">
                  添加文本消息
                </FaButton>
              </div>

              <div v-else class="flex flex-col gap-2">
                <div
                  v-for="(message, index) in activeDraft.messages"
                  :key="`${message.kind}-${index}`"
                  class="p-3 border border-border rounded-xl bg-card flex flex-wrap gap-3 transition-colors items-center hover:border-primary/30"
                >
                  <span class="text-[10px] font-medium border border-border rounded-full bg-muted/50 flex shrink-0 size-6 items-center justify-center tabular-nums">
                    {{ index + 1 }}
                  </span>
                  <span
                    class="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                    :class="message.kind === 'TEXT'
                      ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
                      : message.kind === 'MPNEWS'
                        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-400'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'"
                  >
                    {{ messageKindLabel(message.kind) }}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm truncate">
                      {{ messageSummary(message) }}
                    </div>
                    <div
                      v-if="messageIssueText(index) !== ''"
                      class="text-[11px] text-destructive mt-0.5 truncate"
                      :title="messageIssueText(index)"
                    >
                      {{ messageIssueText(index) }}
                    </div>
                    <div v-else class="text-[11px] text-muted-foreground mt-0.5">
                      {{ messageTypeDescription(message) }}
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-0.5 items-center">
                    <FaButton
                      variant="ghost"
                      size="icon-sm"
                      title="编辑内容"
                      :disabled="!canUpdate"
                      @click="openEditMessage(index)"
                    >
                      <FaIcon name="i-lucide:pencil" />
                    </FaButton>
                    <span class="mx-0.5 bg-border h-4 w-px" />
                    <FaButton
                      variant="ghost"
                      size="icon-sm"
                      title="上移"
                      :disabled="!canUpdate || index === 0"
                      @click="moveMessage(index, -1)"
                    >
                      <FaIcon name="i-lucide:arrow-up" />
                    </FaButton>
                    <FaButton
                      variant="ghost"
                      size="icon-sm"
                      title="下移"
                      :disabled="!canUpdate || index === activeDraft.messages.length - 1"
                      @click="moveMessage(index, 1)"
                    >
                      <FaIcon name="i-lucide:arrow-down" />
                    </FaButton>
                    <FaButton
                      variant="ghost"
                      size="icon-sm"
                      title="删除"
                      :disabled="!canUpdate"
                      @click="removeMessage(index)"
                    >
                      <FaIcon name="i-lucide:trash-2" />
                    </FaButton>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside class="flex flex-col gap-3 xl:top-4 xl:sticky">
          <section class="border border-border rounded-xl bg-card">
            <div class="p-4 border-b border-border">
              <div class="font-medium">
                配置摘要
              </div>
            </div>
            <dl class="text-sm p-4 gap-x-3 gap-y-3 grid grid-cols-[auto_1fr]">
              <dt class="text-muted-foreground">
                状态
              </dt>
              <dd class="inline-flex gap-1.5 items-center">
                <span
                  class="rounded-full size-1.5"
                  :class="activeDraft.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
                />
                {{ activeDraft.enabled ? '已启用' : '未启用' }}
              </dd>
              <dt class="text-muted-foreground">
                渠道
              </dt>
              <dd>{{ activeDraft.channel === 'IN_APP' ? '站内通知' : '企业微信' }}</dd>
              <dt class="text-muted-foreground">
                方式
              </dt>
              <dd>{{ activeDraft.channel === 'IN_APP' ? '站内' : activeDraft.sendMethod === 'ROBOT' ? '群机器人' : '应用消息' }}</dd>
              <dt class="text-muted-foreground">
                收件人
              </dt>
              <dd class="break-words">
                {{ targetSummary(activeDraft) }}
              </dd>
              <dt class="text-muted-foreground">
                消息数
              </dt>
              <dd class="flex flex-col gap-1.5">
                <span>{{ activeDraft.messages.length }} 条</span>
                <span v-if="messageKindCounts(activeDraft).length > 0" class="flex flex-wrap gap-1">
                  <span
                    v-for="item in messageKindCounts(activeDraft)"
                    :key="item.kind"
                    class="text-[10px] text-muted-foreground px-1.5 py-0.5 border border-border rounded bg-muted/50"
                  >
                    {{ messageKindLabel(item.kind) }} {{ item.count }}
                  </span>
                </span>
              </dd>
              <dt class="text-muted-foreground">
                版本
              </dt>
              <dd>{{ activeDraft.expectedVersion }}</dd>
              <dt class="text-muted-foreground">
                最后更新
              </dt>
              <dd class="flex flex-col gap-0.5">
                <span class="text-xs tabular-nums">{{ draftUpdatedAt(activeDraft) }}</span>
                <span class="text-[11px] text-muted-foreground">{{ draftUpdatedBy(activeDraft) }}</span>
              </dd>
            </dl>
          </section>

          <div
            v-if="activeValidationError !== null"
            class="p-4 border border-destructive/30 rounded-xl bg-destructive/5"
          >
            <div class="text-xs text-destructive font-medium">
              配置需要处理
            </div>
            <div class="text-xs text-destructive/90 mt-1">
              {{ activeValidationError }}
            </div>
          </div>

          <div
            v-if="dirty"
            class="p-4 border border-amber-500/30 rounded-xl bg-amber-500/10"
          >
            <div class="text-sm text-amber-700 font-medium flex gap-2 items-center dark:text-amber-400">
              <FaIcon name="i-lucide:circle-alert" class="size-4" />
              有未保存的修改
            </div>
            <p class="text-xs text-amber-700/80 mt-1 dark:text-amber-400/80">
              保存后才会影响后续发布。
            </p>
          </div>
          <div v-else class="text-xs text-muted-foreground p-4 border border-border rounded-xl bg-card">
            当前渠道配置已保存。
          </div>
        </aside>
      </div>
    </div>
  </FaPageMain>

  <MessageEditorModal
    v-if="event !== null && activeDraft !== null"
    v-model="editorOpen"
    :kind="editingKind"
    :seed="editingSeed"
    :channel="activeDraft.channel"
    :send-method="activeDraft.sendMethod"
    :media="event.media"
    :variables="event.variableDefinitions"
    :variables-known="event.variablesKnown"
    :event-label="event.label"
    :event-type="event.eventType"
    :can-update="canUpdate"
    :server-errors="editingServerErrors"
    @apply="applyMessage"
  />
</template>
