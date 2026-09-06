<script setup lang="ts">
import type {
  NumberingDetailAction,
  NumberingDetailTab,
  NumberingIssuanceFilterModel,
} from './numbering-detail.logic'
import type { NumberingActionPermissions } from './numbering-management.logic'
import type {
  NumberingIssuanceDto,
  NumberingRuleDetailDto,
  NumberingRuleIssuancesListData,
  NumberingRuleVersionDto,
  NumberingRuleVersionsListData,
} from '@/api/generated/types.gen'
import { numberingPurposeLabel } from '@/api/modules/numbering-purpose'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import {
  buildNumberingIssuanceLoadQuery,
  buildNumberingVersionLoadQuery,
  canLoadNumberingIssuances,
  describeNumberingVersion,
  hasNumberingDetailFooterActions,
  resolveNumberingDetailActions,
  resolveNumberingDetailTabs,
} from './numbering-detail.logic'
import {
  formatNumberingDecimal,
  numberingPeriodStatusLabel,
  numberingRuleStatusLabel,
  numberingVersionStatusLabel,
} from './numbering-management.logic'

defineOptions({ name: 'NumberingRuleDetailDrawer' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  detail: NumberingRuleDetailDto | null
  detailLoading: boolean
  detailError: string | null
  detailRequestId?: string
  versions: readonly NumberingRuleVersionDto[]
  versionsLoading: boolean
  versionsError: string | null
  versionsRequestId?: string
  versionsPage: number
  versionsPageSize: number
  versionsTotal: number
  issuances: readonly NumberingIssuanceDto[]
  issuancesLoading: boolean
  issuancesError: string | null
  issuancesRequestId?: string
  issuancesPage: number
  issuancesPageSize: number
  issuancesTotal: number
  issuanceFilters: NumberingIssuanceFilterModel
  permissions: NumberingActionPermissions
  actionError?: string | null
  actionRequestId?: string
}>(), {
  actionError: null,
  actionRequestId: undefined,
  detailRequestId: undefined,
  issuancesRequestId: undefined,
  versionsRequestId: undefined,
})

const emit = defineEmits<{
  'closed': []
  'update:modelValue': [value: boolean]
  'reloadDetail': []
  'loadVersions': [query: VersionQuery]
  'loadIssuances': [query: IssuanceQuery]
  'action': [action: NumberingDetailAction, detail: NumberingRuleDetailDto]
}>()
type VersionQuery = NonNullable<NumberingRuleVersionsListData['query']>
type IssuanceQuery = NonNullable<NumberingRuleIssuancesListData['query']>

const activeTab = ref<NumberingDetailTab>('overview')
const versionPageModel = ref(props.versionsPage)
const versionPageSizeModel = ref(props.versionsPageSize)
const issuancePageModel = ref(props.issuancesPage)
const issuancePageSizeModel = ref(props.issuancesPageSize)
const issuanceFilterDraft = reactive<NumberingIssuanceFilterModel>({
  ...props.issuanceFilters,
})

// FaTabs 当前 props 使用可变数组签名；复制一层仅适配组件类型，不改动权限结果。
const tabs = computed(() => resolveNumberingDetailTabs(props.permissions).map(tab => ({
  ...tab,
  class: 'min-h-11 md:min-h-8',
})))
const actions = computed(() =>
  resolveNumberingDetailActions(props.detail, props.permissions))
const hasFooterActions = computed(() =>
  hasNumberingDetailFooterActions(actions.value))
const drawerTitle = computed(() => props.permissions.canRead
  ? props.detail?.name ?? '编号规则详情'
  : '编号规则详情')
const drawerDescription = computed(() => props.detail === null || !props.permissions.canRead
  ? '查看规则、版本与发号记录。'
  : `${props.detail.ruleCode} · 所有统计和时间按 Asia/Shanghai 展示`)

function handleVisibleChange(value: boolean): void {
  emit('update:modelValue', value)
}

