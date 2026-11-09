<script setup lang="ts">
import type { TemplateDomain, TemplateKeyGroup } from './template-key-grouping.logic'
import type {
  AssistantTargetDto,
  NotificationChannelPolicyDto,
  NotificationTemplateDto,
  PermissionDto,
  RoleDto,
  UserDto,
} from '@/api/generated/types.gen'

import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import { computed, onMounted, ref, watch } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import TemplateDomainRail from './components/TemplateDomainRail.vue'
import TemplateKeyDetail from './components/TemplateKeyDetail.vue'
import {
  filterTemplateDomainGroups,
  formatNotificationDateTime,
  groupTemplateKeysByDomain,
  groupTemplatesByKey,
  TEMPLATE_DOMAIN_OPTIONS,

  templateDomainLabel,

} from './template-key-grouping.logic'

const toast = useQsToast()
const { auth } = useAppAuth()
const canUpdateTemplate = computed(() => auth('notification-template:update'))
const canUpdatePolicy = computed(() => auth('notification-policy:update'))

const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)
const templates = ref<NotificationTemplateDto[]>([])
const policies = ref<NotificationChannelPolicyDto[]>([])

interface TemplateVariableDraft {
  name: string
  required: boolean
  maxLength: number
  sensitive: boolean
}

const templateOpen = ref(false)
const templateMode = ref<'create' | 'edit'>('create')
const templateBaseline = ref('')
const templateDraft = ref({
  id: '',
  key: '',
  channel: 'ASSISTANT' as 'IN_APP' | 'ASSISTANT',
  name: '',
  domain: 'SYSTEM' as TemplateDomain,
  messageKind: 'TEXT' as 'TEXT' | 'LINK',
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

interface PolicyTargetConfigDraft {
  permissionCode: string
  roleCodes: string[]
  targetKeys: string[]
  userIds: string[]
}

const policyOpen = ref(false)
const policyEditingExisting = ref(false)
const policyBaseline = ref('')
const discardOpen = ref(false)
const discardKind = ref<'policy' | 'template' | null>(null)
const policyEventType = ref('PURCHASE_REVIEW_PENDING')
const policyChannel = ref<'IN_APP' | 'ASSISTANT'>('ASSISTANT')
const policyDraft = ref({
  targetMode: 'COMMAND_TARGET',
  targetConfig: {
    permissionCode: '',
    roleCodes: [],
    targetKeys: [],
    userIds: [],
  } as PolicyTargetConfigDraft,
  templateKey: '',
  priority: 'NORMAL',
  ttlSeconds: 86_400,
  quietHoursEnabled: false,
  quietStart: '20:00',
  quietEnd: '08:00',
  quietTimezone: 'Asia/Shanghai',
  allowSensitive: true,
  enabled: true,
  expectedVersion: 0,
})

const EVENT_OPTIONS = [
  { label: '采购审核', value: 'PURCHASE_REVIEW_PENDING' },
  { label: '开票申请', value: 'INVOICE_REQUEST_REVIEW_PENDING' },
  { label: '对账完成', value: 'SLH_RECONCILIATION_COMPLETED' },
  { label: '货件到仓', value: 'SHIPMENT_ARRIVED' },
  { label: '提现审核', value: 'FUND_WITHDRAWAL_REVIEW_PENDING' },
  { label: '包装待付款', value: 'PACKAGING_COST_PAYMENT_PENDING' },
  { label: '采购待付款', value: 'PURCHASE_PAYABLE_PENDING' },
]
const CHANNEL_OPTIONS = [
  { label: '千树小助理', value: 'ASSISTANT' },
  { label: '站内通知', value: 'IN_APP' },
]
const TARGET_MODE_OPTIONS = [
  { label: '使用命令目标', value: 'COMMAND_TARGET' },
  { label: '固定员工', value: 'USERS' },
  { label: '角色', value: 'ROLE' },
  { label: '权限', value: 'PERMISSION' },
  { label: '群目标', value: 'GROUP' },
]
const TARGET_MODE_LABELS: Record<string, string> = {
  COMMAND_TARGET: '命令目标',
  USERS: '固定员工',
  ROLE: '角色',
  PERMISSION: '权限',
  GROUP: '群目标',
}
const PRIORITY_LABELS: Record<string, string> = {
  NORMAL: '普通',
  HIGH: '高',
}
const EVENT_DOMAIN_MAP: Record<string, TemplateDomain> = {
  PURCHASE_REVIEW_PENDING: 'PURCHASE',
  INVOICE_REQUEST_REVIEW_PENDING: 'INVOICE',
  SLH_RECONCILIATION_COMPLETED: 'RECONCILIATION',
  SHIPMENT_ARRIVED: 'SHIPMENT',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'FINANCE',
  PACKAGING_COST_PAYMENT_PENDING: 'FINANCE',
  PURCHASE_PAYABLE_PENDING: 'FINANCE',
}
const EVENT_LABELS: Record<string, string> = Object.fromEntries(EVENT_OPTIONS.map(option => [option.value, option.label]))
const CHANNEL_FILTER_OPTIONS = [
  { label: '全部渠道', value: 'ALL' },
  ...CHANNEL_OPTIONS,
]
const STATUS_FILTER_OPTIONS = [
  { label: '全部状态', value: 'ALL' },
  { label: '启用', value: 'ENABLED' },
  { label: '停用', value: 'DISABLED' },
]
const templateSearch = ref('')
const selectedTemplateKey = ref<string | null>(null)
const policyKeyword = ref('')
const policyChannelFilter = ref('ALL')
const policyStatusFilter = ref('ALL')

function formatEventType(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType
}

function formatTtl(seconds: number | null): string {
  if (seconds === null) {
    return '—'
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} 分钟`
  }
  const hours = seconds / 3600
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`
}

const policyUsers = ref<UserDto[]>([])
const policyRoles = ref<RoleDto[]>([])
const policyPermissions = ref<PermissionDto[]>([])
const policyTargets = ref<AssistantTargetDto[]>([])
const policyOptionsLoading = ref(false)
const policyOptionsLoaded = ref(false)
const policyUserOptions = computed(() => policyUsers.value.map(user => ({
  label: `${user.displayName}（${user.username}）`,
  value: user.id,
})))
const policyRoleOptions = computed(() => policyRoles.value.map(role => ({
  label: `${role.name}（${role.code}）`,
  value: role.code,
})))
const policyPermissionOptions = computed(() => policyPermissions.value.map(permission => ({
  label: `${permission.name}（${permission.code}）`,
  value: permission.code,
})))
const policyGroupOptions = computed(() => policyTargets.value.map(target => ({
  label: `${target.name}（${target.key}）`,
  value: target.key,
})))

async function ensurePolicyOptions(): Promise<void> {
  if (policyOptionsLoaded.value || policyOptionsLoading.value) {
    return
  }
  policyOptionsLoading.value = true
  const signal = new AbortController().signal
  const [users, roles, permissions, targets] = await Promise.allSettled([
    managementApi.users.list({ page: 1, pageSize: 100, status: 'ACTIVE' }, signal),
    managementApi.roles.list(),
    managementApi.permissions.list(),
    notificationsApi.assistant.targets.list(signal),
  ])
  if (users.status === 'fulfilled') {
    policyUsers.value = users.value.data.items
  }
  if (roles.status === 'fulfilled') {
    policyRoles.value = roles.value.data
  }
  if (permissions.status === 'fulfilled') {
    policyPermissions.value = permissions.value.data
  }
  if (targets.status === 'fulfilled') {
    policyTargets.value = targets.value.data
  }
  policyOptionsLoaded.value = true
  policyOptionsLoading.value = false
}

const policyColumns: QsGenericTableColumn<NotificationChannelPolicyDto>[] = [
  { accessorKey: 'eventType', id: 'eventType', title: '事件', minWidth: 180 },
  { accessorKey: 'channel', id: 'channel', title: '渠道', width: 130 },
  { accessorKey: 'targetMode', id: 'targetMode', title: '目标', width: 110 },
  { accessorKey: 'templateKey', id: 'templateKey', title: '模板', minWidth: 160 },
  { accessorKey: 'priority', id: 'priority', title: '优先级', width: 80 },
  { accessorKey: 'ttlSeconds', id: 'ttlSeconds', title: 'TTL', width: 100 },
  { accessorKey: 'updatedByName', id: 'updatedByInfo', title: '更新人', width: 170 },
  { accessorKey: 'enabled', id: 'enabled', title: '状态', width: 90 },
]

const templateKeyOptions = computed(() => templates.value
  .filter(template => template.channel === policyChannel.value)
  .map(template => ({ label: template.key, value: template.key })))
const policyTargetModeOptions = computed(() => policyChannel.value === 'IN_APP'
  ? TARGET_MODE_OPTIONS.filter(option => option.value !== 'GROUP')
  : TARGET_MODE_OPTIONS)
const policyExisting = computed(() => policies.value.find(policy =>
  policy.eventType === policyEventType.value && policy.channel === policyChannel.value) ?? null)
const selectedPolicyTemplate = computed(() => templates.value.find(template =>
  template.channel === policyChannel.value && template.key === policyDraft.value.templateKey) ?? null)
const policyEventDomain = computed<TemplateDomain>(() => EVENT_DOMAIN_MAP[policyEventType.value] ?? 'SYSTEM')
const policyTemplateDomainMismatch = computed(() => {
  const template = selectedPolicyTemplate.value
  return template !== null
    && template.domain !== 'SYSTEM'
    && policyEventDomain.value !== 'SYSTEM'
    && template.domain !== policyEventDomain.value
})
const templateKeyGroups = computed(() => groupTemplatesByKey(templates.value))
const templateDomainGroups = computed(() => groupTemplateKeysByDomain(templateKeyGroups.value))
const visibleTemplateDomainGroups = computed(() => filterTemplateDomainGroups(templateDomainGroups.value, templateSearch.value))
const selectedTemplateGroup = computed<TemplateKeyGroup | null>(() => {
  const current = templateKeyGroups.value.find(group => group.key === selectedTemplateKey.value)
  if (current !== undefined) {
    return current
  }
  return visibleTemplateDomainGroups.value[0]?.keys[0] ?? null
})
watch(
  visibleTemplateDomainGroups,
  (groups) => {
    const visibleKeys = groups.flatMap(group => group.keys)
    if (!visibleKeys.some(group => group.key === selectedTemplateKey.value)) {
      selectedTemplateKey.value = visibleKeys[0]?.key ?? null
    }
  },
  { immediate: true },
)
const templateOtherChannel = computed(() => {
  const key = templateDraft.value.key.trim()
  if (key.length === 0) {
    return null
  }
  return templates.value.find(template =>
    template.key === key && template.channel !== templateDraft.value.channel) ?? null
})
watch(
  () => [templateDraft.value.key, templateDraft.value.channel],
  () => {
    if (!templateOpen.value || templateMode.value !== 'create' || templateOtherChannel.value === null) {
      return
    }
    templateDraft.value.domain = templateOtherChannel.value.domain
  },
)
const filteredPolicies = computed(() => {
  const keyword = policyKeyword.value.trim().toLowerCase()
  return policies.value.filter((policy) => {
    if (policyChannelFilter.value !== 'ALL' && policy.channel !== policyChannelFilter.value) {
      return false
    }
    if (policyStatusFilter.value === 'ENABLED' && !policy.enabled) {
      return false
    }
    if (policyStatusFilter.value === 'DISABLED' && policy.enabled) {
      return false
    }
    if (keyword.length === 0) {
      return true
    }
    return [
      policy.eventType,
      formatEventType(policy.eventType),
      policy.templateKey ?? '',
      TARGET_MODE_LABELS[policy.targetMode] ?? policy.targetMode,
    ].some(value => value.toLowerCase().includes(keyword))
  })
})
const policyCoverage = computed(() => EVENT_OPTIONS.map(event => ({
  label: event.label,
  value: event.value,
  channels: CHANNEL_OPTIONS.map(channel => ({
    ...channel,
    policy: policies.value.find(policy => policy.eventType === event.value && policy.channel === channel.value) ?? null,
  })),
})))

function changePolicyEvent(value: string): void {
  policyEventType.value = value
  syncPolicyCombination()
}

function changePolicyChannel(value: string): void {
  policyChannel.value = value as 'IN_APP' | 'ASSISTANT'
  syncPolicyCombination()
}

function formatChannel(channel: string): string {
  return channel === 'ASSISTANT' ? '千树小助理' : '站内通知'
}

function channelTagClass(channel: string): string {
  if (channel === 'ASSISTANT') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (channel === 'IN_APP') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  }
  return 'border-border bg-muted text-muted-foreground'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const signal = new AbortController().signal
    const [assistantTemplates, inappTemplates, policyResult] = await Promise.all([
      notificationsApi.templates.list('ASSISTANT', signal),
      notificationsApi.templates.list('IN_APP', signal),
      notificationsApi.policies.list({}, signal),
    ])
    templates.value = [...assistantTemplates.data, ...inappTemplates.data]
    policies.value = policyResult.data
  }
  catch (failure) {
    error.value = getApiClientFailureMessage(failure, '通知规则加载失败')
  }
  finally {
    loading.value = false
  }
}

