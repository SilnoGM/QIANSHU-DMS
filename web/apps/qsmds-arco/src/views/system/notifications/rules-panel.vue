<script setup lang="ts">
import type { TemplateDomain } from './template-key-grouping.logic'
import type {
  NotificationChannelPolicyDto,
  NotificationEventDto,
  NotificationTemplateDto,
} from '@/api/generated/types.gen'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import EventConfigPanel from './components/EventConfigPanel.vue'
import TemplateLibraryPanel from './components/TemplateLibraryPanel.vue'
import { buildTemplateUsageCounts, templateUsageCount } from './event-config.logic'
import { TEMPLATE_DOMAIN_OPTIONS, templateDomainLabel } from './template-key-grouping.logic'

const toast = useQsToast()
const { auth } = useAppAuth()
const canViewPolicy = computed(() => auth('notification-policy:read'))
const canViewTemplate = computed(() => auth('notification-template:read'))
const canUpdateTemplate = computed(() => auth('notification-template:update'))
const canUpdatePolicy = computed(() => auth('notification-policy:update'))

const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)
const activeTab = ref<'events' | 'templates'>(canViewPolicy.value ? 'events' : 'templates')
const events = ref<NotificationEventDto[]>([])
const policies = ref<NotificationChannelPolicyDto[]>([])
const templates = ref<NotificationTemplateDto[]>([])
const eventsError = ref<string | null>(null)
const policiesError = ref<string | null>(null)
const templatesError = ref<string | null>(null)

const tabs = computed(() => [
  ...(canViewPolicy.value ? [{ label: '事件配置', value: 'events' }] : []),
  ...(canViewTemplate.value ? [{ label: '模板库', value: 'templates' }] : []),
])
const templatesForCoverage = computed(() => canViewTemplate.value && templatesError.value === null
  ? templates.value
  : null)
const usage = computed(() => buildTemplateUsageCounts(events.value, policies.value))

const eventPanelRef = ref<InstanceType<typeof EventConfigPanel> | null>(null)
const tabDiscardOpen = ref(false)
const pendingTab = ref<'events' | 'templates' | null>(null)
const leaveOpen = ref(false)
const pendingRoute = ref<string | null>(null)
const router = useRouter()

watch(
  tabs,
  (availableTabs) => {
    if (availableTabs.length > 0 && !availableTabs.some(tab => tab.value === activeTab.value)) {
      activeTab.value = availableTabs[0]!.value as 'events' | 'templates'
    }
  },
  { immediate: true },
)

interface TemplateVariableDraft {
  name: string
  required: boolean
  maxLength: number
  sensitive: boolean
}

const templateOpen = ref(false)
const templateMode = ref<'create' | 'edit'>('create')
const templateAboveDrawer = ref(false)
const templateBaseline = ref('')
const templateDraft = ref({
  id: '',
  key: '',
  channel: 'ASSISTANT' as 'IN_APP' | 'ASSISTANT',
  name: '',
  domain: 'SYSTEM' as TemplateDomain,
  titleTemplate: '',
  bodyTemplate: '',
  linkUrlTemplate: '',
  variables: [] as TemplateVariableDraft[],
  maxLength: 2000,
  enabled: true,
  expectedVersion: 1,
})

const previewOpen = ref(false)
const previewTemplate = ref<NotificationTemplateDto | null>(null)
const previewVariables = ref('{}')
const previewContent = ref('')
const previewLink = ref<string | null>(null)
const previewTruncated = ref(false)
const previewWarnings = ref<string[]>([])

const discardOpen = ref(false)

const CHANNEL_OPTIONS = [
  { label: '千树小助理', value: 'ASSISTANT' },
  { label: '站内通知', value: 'IN_APP' },
]

const templateOtherChannel = computed(() => {
  const key = templateDraft.value.key.trim()
  if (key.length === 0) {
    return null
  }
  return templates.value.find(template =>
    template.key === key && template.channel !== templateDraft.value.channel) ?? null
})

const templateDraftUsage = computed(() => templateUsageCount(usage.value, templateDraft.value.key.trim()))

