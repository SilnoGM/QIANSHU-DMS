<script setup lang="ts">
import type {
  SlhReconciliationBillAmountRow,
  SlhReconciliationLineField,
} from './detail.logic'
import type { SlhReconciliationBatchDetailDto } from '@/api/generated/types.gen'
import exchangeRatesApi from '@/api/modules/exchange-rates'
import slhBillsApi from '@/api/modules/slh-bills'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsReconciliationLineSwitcher from '@/components/business/QsReconciliationLineSwitcher/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import { containerFailure } from '../containers/use-container-resource'
import {
  buildSlhReconciliationBillLinePanel,
  buildSlhReconciliationFocusValues,
  buildSlhReconciliationLineItems,
  buildSlhReconciliationLoadingItemPanel,
  buildSlhReconciliationOrderSections,
  resolveSlhReconciliationSelectedMember,
  SLH_RECONCILIATION_LINE_TONES,
} from './detail.logic'
import SlhReconciliationOverflowText from './overflow-text.vue'
import SlhReconciliationRecordsModal from './records-modal.vue'
import SlhReconciliationSettleModal from './settle-modal.vue'
import {
  resolveSlhReconciliationBatchLabelKey,
  resolveSlhReconciliationBatchTone,
  resolveSlhReconciliationCompleteBlockLabelKey,
  resolveSlhReconciliationCompleteBlockReason,
} from './status.logic'

/**
 * 批次详情页：切换器自带面板，用来浏览创建时冻结的明细行；切换器下方是「核对焦点」——
 * 三个跨域金额（销售尾款 / 装柜代收货款 / 账单代收货款）并列展示供人工比对，只展示不判定；
 * 再往下三块面板横向排布，分别展示选中行的销售/采购信息、装柜明细行信息与账单明细行信息。
 * 头部辅助文字给出批次状态、批次编号与账单基础信息；底部承接「完成批次对账」动作。
 */
defineOptions({ name: 'QsFinanceBillReconciliationSlhReconciliationDetail' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const batchId = computed(() => String(route.params.id ?? ''))
const batch = shallowRef<SlhReconciliationBatchDetailDto | null>(null)
const loading = ref(false)
const loadError = ref('')
const completeOpen = ref(false)
const completing = ref(false)
/** 「对账信息」弹窗：开关与打开时取到的两个汇率（系统当前 / 账单内置）。 */
const settleOpen = ref(false)
const settleSystemRate = ref<string | null>(null)
const settleBillRate = ref<string | null>(null)
/** 完成失败的错误提示比默认提示停得久一点：失败原因常常要读几行，别还没看清就消失。 */
const ACTION_ERROR_TOAST_DURATION = 8_000
/** 选中行由页面持有：切换器只发 update:modelValue，行数据与后续核对动作都跟着它走。 */
const selectedLineId = ref<string | null>(null)
let controller: AbortController | null = null

/** 纯函数只要求最小翻译签名；带参数时显式展开，与弹窗里的既有写法一致。 */
function translate(key: string, params?: Record<string, unknown>) {
  return params === undefined ? t(key) : t(key, params)
}

/**
 * 完成批次的门禁：批次已结束、或还有未核对的明细行时都不让完成。
 * 未通过时按钮看起来不可用，但仍可点击——点了给一句轻提示说明原因，而不是无声无息。
 * 批次还没读到时是例外：按钮真禁用（页面上已有错误与重试，不必再解释）。
 */
const completeBlockReason = computed(() => (
  batch.value === null ? null : resolveSlhReconciliationCompleteBlockReason(batch.value)
))
const canComplete = computed(() => batch.value !== null && completeBlockReason.value === null)
const members = computed(() => batch.value?.members ?? [])
const lineSwitcherItems = computed(() => buildSlhReconciliationLineItems(members.value, translate))
const selectedMember = computed(() => resolveSlhReconciliationSelectedMember(members.value, selectedLineId.value))
/** 核对焦点与三块面板的字段清单都跟着选中行走；均为纯函数结果，不额外请求数据。 */
const focusValues = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationFocusValues(selectedMember.value, translate)
))
const orderSections = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationOrderSections(selectedMember.value, translate)
))
const loadingItemPanel = computed(() => (
  selectedMember.value === null ? null : buildSlhReconciliationLoadingItemPanel(selectedMember.value, translate)
))
const billLinePanel = computed(() => (
  selectedMember.value === null ? null : buildSlhReconciliationBillLinePanel(selectedMember.value, translate)
))
/** 账单面板金额行的字号与颜色：总额大号加粗、代收货款大号加粗且蓝、台币杂费橙红。 */
function billAmountClass(row: SlhReconciliationBillAmountRow): string {
  if (row.emphasis === 'total') {
    return '!text-xl !font-semibold'
  }
  if (row.emphasis === 'cod') {
    return '!text-xl !font-semibold !text-sky-700 dark:!text-sky-300'
  }
  return row.emphasis === 'warning' ? '!text-amber-700 dark:!text-amber-300' : ''
}
/** 金额块的行间距：总额行之后用一条虚线分开，其余行只靠行距区分。 */
function amountRowClass(index: number): string {
  return index === 1 ? 'pt-2 border-t border-dashed border-border' : ''
}
/** 金额块的金额样式：总额大号加粗，余额非零时染红（标记由 logic 判断后下发）。 */
function amountClass(field: SlhReconciliationLineField): string {
  if (field.emphasis === 'total') {
    return '!text-xl !font-semibold'
  }
  return field.emphasis === 'balance' ? '!text-destructive' : ''
}