function requestDiscard(kind: 'policy' | 'template'): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  discardKind.value = kind
  discardOpen.value = true
  return false
}

function canCloseTemplateModal(): boolean {
  return JSON.stringify(templateDraft.value) === templateBaseline.value || requestDiscard('template')
}

function canClosePolicyModal(): boolean {
  return JSON.stringify(policyDraft.value) === policyBaseline.value || requestDiscard('policy')
}

function confirmDiscard(): void {
  if (discardKind.value === 'template') {
    templateBaseline.value = JSON.stringify(templateDraft.value)
    templateOpen.value = false
  }
  else if (discardKind.value === 'policy') {
    policyBaseline.value = JSON.stringify(policyDraft.value)
    policyOpen.value = false
  }
  discardOpen.value = false
  discardKind.value = null
}

function cancelDiscard(): void {
  discardOpen.value = false
  discardKind.value = null
}

function handleDiscardVisible(value: boolean): void {
  discardOpen.value = value
  if (!value) {
    discardKind.value = null
  }
}

function openCreateTemplate(): void {
  templateMode.value = 'create'
  templateDraft.value = {
    id: '',
    key: '',
    channel: 'ASSISTANT',
    name: '',
    domain: 'SYSTEM',
    messageKind: 'TEXT',
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

function openCreateTemplateForChannel(group: TemplateKeyGroup, channel: 'ASSISTANT' | 'IN_APP'): void {
  templateMode.value = 'create'
  templateDraft.value = {
    id: '',
    key: group.key,
    channel,
    name: '',
    domain: group.domain,
    messageKind: 'TEXT',
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

function handleTemplateAdd(channel: 'ASSISTANT' | 'IN_APP'): void {
  if (selectedTemplateGroup.value !== null) {
    openCreateTemplateForChannel(selectedTemplateGroup.value, channel)
  }
}

function openEditTemplate(template: NotificationTemplateDto): void {
  templateMode.value = 'edit'
  templateDraft.value = {
    id: template.id,
    key: template.key,
    channel: template.channel as 'IN_APP' | 'ASSISTANT',
    name: template.name,
    domain: template.domain,
    messageKind: template.messageKind as 'TEXT' | 'LINK',
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
        messageKind: templateDraft.value.messageKind,
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
        messageKind: templateDraft.value.messageKind,
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
    await load()
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

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function readPolicyTargetConfig(value: Record<string, unknown> | null | undefined): PolicyTargetConfigDraft {
  return {
    permissionCode: typeof value?.permissionCode === 'string' ? value.permissionCode : '',
    roleCodes: readStringList(value?.roleCodes),
    targetKeys: readStringList(value?.targetKeys),
    userIds: readStringList(value?.userIds),
  }
}

function readQuietHours(value: Record<string, unknown> | null | undefined) {
  return {
    enabled: value !== null && value !== undefined,
    start: typeof value?.start === 'string' ? value.start : '20:00',
    end: typeof value?.end === 'string' ? value.end : '08:00',
    timezone: typeof value?.timezone === 'string' ? value.timezone : 'Asia/Shanghai',
  }
}

function buildPolicyTargetConfig(): Record<string, unknown> {
  if (policyDraft.value.targetMode === 'USERS') {
    return { userIds: policyDraft.value.targetConfig.userIds }
  }
  if (policyDraft.value.targetMode === 'ROLE') {
    return { roleCodes: policyDraft.value.targetConfig.roleCodes }
  }
  if (policyDraft.value.targetMode === 'PERMISSION') {
    return { permissionCode: policyDraft.value.targetConfig.permissionCode }
  }
  if (policyDraft.value.targetMode === 'GROUP') {
    return { targetKeys: policyDraft.value.targetConfig.targetKeys }
  }
  return {}
}

const canSavePolicy = computed(() => {
  if (!canUpdatePolicy.value) {
    return false
  }
  if (policyDraft.value.targetMode === 'USERS' && policyDraft.value.targetConfig.userIds.length === 0) {
    return false
  }
  if (policyDraft.value.targetMode === 'ROLE' && policyDraft.value.targetConfig.roleCodes.length === 0) {
    return false
  }
  if (policyDraft.value.targetMode === 'PERMISSION' && policyDraft.value.targetConfig.permissionCode.length === 0) {
    return false
  }
  if (policyDraft.value.targetMode === 'GROUP' && policyDraft.value.targetConfig.targetKeys.length === 0) {
    return false
  }
  if (policyChannel.value === 'ASSISTANT') {
    const ttl = policyDraft.value.ttlSeconds
    return Number.isInteger(ttl) && ttl >= 60 && ttl <= 604_800
  }
  return true
})
const policyTtlHint = computed(() => {
  const seconds = policyDraft.value.ttlSeconds
  return Number.isFinite(seconds) && seconds >= 60 && seconds <= 604_800
    ? `约 ${(seconds / 3600).toFixed(1)} 小时；范围 60–604800 秒`
    : '范围 60–604800 秒（1 分钟–7 天）'
})

function createPolicyDraft(policy?: NotificationChannelPolicyDto) {
  const quiet = readQuietHours(policy?.quietHours)
  return {
    targetMode: policy?.targetMode ?? 'COMMAND_TARGET',
    targetConfig: readPolicyTargetConfig(policy?.targetConfig),
    templateKey: policy?.templateKey ?? '',
    priority: policy?.priority ?? 'NORMAL',
    ttlSeconds: policy?.ttlSeconds ?? 86_400,
    quietHoursEnabled: quiet.enabled,
    quietStart: quiet.start,
    quietEnd: quiet.end,
    quietTimezone: quiet.timezone,
    allowSensitive: policy?.allowSensitive ?? true,
    enabled: policy?.enabled ?? true,
    expectedVersion: policy?.version ?? 0,
  }
}

function syncPolicyCombination(): void {
  if (policyEditingExisting.value) {
    return
  }
  const existing = policies.value.find(policy =>
    policy.eventType === policyEventType.value && policy.channel === policyChannel.value)
  policyDraft.value = createPolicyDraft(existing)
}

function openPolicy(policy?: NotificationChannelPolicyDto, preset?: { eventType: string, channel: 'IN_APP' | 'ASSISTANT' }): void {
  policyEditingExisting.value = policy !== undefined
  policyEventType.value = policy?.eventType ?? preset?.eventType ?? 'PURCHASE_REVIEW_PENDING'
  policyChannel.value = (policy?.channel as 'IN_APP' | 'ASSISTANT' | undefined) ?? preset?.channel ?? 'ASSISTANT'
  const existing = policy ?? policies.value.find(item =>
    item.eventType === policyEventType.value && item.channel === policyChannel.value)
  policyDraft.value = createPolicyDraft(existing)
  policyBaseline.value = JSON.stringify(policyDraft.value)
  void ensurePolicyOptions()
  policyOpen.value = true
}

function openPolicyAt(eventType: string, channel: string): void {
  const targetChannel = channel as 'IN_APP' | 'ASSISTANT'
  const existing = policies.value.find(policy => policy.eventType === eventType && policy.channel === targetChannel)
  if (existing !== undefined) {
    openPolicy(existing)
    return
  }
  openPolicy(undefined, { eventType, channel: targetChannel })
}

async function savePolicy(): Promise<void> {
  busy.value = true
  try {
    const quietHours = policyChannel.value === 'ASSISTANT' && policyDraft.value.quietHoursEnabled
      ? {
          start: policyDraft.value.quietStart,
          end: policyDraft.value.quietEnd,
          timezone: policyDraft.value.quietTimezone,
        }
      : null
    await notificationsApi.policies.update(policyEventType.value, policyChannel.value, {
      targetMode: policyDraft.value.targetMode as 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP',
      targetConfig: buildPolicyTargetConfig(),
      templateKey: policyDraft.value.templateKey || null,
      priority: policyDraft.value.priority as 'NORMAL' | 'HIGH',
      ttlSeconds: policyChannel.value === 'ASSISTANT' ? policyDraft.value.ttlSeconds : null,
      quietHours: policyChannel.value === 'ASSISTANT' ? quietHours : null,
      allowSensitive: policyDraft.value.allowSensitive,
      enabled: policyDraft.value.enabled,
      expectedVersion: policyExisting.value?.version ?? policyDraft.value.expectedVersion,
    })
    policyBaseline.value = JSON.stringify(policyDraft.value)
    policyOpen.value = false
    toast.success('事件策略已保存')
    await load()
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '事件策略保存失败'))
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

async function togglePolicyEnabled(policy: NotificationChannelPolicyDto, enabled: boolean): Promise<void> {
  busy.value = true
  try {
    const updated = (await notificationsApi.policies.update(policy.eventType, policy.channel as 'IN_APP' | 'ASSISTANT', {
      targetMode: policy.targetMode as 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP',
      targetConfig: policy.targetConfig,
      templateKey: policy.templateKey,
      priority: policy.priority as 'NORMAL' | 'HIGH',
      ttlSeconds: policy.ttlSeconds,
      quietHours: policy.quietHours,
      allowSensitive: policy.allowSensitive,
      enabled,
      expectedVersion: policy.version,
    })).data
    policies.value = policies.value.map(item => item.id === updated.id ? updated : item)
    toast.success(enabled ? '策略已启用' : '策略已停用')
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '策略状态更新失败'))
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
      正在加载通知规则…
    </div>
  </FaPageMain>

  <template v-else>
    <FaPageMain class="my-2!">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h2 class="qs-type-section-title m-0">
            消息模板
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            业务只传一个 templateKey，每个渠道各有一份模板；保存时会校验未声明变量。
          </p>
        </div>
        <FaButton size="sm" :disabled="!canUpdateTemplate || busy" @click="openCreateTemplate">
          新建模板
        </FaButton>
      </div>

      <div
        class="mt-4 border border-border rounded-xl bg-background grid overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] lg:h-[640px]"
        data-testid="notification-template-master-detail"
      >
        <TemplateDomainRail
          :groups="visibleTemplateDomainGroups"
          :search="templateSearch"
          :selected-key="selectedTemplateKey"
          @select="selectedTemplateKey = $event"
          @update:search="templateSearch = $event"
        />
        <div class="h-full min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-y-auto">
          <TemplateKeyDetail
            :group="selectedTemplateGroup"
            :can-update="canUpdateTemplate"
            :busy="busy"
            @add="handleTemplateAdd"
            @edit="openEditTemplate"
            @preview="openPreview"
            @toggle="toggleTemplateEnabled"
          />
        </div>
      </div>
    </FaPageMain>

    <FaPageMain class="my-2!">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h2 class="qs-type-section-title m-0">
            事件策略
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            站内不需要 TTL 与静默时段；千树小助理必须配置 TTL。敏感内容只允许发已验证绑定与仅内部群。
          </p>
          <p class="qs-type-meta text-amber-700 m-0 mt-1 dark:text-amber-300">
            当前业务只接入采购审核、开票申请和货件到仓；其余事件暂无触发源，可以提前配置但不会触发。
          </p>
        </div>
        <FaButton size="sm" :disabled="!canUpdatePolicy || busy" @click="openPolicy()">
          配置策略
        </FaButton>
      </div>

      <div class="mt-4 border border-border rounded-lg overflow-hidden">
        <div class="px-3 py-2 bg-muted/40 flex flex-wrap gap-2 items-center justify-between">
          <span class="qs-type-meta">事件 × 渠道覆盖</span>
          <span class="qs-type-meta text-muted-foreground">点击标签直接编辑或创建对应策略</span>
        </div>
        <div
          v-for="row in policyCoverage"
          :key="row.value"
          class="px-3 py-2 border-t border-border/60 flex flex-wrap gap-2 items-center justify-between"
        >
          <span class="qs-type-meta">{{ row.label }}</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="channel in row.channels"
              :key="channel.value"
              type="button"
              class="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              @click="openPolicyAt(row.value, channel.value)"
            >
              <FaTag
                variant="outline"
                :class="channel.policy === null
                  ? 'border-amber-500/40 border-dashed bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  : channel.policy.enabled
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'"
              >
                {{ channel.label }} · {{ channel.policy === null ? '未配置' : channel.policy.enabled ? '已启用' : '已停用' }}
              </FaTag>
            </button>
          </div>
        </div>
      </div>

      <QsGenericTable
        class="mt-4"
        :columns="policyColumns"
        :data="filteredPolicies"
        :addable="false"
        :searchable="false"
        :action-column="{ width: 140, minWidth: 140 }"
        :show-pagination="false"
        row-key="id"
        data-testid="notification-policy-table"
      >
        <template #query-leading>
          <div class="flex flex-wrap gap-2 items-center">
            <FaInput
              v-model="policyKeyword"
              type="search"
              clearable
              class="w-56"
              placeholder="事件、模板键或目标"
              aria-label="搜索事件策略"
            >
              <template #start>
                <FaIcon name="i-lucide:search" />
              </template>
            </FaInput>
            <FaSelect v-model="policyChannelFilter" :options="CHANNEL_FILTER_OPTIONS" class="w-32" aria-label="策略渠道" />
            <FaSelect v-model="policyStatusFilter" :options="STATUS_FILTER_OPTIONS" class="w-28" aria-label="策略状态" />
          </div>
        </template>
        <template #cell-eventType="{ row }">
          {{ formatEventType(row.original.eventType) }}
        </template>
        <template #cell-channel="{ row }">
          <FaTag variant="outline" :class="channelTagClass(row.original.channel)">
            {{ formatChannel(row.original.channel) }}
          </FaTag>
        </template>
        <template #cell-targetMode="{ row }">
          {{ TARGET_MODE_LABELS[row.original.targetMode] ?? row.original.targetMode }}
        </template>
        <template #cell-templateKey="{ row }">
          {{ row.original.templateKey ?? '—' }}
        </template>
        <template #cell-priority="{ row }">
          {{ PRIORITY_LABELS[row.original.priority] ?? row.original.priority }}
        </template>
        <template #cell-ttlSeconds="{ row }">
          {{ formatTtl(row.original.ttlSeconds) }}
        </template>
        <template #cell-updatedByInfo="{ row }">
          <div class="flex flex-col gap-1 min-w-0">
            <QsPersonDisplay :display-name="row.original.updatedByName ?? ''" size="sm" />
            <span class="qs-type-meta text-muted-foreground">{{ formatNotificationDateTime(row.original.updatedAt) }}</span>
          </div>
        </template>
        <template #cell-enabled="{ row }">
          <FaTag
            variant="outline"
            :class="row.original.enabled
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'"
          >
            {{ row.original.enabled ? '启用' : '停用' }}
          </FaTag>
        </template>
        <template #actions="{ row }">
          <div class="flex flex-wrap gap-2 items-center">
            <FaSwitch
              :model-value="row.enabled"
              :disabled="!canUpdatePolicy || busy"
              :aria-label="`${formatEventType(row.eventType)} 启用状态`"
              :title="row.enabled ? '点击停用' : '点击启用'"
              @update:model-value="togglePolicyEnabled(row, Boolean($event))"
            />
            <FaButton variant="outline" size="sm" :disabled="!canUpdatePolicy || busy" @click="openPolicy(row)">
              编辑
            </FaButton>
          </div>
        </template>
        <template #mobile-row="{ row }">
          <div class="flex flex-col gap-2 min-w-0">
            <div class="flex gap-2 items-start justify-between">
              <div class="min-w-0">
                <p class="qs-type-body-medium m-0 truncate">
                  {{ formatEventType(row.eventType) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-0.5">
                  {{ formatChannel(row.channel) }} · {{ TARGET_MODE_LABELS[row.targetMode] ?? row.targetMode }}
                </p>
              </div>
              <FaTag
                variant="outline"
                class="shrink-0"
                :class="row.enabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'"
              >
                {{ row.enabled ? '启用' : '停用' }}
              </FaTag>
            </div>
            <p class="qs-type-meta text-muted-foreground m-0">
              模板 {{ row.templateKey ?? '—' }} · {{ formatTtl(row.ttlSeconds) }} · 更新：{{ row.updatedByName ?? '—' }} · {{ formatNotificationDateTime(row.updatedAt) }}
            </p>
            <div class="flex flex-wrap gap-2 items-center">
              <FaSwitch
                :model-value="row.enabled"
                :disabled="!canUpdatePolicy || busy"
                :aria-label="`${formatEventType(row.eventType)} 启用状态`"
                :title="row.enabled ? '点击停用' : '点击启用'"
                @update:model-value="togglePolicyEnabled(row, Boolean($event))"
              />
              <FaButton variant="outline" size="sm" :disabled="!canUpdatePolicy || busy" @click="openPolicy(row)">
                编辑
              </FaButton>
            </div>
          </div>
        </template>
      </QsGenericTable>
    </FaPageMain>
  </template>

  <QsGenericModal v-model="templateOpen" :title="templateMode === 'create' ? '新建模板' : '编辑模板'" size="2xl" :submitting="busy" :before-close="canCloseTemplateModal" @update:model-value="templateOpen = $event">
    <div class="flex flex-col gap-5">
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
            <FaSelect v-model="templateDraft.channel" class="w-full" :options="CHANNEL_OPTIONS" :disabled="templateMode === 'edit'" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">名称</span>
            <FaInput v-model="templateDraft.name" class="w-full" placeholder="采购审核待办" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">业务域</span>
            <FaSelect
              v-model="templateDraft.domain"
              class="w-full"
              :options="TEMPLATE_DOMAIN_OPTIONS"
              :disabled="templateOtherChannel !== null"
            />
            <span v-if="templateOtherChannel !== null" class="qs-type-meta text-muted-foreground">
              同一模板键在{{ formatChannel(templateOtherChannel.channel) }}已使用「{{ templateDomainLabel(templateOtherChannel.domain) }}」，业务域已锁定。
            </span>
          </label>
          <p v-if="templateMode === 'edit'" class="qs-type-meta text-muted-foreground m-0 md:col-span-2">
            模板键与渠道创建后不可修改；需要换渠道请新建对应模板。
          </p>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">消息类型</span>
            <FaSelect v-model="templateDraft.messageKind" class="w-full" :options="[{ label: '文本', value: 'TEXT' }, { label: '链接', value: 'LINK' }]" />
          </label>
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
        <label v-if="templateDraft.messageKind === 'LINK'" class="flex flex-col gap-1">
          <span class="qs-type-compact-label">跳转链接模板</span>
          <FaInput v-model="templateDraft.linkUrlTemplate" class="w-full" placeholder="/operations/purchase-orders/{{ orderId }}" />
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

  <QsGenericModal v-model="policyOpen" title="事件策略" size="2xl" :submitting="busy" :before-close="canClosePolicyModal" @update:model-value="policyOpen = $event">
    <div class="gap-3 grid md:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">事件</span>
        <FaSelect
          :model-value="policyEventType"
          :options="EVENT_OPTIONS"
          :disabled="policyEditingExisting"
          @update:model-value="changePolicyEvent(String($event))"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">渠道</span>
        <FaSelect
          :model-value="policyChannel"
          :options="CHANNEL_OPTIONS"
          :disabled="policyEditingExisting"
          @update:model-value="changePolicyChannel(String($event))"
        />
      </label>
      <p v-if="policyExisting !== null && !policyEditingExisting" class="qs-type-meta text-amber-700 m-0 dark:text-amber-300 md:col-span-2">
        该事件与渠道已有策略，保存会更新现有配置（当前版本 {{ policyExisting.version }}）。
      </p>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">目标模式</span>
        <FaSelect v-model="policyDraft.targetMode" :options="policyTargetModeOptions" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">模板</span>
        <FaSelect v-model="policyDraft.templateKey" :options="templateKeyOptions" placeholder="选择模板" />
      </label>
      <p v-if="policyTemplateDomainMismatch && selectedPolicyTemplate !== null" class="qs-type-meta text-amber-700 m-0 dark:text-amber-300 md:col-span-2">
        模板所属业务域（{{ templateDomainLabel(selectedPolicyTemplate.domain) }}）与事件业务域（{{ templateDomainLabel(policyEventDomain) }}）不一致，请确认。
      </p>
      <p v-if="policyOptionsLoading" class="qs-type-meta text-muted-foreground m-0 md:col-span-2">
        正在加载员工、角色、权限与群目标选项…
      </p>
      <div v-if="policyDraft.targetMode === 'COMMAND_TARGET'" class="qs-type-meta text-muted-foreground p-3 border border-border rounded-lg bg-muted/30 md:col-span-2">
        目标由业务命令携带，不需要额外配置。
      </div>
      <label v-else-if="policyDraft.targetMode === 'USERS'" class="flex flex-col gap-1 md:col-span-2">
        <span class="qs-type-compact-label">固定员工</span>
        <FaSelect
          v-model="policyDraft.targetConfig.userIds"
          multiple
          :options="policyUserOptions"
          :disabled="policyOptionsLoading"
          placeholder="选择员工"
        />
        <span class="qs-type-meta text-muted-foreground">可多选；列表只包含启用中的员工。</span>
      </label>
      <label v-else-if="policyDraft.targetMode === 'ROLE'" class="flex flex-col gap-1 md:col-span-2">
        <span class="qs-type-compact-label">角色</span>
        <FaSelect
          v-model="policyDraft.targetConfig.roleCodes"
          multiple
          :options="policyRoleOptions"
          :disabled="policyOptionsLoading"
          placeholder="选择角色"
        />
      </label>
      <label v-else-if="policyDraft.targetMode === 'PERMISSION'" class="flex flex-col gap-1 md:col-span-2">
        <span class="qs-type-compact-label">权限</span>
        <FaSelect
          v-model="policyDraft.targetConfig.permissionCode"
          :options="policyPermissionOptions"
          :disabled="policyOptionsLoading"
          placeholder="选择权限"
        />
        <span class="qs-type-meta text-muted-foreground">接收拥有该权限的全部启用用户。</span>
      </label>
      <label v-else class="flex flex-col gap-1 md:col-span-2">
        <span class="qs-type-compact-label">群目标</span>
        <FaSelect
          v-model="policyDraft.targetConfig.targetKeys"
          multiple
          :options="policyGroupOptions"
          :disabled="policyOptionsLoading"
          placeholder="选择群目标"
        />
        <span class="qs-type-meta text-muted-foreground">敏感内容只会发送到标记为「仅内部」且已启用的群。</span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">优先级</span>
        <FaSelect v-model="policyDraft.priority" :options="[{ label: '普通', value: 'NORMAL' }, { label: '高', value: 'HIGH' }]" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="qs-type-compact-label">站外 TTL（秒）</span>
        <FaInput v-model.number="policyDraft.ttlSeconds" type="number" min="60" max="604800" :disabled="policyChannel === 'IN_APP'" />
        <span class="qs-type-meta text-muted-foreground">{{ policyTtlHint }}</span>
      </label>
      <div v-if="policyChannel === 'ASSISTANT'" class="flex flex-col gap-2 md:col-span-2">
        <label class="qs-type-meta flex gap-2 items-center">
          <FaSwitch v-model="policyDraft.quietHoursEnabled" />
          启用静默时段
        </label>
        <div v-if="policyDraft.quietHoursEnabled" class="gap-2 grid sm:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">开始时间</span>
            <FaInput v-model="policyDraft.quietStart" type="time" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-compact-label">结束时间</span>
            <FaInput v-model="policyDraft.quietEnd" type="time" />
          </label>
        </div>
        <span v-if="policyDraft.quietHoursEnabled" class="qs-type-meta text-muted-foreground">
          时区固定为 {{ policyDraft.quietTimezone }}；开始时间晚于结束时间表示跨天。
        </span>
      </div>
      <label v-if="policyChannel === 'ASSISTANT'" class="qs-type-meta flex gap-2 items-center">
        <FaSwitch v-model="policyDraft.allowSensitive" />
        允许金额/客户名称
      </label>
      <label class="qs-type-meta flex gap-2 items-center">
        <FaSwitch v-model="policyDraft.enabled" />
        启用
      </label>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="busy" @click="policyOpen = false">
        取消
      </FaButton>
      <FaButton :loading="busy" :disabled="!canSavePolicy" @click="savePolicy">
        保存
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal v-model="discardOpen" title="放弃修改" size="sm" :z-index="2200" @update:model-value="handleDiscardVisible">
    <p class="qs-type-body m-0">
      有未保存的修改，关闭后这些修改会丢失。
    </p>
    <template #footer>
      <FaButton variant="outline" @click="cancelDiscard">
        继续编辑
      </FaButton>
      <FaButton variant="destructive" @click="confirmDiscard">
        放弃修改
      </FaButton>
    </template>
  </QsGenericModal>
</template>