function formatChannel(channel: string): string {
  return channel === 'ASSISTANT' ? '千树小助理' : '站内通知'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  eventsError.value = null
  policiesError.value = null
  templatesError.value = null
  const signal = new AbortController().signal
  await Promise.all([
    (async () => {
      if (!canViewPolicy.value && !canViewTemplate.value) {
        return
      }
      try {
        events.value = (await notificationsApi.events.list(signal)).data
      }
      catch (failure) {
        eventsError.value = getApiClientFailureMessage(failure, '事件列表加载失败')
      }
    })(),
    (async () => {
      if (!canViewPolicy.value) {
        return
      }
      try {
        policies.value = (await notificationsApi.policies.list({}, signal)).data
      }
      catch (failure) {
        policiesError.value = getApiClientFailureMessage(failure, '事件策略加载失败')
      }
    })(),
    (async () => {
      if (!canViewTemplate.value) {
        return
      }
      try {
        const [assistantTemplates, inappTemplates] = await Promise.all([
          notificationsApi.templates.list('ASSISTANT', signal),
          notificationsApi.templates.list('IN_APP', signal),
        ])
        templates.value = [...assistantTemplates.data, ...inappTemplates.data]
      }
      catch (failure) {
        templatesError.value = getApiClientFailureMessage(failure, '模板列表加载失败')
      }
    })(),
  ])
  if (!canViewPolicy.value && !canViewTemplate.value) {
    error.value = '当前账号没有通知策略或模板查看权限。'
  }
  loading.value = false
}

async function reloadTemplates(): Promise<void> {
  if (!canViewTemplate.value) {
    return
  }
  const signal = new AbortController().signal
  try {
    const [assistantTemplates, inappTemplates] = await Promise.all([
      notificationsApi.templates.list('ASSISTANT', signal),
      notificationsApi.templates.list('IN_APP', signal),
    ])
    templates.value = [...assistantTemplates.data, ...inappTemplates.data]
    templatesError.value = null
  }
  catch (failure) {
    templatesError.value = getApiClientFailureMessage(failure, '模板列表加载失败')
  }
}

function handlePolicySaved(policy: NotificationChannelPolicyDto): void {
  const index = policies.value.findIndex(item =>
    item.eventType === policy.eventType && item.channel === policy.channel)
  policies.value = index >= 0
    ? policies.value.map((item, itemIndex) => itemIndex === index ? policy : item)
    : [...policies.value, policy]
}

function handleTabChange(value: string | number): void {
  const next = String(value) === 'templates' ? 'templates' : 'events'
  if (activeTab.value === next) {
    return
  }
  if (activeTab.value === 'events' && next === 'templates' && eventPanelRef.value?.hasDirty() === true) {
    pendingTab.value = next
    tabDiscardOpen.value = true
    return
  }
  activeTab.value = next
}

function confirmTabDiscard(): void {
  eventPanelRef.value?.discard()
  activeTab.value = pendingTab.value ?? activeTab.value
  pendingTab.value = null
  tabDiscardOpen.value = false
}

function cancelTabDiscard(): void {
  pendingTab.value = null
  tabDiscardOpen.value = false
}

function hasUnsavedChanges(): boolean {
  const templateDirty = templateOpen.value
    && JSON.stringify(templateDraft.value) !== templateBaseline.value
  return eventPanelRef.value?.hasDirty() === true || templateDirty
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedChanges()) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

function confirmLeave(): void {
  if (eventPanelRef.value?.hasDirty() === true) {
    eventPanelRef.value.discard()
  }
  if (templateOpen.value) {
    templateBaseline.value = JSON.stringify(templateDraft.value)
    templateOpen.value = false
  }
  const target = pendingRoute.value
  pendingRoute.value = null
  leaveOpen.value = false
  if (target !== null) {
    void router.push(target)
  }
}

function cancelLeave(): void {
  pendingRoute.value = null
  leaveOpen.value = false
}