/**
 * 成员变化后收敛选中值：仍在清单里就保持，否则退回第一条，批次为空时清空。
 * 切换器不擅自改模型值，选中项的校正属于页面职责。
 */
watch(members, (list) => {
  if (selectedLineId.value !== null && list.some(member => member.lineId === selectedLineId.value)) {
    return
  }
  selectedLineId.value = list.at(0)?.lineId ?? null
}, { immediate: true })

async function load(): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  loadError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.get(batchId.value, current.signal)
    if (current.signal.aborted) {
      return
    }
    batch.value = response.data
  }
  catch (failure) {
    if (!current.signal.aborted) {
      batch.value = null
      loadError.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

function backToList(): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillReconciliation' })
}

/** 点完成：门禁未过时只说明原因（按钮仍是软禁用态，可点但看起来不可用）。 */
function requestComplete(): void {
  if (completeBlockReason.value !== null) {
    toast.info(t(resolveSlhReconciliationCompleteBlockLabelKey(completeBlockReason.value), {
      count: Math.max((batch.value?.memberCount ?? 0) - (batch.value?.reconciledMemberCount ?? 0), 0),
    }))
    return
  }
  completeOpen.value = true
}

const SYSTEM_RATE_CURRENCY_CODE = 'TWD'

/** 当前系统汇率（顺联航账单的台币口径）：取不到（无权限/失败）返回 null，由调用方决定怎么退化。 */
async function resolveSystemForeignUnitsPerCny(): Promise<string | null> {
  try {
    const response = await exchangeRatesApi.list(new AbortController().signal)
    return response.data.items
      .find(item => item.currency.code === SYSTEM_RATE_CURRENCY_CODE)
      ?.currentRate
      ?.foreignUnitsPerCny ?? null
  }
  catch {
    return null
  }
}

/** 账单内置汇率：批次详情不带，打开弹窗时按账单 id 取一次账单详情。 */
async function resolveBillForeignUnitsPerCny(): Promise<string | null> {
  const billId = batch.value?.bill.id
  if (billId === undefined) {
    return null
  }
  try {
    const response = await slhBillsApi.get(billId, new AbortController().signal)
    // 账单详情把汇率收在 rate 里：内嵌汇率可能为 null（账单公式没自带汇率）。
    return response.data.rate?.embeddedForeignUnitsPerCny ?? null
  }
  catch {
    return null
  }
}

/** 「本行核对正确」：打开两步的「对账信息」弹窗（只算汇率与两个金额，不落库）。 */
async function openSettleModal(): Promise<void> {
  if (selectedMember.value === null) {
    return
  }
  const [systemRate, billRate] = await Promise.all([
    resolveSystemForeignUnitsPerCny(),
    resolveBillForeignUnitsPerCny(),
  ])
  settleSystemRate.value = systemRate
  settleBillRate.value = billRate
  settleOpen.value = true
}

/** 「本行核对有误」：接口随本分支重构删除，先只给反馈，接线时替换成真实动作。 */
function showReconcilePending(labelKey: string): void {
  toast.info(t('slhReconciliation.detail.reconcilePending', { action: t(labelKey) }))
}

/** 「查看核对记录」：只读弹窗自己取数，页面只负责开合与当前选中行。 */
const recordsOpen = ref(false)
function openRecordsModal(): void {
  if (selectedMember.value === null) {
    return
  }
  recordsOpen.value = true
}

async function complete(): Promise<void> {
  if (!canComplete.value || completing.value) {
    return
  }
  completing.value = true
  try {
    await slhReconciliationBatchesApi.complete(batchId.value, new AbortController().signal)
    completeOpen.value = false
    toast.success(t('slhReconciliation.detail.completedToast'))
    // 重新读回：头部状态标签与底部按钮的禁用都跟着服务端数据走。
    await load()
  }
  catch (failure) {
    toast.error(containerFailure(failure).message, { duration: ACTION_ERROR_TOAST_DURATION })
    completeOpen.value = false
  }
  finally {
    completing.value = false
  }
}

watch(batchId, () => {
  void load()
}, { immediate: true })
onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.slhBillReconciliationDetail')">
      <template #description>
        <span v-if="batch" class="qs-type-description text-muted-foreground flex flex-wrap gap-2 items-center">
          <FaTag variant="outline" class="qs-type-status-tag" :class="resolveSlhReconciliationBatchTone(batch.status)">
            {{ t(resolveSlhReconciliationBatchLabelKey(batch.status)) }}
          </FaTag>
          <span class="font-mono">{{ batch.batchNo }}</span>
          <span aria-hidden="true">·</span>
          <span class="font-mono">{{ batch.bill.slhBillNo }}</span>
          <span class="text-foreground">{{ batch.bill.billName }}</span>
        </span>
      </template>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:w-auto sm:items-center">
        <FaButton variant="outline" class="w-full sm:w-auto" @click="backToList">
          <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhReconciliation.backToList') }}
        </FaButton>
        <!--
          完成按钮在门禁未过时只做「软禁用」：aria-disabled + 降透明度，但保留点击，
          点了由 requestComplete 说明原因；批次没读到时才是真禁用（页面已有错误与重试）。
        -->
        <FaButton
          :loading="completing"
          :disabled="batch === null || completing"
          :aria-disabled="!canComplete || completing"
          class="w-full sm:w-auto"
          :class="canComplete ? '' : 'opacity-50'"
          @click="requestComplete"
        >
          {{ t('slhReconciliation.detail.completeButton') }}
        </FaButton>
      </div>
    </FaPageHeader>
    <!-- 读取失败给错误与重试；其余批次内容留到详情页重做时再补。 -->
    <FaPageMain v-if="loadError" class="min-w-0">
      <FaAlert variant="destructive" role="alert" :title="loadError" />
      <FaButton class="mt-3" variant="outline" @click="load">
        {{ t('slhBill.retry') }}
      </FaButton>
    </FaPageMain>
    <template v-else-if="batch">
      <template v-if="members.length > 0">
        <!-- 切换器独立成一块面板：只用一个普通容器承接页面外边距，不塞进 FaPageMain 里。 -->
        <div class="m-4 min-w-0">
          <QsReconciliationLineSwitcher
            v-model="selectedLineId"
            :items="lineSwitcherItems"
            :status-tones="SLH_RECONCILIATION_LINE_TONES"
            :aria-label="t('slhReconciliation.detail.lineSwitcherLabel')"
          />
        </div>
        <!--
          核对焦点：三个跨域金额并列展示，只供人工目测比对（不判定、不给差异、不换算币种）。
          按产品要求不显示标题与说明文字；容器只保留一个不可见的无障碍名称。
        -->
        <div
          v-if="selectedMember"
          class="m-4 min-w-0"
          role="group"
          :aria-label="t('slhReconciliation.detail.focusTitle')"
        >
          <div class="gap-4 grid sm:grid-cols-3">
            <div
              v-for="focus in focusValues"
              :key="focus.id"
              data-slot="slh-reconciliation-focus-item"
              class="qs-focus-card p-4 border border-border rounded-xl bg-card min-w-0"
              :class="`qs-focus-card--${focus.accent}`"
            >
              <!-- 装饰图案：与来源同域的大号图标，只做视觉标记，不进无障碍树。 -->
              <FaIcon
                :name="focus.motif"
                aria-hidden="true"
                class="qs-focus-card__motif"
              />
              <!-- 内容自成一格并抬到图案之上，否则绝对定位的图案会盖住金额文字。 -->
              <div class="flex flex-col gap-1 min-w-0 relative z-1">
                <p class="qs-type-compact-label text-muted-foreground m-0">
                  {{ focus.sourceLabel }}
                </p>
                <AmountDisplay
                  v-if="!focus.isEmpty"
                  :value="focus.value"
                  :currency="focus.currency"
                  :currencies="currencyCatalog.currencies.value"
                  class="!text-2xl !font-semibold"
                />
                <!-- 空值＝本行不涉及：只留占位符与说明，与 0.00 区分开。 -->
                <template v-else>
                  <p class="text-base text-muted-foreground m-0">
                    {{ t('slhBill.valueMissing') }}
                  </p>
                  <p class="qs-type-meta text-muted-foreground m-0">
                    {{ t('slhReconciliation.detail.focusEmptyNote') }}
                  </p>
                </template>
              </div>
            </div>
          </div>
        </div>
        <!-- 选中行的三方资料横向排布：宽屏三列、中屏两列、窄屏堆叠。 -->
        <div
          v-if="selectedMember"
          class="m-4 gap-4 grid lg:grid-cols-2 xl:grid-cols-3"
        >
          <!-- 销售与采购：每个区块＝信息块（单号＋状态徽章）＋关键字段行＋金额块，区块之间用分割线隔开。 -->
          <FaPageMain class="m-0 min-w-0">
            <template v-for="(section, sectionIndex) in orderSections" :key="section.id">
              <!-- 装饰性分割线不进无障碍树。 -->
              <div
                v-if="sectionIndex > 0"
                class="my-3 border-t border-border"
                aria-hidden="true"
              />
              <section class="min-w-0" :aria-label="section.label">
                <!-- 区块标题：竖条沿用采购订单详情的分区标题范式（纯装饰，不进无障碍树）。 -->
                <h2 class="qs-type-section-title m-0 flex gap-2 items-center">
                  <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
                  {{ section.label }}
                </h2>
                <!-- 信息块：单号单独一行，下面一行三个状态徽章。 -->
                <div class="mt-3 p-3 rounded-lg bg-muted/40 flex flex-col gap-2 min-w-0">
                  <p class="qs-type-data-emphasis m-0 break-all">
                    {{ section.orderNo.value }}
                  </p>
                  <div v-if="section.states.length > 0" class="flex flex-wrap gap-1.5">
                    <FaTag
                      v-for="state in section.states"
                      :key="state.dimension"
                      variant="outline"
                      class="qs-type-status-tag"
                      :class="resolveStatusTagToneClass(state.tone)"
                      :aria-label="`${state.dimension}：${state.label}`"
                    >
                      {{ state.label }}
                    </FaTag>
                  </div>
                </div>
                <!-- 关键字段行：客户信息（姓名 · 电话合并）、完整地址、出单人 / 供应商、采购唛头、采购人。 -->
                <dl class="m-0 mt-3 flex flex-col gap-2">
                  <div
                    v-for="field in section.fields"
                    :key="field.id"
                    class="gap-x-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline"
                  >
                    <dt class="qs-type-compact-label text-muted-foreground">
                      {{ field.label }}
                    </dt>
                    <dd class="m-0 break-all">
                      <!-- 人员行：姓名交给 QsPersonDisplay（头像位 + 单行截断 + 悬停完整名）。 -->
                      <QsPersonDisplay
                        v-if="field.person"
                        :display-name="field.person"
                        size="sm"
                        class="max-w-full"
                      />
                      <!-- 长文本行：单行截断，只有真的截断了才给悬停提示。 -->
                      <SlhReconciliationOverflowText
                        v-else-if="field.truncate"
                        :text="field.value"
                      />
                      <span v-else class="qs-type-data">
                        {{ field.value }}
                      </span>
                    </dd>
                  </div>
                </dl>
                <!-- 金额块：总额大号加粗右对齐，虚线之后是三项明细，末行余额非零时染红。 -->
                <dl class="m-0 mt-3 p-3 border border-border rounded-lg flex flex-col gap-2">
                  <div
                    v-for="(field, index) in section.amountFields"
                    :key="field.id"
                    class="gap-x-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline"
                    :class="amountRowClass(index)"
                  >
                    <dt
                      class="qs-type-compact-label"
                      :class="field.emphasis === 'total' ? 'text-foreground' : 'text-muted-foreground'"
                    >
                      {{ field.label }}
                    </dt>
                    <dd class="m-0 text-right">
                      <!-- 金额统一走 AmountDisplay（符号、千分位与币种精度）；右对齐由本行给定。 -->
                      <AmountDisplay
                        v-if="field.amount"
                        :value="field.amount.value"
                        :currency="field.amount.currency"
                        :currencies="currencyCatalog.currencies.value"
                        :class="amountClass(field)"
                      />
                      <span v-else class="qs-type-data">
                        {{ field.value }}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>
            </template>
          </FaPageMain>
          <!-- 装柜明细行：顶部信息块（入仓单号 + 匹配依据标签）＋货物明细＋代收货款块＋收货与备注。 -->
          <FaPageMain v-if="loadingItemPanel" class="m-0 min-w-0">
            <h2 class="qs-type-compact-title m-0">
              {{ t('slhReconciliation.detail.loadingItemTitle') }}
            </h2>
            <div class="mt-3 p-3 rounded-lg bg-muted/40 flex flex-col gap-2 min-w-0">
              <p class="m-0 min-w-0">
                <span class="qs-type-compact-label text-muted-foreground">
                  {{ loadingItemPanel.receiptReference.label }}
                </span>
                <span class="qs-type-data-emphasis mt-0.5 block break-all">
                  {{ loadingItemPanel.receiptReference.value }}
                </span>
              </p>
              <div class="flex flex-wrap gap-1.5">
                <FaTag
                  v-for="tag in loadingItemPanel.tags"
                  :key="tag.text"
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="resolveStatusTagToneClass(tag.tone)"
                >
                  {{ tag.text }}
                </FaTag>
              </div>
            </div>
            <!-- 货物明细：与账单侧同名，两侧同名行便于逐项对照。 -->
            <div class="mt-4 min-w-0">
              <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
                <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
                {{ loadingItemPanel.cargo.label }}
              </h3>
              <dl class="m-0 mt-3 flex flex-col gap-2">
                <div
                  v-for="field in loadingItemPanel.cargo.fields"
                  :key="field.id"
                  class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline"
                >
                  <dt class="qs-type-compact-label text-muted-foreground">
                    {{ field.label }}
                  </dt>
                  <dd class="m-0 min-w-0">
                    <SlhReconciliationOverflowText
                      v-if="field.truncate"
                      :text="field.value"
                    />
                    <span v-else class="qs-type-data">
                      {{ field.value }}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
            <!-- 费用详情：代收货款是对账焦点之一，单独成块并与核对焦点区同源同格式。 -->
            <div class="mt-4 min-w-0">
              <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
                <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
                {{ loadingItemPanel.fee.label }}
              </h3>
              <dl class="m-0 mt-3 p-3 border border-border rounded-lg flex flex-col">
                <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
                  <dt class="qs-type-compact-label text-foreground">
                    {{ loadingItemPanel.fee.amount.label }}
                  </dt>
                  <dd class="m-0 text-right">
                    <AmountDisplay
                      v-if="loadingItemPanel.fee.amount.amount"
                      :value="loadingItemPanel.fee.amount.amount.value"
                      :currency="loadingItemPanel.fee.amount.amount.currency"
                      :currencies="currencyCatalog.currencies.value"
                      :class="billAmountClass(loadingItemPanel.fee.amount)"
                    />
                    <span v-else class="qs-type-data">{{ loadingItemPanel.fee.amount.value }}</span>
                  </dd>
                </div>
              </dl>
            </div>
            <!-- 收货与备注：收货信息叠三行，备注走浅色标签，与账单侧同一形态。 -->
            <div class="mt-4 min-w-0">
              <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
                <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
                {{ loadingItemPanel.recipient.label }}
              </h3>
              <dl class="m-0 mt-3 flex flex-col gap-2">
                <div
                  v-for="field in loadingItemPanel.recipient.fields"
                  :key="field.id"
                  class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline"
                >
                  <dt class="qs-type-compact-label text-muted-foreground">
                    {{ field.label }}
                  </dt>
                  <dd class="m-0 min-w-0">
                    <template v-if="field.lines && field.lines.length > 0">
                      <span v-for="line in field.lines" :key="line" class="qs-type-data block break-all">
                        {{ line }}
                      </span>
                    </template>
                    <span
                      v-else-if="field.chip"
                      class="qs-type-data px-2 py-0.5 rounded-md bg-muted/50 inline-block break-all"
                    >
                      {{ field.value }}
                    </span>
                    <span v-else class="qs-type-data">
                      {{ field.value }}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          </FaPageMain>
          <!-- 账单明细行：顶部信息块（入仓单号 + 行号/柜号/装柜日期）＋货物明细＋费用结算＋收货与备注。 -->
          <FaPageMain v-if="billLinePanel" class="m-0 min-w-0">
            <h2 class="qs-type-compact-title m-0">
              {{ t('slhReconciliation.detail.billLineTitle') }}
            </h2>
            <div class="mt-3 p-3 rounded-lg bg-muted/40 flex flex-col gap-2 min-w-0">
              <p class="m-0 min-w-0">
                <span class="qs-type-compact-label text-muted-foreground">
                  {{ billLinePanel.receiptReference.label }}
                </span>
                <span class="qs-type-data-emphasis mt-0.5 block break-all">
                  {{ billLinePanel.receiptReference.value }}
                </span>
              </p>
              <div class="flex flex-wrap gap-1.5">
                <FaTag
                  v-for="tag in billLinePanel.tags"
                  :key="tag.text"
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="resolveStatusTagToneClass(tag.tone)"
                >
                  {{ tag.text }}
                </FaTag>
              </div>
            </div>
            <template v-for="section in billLinePanel.sections" :key="section.id">
              <div class="mt-4 min-w-0">
                <!-- 区块标题：竖条范式与销售/采购区块一致（纯装饰，不进无障碍树）。 -->
                <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
                  <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
                  {{ section.label }}
                </h3>
                <!-- 字段段：货物明细与收货与备注。 -->
                <dl v-if="section.id !== 'fees'" class="m-0 mt-3 flex flex-col gap-2">
                  <div
                    v-for="field in section.fields"
                    :key="field.id"
                    class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline"
                  >
                    <dt class="qs-type-compact-label text-muted-foreground">
                      {{ field.label }}
                    </dt>
                    <dd class="m-0 min-w-0">
                      <!-- 多行值（收货信息）：名称 / 地址 / 电话各占一行。 -->
                      <template v-if="field.lines && field.lines.length > 0">
                        <span v-for="line in field.lines" :key="line" class="qs-type-data block break-all">
                          {{ line }}
                        </span>
                      </template>
                      <!-- 备注这类整段短文本：值以浅色标签呈现。 -->
                      <span
                        v-else-if="field.chip"
                        class="qs-type-data px-2 py-0.5 rounded-md bg-muted/50 inline-block break-all"
                      >
                        {{ field.value }}
                      </span>
                      <SlhReconciliationOverflowText
                        v-else-if="field.truncate"
                        :text="field.value"
                      />
                      <span v-else class="qs-type-data">
                        {{ field.value }}
                      </span>
                    </dd>
                  </div>
                </dl>
                <!-- 费用段按币种分块：每块＝合计（大号）＋可选的明细合计行＋虚线之后的明细。 -->
                <div v-else class="mt-3 flex flex-col gap-3">
                  <dl
                    v-for="block in section.blocks"
                    :key="block.headline.id"
                    class="m-0 p-3 border border-border rounded-lg flex flex-col gap-2"
                  >
                    <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
                      <dt class="qs-type-compact-label text-foreground">
                        {{ block.headline.label }}
                      </dt>
                      <dd class="m-0 text-right">
                        <AmountDisplay
                          v-if="block.headline.amount"
                          :value="block.headline.amount.value"
                          :currency="block.headline.amount.currency"
                          :currencies="currencyCatalog.currencies.value"
                          :class="billAmountClass(block.headline)"
                        />
                        <span v-else class="qs-type-data">{{ block.headline.value }}</span>
                      </dd>
                    </div>
                    <div
                      v-if="block.summary"
                      class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline"
                    >
                      <dt class="qs-type-compact-label text-muted-foreground">
                        {{ block.summary.label }}
                      </dt>
                      <dd class="m-0 text-right">
                        <AmountDisplay
                          v-if="block.summary.amount"
                          :value="block.summary.amount.value"
                          :currency="block.summary.amount.currency"
                          :currencies="currencyCatalog.currencies.value"
                          :class="billAmountClass(block.summary)"
                        />
                        <span v-else class="qs-type-data">{{ block.summary.value }}</span>
                      </dd>
                    </div>
                    <div
                      v-for="(row, index) in block.details"
                      :key="row.id"
                      class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline"
                      :class="index === 0 ? 'pt-2 border-t border-dashed border-border' : ''"
                    >
                      <dt class="qs-type-compact-label text-muted-foreground flex flex-wrap gap-1 items-center">
                        {{ row.label }}
                        <FaTag
                          v-if="row.tag"
                          variant="outline"
                          class="qs-type-status-tag"
                          :class="resolveStatusTagToneClass(row.tag.tone)"
                        >
                          {{ row.tag.text }}
                        </FaTag>
                      </dt>
                      <dd class="m-0 text-right">
                        <AmountDisplay
                          v-if="row.amount"
                          :value="row.amount.value"
                          :currency="row.amount.currency"
                          :currencies="currencyCatalog.currencies.value"
                          :class="billAmountClass(row)"
                        />
                        <span v-else class="qs-type-data">{{ row.value }}</span>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </template>
          </FaPageMain>
        </div>
      </template>
      <!-- 没有冻结行时只给一句批次级说明，不让切换器空转。 -->
      <FaPageMain v-else class="min-w-0">
        <p class="qs-type-description text-muted-foreground m-0">
          {{ t('slhReconciliation.detail.membersEmpty') }}
        </p>
      </FaPageMain>
    </template>
    <FaFixedBar position="bottom" class="border-t border-border">
      <div class="flex flex-col gap-3 w-full md:flex-row md:items-center md:justify-end">
        <!-- 只读的查历史放在最左：与右侧两个写动作在视觉上分开。 -->
        <FaButton
          variant="outline"
          class="w-full md:mr-auto sm:w-auto"
          :disabled="selectedMember === null"
          @click="openRecordsModal"
        >
          {{ t('slhReconciliation.detail.viewRecords') }}
        </FaButton>
        <FaButton
          variant="destructive"
          class="w-full sm:w-auto"
          :disabled="completing"
          @click="showReconcilePending('slhReconciliation.detail.reconcileWrong')"
        >
          {{ t('slhReconciliation.detail.reconcileWrong') }}
        </FaButton>
        <FaButton
          class="w-full sm:w-auto"
          :disabled="selectedMember === null"
          @click="openSettleModal"
        >
          {{ t('slhReconciliation.detail.reconcileCorrect') }}
        </FaButton>
      </div>
    </FaFixedBar>

    <QsGenericModal
      v-model="completeOpen"
      :title="t('slhReconciliation.detail.completeTitle')"
      size="sm"
      :submitting="completing"
    >
      <p class="qs-type-description text-muted-foreground m-0">
        {{ t('slhReconciliation.detail.completeHint') }}
      </p>
      <template #footer>
        <div class="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
          <FaButton type="button" variant="outline" class="w-full sm:w-auto" :disabled="completing" @click="completeOpen = false">
            {{ t('slhBill.cancel') }}
          </FaButton>
          <FaButton type="button" class="w-full sm:w-auto" :loading="completing" @click="complete">
            {{ t('slhReconciliation.detail.completeConfirm') }}
          </FaButton>
        </div>
      </template>
    </QsGenericModal>

    <SlhReconciliationSettleModal
      v-model="settleOpen"
      :batch="batch"
      :member="selectedMember"
      :system-rate="settleSystemRate"
      :bill-rate="settleBillRate"
      @settled="load"
    />

    <SlhReconciliationRecordsModal
      v-model="recordsOpen"
      :batch-id="batchId"
      :member="selectedMember"
    />
  </div>
</template>

<style scoped>
/*
 * 三张核对焦点卡各自的身份色：纯装饰，不承载任何判定语义（不用语义色的深浅，
 * 只把同色系中调色按固定比例混进当前主题的卡片底色做斜向过渡）。
 * 混色基于 --card，浅色下自动得到淡色高光、深色下得到同色系暗调，无需为明暗各写一套规则。
 */
.qs-focus-card {
  position: relative;
  overflow: hidden;
  background-repeat: no-repeat;
}

/* 装饰图案压在内容下层、不接鼠标事件；颜色同样从主题卡片底色里混出来，明暗主题共用一套。 */
.qs-focus-card__motif {
  position: absolute;
  right: -0.75rem;
  bottom: -1rem;
  z-index: 0;
  width: 6.5rem;
  height: 6.5rem;
  pointer-events: none;
  transform: rotate(-8deg);
}

.qs-focus-card--emerald .qs-focus-card__motif {
  color: color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 14%, oklch(var(--card)));
}

.qs-focus-card--amber .qs-focus-card__motif {
  color: color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 14%, oklch(var(--card)));
}

.qs-focus-card--blue .qs-focus-card__motif {
  color: color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 14%, oklch(var(--card)));
}

.qs-focus-card--emerald {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.qs-focus-card--amber {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.qs-focus-card--blue {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}
</style>
