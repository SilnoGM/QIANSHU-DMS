<script setup lang="ts">
import type {
  NotificationEventChannelConfigDto,
  NotificationEventChannelMessageDto,
  NotificationEventConfigDto,
  NotificationEventConfigUpdateDto,
} from '@/api/generated/types.gen'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useAppAuth } from '@/composables/app/auth'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import RichTextEditor from './components/RichTextEditor.vue'

defineOptions({ name: 'SystemNotificationEventDetail' })

type Channel = 'IN_APP' | 'WECOM'
type SendMethod = 'IN_APP' | 'APP' | 'ROBOT'
type TargetMode = 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'
type MessageKind = NotificationEventChannelMessageDto['kind']

interface MessageDraft {
  kind: MessageKind
  payload: Record<string, unknown>
  mediaPolicy: Record<string, unknown>
  enabled: boolean
}

interface ChannelDraft {
  channel: Channel
  sendMethod: SendMethod
  enabled: boolean
  targetMode: TargetMode
  targetConfig: Record<string, unknown>
  ttlSeconds: number | null
  quietStart: string
  quietEnd: string
  allowSensitive: boolean
  expectedVersion: number
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
const coverFileInput = ref<HTMLInputElement | null>(null)
const coverTargetIndex = ref<number | null>(null)
const coverUploadingIndex = ref<number | null>(null)
const coverUploadErrors = ref<Record<number, string>>({})
const coverPreviewUrls = ref<Record<string, string>>({})

const MAXIMUM_COVER_BYTES = 10 * 1024 * 1024

const eventType = computed(() => String(route.params.eventType ?? ''))
const activeDraft = computed(() => drafts.value.find(channel => channel.channel === activeChannel.value) ?? null)

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

const TARGET_VALUE_HINT: Record<TargetMode, string> = {
  COMMAND_TARGET: '由业务发布时传入，无需填写',
  USERS: '填写 user id，多个用逗号分隔',
  ROLE: '填写角色 code，多个用逗号分隔',
  PERMISSION: '填写权限 code',
  GROUP: '填写内部群 key，多个用逗号分隔',
}

function channelFromDto(channel: NotificationEventChannelConfigDto): ChannelDraft {
  return {
    channel: channel.channel,
    sendMethod: channel.sendMethod,
    enabled: channel.enabled,
    targetMode: channel.targetMode,
    targetConfig: { ...channel.targetConfig },
    ttlSeconds: channel.ttlSeconds,
    quietStart: typeof channel.quietHours?.start === 'string' ? channel.quietHours.start : '',
    quietEnd: typeof channel.quietHours?.end === 'string' ? channel.quietHours.end : '',
    allowSensitive: channel.allowSensitive,
    expectedVersion: channel.version,
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
    quietStart: '',
    quietEnd: '',
    allowSensitive: false,
    expectedVersion: 0,
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

function markDirty(): void {
  dirty.value = true
}

function targetValues(draft: ChannelDraft): string {
  const key = draft.targetMode === 'USERS'
    ? 'userIds'
    : draft.targetMode === 'ROLE'
      ? 'roleCodes'
      : draft.targetMode === 'PERMISSION'
        ? 'permissionCode'
        : draft.targetMode === 'GROUP' ? 'targetKeys' : null
  if (key === null) {
    return ''
  }
  const value = draft.targetConfig[key]
  return Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''
}

function setTargetValues(draft: ChannelDraft, value: string): void {
  const key = draft.targetMode === 'USERS'
    ? 'userIds'
    : draft.targetMode === 'ROLE'
      ? 'roleCodes'
      : draft.targetMode === 'PERMISSION'
        ? 'permissionCode'
        : draft.targetMode === 'GROUP' ? 'targetKeys' : null
  if (key === null) {
    draft.targetConfig = {}
  }
  else if (key === 'permissionCode') {
    draft.targetConfig = { permissionCode: value.trim() }
  }
  else {
    draft.targetConfig = { [key]: value.split(',').map(item => item.trim()).filter(Boolean) }
  }
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
  markDirty()
}

function changeTargetMode(draft: ChannelDraft, mode: TargetMode): void {
  draft.targetMode = mode
  draft.targetConfig = {}
  markDirty()
}

function addTextMessage(): void {
  const draft = activeDraft.value
  if (draft === null) {
    return
  }
  if (draft.channel === 'IN_APP' && draft.messages.length >= 1) {
    return
  }
  draft.messages.push({
    kind: 'TEXT',
    payload: { title: null, content: '', linkUrl: null },
    mediaPolicy: {},
    enabled: true,
  })
  markDirty()
}

function addMpnewsMessage(): void {
  const draft = activeDraft.value
  if (draft === null || draft.channel !== 'WECOM' || draft.sendMethod !== 'APP') {
    return
  }
  draft.messages.push({
    kind: 'MPNEWS',
    payload: {
      cover: null,
      title: '',
      author: null,
      digest: null,
      contentSourceUrl: null,
      content: '',
    },
    mediaPolicy: {},
    enabled: true,
  })
  markDirty()
}

function removeMessage(index: number): void {
  activeDraft.value?.messages.splice(index, 1)
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
  markDirty()
}

function textContent(message: MessageDraft): string {
  return typeof message.payload.content === 'string' ? message.payload.content : ''
}

function setTextContent(message: MessageDraft, value: string): void {
  message.payload = { ...message.payload, content: value }
  markDirty()
}

function payloadString(message: MessageDraft, key: string): string {
  const value = message.payload[key]
  return typeof value === 'string' ? value : ''
}

function setPayloadString(message: MessageDraft, key: string, value: string): void {
  message.payload = { ...message.payload, [key]: value }
  markDirty()
}

function coverAssetId(message: MessageDraft): string {
  const cover = message.payload.cover
  if (typeof cover !== 'object' || cover === null || Array.isArray(cover)) {
    return ''
  }
  const assetId = (cover as Record<string, unknown>).mediaAssetId
  return typeof assetId === 'string' ? assetId : ''
}

function coverPreviewUrl(message: MessageDraft): string {
  const assetId = coverAssetId(message)
  if (assetId === '') {
    return ''
  }
  return coverPreviewUrls.value[assetId] ?? notificationsApi.contentMedia.contentUrl(assetId)
}

function setCover(message: MessageDraft, assetId: string): void {
  message.payload = { ...message.payload, cover: { mediaAssetId: assetId } }
  markDirty()
}

function clearCover(message: MessageDraft): void {
  message.payload = { ...message.payload, cover: null }
  markDirty()
}

function chooseCover(index: number): void {
  coverTargetIndex.value = index
  coverFileInput.value?.click()
}

async function onCoverSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const index = coverTargetIndex.value
  coverTargetIndex.value = null
  const message = index === null ? undefined : activeDraft.value?.messages[index]
  if (index === null || message === undefined || file === undefined || coverUploadingIndex.value !== null) {
    return
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    coverUploadErrors.value = { ...coverUploadErrors.value, [index]: '仅支持 JPEG、PNG、WebP 图片' }
    return
  }
  if (file.size > MAXIMUM_COVER_BYTES) {
    coverUploadErrors.value = { ...coverUploadErrors.value, [index]: '封面图片不得超过 10 MiB' }
    return
  }
  coverUploadingIndex.value = index
  coverUploadErrors.value = { ...coverUploadErrors.value, [index]: '' }
  try {
    const response = await notificationsApi.contentMedia.upload(file, new AbortController().signal)
    if (!activeDraft.value?.messages.includes(message)) {
      return
    }
    coverPreviewUrls.value = {
      ...coverPreviewUrls.value,
      [response.data.assetId]: URL.createObjectURL(file),
    }
    setCover(message, response.data.assetId)
  }
  catch (failure) {
    coverUploadErrors.value = {
      ...coverUploadErrors.value,
      [index]: getApiClientFailureMessage(failure, '封面上传失败'),
    }
  }
  finally {
    coverUploadingIndex.value = null
  }
}

function messageSummary(message: MessageDraft): string {
  if (message.kind === 'TEXT') {
    return textContent(message).trim().slice(0, 80) || '空文本'
  }
  if (message.kind === 'MPNEWS') {
    return typeof message.payload.title === 'string' ? message.payload.title : 'mpnews'
  }
  return message.kind
}

function validateDraft(draft: ChannelDraft): string | null {
  if (!draft.enabled) {
    return null
  }
  if (draft.messages.length === 0) {
    return `${draft.channel === 'IN_APP' ? '站内通知' : '企业微信'}启用后必须配置消息内容`
  }
  if (draft.channel === 'IN_APP'
    && (draft.messages.length !== 1 || draft.messages[0]?.kind !== 'TEXT')) {
    return '站内通知必须配置且只配置一条文本消息'
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
  const toSave = drafts.value.filter(draft => draft.enabled || draft.expectedVersion > 0)
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
        quietHours: draft.channel === 'WECOM' && draft.quietStart.length > 0 && draft.quietEnd.length > 0
          ? { start: draft.quietStart, end: draft.quietEnd, timezone: 'Asia/Shanghai' }
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

onMounted(load)
watch(eventType, load)

onBeforeUnmount(() => {
  for (const url of Object.values(coverPreviewUrls.value)) {
    URL.revokeObjectURL(url)
  }
})
</script>

<template>
  <FaPageHeader :title="event?.label ?? '事件配置'" :description="event?.eventType ?? '加载中…'">
    <div class="flex gap-2">
      <FaButton variant="outline" @click="goBack">
        返回
      </FaButton>
      <FaButton v-if="canUpdate && event !== null" :loading="saving" @click="save">
        保存
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
      <div class="p-4 border border-border rounded-lg bg-card">
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <div>
            <div class="text-lg font-medium">
              {{ event.label }}
            </div>
            <div class="text-xs text-muted-foreground font-mono">
              {{ event.eventType }}
            </div>
          </div>
          <span v-if="!canUpdate" class="text-sm text-muted-foreground">只读</span>
        </div>
        <div class="text-sm text-muted-foreground mt-2">
          变量：{{ event.variables.length === 0 ? '未声明' : event.variables.join('、') }}
        </div>
      </div>

      <div class="border-b border-border flex gap-2">
        <button
          v-for="channel in (['IN_APP', 'WECOM'] as const)"
          :key="channel"
          type="button"
          class="text-sm px-4 py-2 transition-colors"
          :class="activeChannel === channel
            ? 'border-primary text-primary border-b-2 font-medium'
            : 'text-muted-foreground hover:text-foreground'"
          @click="activeChannel = channel"
        >
          {{ channel === 'IN_APP' ? '站内通知' : '企业微信' }}
          <span class="text-xs ml-1">{{ drafts.find(item => item.channel === channel)?.enabled ? '已启用' : '未启用' }}</span>
        </button>
      </div>

      <div v-if="activeDraft !== null" class="gap-4 grid xl:grid-cols-[minmax(0,1fr)_360px]">
        <div class="flex flex-col gap-4">
          <div class="p-4 border border-border rounded-lg bg-card">
            <label class="font-medium flex gap-2 items-center">
              <FaSwitch v-model="activeDraft.enabled" :disabled="!canUpdate" @update:model-value="markDirty" />
              启用该渠道
            </label>

            <div v-if="activeDraft.channel === 'WECOM'" class="mt-4 flex flex-col gap-2">
              <span class="text-sm font-medium">发送方式</span>
              <div class="flex gap-2">
                <FaButton
                  v-for="option in SEND_METHOD_OPTIONS"
                  :key="option.value"
                  :variant="activeDraft.sendMethod === option.value ? 'default' : 'outline'"
                  size="sm"
                  :disabled="!canUpdate"
                  @click="changeSendMethod(activeDraft, option.value)"
                >
                  {{ option.label }}
                </FaButton>
              </div>
            </div>

            <div class="mt-4 gap-3 grid md:grid-cols-2">
              <label class="text-sm flex flex-col gap-1">
                <span class="font-medium">收件人/目标</span>
                <FaSelect
                  :model-value="activeDraft.targetMode"
                  :options="targetModeOptions(activeDraft)"
                  :disabled="!canUpdate"
                  @update:model-value="value => changeTargetMode(activeDraft!, value as TargetMode)"
                />
              </label>
              <label class="text-sm flex flex-col gap-1">
                <span class="font-medium">目标值</span>
                <FaInput
                  :model-value="targetValues(activeDraft)"
                  :disabled="!canUpdate || activeDraft.targetMode === 'COMMAND_TARGET'"
                  :placeholder="TARGET_VALUE_HINT[activeDraft.targetMode]"
                  @update:model-value="value => setTargetValues(activeDraft!, value ?? '')"
                />
              </label>
            </div>

            <div v-if="activeDraft.channel === 'WECOM'" class="mt-4 gap-3 grid md:grid-cols-3">
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
                  :disabled="!canUpdate"
                  @update:model-value="value => { activeDraft!.quietStart = value ?? ''; markDirty() }"
                />
              </label>
              <label class="text-sm flex flex-col gap-1">
                <span class="font-medium">静默结束</span>
                <FaInput
                  :model-value="activeDraft.quietEnd"
                  type="time"
                  :disabled="!canUpdate"
                  @update:model-value="value => { activeDraft!.quietEnd = value ?? ''; markDirty() }"
                />
              </label>
            </div>

            <label v-if="activeDraft.channel === 'WECOM'" class="text-sm mt-4 flex gap-2 items-center">
              <FaSwitch v-model="activeDraft.allowSensitive" :disabled="!canUpdate" @update:model-value="markDirty" />
              允许敏感内容
            </label>
          </div>

          <div class="p-4 border border-border rounded-lg bg-card">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <div>
                <div class="font-medium">
                  消息内容
                </div>
                <div class="text-xs text-muted-foreground">
                  支持文本与 mpnews；正文图片仅允许 DMS 资产。
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <FaButton
                  v-if="canUpdate && activeDraft.channel === 'WECOM' && activeDraft.sendMethod === 'APP'"
                  variant="outline"
                  size="sm"
                  @click="addMpnewsMessage"
                >
                  添加 mpnews 消息
                </FaButton>
                <FaButton
                  v-if="canUpdate && (activeDraft.channel === 'WECOM' || activeDraft.messages.length === 0)"
                  variant="outline"
                  size="sm"
                  @click="addTextMessage"
                >
                  添加文本消息
                </FaButton>
              </div>
            </div>

            <div v-if="activeDraft.messages.length === 0" class="text-sm text-muted-foreground py-8 text-center">
              尚未配置消息内容
            </div>

            <div v-else class="mt-4 flex flex-col gap-3">
              <div
                v-for="(message, index) in activeDraft.messages"
                :key="`${message.kind}-${index}`"
                class="p-3 border border-border rounded-md"
              >
                <div class="flex flex-wrap gap-2 items-center">
                  <span class="text-xs font-mono px-2 py-0.5 rounded bg-muted">{{ message.kind }}</span>
                  <span class="text-xs text-muted-foreground">{{ messageSummary(message) }}</span>
                  <div class="ml-auto flex gap-1">
                    <FaButton variant="ghost" size="sm" :disabled="!canUpdate || index === 0" @click="moveMessage(index, -1)">
                      上移
                    </FaButton>
                    <FaButton variant="ghost" size="sm" :disabled="!canUpdate || index === activeDraft.messages.length - 1" @click="moveMessage(index, 1)">
                      下移
                    </FaButton>
                    <FaButton variant="ghost" size="sm" :disabled="!canUpdate" @click="removeMessage(index)">
                      删除
                    </FaButton>
                  </div>
                </div>

                <FaTextarea
                  v-if="message.kind === 'TEXT'"
                  class="mt-2"
                  :model-value="textContent(message)"
                  :disabled="!canUpdate"
                  :maxlength="2048"
                  input-class="min-h-28"
                  placeholder="输入文本内容，支持 {{变量}} 占位符"
                  @update:model-value="value => setTextContent(message, value ?? '')"
                />
                <template v-else-if="message.kind === 'MPNEWS'">
                  <div class="mt-3 flex flex-col gap-3">
                    <div class="text-sm p-3 border border-border rounded-md flex flex-wrap gap-3 items-center">
                      <div class="text-xs text-muted-foreground">
                        <div class="text-foreground font-medium">
                          固定封面
                        </div>
                        <div>建议 1068×455 或等比例倍数，不超过 10 MiB。</div>
                      </div>
                      <img
                        v-if="coverPreviewUrl(message) !== ''"
                        :src="coverPreviewUrl(message)"
                        alt="mpnews 封面预览"
                        class="border border-border rounded h-20 w-[47] object-cover"
                      >
                      <div v-else class="text-xs text-muted-foreground px-6 py-5 border border-border rounded border-dashed">
                        未选择封面
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-xs text-muted-foreground font-mono break-all">
                          {{ coverAssetId(message) || '未配置资产' }}
                        </span>
                        <div class="flex gap-2">
                          <FaButton
                            v-if="canUpdate"
                            variant="outline"
                            size="sm"
                            :loading="coverUploadingIndex === index"
                            :disabled="coverUploadingIndex !== null"
                            @click="chooseCover(index)"
                          >
                            选择封面
                          </FaButton>
                          <FaButton
                            v-if="canUpdate && coverAssetId(message) !== ''"
                            variant="ghost"
                            size="sm"
                            :disabled="coverUploadingIndex !== null"
                            @click="clearCover(message)"
                          >
                            清除
                          </FaButton>
                        </div>
                      </div>
                      <p v-if="(coverUploadErrors[index] ?? '') !== ''" class="text-xs text-destructive m-0 w-full">
                        {{ coverUploadErrors[index] }}
                      </p>
                    </div>
                    <div class="gap-3 grid md:grid-cols-2">
                      <label class="text-sm flex flex-col gap-1">
                        <span class="font-medium">标题</span>
                        <FaInput
                          :model-value="payloadString(message, 'title')"
                          :disabled="!canUpdate"
                          maxlength="128"
                          @update:model-value="value => setPayloadString(message, 'title', value ?? '')"
                        />
                      </label>
                      <label class="text-sm flex flex-col gap-1">
                        <span class="font-medium">作者</span>
                        <FaInput
                          :model-value="payloadString(message, 'author')"
                          :disabled="!canUpdate"
                          maxlength="64"
                          @update:model-value="value => setPayloadString(message, 'author', value ?? '')"
                        />
                      </label>
                      <label class="text-sm flex flex-col gap-1">
                        <span class="font-medium">摘要</span>
                        <FaInput
                          :model-value="payloadString(message, 'digest')"
                          :disabled="!canUpdate"
                          maxlength="512"
                          @update:model-value="value => setPayloadString(message, 'digest', value ?? '')"
                        />
                      </label>
                      <label class="text-sm flex flex-col gap-1">
                        <span class="font-medium">阅读原文</span>
                        <FaInput
                          :model-value="payloadString(message, 'contentSourceUrl')"
                          :disabled="!canUpdate"
                          placeholder="https://"
                          @update:model-value="value => setPayloadString(message, 'contentSourceUrl', value ?? '')"
                        />
                      </label>
                    </div>
                    <RichTextEditor
                      :model-value="payloadString(message, 'content')"
                      :disabled="!canUpdate"
                      @update:model-value="value => setPayloadString(message, 'content', value)"
                    />
                    <p class="text-xs text-muted-foreground m-0">
                      正文图片仅允许 DMS 资产，单张不超过 2 MiB；保存前图片使用本地预览。
                    </p>
                  </div>
                </template>
                <div v-else class="text-sm text-muted-foreground mt-2">
                  该类型暂未开放前端编辑。
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <div class="p-4 border border-border rounded-lg bg-card">
            <div class="font-medium">
              配置摘要
            </div>
            <dl class="text-sm mt-3 gap-x-3 gap-y-2 grid grid-cols-[auto_1fr]">
              <dt class="text-muted-foreground">
                渠道
              </dt>
              <dd>{{ activeDraft.channel === 'IN_APP' ? '站内通知' : '企业微信' }}</dd>
              <dt class="text-muted-foreground">
                方式
              </dt>
              <dd>{{ activeDraft.channel === 'IN_APP' ? '站内' : activeDraft.sendMethod === 'ROBOT' ? '群机器人' : '应用消息' }}</dd>
              <dt class="text-muted-foreground">
                消息数
              </dt>
              <dd>{{ activeDraft.messages.length }} 条</dd>
              <dt class="text-muted-foreground">
                版本
              </dt>
              <dd>{{ activeDraft.expectedVersion }}</dd>
            </dl>
          </div>
          <div v-if="dirty" class="text-sm text-amber-700 p-3 border border-amber-500/30 rounded-lg bg-amber-500/10 dark:text-amber-400">
            有未保存的修改。
          </div>
        </div>
      </div>
    </div>
  </FaPageMain>

  <input
    ref="coverFileInput"
    class="hidden"
    type="file"
    :accept="IMAGE_ONLY_ACCEPT"
    @change="onCoverSelected"
  >
</template>