onBeforeRouteLeave((to) => {
  if (!hasUnsavedChanges()) {
    return true
  }
  pendingRoute.value = to.fullPath
  leaveOpen.value = true
  return false
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

function requestDiscard(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  discardOpen.value = true
  return false
}

function canCloseTemplateModal(): boolean {
  return JSON.stringify(templateDraft.value) === templateBaseline.value || requestDiscard()
}

function confirmDiscard(): void {
  templateBaseline.value = JSON.stringify(templateDraft.value)
  templateOpen.value = false
  discardOpen.value = false
}

function openCreateTemplate(): void {
  templateMode.value = 'create'
  templateAboveDrawer.value = false
  templateDraft.value = {
    id: '',
    key: '',
    channel: 'ASSISTANT',
    name: '',
    domain: 'SYSTEM',
    titleTemplate: '',
    bodyTemplate: '',
    linkUrlTemplate: '',
    variables: [],
    maxLength: 2000,
    enabled: true,
    expectedVersion: 1,
  }
  templateBaseline.value = JSON.stringify(templateDraft.value)
  templateOpen.value = true
}

function openCreateTemplateForChannel(payload: {
  key: string
  domain: TemplateDomain
  channel: 'ASSISTANT' | 'IN_APP'
}): void {
  templateMode.value = 'create'
  templateAboveDrawer.value = false
  templateDraft.value = {
    id: '',
    key: payload.key,
    channel: payload.channel,
    name: '',
    domain: payload.domain,
    titleTemplate: '',
    bodyTemplate: '',
    linkUrlTemplate: '',
    variables: [],
    maxLength: 2000,
    enabled: true,
    expectedVersion: 1,
  }
  templateBaseline.value = JSON.stringify(templateDraft.value)
  templateOpen.value = true
}

function openCreateTemplateFromEvent(payload: {
  eventType: string
  channel: 'ASSISTANT' | 'IN_APP'
  key: string
}): void {
  const event = events.value.find(item => item.eventType === payload.eventType)
  templateMode.value = 'create'
  templateAboveDrawer.value = true
  templateDraft.value = {
    id: '',
    key: payload.key || event?.defaultTemplateKey || '',
    channel: payload.channel,
    name: '',
    domain: event?.domain ?? 'SYSTEM',
    titleTemplate: '',
    bodyTemplate: '',
    linkUrlTemplate: '',
    variables: [],
    maxLength: 2000,
    enabled: true,
    expectedVersion: 1,
  }
  templateBaseline.value = JSON.stringify(templateDraft.value)
  templateOpen.value = true
}

function openEditTemplate(template: NotificationTemplateDto, aboveDrawer = false): void {
  templateMode.value = 'edit'
  templateAboveDrawer.value = aboveDrawer
  templateDraft.value = {
    id: template.id,
    key: template.key,
    channel: template.channel as 'IN_APP' | 'ASSISTANT',
    name: template.name,
    domain: template.domain,
    titleTemplate: template.titleTemplate ?? '',
    bodyTemplate: template.bodyTemplate,
    linkUrlTemplate: template.linkUrlTemplate ?? '',
    variables: template.variables.map(variable => ({
      name: variable.name,
      required: variable.required ?? false,
      maxLength: variable.maxLength ?? 200,
      sensitive: variable.sensitive ?? false,
    })),
    maxLength: template.maxLength,
    enabled: template.enabled,
    expectedVersion: template.version,
  }
  templateBaseline.value = JSON.stringify(templateDraft.value)
  templateOpen.value = true
}

function parseVariables(raw: string): Record<string, string | number | null> {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('变量必须是 JSON 对象')
  }
  return parsed as Record<string, string | number | null>
}

function addTemplateVariable(): void {
  templateDraft.value.variables.push({ name: '', required: false, maxLength: 200, sensitive: false })
}

function removeTemplateVariable(index: number): void {
  templateDraft.value.variables.splice(index, 1)
}

function normalizedTemplateVariables(): TemplateVariableDraft[] {
  return templateDraft.value.variables
    .map(variable => ({
      name: variable.name.trim(),
      required: variable.required,
      maxLength: variable.maxLength,
      sensitive: variable.sensitive,
    }))
    .filter(variable => variable.name.length > 0)
}

const templateVariableError = computed(() => {
  for (const variable of templateDraft.value.variables) {
    const name = variable.name.trim()
    if (name.length === 0) {
      return '变量名不能为空'
    }
    if (!/^\w+$/u.test(name)) {
      return `变量名「${name}」只能包含字母、数字和下划线`
    }
    if (!Number.isInteger(variable.maxLength) || variable.maxLength < 1 || variable.maxLength > 200) {
      return `变量「${name}」的最大长度必须是 1–200`
    }
  }
  return null
})

const canSaveTemplate = computed(() => {
  return canUpdateTemplate.value
    && /^[\w.-]+$/u.test(templateDraft.value.key.trim())
    && templateDraft.value.name.trim().length > 0
    && templateDraft.value.bodyTemplate.trim().length > 0
    && Number.isInteger(templateDraft.value.maxLength)
    && templateDraft.value.maxLength >= 1
    && templateDraft.value.maxLength <= 5000
    && templateVariableError.value === null
})

async function saveTemplate(): Promise<void> {
  busy.value = true
  try {
    const variables = normalizedTemplateVariables()
    if (templateMode.value === 'create') {
      await notificationsApi.templates.create({
        key: templateDraft.value.key,
        channel: templateDraft.value.channel,
        name: templateDraft.value.name,
        domain: templateDraft.value.domain,
        bodyTemplate: templateDraft.value.bodyTemplate,
        titleTemplate: templateDraft.value.titleTemplate || null,
        linkUrlTemplate: templateDraft.value.linkUrlTemplate || null,
        variables,
        maxLength: templateDraft.value.maxLength,
        enabled: templateDraft.value.enabled,
      })
    }
    else {
      await notificationsApi.templates.update(templateDraft.value.id, {
        name: templateDraft.value.name,
        ...(templateOtherChannel.value === null ? { domain: templateDraft.value.domain } : {}),
        bodyTemplate: templateDraft.value.bodyTemplate,
        titleTemplate: templateDraft.value.titleTemplate || null,
        linkUrlTemplate: templateDraft.value.linkUrlTemplate || null,
        variables,
        maxLength: templateDraft.value.maxLength,
        enabled: templateDraft.value.enabled,
        expectedVersion: templateDraft.value.expectedVersion,
      })
    }
    templateBaseline.value = JSON.stringify(templateDraft.value)
    templateOpen.value = false
    toast.success('模板已保存')
    await reloadTemplates()
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '模板保存失败'))
  }
  finally {
    busy.value = false
  }
}