function requestAction(action: NumberingDetailAction): void {
  const detail = props.detail
  if (detail === null) {
    return
  }
  const allowed = {
    clone: actions.value.canClone,
    disable: actions.value.canDisable,
    edit: actions.value.canEdit,
    enable: actions.value.canEnable,
    publish: actions.value.canPublish,
  }[action]
  if (allowed) {
    emit('action', action, detail)
  }
}

function emitVersions(page: number, pageSize: number): void {
  if (!props.permissions.canRead || props.detail === null) {
    return
  }
  emit('loadVersions', buildNumberingVersionLoadQuery({ page, pageSize }))
}

function issuanceQuery(
  page: number,
  pageSize: number,
  filters: NumberingIssuanceFilterModel,
): IssuanceQuery | null {
  return buildNumberingIssuanceLoadQuery({ filters, page, pageSize }, props.permissions)
}

function emitIssuances(
  page: number,
  pageSize: number,
  filters: NumberingIssuanceFilterModel,
): void {
  if (props.detail === null || !canLoadNumberingIssuances(props.permissions)) {
    return
  }
  const query = issuanceQuery(page, pageSize, filters)
  if (query !== null) {
    emit('loadIssuances', query)
  }
}

function handleTabChange(value: string | number): void {
  if (value !== 'overview' && value !== 'versions' && value !== 'issuances') {
    return
  }
  if (!tabs.value.some(tab => tab.value === value)) {
    return
  }
  activeTab.value = value
  if (value === 'versions') {
    emitVersions(props.versionsPage, props.versionsPageSize)
  }
  else if (value === 'issuances') {
    emitIssuances(
      props.issuancesPage,
      props.issuancesPageSize,
      props.issuanceFilters,
    )
  }
}

function handleVersionPageChange(page: number): void {
  emitVersions(page, props.versionsPageSize)
}

function handleVersionPageSizeChange(pageSize: number): void {
  emitVersions(1, pageSize)
}

function handleIssuancePageChange(page: number): void {
  emitIssuances(page, props.issuancesPageSize, props.issuanceFilters)
}

function handleIssuancePageSizeChange(pageSize: number): void {
  emitIssuances(1, pageSize, props.issuanceFilters)
}

function applyIssuanceFilters(): void {
  emitIssuances(1, props.issuancesPageSize, issuanceFilterDraft)
}

function resetIssuanceFilters(): void {
  Object.assign(issuanceFilterDraft, {
    consumerCode: '',
    generatedNumber: '',
    generatedNumberMatch: 'EXACT',
    periodKey: '',
  } satisfies NumberingIssuanceFilterModel)
  emitIssuances(1, props.issuancesPageSize, issuanceFilterDraft)
}

function statusIcon(status: NumberingRuleDetailDto['status']): string {
  return {
    DISABLED: 'i-lucide:circle-stop',
    DRAFT: 'i-lucide:file-pen-line',
    ENABLED: 'i-lucide:circle-check',
  }[status]
}

function versionStatusIcon(status: NumberingRuleVersionDto['status']): string {
  return {
    ACTIVE: 'i-lucide:badge-check',
    DRAFT: 'i-lucide:file-clock',
    RETIRED: 'i-lucide:archive',
  }[status]
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    activeTab.value = 'overview'
  }
})

watch(tabs, (availableTabs) => {
  // 动态撤销发号权限时立即退出敏感 tab，且不触发任何兜底请求。
  if (!availableTabs.some(tab => tab.value === activeTab.value)) {
    activeTab.value = 'overview'
  }
})

watch(() => [props.versionsPage, props.versionsPageSize] as const, ([page, size]) => {
  versionPageModel.value = page
  versionPageSizeModel.value = size
})

watch(() => [props.issuancesPage, props.issuancesPageSize] as const, ([page, size]) => {
  issuancePageModel.value = page
  issuancePageSizeModel.value = size
})

