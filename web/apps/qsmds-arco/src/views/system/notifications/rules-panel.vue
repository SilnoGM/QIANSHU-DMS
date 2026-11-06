<script setup lang="ts">
import type { NotificationChannelPolicyDto, NotificationTemplateDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import { computed, onMounted, ref } from 'vue'

import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useAppAuth } from '@/composables/app/auth'

const toast = useQsToast()
const { auth } = useAppAuth()
const canUpdateTemplate = computed(() => auth('notification-template:update'))
const canUpdatePolicy = computed(() => auth('notification-policy:update'))

const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)
const templates = ref<NotificationTemplateDto[]>([])
const policies = ref<NotificationChannelPolicyDto[]>([])

const templateOpen = ref(false)
const templateMode = ref<'create' | 'edit'>('create')
const templateDraft = ref({
  id: '',
  key: '',
  channel: 'ASSISTANT' as 'IN_APP' | 'ASSISTANT',
  name: '',
  messageKind: 'TEXT' as 'TEXT' | 'LINK',
  titleTemplate: '',
  bodyTemplate: '',
  linkUrlTemplate: '',
  variables: '[]',
  maxLength: 2000,
  enabled: true,
  expectedVersion: 1,
})

const previewOpen = ref(false)
const previewTemplate = ref<NotificationTemplateDto | null>(null)
const previewVariables = ref('{}')
const previewContent = ref('')
const previewLink = ref<string | null>(null)

const policyOpen = ref(false)
const policyEventType = ref('PURCHASE_REVIEW_PENDING')
const policyChannel = ref<'IN_APP' | 'ASSISTANT'>('ASSISTANT')
const policyDraft = ref({
  targetMode: 'COMMAND_TARGET',
  targetConfig: '{}',
  templateKey: '',
  priority: 'NORMAL',
  ttlSeconds: 86_400,
  quietHours: '{"start":"20:00","end":"08:00","timezone":"Asia/Shanghai"}',
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

const templateColumns: QsGenericTableColumn<NotificationTemplateDto>[] = [
  { accessorKey: 'key', id: 'key', title: '模板键', minWidth: 180 },
  { accessorKey: 'channel', id: 'channel', title: '渠道', width: 110 },
  { accessorKey: 'name', id: 'name', title: '名称', minWidth: 160 },
  { accessorKey: 'version', id: 'version', title: '版本', width: 80 },
  { accessorKey: 'enabled', id: 'enabled', title: '状态', width: 90 },
]
const policyColumns: QsGenericTableColumn<NotificationChannelPolicyDto>[] = [
  { accessorKey: 'eventType', id: 'eventType', title: '事件', minWidth: 220 },
  { accessorKey: 'channel', id: 'channel', title: '渠道', width: 110 },
  { accessorKey: 'targetMode', id: 'targetMode', title: '目标', width: 130 },
  { accessorKey: 'templateKey', id: 'templateKey', title: '模板', minWidth: 180 },
  { accessorKey: 'priority', id: 'priority', title: '优先级', width: 90 },
  { accessorKey: 'ttlSeconds', id: 'ttlSeconds', title: 'TTL', width: 90 },
  { accessorKey: 'enabled', id: 'enabled', title: '状态', width: 90 },
]

const templateKeyOptions = computed(() => templates.value
  .filter(template => template.channel === policyChannel.value)
  .map(template => ({ label: template.key, value: template.key })))

function formatChannel(channel: string): string {
  return channel === 'ASSISTANT' ? '千树小助理' : '站内通知'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const signal = new AbortController().signal
    const [templateResult, policyResult] = await Promise.all([
      notificationsApi.templates.list('ASSISTANT', signal),
      notificationsApi.policies.list({}, signal),
    ])
    templates.value = templateResult.data
    policies.value = policyResult.data
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    loading.value = false
  }
}

function openCreateTemplate(): void {
  templateMode.value = 'create'
  templateDraft.value = {
    id: '',
    key: '',
    channel: 'ASSISTANT',
    name: '',
    messageKind: 'TEXT',
    titleTemplate: '',
    bodyTemplate: '',
    linkUrlTemplate: '',
    variables: '[]',
    maxLength: 2000,
    enabled: true,
    expectedVersion: 1,
  }
  templateOpen.value = true
}

function openEditTemplate(template: NotificationTemplateDto): void {
  templateMode.value = 'edit'
  templateDraft.value = {
    id: template.id,
    key: template.key,
    channel: template.channel as 'IN_APP' | 'ASSISTANT',
    name: template.name,
    messageKind: template.messageKind as 'TEXT' | 'LINK',
    titleTemplate: template.titleTemplate ?? '',
    bodyTemplate: template.bodyTemplate,
    linkUrlTemplate: template.linkUrlTemplate ?? '',
    variables: JSON.stringify(template.variables, null, 2),
    maxLength: template.maxLength,
    enabled: template.enabled,
    expectedVersion: template.version,
  }
  templateOpen.value = true
}

function parseVariables(raw: string): Record<string, string | number | null> {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('变量必须是 JSON 对象')
  }
  return parsed as Record<string, string | number | null>
}