function openPreview(template: NotificationTemplateDto): void {
  previewTemplate.value = template
  previewVariables.value = JSON.stringify(
    Object.fromEntries(template.variables.map(variable => [variable.name, `示例${variable.name}`])),
    null,
    2,
  )
  previewContent.value = ''
  previewLink.value = null
  previewTruncated.value = false
  previewWarnings.value = []
  previewOpen.value = true
}

async function preview(): Promise<void> {
  if (previewTemplate.value === null) {
    return
  }
  busy.value = true
  try {
    const result = (await notificationsApi.templates.preview(previewTemplate.value.id, {
      variables: parseVariables(previewVariables.value),
    })).data
    previewContent.value = result.content
    previewLink.value = result.linkUrl
    previewTruncated.value = result.truncated
    previewWarnings.value = result.warnings
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '模板预览失败'))
  }
  finally {
    busy.value = false
  }
}

async function testTemplate(): Promise<void> {
  if (previewTemplate.value === null) {
    return
  }
  busy.value = true
  try {
    await notificationsApi.templates.test(previewTemplate.value.id, {
      variables: parseVariables(previewVariables.value),
    })
    toast.success('测试消息已提交，请确认公司号文件传输助手已收到')
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '测试发送失败'))
  }
  finally {
    busy.value = false
  }
}