watch(() => props.issuanceFilters, (filters) => {
  Object.assign(issuanceFilterDraft, filters)
}, { deep: true })
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="drawerTitle"
    :description="drawerDescription"
    size="xl"
    :loading="detailLoading"
    :error="detailError"
    @update:model-value="handleVisibleChange"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:list-ordered" class="size-4" />
    </template>

    <template #error-actions>
      <FaButton size="sm" variant="outline" @click="emit('reloadDetail')">
        重新加载
      </FaButton>
      <code v-if="detailRequestId" class="qs-type-meta [overflow-wrap:anywhere]">
        requestId: {{ detailRequestId }}
      </code>
    </template>

    <FaEmpty
      v-if="detail === null || !permissions.canRead"
      :icon="permissions.canRead ? 'i-lucide:file-question' : 'i-lucide:shield-alert'"
      :title="permissions.canRead ? '暂无规则详情' : '无权查看规则详情'"
      :description="permissions.canRead
        ? '请返回列表重新选择编号规则。'
        : '当前身份缺少 numbering-rules:read 权限。'"
      class="min-h-64"
    />

    <div v-else data-testid="numbering-detail-drawer" class="gap-4 grid min-w-0">
      <FaAlert
        v-if="actionError"
        role="alert"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="规则操作未完成"
      >
        <template #description>
          <div class="flex flex-wrap gap-2 min-w-0 items-center justify-between">
            <span class="break-words">{{ actionError }}</span>
            <code v-if="actionRequestId" class="qs-type-meta [overflow-wrap:anywhere]">
              requestId: {{ actionRequestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <FaTabs
        :model-value="activeTab"
        :list="tabs"
        class="min-w-0"
        list-class="h-auto min-h-11 w-full"
        content-class="mt-4 min-w-0"
        data-testid="numbering-detail-tabs"
        @update:model-value="handleTabChange"
      >
        <template #overview>
          <div class="gap-4 grid min-w-0">
            <section class="p-4 border border-border rounded-lg bg-muted/10 min-w-0">
              <div class="mb-4 flex flex-wrap gap-3 items-start justify-between">
                <div class="min-w-0">
                  <p class="qs-type-compact-label m-0">
                    规则身份
                  </p>
                  <h3 class="qs-type-section-title mb-1 mt-1 break-words">
                    {{ detail.name }}
                  </h3>
                  <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">
                    {{ detail.ruleCode }}
                  </code>
                  <p class="qs-type-meta mb-0 mt-2">
                    用途分类：{{ numberingPurposeLabel(detail.purpose) }}
                  </p>
                </div>
                <FaTag class="qs-type-status-tag" variant="outline">
                  <FaIcon :name="statusIcon(detail.status)" class="me-1 size-3.5" />
                  {{ numberingRuleStatusLabel(detail.status) }}
                </FaTag>
              </div>
              <p class="qs-type-description mb-0 mt-0 break-words">
                {{ detail.description || '未填写规则说明' }}
              </p>
            </section>

            <section aria-labelledby="numbering-statistics-title">
              <div class="mb-3 flex flex-wrap gap-2 items-baseline justify-between">
                <h3 id="numbering-statistics-title" class="qs-type-section-title m-0">
                  当前周期统计
                </h3>
                <span class="qs-type-meta">
                  {{ detail.statistics.periodKey }} · {{ numberingPeriodStatusLabel(detail.statistics.periodStatus) }}
                </span>
              </div>
              <dl class="m-0 gap-3 grid grid-cols-3 min-w-0 max-[390px]:grid-cols-1">
                <div class="p-3 border border-border rounded-lg bg-background min-w-0">
                  <dt class="qs-type-compact-label">
                    容量
                  </dt>
                  <dd class="qs-type-data-emphasis mb-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(detail.statistics.capacity) }}
                  </dd>
                </div>
                <div class="p-3 border border-border rounded-lg bg-background min-w-0">
                  <dt class="qs-type-compact-label">
                    已使用
                  </dt>
                  <dd class="qs-type-data mb-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(detail.statistics.usedCount) }}
                  </dd>
                </div>
                <div class="p-3 border border-border rounded-lg bg-background min-w-0">
                  <dt class="qs-type-compact-label">
                    剩余
                  </dt>
                  <dd class="qs-type-data-emphasis mb-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(detail.statistics.remainingCount) }}
                  </dd>
                </div>
                <div class="p-3 border border-border rounded-lg bg-background min-w-0">
                  <dt class="qs-type-compact-label">
                    累计使用
                  </dt>
                  <dd class="qs-type-data mb-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(detail.statistics.lifetimeUsedCount) }}
                  </dd>
                </div>
                <div class="p-3 border border-border rounded-lg bg-background min-w-0">
                  <dt class="qs-type-compact-label">
                    下一序列值
                  </dt>
                  <dd class="qs-type-data mb-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                    {{ detail.statistics.nextSequenceValue === null
                      ? '生成时确定'
                      : formatNumberingDecimal(detail.statistics.nextSequenceValue) }}
                  </dd>
                </div>
                <div class="p-3 border border-border rounded-lg bg-background min-w-0">
                  <dt class="qs-type-compact-label">
                    下一编号
                  </dt>
                  <dd class="mb-0 mt-1 min-w-0">
                    <code class="qs-type-data-emphasis block whitespace-normal [overflow-wrap:anywhere]">
                      {{ detail.statistics.nextNumberPreview || '暂不可预览' }}
                    </code>
                  </dd>
                </div>
              </dl>
            </section>

            <section
              v-for="version in [detail.activeVersion, detail.draftVersion].filter(Boolean) as NumberingRuleVersionDto[]"
              :key="version.id"
              class="p-4 border border-border rounded-lg min-w-0"
            >
              <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
                <h3 class="qs-type-section-title m-0">
                  revision {{ version.revision }}
                </h3>
                <FaTag class="qs-type-status-tag" variant="outline">
                  <FaIcon :name="versionStatusIcon(version.status)" class="me-1 size-3.5" />
                  {{ numberingVersionStatusLabel(version.status) }}
                </FaTag>
              </div>
              <code class="qs-type-data-mono block whitespace-normal [overflow-wrap:anywhere]">
                {{ describeNumberingVersion(version).structure }}
              </code>
              <p class="qs-type-meta mb-0 mt-2 break-words">
                {{ describeNumberingVersion(version).resetPolicy }} · {{ describeNumberingVersion(version).timezone }}
                · 容量 {{ describeNumberingVersion(version).capacity }}
              </p>
            </section>

            <p class="qs-type-meta m-0 text-end">
              统计截至
              <DateTimeDisplay :value="detail.statistics.asOf" time-zone="Asia/Shanghai" />
            </p>
          </div>
        </template>

        <template #versions>
          <section aria-label="编号规则版本记录" class="gap-3 grid min-w-0">
            <FaAlert
              v-if="versionsError"
              role="alert"
              variant="destructive"
              icon="i-lucide:circle-alert"
              title="版本加载失败"
            >
              <template #description>
                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <span>{{ versionsError }}</span>
                  <code v-if="versionsRequestId" class="qs-type-meta [overflow-wrap:anywhere]">
                    requestId: {{ versionsRequestId }}
                  </code>
                  <FaButton size="sm" variant="outline" @click="emitVersions(versionsPage, versionsPageSize)">
                    重试
                  </FaButton>
                </div>
              </template>
            </FaAlert>
            <div v-if="versionsLoading" class="py-12 flex gap-2 items-center justify-center" role="status">
              <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
              <span>正在加载版本…</span>
            </div>
            <FaEmpty
              v-else-if="versions.length === 0"
              icon="i-lucide:history"
              title="暂无版本记录"
              description="发布版本后将在这里保留完整历史。"
            />
            <ol v-else class="m-0 p-0 list-none gap-3 grid">
              <li
                v-for="version in versions"
                :key="version.id"
                class="p-4 border border-border rounded-lg bg-background min-w-0"
              >
                <div class="flex flex-wrap gap-3 items-start justify-between">
                  <div class="min-w-0">
                    <strong class="qs-type-body-medium">revision {{ version.revision }}</strong>
                    <code class="qs-type-data-mono mt-2 block whitespace-normal [overflow-wrap:anywhere]">
                      {{ describeNumberingVersion(version).structure }}
                    </code>
                  </div>
                  <FaTag class="qs-type-status-tag" variant="outline">
                    <FaIcon :name="versionStatusIcon(version.status)" class="me-1 size-3.5" />
                    {{ numberingVersionStatusLabel(version.status) }}
                  </FaTag>
                </div>
                <dl class="m-0 mt-3 gap-3 grid grid-cols-3 max-[390px]:grid-cols-1">
                  <div>
                    <dt class="qs-type-compact-label">
                      容量
                    </dt>
                    <dd class="qs-type-data-emphasis m-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                      {{ describeNumberingVersion(version).capacity }}
                    </dd>
                  </div>
                  <div>
                    <dt class="qs-type-compact-label">
                      创建时间
                    </dt>
                    <dd class="qs-type-data m-0 mt-1">
                      <DateTimeDisplay :value="version.createdAt" time-zone="Asia/Shanghai" />
                    </dd>
                  </div>
                  <div>
                    <dt class="qs-type-compact-label">
                      发布时间
                    </dt>
                    <dd class="qs-type-data m-0 mt-1">
                      <DateTimeDisplay v-if="version.publishedAt" :value="version.publishedAt" time-zone="Asia/Shanghai" />
                      <span v-else>尚未发布</span>
                    </dd>
                  </div>
                </dl>
              </li>
            </ol>
            <FaPagination
              v-if="versionsTotal > 0"
              v-model:page="versionPageModel"
              v-model:size="versionPageSizeModel"
              :total="versionsTotal"
              layout="pager, sizes"
              class="flex-wrap max-w-full justify-center"
              @page-change="handleVersionPageChange"
              @size-change="handleVersionPageSizeChange"
            />
          </section>
        </template>

        <template v-if="canLoadNumberingIssuances(permissions)" #issuances>
          <section aria-label="编号发号记录" class="gap-4 grid min-w-0">
            <div class="p-3 border border-border rounded-lg bg-muted/10 gap-3 grid grid-cols-2 max-[390px]:grid-cols-1">
              <label class="gap-1.5 grid min-w-0">
                <span class="qs-type-compact-label">周期</span>
                <FaInput v-model="issuanceFilterDraft.periodKey" aria-label="发号周期" class="w-full" placeholder="ALL 或 YYYYMMDD" />
              </label>
              <label class="gap-1.5 grid min-w-0">
                <span class="qs-type-compact-label">调用方编码</span>
                <FaInput v-model="issuanceFilterDraft.consumerCode" aria-label="调用方编码" class="w-full" placeholder="例如 ORDER.CREATE" />
              </label>
              <label class="gap-1.5 grid min-w-0">
                <span class="qs-type-compact-label">已生成编号</span>
                <FaInput v-model="issuanceFilterDraft.generatedNumber" aria-label="已生成编号" class="w-full" placeholder="输入完整编号或前缀" />
              </label>
              <label class="gap-1.5 grid min-w-0">
                <span class="qs-type-compact-label">匹配方式</span>
                <FaSelect
                  v-model="issuanceFilterDraft.generatedNumberMatch"
                  :options="[
                    { label: '精确匹配', value: 'EXACT' },
                    { label: '前缀匹配', value: 'PREFIX' },
                  ]"
                  aria-label="编号匹配方式"
                  class="w-full"
                />
              </label>
              <div class="flex flex-col gap-2 col-span-full sm:flex-row max-[390px]:col-span-1 sm:justify-end">
                <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="resetIssuanceFilters">
                  重置
                </FaButton>
                <FaButton class="min-h-11 sm:min-h-9" @click="applyIssuanceFilters">
                  查询记录
                </FaButton>
              </div>
            </div>

            <FaAlert
              v-if="issuancesError"
              role="alert"
              variant="destructive"
              icon="i-lucide:circle-alert"
              title="发号记录加载失败"
            >
              <template #description>
                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <span>{{ issuancesError }}</span>
                  <code v-if="issuancesRequestId" class="qs-type-meta [overflow-wrap:anywhere]">
                    requestId: {{ issuancesRequestId }}
                  </code>
                  <FaButton size="sm" variant="outline" @click="emitIssuances(issuancesPage, issuancesPageSize, issuanceFilters)">
                    重试
                  </FaButton>
                </div>
              </template>
            </FaAlert>
            <div v-if="issuancesLoading" class="py-12 flex gap-2 items-center justify-center" role="status">
              <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
              <span>正在加载发号记录…</span>
            </div>
            <FaEmpty
              v-else-if="issuances.length === 0"
              icon="i-lucide:receipt-text"
              title="暂无发号记录"
              description="当前筛选范围内没有已生成编号。"
            />
            <ol v-else class="m-0 p-0 list-none gap-3 grid">
              <li
                v-for="issuance in issuances"
                :key="issuance.id"
                class="p-4 border border-border rounded-lg bg-background min-w-0"
              >
                <code class="qs-type-data-emphasis block whitespace-normal [overflow-wrap:anywhere]">
                  {{ issuance.generatedNumber }}
                </code>
                <dl class="m-0 mt-3 gap-3 grid grid-cols-3 max-[390px]:grid-cols-1">
                  <div>
                    <dt class="qs-type-compact-label">
                      consumerCode
                    </dt>
                    <dd class="qs-type-data m-0 mt-1 [overflow-wrap:anywhere]">
                      {{ issuance.consumerCode }}
                    </dd>
                  </div>
                  <div>
                    <dt class="qs-type-compact-label">
                      revision / periodKey
                    </dt>
                    <dd class="qs-type-data m-0 mt-1 tabular-nums">
                      {{ issuance.ruleRevision }} / {{ issuance.periodKey }}
                    </dd>
                  </div>
                  <div>
                    <dt class="qs-type-compact-label">
                      issuedAt
                    </dt>
                    <dd class="qs-type-data m-0 mt-1">
                      <DateTimeDisplay :value="issuance.issuedAt" time-zone="Asia/Shanghai" />
                    </dd>
                  </div>
                  <div v-if="issuance.sequenceValue !== null" class="col-span-full max-[390px]:col-span-1">
                    <dt class="qs-type-compact-label">
                      sequenceValue
                    </dt>
                    <dd class="qs-type-data m-0 mt-1 [overflow-wrap:anywhere] tabular-nums">
                      {{ formatNumberingDecimal(issuance.sequenceValue) }}
                    </dd>
                  </div>
                </dl>
              </li>
            </ol>
            <FaPagination
              v-if="issuancesTotal > 0"
              v-model:page="issuancePageModel"
              v-model:size="issuancePageSizeModel"
              :total="issuancesTotal"
              layout="pager, sizes"
              class="flex-wrap max-w-full justify-center"
              @page-change="handleIssuancePageChange"
              @size-change="handleIssuancePageSizeChange"
            />
          </section>
        </template>
      </FaTabs>
    </div>

    <template v-if="detail !== null && hasFooterActions" #footer>
      <FaButton v-if="actions.canEdit" data-testid="numbering-detail-action-edit" variant="outline" class="min-h-11 w-full md:min-h-9 md:w-auto" @click="requestAction('edit')">
        编辑
      </FaButton>
      <FaButton v-if="actions.canClone" data-testid="numbering-detail-action-clone" variant="outline" class="min-h-11 w-full md:min-h-9 md:w-auto" @click="requestAction('clone')">
        克隆
      </FaButton>
      <FaButton v-if="actions.canPublish" data-testid="numbering-detail-action-publish" class="min-h-11 w-full md:min-h-9 md:w-auto" @click="requestAction('publish')">
        发布草稿
      </FaButton>
      <FaButton v-if="actions.canEnable" data-testid="numbering-detail-action-enable" class="min-h-11 w-full md:min-h-9 md:w-auto" @click="requestAction('enable')">
        启用规则
      </FaButton>
      <FaButton v-if="actions.canDisable" data-testid="numbering-detail-action-disable" variant="destructive" class="min-h-11 w-full md:min-h-9 md:w-auto" @click="requestAction('disable')">
        停用规则
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