function parseTemplateVariables(raw: string): Array<{ name: string, required: boolean, maxLength: number, sensitive: boolean }> {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('模板变量必须是 JSON 数组')
  }
  return parsed as Array<{ name: string, required: boolean, maxLength: number, sensitive: boolean }>
}

async function saveTemplate(): Promise<void> {
  busy.value = true
  try {
    const variables = parseTemplateVariables(templateDraft.value.variables)
    if (templateMode.value === 'create') {
      await notificationsApi.templates.create({
        key: templateDraft.value.key,
        channel: templateDraft.value.channel,
        name: templateDraft.value.name,
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
    templateOpen.value = false
    toast.success('模板已保存')
    await load()
  }
  catch (failure) {
    toast.error(failure instanceof SyntaxError || failure instanceof Error
      ? failure.message
      : getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

function openPreview(template: NotificationTemplateDto): void {
  previewTemplate.value = template
  previewVariables.value = '{}'
  previewContent.value = ''
  previewLink.value = null
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
  }
  catch (failure) {
    toast.error(failure instanceof Error
      ? failure.message
      : getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
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
    toast.error(failure instanceof Error
      ? failure.message
      : getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

function openPolicy(policy?: NotificationChannelPolicyDto): void {
  policyEventType.value = policy?.eventType ?? 'PURCHASE_REVIEW_PENDING'
  policyChannel.value = (policy?.channel as 'IN_APP' | 'ASSISTANT' | undefined) ?? 'ASSISTANT'
  policyDraft.value = policy === undefined
    ? {
        targetMode: 'COMMAND_TARGET',
        targetConfig: '{}',
        templateKey: '',
        priority: 'NORMAL',
        ttlSeconds: 86_400,
        quietHours: '{"start":"20:00","end":"08:00","timezone":"Asia/Shanghai"}',
        allowSensitive: true,
        enabled: true,
        expectedVersion: 0,
      }
    : {
        targetMode: policy.targetMode,
        targetConfig: JSON.stringify(policy.targetConfig, null, 2),
        templateKey: policy.templateKey ?? '',
        priority: policy.priority,
        ttlSeconds: policy.ttlSeconds ?? 86_400,
        quietHours: policy.quietHours === null ? '' : JSON.stringify(policy.quietHours, null, 2),
        allowSensitive: policy.allowSensitive,
        enabled: policy.enabled,
        expectedVersion: policy.version,
      }
  policyOpen.value = true
}

async function savePolicy(): Promise<void> {
  busy.value = true
  try {
    const targetConfig = JSON.parse(policyDraft.value.targetConfig) as Record<string, unknown>
    const quietHours = policyDraft.value.quietHours.trim().length === 0
      ? null
      : JSON.parse(policyDraft.value.quietHours) as Record<string, unknown>
    await notificationsApi.policies.update(policyEventType.value, policyChannel.value, {
      targetMode: policyDraft.value.targetMode as 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP',
      targetConfig,
      templateKey: policyDraft.value.templateKey || null,
      priority: policyDraft.value.priority as 'NORMAL' | 'HIGH',
      ttlSeconds: policyChannel.value === 'ASSISTANT' ? policyDraft.value.ttlSeconds : null,
      quietHours: policyChannel.value === 'ASSISTANT' ? quietHours : null,
      allowSensitive: policyDraft.value.allowSensitive,
      enabled: policyDraft.value.enabled,
      expectedVersion: policyDraft.value.expectedVersion,
    })
    policyOpen.value = false
    toast.success('事件策略已保存')
    await load()
  }
  catch (failure) {
    toast.error(failure instanceof Error
      ? failure.message
      : getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
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
  <div class="flex flex-col gap-4">
    <FaAlert v-if="error !== null" variant="destructive" :title="error">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="load">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div v-else-if="loading" class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
      正在加载通知规则…
    </div>

    <template v-else>
      <section class="p-4 border border-border rounded-lg bg-background">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h3 class="qs-type-body-medium m-0">
              模板
            </h3>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              业务只传一个 templateKey，每个渠道各有一份模板；保存时会校验未声明变量。
            </p>
          </div>
          <FaButton size="sm" :disabled="!canUpdateTemplate || busy" @click="openCreateTemplate">
            新建模板
          </FaButton>
        </div>

        <QsGenericTable
          class="mt-4"
          :columns="templateColumns"
          :data="templates"
          :addable="false"
          :show-pagination="false"
          row-key="id"
          data-testid="notification-template-table"
        >
          <template #cell-channel="{ row }">
            {{ formatChannel(row.original.channel) }}
          </template>
          <template #cell-enabled="{ row }">
            <FaTag variant="outline" :class="row.original.enabled ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'">
              {{ row.original.enabled ? '启用' : '停用' }}
            </FaTag>
          </template>
          <template #actions="{ row }">
            <div class="flex flex-wrap gap-2">
              <FaButton variant="outline" size="sm" :disabled="!canUpdateTemplate || busy" @click="openEditTemplate(row)">
                编辑
              </FaButton>
              <FaButton variant="outline" size="sm" @click="openPreview(row)">
                预览
              </FaButton>
            </div>
          </template>
        </QsGenericTable>
      </section>

      <section class="p-4 border border-border rounded-lg bg-background">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h3 class="qs-type-body-medium m-0">
              事件策略
            </h3>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              站内不需要 TTL 与静默时段；千树小助理必须配置 TTL。敏感内容只允许发已验证绑定与仅内部群。
            </p>
          </div>
          <FaButton size="sm" :disabled="!canUpdatePolicy || busy" @click="openPolicy()">
            新建策略
          </FaButton>
        </div>

        <QsGenericTable
          class="mt-4"
          :columns="policyColumns"
          :data="policies"
          :addable="false"
          :show-pagination="false"
          row-key="id"
          data-testid="notification-policy-table"
        >
          <template #cell-channel="{ row }">
            {{ formatChannel(row.original.channel) }}
          </template>
          <template #cell-ttlSeconds="{ row }">
            {{ row.original.ttlSeconds === null ? '—' : `${row.original.ttlSeconds}s` }}
          </template>
          <template #cell-enabled="{ row }">
            <FaTag variant="outline" :class="row.original.enabled ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'">
              {{ row.original.enabled ? '启用' : '停用' }}
            </FaTag>
          </template>
          <template #actions="{ row }">
            <FaButton variant="outline" size="sm" :disabled="!canUpdatePolicy || busy" @click="openPolicy(row)">
              编辑
            </FaButton>
          </template>
        </QsGenericTable>
      </section>
    </template>

    <QsGenericModal v-model="templateOpen" :title="templateMode === 'create' ? '新建模板' : '编辑模板'" size="2xl" :submitting="busy" @update:model-value="templateOpen = $event">
      <div class="gap-3 grid md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">模板键</span>
          <FaInput v-model="templateDraft.key" :disabled="templateMode === 'edit'" placeholder="purchase.review.pending" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">渠道</span>
          <FaSelect v-model="templateDraft.channel" :options="CHANNEL_OPTIONS" :disabled="templateMode === 'edit'" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">名称</span>
          <FaInput v-model="templateDraft.name" placeholder="采购审核待办" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">消息类型</span>
          <FaSelect v-model="templateDraft.messageKind" :options="[{ label: '文本', value: 'TEXT' }, { label: '链接', value: 'LINK' }]" />
        </label>
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="qs-type-compact-label">正文（支持 &#123;&#123;variable&#125;&#125;）</span>
          <textarea v-model="templateDraft.bodyTemplate" rows="5" class="qs-type-body px-3 py-2 border border-border rounded-md bg-background w-full" />
        </label>
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="qs-type-compact-label">链接模板（可选）</span>
          <FaInput v-model="templateDraft.linkUrlTemplate" placeholder="/operations/purchase-orders/{{ orderId }}" />
        </label>
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="qs-type-compact-label">变量白名单（JSON 数组）</span>
          <textarea v-model="templateDraft.variables" rows="5" class="qs-type-data px-3 py-2 border border-border rounded-md bg-background w-full" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">最大长度</span>
          <FaInput v-model.number="templateDraft.maxLength" type="number" />
        </label>
        <label class="qs-type-meta flex gap-2 items-center">
          <FaSwitch v-model="templateDraft.enabled" />
          启用
        </label>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="templateOpen = false">
          取消
        </FaButton>
        <FaButton :loading="busy" :disabled="templateDraft.key.trim().length === 0 || templateDraft.bodyTemplate.trim().length === 0" @click="saveTemplate">
          保存
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="previewOpen" title="模板预览" size="lg" :submitting="busy" @update:model-value="previewOpen = $event">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">样例变量（JSON 对象）</span>
          <textarea v-model="previewVariables" rows="4" class="qs-type-data px-3 py-2 border border-border rounded-md bg-background w-full" />
        </label>
        <pre v-if="previewContent" class="qs-type-body p-3 border border-border rounded-lg bg-muted/40 whitespace-pre-wrap">{{ previewContent }}</pre>
        <p v-if="previewLink" class="qs-type-meta text-muted-foreground break-all">
          链接：{{ previewLink }}
        </p>
      </div>
      <template #footer>
        <FaButton variant="outline" :loading="busy" @click="preview">
          预览
        </FaButton>
        <FaButton :loading="busy" :disabled="!canUpdateTemplate" @click="testTemplate">
          测试发送
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="policyOpen" title="事件策略" size="2xl" :submitting="busy" @update:model-value="policyOpen = $event">
      <div class="gap-3 grid md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">事件</span>
          <FaSelect v-model="policyEventType" :options="EVENT_OPTIONS" :disabled="policyDraft.expectedVersion > 0" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">渠道</span>
          <FaSelect v-model="policyChannel" :options="CHANNEL_OPTIONS" :disabled="policyDraft.expectedVersion > 0" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">目标模式</span>
          <FaSelect v-model="policyDraft.targetMode" :options="TARGET_MODE_OPTIONS" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">模板</span>
          <FaSelect v-model="policyDraft.templateKey" :options="templateKeyOptions" placeholder="选择模板" />
        </label>
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="qs-type-compact-label">目标配置（JSON 对象）</span>
          <textarea v-model="policyDraft.targetConfig" rows="3" class="qs-type-data px-3 py-2 border border-border rounded-md bg-background w-full" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">优先级</span>
          <FaSelect v-model="policyDraft.priority" :options="[{ label: '普通', value: 'NORMAL' }, { label: '高', value: 'HIGH' }]" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-compact-label">站外 TTL（秒）</span>
          <FaInput v-model.number="policyDraft.ttlSeconds" type="number" :disabled="policyChannel === 'IN_APP'" />
        </label>
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="qs-type-compact-label">静默时段（JSON，站外）</span>
          <textarea v-model="policyDraft.quietHours" rows="2" class="qs-type-data px-3 py-2 border border-border rounded-md bg-background w-full" :disabled="policyChannel === 'IN_APP'" />
        </label>
        <label class="qs-type-meta flex gap-2 items-center">
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
        <FaButton :loading="busy" :disabled="!canUpdatePolicy" @click="savePolicy">
          保存
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