async function toggleTemplateEnabled(template: NotificationTemplateDto, enabled: boolean): Promise<void> {
  busy.value = true
  try {
    const updated = (await notificationsApi.templates.update(template.id, {
      enabled,
      expectedVersion: template.version,
    })).data
    templates.value = templates.value.map(item => item.id === updated.id ? updated : item)
    toast.success(enabled ? '模板已启用' : '模板已停用')
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '模板状态更新失败'))
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <FaPageMain v-if="error !== null" class="my-2!">
    <FaAlert variant="destructive" :title="error">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="load">
          重试
        </FaButton>
      </template>
    </FaAlert>
  </FaPageMain>

  <FaPageMain v-else-if="loading" class="my-2!">
    <div class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
      正在加载通知策略…
    </div>
  </FaPageMain>

  <template v-else>
    <FaPageMain class="my-2!">
      <template v-if="tabs.length > 0">
        <QsStatusSwitchToolbar
          :model-value="activeTab"
          :items="tabs"
          aria-label="通知策略视图"
          class="w-full"
          stretch
          data-testid="notification-policy-view-switch"
          @update:model-value="handleTabChange"
        />

        <EventConfigPanel
          v-show="activeTab === 'events'"
          ref="eventPanelRef"
          class="mt-4"
          :events="events"
          :policies="policies"
          :templates="templatesForCoverage"
          :events-error="eventsError"
          :policies-error="policiesError"
          :templates-error="templatesError"
          :can-update-policy="canUpdatePolicy"
          :can-update-template="canUpdateTemplate"
          :can-view-policy="canViewPolicy"
          :can-view-template="canViewTemplate"
          :busy="busy"
          @saved="handlePolicySaved"
          @retry="load"
          @edit-template="openEditTemplate($event, true)"
          @preview-template="openPreview"
          @create-template="openCreateTemplateFromEvent"
        />

        <TemplateLibraryPanel
          v-show="activeTab === 'templates'"
          class="mt-4"
          :templates="templates"
          :usage="usage"
          :loading-error="templatesError"
          :can-update="canUpdateTemplate"
          :busy="busy"
          @create="openCreateTemplate"
          @add="openCreateTemplateForChannel"
          @edit="openEditTemplate"
          @preview="openPreview"
          @toggle="toggleTemplateEnabled"
        />
      </template>

      <FaEmpty
        v-else
        icon="i-lucide:shield-alert"
        title="暂无查看权限"
        description="当前账号缺少通知策略或模板读取权限。"
        class="min-h-64"
      />
    </FaPageMain>
  </template>

  <QsGenericModal v-model="templateOpen" :title="templateMode === 'create' ? '新建模板' : '编辑模板'" size="2xl" :z-index="2200" :submitting="busy" :before-close="canCloseTemplateModal" @update:model-value="templateOpen = $event">
    <div class="flex flex-col gap-5">
      <FaAlert
        v-if="templateDraftUsage > 1"
        :title="`该模板键被 ${templateDraftUsage} 个事件使用`"
        description="修改内容会同时影响这些事件的下一次发送。"
      />
      <section class="flex flex-col gap-3">
        <h3 class="qs-type-body-medium m-0">
          基础信息
        </h3>
        <div class="gap-3 grid md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">模板键</span>
            <FaInput v-model="templateDraft.key" class="w-full" :disabled="templateMode === 'edit'" placeholder="purchase.review.pending" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">渠道</span>
            <template v-if="templateAboveDrawer">
              <div class="px-3 py-2 border border-border rounded-md bg-muted/30">
                {{ formatChannel(templateDraft.channel) }}
              </div>
              <span class="qs-type-meta text-muted-foreground">由当前事件渠道决定。</span>
            </template>
            <FaSelect v-else v-model="templateDraft.channel" class="w-full" :options="CHANNEL_OPTIONS" :disabled="templateMode === 'edit'" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">名称</span>
            <FaInput v-model="templateDraft.name" class="w-full" placeholder="采购审核待办" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">业务域</span>
            <template v-if="templateAboveDrawer">
              <div class="px-3 py-2 border border-border rounded-md bg-muted/30">
                {{ templateDomainLabel(templateDraft.domain) }}
              </div>
              <span class="qs-type-meta text-muted-foreground">业务域随事件确定；需要调整请在模板库中编辑。</span>
            </template>
            <template v-else>
              <FaSelect
                v-model="templateDraft.domain"
                class="w-full"
                :options="TEMPLATE_DOMAIN_OPTIONS"
                :disabled="templateOtherChannel !== null"
              />
              <span v-if="templateOtherChannel !== null" class="qs-type-meta text-muted-foreground">
                同一模板键在{{ formatChannel(templateOtherChannel.channel) }}已使用「{{ templateDomainLabel(templateOtherChannel.domain) }}」，业务域已锁定。
              </span>
            </template>
          </label>
          <p v-if="templateMode === 'edit'" class="qs-type-meta text-muted-foreground m-0 md:col-span-2">
            模板键与渠道创建后不可修改；需要换渠道请新建对应模板。
          </p>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">最大长度</span>
            <FaInput v-model.number="templateDraft.maxLength" class="w-full" type="number" min="1" max="5000" />
            <span class="qs-type-meta text-muted-foreground">1–5000，正文渲染后的字符上限。</span>
          </label>
          <div class="flex flex-wrap gap-4 items-end md:col-span-2">
            <label v-if="templateDraft.channel === 'IN_APP'" class="flex flex-1 flex-col gap-1 min-w-0">
              <span class="qs-type-compact-label">标题（站内通知使用）</span>
              <FaInput v-model="templateDraft.titleTemplate" class="w-full" placeholder="采购单 {{ orderNo }} 待审核" />
            </label>
            <label class="qs-type-meta pb-2 flex gap-2 items-center">
              <FaSwitch v-model="templateDraft.enabled" />
              启用
            </label>
          </div>
        </div>
      </section>

      <section class="pt-4 border-t border-border flex flex-col gap-3">
        <h3 class="qs-type-body-medium m-0">
          消息内容
        </h3>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">正文（支持 &#123;&#123;variable&#125;&#125;）</span>
          <textarea v-model="templateDraft.bodyTemplate" rows="7" class="qs-type-body px-3 py-2 border border-border rounded-md bg-background w-full" />
          <span class="qs-type-meta text-muted-foreground">占位符必须使用双花括号；单花括号不会替换，保存会被拒绝。</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">跳转链接模板（可选）</span>
          <FaInput v-model="templateDraft.linkUrlTemplate" class="w-full" placeholder="/operations/purchase-orders/{{ orderId }}" />
          <span class="qs-type-meta text-muted-foreground">填写后站内通知详情页显示跳转入口；占位符必须先在变量白名单声明。</span>
        </label>
      </section>

      <section class="pt-4 border-t border-border flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <h3 class="qs-type-body-medium m-0">
            变量白名单
          </h3>
          <FaButton variant="outline" size="sm" @click="addTemplateVariable">
            添加变量
          </FaButton>
        </div>
        <p v-if="templateVariableError !== null" class="qs-type-meta text-destructive m-0">
          {{ templateVariableError }}
        </p>
        <p v-if="templateDraft.variables.length === 0" class="qs-type-meta text-muted-foreground m-0">
          还没有变量。正文只允许使用这里声明的变量。
        </p>
        <div v-else class="border border-border rounded-lg overflow-x-auto">
          <div class="px-3 py-2 bg-muted/40 gap-2 grid grid-cols-[minmax(0,1fr)_88px_64px_64px_32px] min-w-[520px] items-center">
            <span class="qs-type-compact-label">变量名</span>
            <span class="qs-type-compact-label">最大长度</span>
            <span class="qs-type-compact-label text-center">必填</span>
            <span class="qs-type-compact-label text-center">敏感</span>
            <span />
          </div>
          <div
            v-for="(variable, index) in templateDraft.variables"
            :key="index"
            class="px-3 py-2 border-t border-border/60 gap-2 grid grid-cols-[minmax(0,1fr)_88px_64px_64px_32px] min-w-[520px] items-center"
          >
            <FaInput
              v-model="variable.name"
              class="w-full"
              :aria-label="`第 ${index + 1} 个变量的变量名`"
              placeholder="orderNo"
            />
            <FaInput
              v-model.number="variable.maxLength"
              class="w-full"
              type="number"
              min="1"
              max="200"
              :aria-label="`第 ${index + 1} 个变量的最大长度`"
            />
            <FaSwitch v-model="variable.required" class="justify-self-center" :aria-label="`第 ${index + 1} 个变量必填`" />
            <FaSwitch v-model="variable.sensitive" class="justify-self-center" :aria-label="`第 ${index + 1} 个变量敏感`" />
            <FaButton
              variant="ghost"
              size="icon-sm"
              class="justify-self-center"
              :aria-label="`删除变量 ${variable.name || index + 1}`"
              @click="removeTemplateVariable(index)"
            >
              <FaIcon name="i-lucide:trash-2" class="size-4" aria-hidden="true" />
            </FaButton>
          </div>
        </div>
        <p class="qs-type-meta text-muted-foreground m-0">
          变量名只允许字母、数字和下划线；正文中的 &#123;&#123;name&#125;&#125; 必须在这里声明。
        </p>
      </section>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="busy" @click="templateOpen = false">
        取消
      </FaButton>
      <FaButton :loading="busy" :disabled="!canSaveTemplate" @click="saveTemplate">
        保存
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    v-model="previewOpen"
    :title="previewTemplate === null ? '模板预览' : `模板预览 · ${previewTemplate.name}`"
    size="lg"
    :z-index="2200"
    :submitting="busy"
    @update:model-value="previewOpen = $event"
  >
    <div class="flex flex-col gap-3">
      <p v-if="previewTemplate !== null" class="qs-type-meta text-muted-foreground m-0">
        模板键：{{ previewTemplate.key }} · 渠道：{{ formatChannel(previewTemplate.channel) }}
      </p>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">样例变量（JSON 对象）</span>
        <textarea v-model="previewVariables" rows="4" class="qs-type-data px-3 py-2 border border-border rounded-md bg-background w-full" />
      </label>
      <p v-if="previewContent.length === 0" class="qs-type-meta text-muted-foreground m-0">
        点击「预览」生成渲染结果。
      </p>
      <pre v-if="previewContent" class="qs-type-body p-3 border border-border rounded-lg bg-muted/40 whitespace-pre-wrap">{{ previewContent }}</pre>
      <p v-if="previewTruncated" class="qs-type-meta text-amber-700 m-0 dark:text-amber-300">
        内容超过模板最大长度，预览已截断。
      </p>
      <ul v-if="previewWarnings.length > 0" class="qs-type-meta text-amber-700 m-0 pl-5 list-disc dark:text-amber-300">
        <li v-for="warning in previewWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <p v-if="previewLink" class="qs-type-meta text-muted-foreground break-all">
        链接：{{ previewLink }}
      </p>
      <p v-if="previewTemplate?.channel === 'IN_APP'" class="qs-type-meta text-muted-foreground m-0">
        站内模板不支持测试发送，仅千树小助理模板可以测试外发。
      </p>
    </div>
    <template #footer>
      <FaButton variant="outline" :loading="busy" @click="preview">
        预览
      </FaButton>
      <FaButton :loading="busy" :disabled="!canUpdateTemplate || previewTemplate?.channel !== 'ASSISTANT'" @click="testTemplate">
        测试发送
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="discardOpen" title="放弃修改" size="sm" :z-index="2200" @update:model-value="discardOpen = $event">
    <p class="qs-type-body m-0">
      有未保存的修改，关闭后这些修改会丢失。
    </p>
    <template #footer>
      <FaButton variant="outline" @click="discardOpen = false">
        继续编辑
      </FaButton>
      <FaButton variant="destructive" @click="confirmDiscard">
        放弃修改
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="tabDiscardOpen" title="放弃修改" size="sm" :z-index="2200" @update:model-value="cancelTabDiscard">
    <p class="qs-type-body m-0">
      事件配置有未保存的修改，切换到模板库后这些修改会丢失。
    </p>
    <template #footer>
      <FaButton variant="outline" @click="cancelTabDiscard">
        继续编辑
      </FaButton>
      <FaButton variant="destructive" @click="confirmTabDiscard">
        放弃修改
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="leaveOpen" title="放弃修改" size="sm" :z-index="2300" @update:model-value="cancelLeave">
    <p class="qs-type-body m-0">
      页面有未保存的修改，离开后这些修改会丢失。
    </p>
    <template #footer>
      <FaButton variant="outline" @click="cancelLeave">
        继续编辑
      </FaButton>
      <FaButton variant="destructive" @click="confirmLeave">
        离开页面
      </FaButton>
    </template>
  </QsGenericModal>
</template>
