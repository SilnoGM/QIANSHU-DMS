<script setup lang="ts">
import type { SlhReconciliationPreviewLine, SlhReconciliationPreviewRow, SlhReconciliationSelectStep } from './select-modal.logic'
import type { SlhBillListItemDto, SlhReconciliationBatchDetailDto, SlhReconciliationBatchPreviewDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableGrouping } from '@/components/business/QsGenericTable/logic'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import { resolveSlhBillNetDisplay } from '../slh-bills/display.logic'
import SlhBillOverflowText from '../slh-bills/slh-bill-overflow-text.vue'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import { buildSlhReconciliationBatchCreatePayload, buildSlhReconciliationPreviewColumns, buildSlhReconciliationPreviewRows, resolveSlhReconciliationBillRowClass, resolveSlhReconciliationPreviewSummary, SLH_RECONCILIATION_SELECT_STEPS } from './select-modal.logic'
import { resolveSlhBillLineMatchSourceLabelKey, resolveSlhBillLineUnmatchedReasonLabelKey } from './status.logic'

defineOptions({ name: 'SlhReconciliationBatchSelectModal' })
/** 弹窗只管「选账单 → 看范围 → 创建」；创建成功后由页面决定去哪。 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean], 'created': [batch: SlhReconciliationBatchDetailDto] }>()

const { t } = useI18n()
const step = ref<SlhReconciliationSelectStep>(0)
const selectedBillId = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const items = shallowRef<SlhBillListItemDto[]>([])
const total = ref(0)
const loading = ref(false)
const listError = ref('')
const preview = shallowRef<SlhReconciliationBatchPreviewDto | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const submitting = ref(false)
const submitError = ref('')
// 幂等键随「选定账单」生成一次：同一批行的重试复用同一个键，服务端返回同一批次。
const idempotencyKey = ref('')
let controller: AbortController | null = null
let previewController: AbortController | null = null

const steps = computed(() => SLH_RECONCILIATION_SELECT_STEPS.map(id => ({ id, title: t(`slhReconciliation.selectModal.steps.${id}`) })))
const summary = computed(() => resolveSlhReconciliationPreviewSummary(preview.value))
const deliverable = computed(() => preview.value?.bill ?? null)
const locked = computed(() => previewLoading.value || submitting.value)
const currencyCatalog = useCurrencyCatalog()
/**
 * 第一步四列收口在 846px 可用宽度内：编号与操作列左右固定，中间放「对账状态 + 账单信息 + 折算净额」。
 * 名称、月份、期间、行数合并进「账单信息」堆叠单元格；行号列关闭——账单编号才是这一列的导航标识
 * （规范允许业务单号承担首列时关闭行号），否则 56px 行号会把金额列挤到固定操作列下面。
 */
const billColumns = computed<QsGenericTableColumn<SlhBillListItemDto>[]>(() => [
  { id: 'slhBillNo', title: t('slhBill.column.slhBillNo'), accessorKey: 'slhBillNo', width: 170, minWidth: 170, fixed: 'left' },
  { id: 'reconciliationStatus', title: t('slhBill.column.reconciliationStatus'), accessorKey: 'reconciliationStatus', width: 110, minWidth: 110 },
  { id: 'billInfo', title: t('slhReconciliation.selectModal.billInfo'), accessorFn: item => item.billName, minWidth: 225 },
  // 金额列要放得下「NT$1,946,939.00 TWD」这种带币种的长值，比同页其它列宽一档。
  { id: 'netAmount', title: t('slhBill.column.foldedNetAmount'), accessorFn: item => resolveSlhBillNetDisplay(item).amount, width: 180, minWidth: 180, align: 'right' },
])
/** 操作列只放「选择 / 取消选择」一个按钮，右固定；宽度按按钮 100 + 左右内边距 24 估算，取 124。 */
const billActionColumn = { fixed: 'right' as const, width: 124, minWidth: 124 }
const previewColumns = computed(() => buildSlhReconciliationPreviewColumns(t))
const previewRows = computed<SlhReconciliationPreviewRow[]>(() => buildSlhReconciliationPreviewRows(preview.value, {
  matched: t('slhReconciliation.selectModal.matchedTitle', { count: summary.value.matchedCount }),
  unmatched: t('slhReconciliation.selectModal.unmatchedTitle', { count: summary.value.unmatchedCount }),
}))
const previewGrouping: QsGenericTableGrouping<SlhReconciliationPreviewRow> = {
  getRows: group => group.children ?? [],
  getLabel: group => group.group?.label ?? '',
}
/** 选中行整行浅绿底 + 细绿边；未选中不加类，保持表格默认样式。 */
function billRowClass(row: { original: SlhBillListItemDto }): string {
  return resolveSlhReconciliationBillRowClass(row, selectedBillId.value)
}
/** 页脚提示：把「下一步为什么禁用」写成文字，而不是只把按钮灰掉。 */
const footerHint = computed(() => selectedBillId.value === ''
  ? t('slhReconciliation.selectModal.selectHint')
  : t('slhReconciliation.selectModal.selectedHint', { billNo: items.value.find(item => item.id === selectedBillId.value)?.slhBillNo ?? '' }))
/** 匹配来源只在已匹配行有值，缺省返回空串，由单元格决定展示方式。 */
function matchedSourceLabel(line: SlhReconciliationPreviewLine): string {
  return line.matchSource === null ? '' : t(resolveSlhBillLineMatchSourceLabelKey(line.matchSource))
}

async function loadBills(): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  listError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.candidates({ page: page.value, pageSize: pageSize.value, ...(keyword.value.trim() === '' ? {} : { keyword: keyword.value.trim() }) }, current.signal)
    if (current.signal.aborted) {
      return
    }
    items.value = response.data.items
    total.value = response.data.total
  }
  catch (failure) {
    if (!current.signal.aborted) {
      items.value = []
      total.value = 0
      listError.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

function searchBills(): void {
  page.value = 1
  void loadBills()
}

function selectBill(id: string): void {
  if (locked.value) {
    return
  }
  selectedBillId.value = selectedBillId.value === id ? '' : id
}

async function loadPreview(): Promise<void> {
  previewController?.abort()
  const current = new AbortController()
  previewController = current
  previewLoading.value = true
  previewError.value = ''
  preview.value = null
  try {
    const response = await slhReconciliationBatchesApi.matchPreview({ billId: selectedBillId.value }, current.signal)
    if (current.signal.aborted) {
      return
    }
    preview.value = response.data
  }
  catch (failure) {
    if (!current.signal.aborted) {
      previewError.value = containerFailure(failure).message
    }
  }
  finally {
    if (previewController === current) {
      previewLoading.value = false
    }
  }
}

async function nextStep(): Promise<void> {
  if (selectedBillId.value === '' || locked.value) {
    return
  }
  step.value = 1
  submitError.value = ''
  idempotencyKey.value = crypto.randomUUID()
  await loadPreview()
}

function previousStep(): void {
  if (locked.value) {
    return
  }
  step.value = 0
  submitError.value = ''
}

async function submit(): Promise<void> {
  if (!summary.value.canStart || locked.value) {
    return
  }
  submitting.value = true
  submitError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.create(
      buildSlhReconciliationBatchCreatePayload(selectedBillId.value, preview.value),
      idempotencyKey.value,
      new AbortController().signal,
    )
    emit('created', response.data)
  }
  catch (failure) {
    // 范围变化或占用冲突都要让用户重新看一眼，因此把预览一起刷新。
    submitError.value = containerFailure(failure).message
    await loadPreview()
  }
  finally {
    submitting.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}

watch(() => props.modelValue, (open) => {
  if (open) {
    step.value = 0
    selectedBillId.value = ''
    keyword.value = ''
    page.value = 1
    preview.value = null
    previewError.value = ''
    submitError.value = ''
    void loadBills()
  }
  else {
    controller?.abort()
    previewController?.abort()
  }
})
onBeforeUnmount(() => {
  controller?.abort()
  previewController?.abort()
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('slhReconciliation.selectModal.title')"
    size="xl"
    :loading="locked"
    :submitting="submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="min-w-0 space-y-4">
      <FaSteps :model-value="step" :steps="steps" :status="step === 1 && summary.canStart ? 'process' : 'process'" class="w-full" />

      <template v-if="step === 0">
        <QsGenericTable
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:search="keyword"
          row-key="id"
          class="min-w-0"
          :columns="billColumns"
          :data="items"
          :loading="loading"
          :error="listError || undefined"
          :total="total"
          :addable="false"
          :show-column-settings="false"
          :action-column="billActionColumn"
          :row-class="billRowClass"
          :show-row-number="false"
          :search-placeholder="t('slhBill.search')"
          :empty-title="t('slhReconciliation.selectModal.emptyBills')"
          :empty-description="t('slhReconciliation.selectModal.emptyBillsDescription')"
          @search="searchBills"
          @pagination-change="loadBills"
          @retry="loadBills"
        >
          <template #cell-slhBillNo="{ row }">
            <span class="qs-type-data-emphasis font-mono break-all">{{ row.original.slhBillNo }}</span>
          </template>
          <template #cell-reconciliationStatus="{ row }">
            <SlhBillReconciliationStatusTag :status="row.original.reconciliationStatus" />
          </template>
          <!-- 名称是主信息，期间与行数退到次行（月份可由期间看出，不再重复占位）。 -->
          <template #cell-billInfo="{ row }">
            <QsTableStackedCell>
              <QsTableStackedLine content-class="qs-type-body-medium">
                <SlhBillOverflowText :text="row.original.billName" />
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted">
                {{ row.original.periodStart }} ~ {{ row.original.periodEnd }} · {{ t('slhReconciliation.selectModal.lineCountInline', { count: row.original.lineCount }) }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <!-- 金额主值用折算净额（与账单列表同一口径），次行退到应付人民币，便于扫读规模。 -->
          <template #cell-netAmount="{ row }">
            <QsTableStackedCell>
              <QsTableStackedLine content-class="qs-type-data-emphasis">
                <AmountDisplay
                  :value="resolveSlhBillNetDisplay(row.original).amount"
                  :currency="resolveSlhBillNetDisplay(row.original).currency"
                  :currencies="currencyCatalog.currencies.value"
                />
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted">
                {{ t('slhReconciliation.selectModal.payableLabel') }}
                <AmountDisplay
                  class="ml-1"
                  :value="row.original.payableTotalAmountCny"
                  currency="CNY"
                  :currencies="currencyCatalog.currencies.value"
                />
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <!-- 选中态由「整行浅绿底 + 细绿边」与按钮共同表达；已选中的按钮再点一次即取消选择。 -->
          <template #actions="{ row }">
            <FaButton
              v-if="row.id === selectedBillId"
              type="button"
              variant="outline"
              size="sm"
              class="min-h-11 sm:min-h-8"
              :aria-label="t('slhReconciliation.selectModal.deselect')"
              @click="selectBill(row.id)"
            >
              <FaIcon name="i-lucide:check" aria-hidden="true" />{{ t('slhReconciliation.selectModal.selected') }}
            </FaButton>
            <FaButton v-else type="button" variant="ghost" size="sm" class="min-h-11 sm:min-h-8" @click="selectBill(row.id)">
              <FaIcon name="i-lucide:circle-check-big" aria-hidden="true" />{{ t('slhReconciliation.selectModal.select') }}
            </FaButton>
          </template>
        </QsGenericTable>
      </template>

      <template v-else>
        <FaAlert v-if="previewError" variant="destructive" role="alert" :title="previewError" />
        <SaSpin v-else-if="previewLoading" class="py-8" />
        <template v-else-if="preview">
          <!-- 结论条：两个数字是本步唯一的决策依据，先给它们主次分明的视觉权重，账单信息退到次行。 -->
          <div class="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <span class="qs-type-data-emphasis text-primary">
              {{ t('slhReconciliation.selectModal.canReconcile', { count: summary.matchedCount }) }}
            </span>
            <FaTag variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/40 dark:text-amber-300">
              {{ t('slhReconciliation.selectModal.cannotReconcile', { count: summary.unmatchedCount }) }}
            </FaTag>
            <span v-if="deliverable" class="qs-type-meta text-muted-foreground min-w-0 truncate">
              {{ deliverable.slhBillNo }} · {{ deliverable.billName }}
            </span>
          </div>
          <FaAlert v-if="!summary.canStart" variant="destructive" role="status" :title="t('slhReconciliation.selectModal.noMatch')" />
          <!-- 单表分组：已匹配在前、未匹配在后，两组默认展开；「匹配结果」列在两组间承载依据或原因。 -->
          <QsGenericTable
            row-key="id"
            table-class="min-w-full"
            :columns="previewColumns"
            :data="previewRows"
            :grouping="previewGrouping"
            :total="previewRows.length"
            :searchable="false"
            :addable="false"
            :show-column-settings="false"
            :show-pagination="false"
            :empty-title="t('slhReconciliation.selectModal.noMatch')"
          >
            <template #group-header="{ row }">
              <span class="qs-type-component-title" :class="row.group?.tone === 'unmatched' ? 'text-muted-foreground' : undefined">
                {{ row.group?.label ?? '' }}
              </span>
            </template>
            <!-- 品名与客户名是次要信息：外层限宽 + 内层截断，完整内容进浮层；否则长名字会把「匹配结果」挤出可视区。 -->
            <template #cell-goodsName="{ row }">
              <span v-if="row.original.line?.goodsName" class="max-w-[145px] block">
                <SlhBillOverflowText :text="row.original.line.goodsName" content-class="qs-type-body" />
              </span>
            </template>
            <template #cell-customerName="{ row }">
              <span v-if="row.original.line?.recipientName" class="max-w-[140px] block">
                <SlhBillOverflowText :text="row.original.line.recipientName" content-class="qs-type-body" />
              </span>
              <span v-else class="text-muted-foreground">{{ t('slhBill.valueMissing') }}</span>
            </template>
            <!-- 已匹配行给核对依据（柜次 + 柜次行号 + 来源），未匹配行给原因：共用一列，不必横向滚动找证据。 -->
            <template #cell-matchResult="{ row }">
              <QsTableStackedCell v-if="row.original.line?.matchedContainerBatchName">
                <QsTableStackedLine content-class="qs-type-data">
                  {{ row.original.line.matchedContainerBatchName }}
                </QsTableStackedLine>
                <QsTableStackedLine tone="muted">
                  {{ t('slhReconciliation.selectModal.matchedLine') }} {{ row.original.line.matchedLoadingItemLineNumber }} · {{ matchedSourceLabel(row.original.line) }}
                </QsTableStackedLine>
              </QsTableStackedCell>
              <FaTag v-else variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/40 dark:text-amber-300">
                {{ row.original.line?.reason == null ? t('slhBill.valueMissing') : t(resolveSlhBillLineUnmatchedReasonLabelKey(row.original.line.reason)) }}
              </FaTag>
            </template>
          </QsGenericTable>
        </template>
        <FaAlert v-if="submitError" variant="destructive" role="alert" :title="submitError" />
      </template>
    </div>
    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center" :class="step === 0 ? '' : 'sm:justify-end'">
        <!-- 把「下一步为什么禁用」写成文字，而不是只把按钮灰掉。 -->
        <p v-if="step === 0" class="qs-type-meta text-muted-foreground m-0 flex-1 min-w-0 truncate">
          {{ footerHint }}
        </p>
        <div class="flex flex-col gap-2 w-full sm:flex-row sm:w-auto">
          <FaButton v-if="step === 0" type="button" variant="outline" class="w-full sm:w-auto" :disabled="locked" @click="close">
            {{ t('slhBill.cancel') }}
          </FaButton>
          <FaButton v-else type="button" variant="outline" class="w-full sm:w-auto" :disabled="locked" @click="previousStep">
            {{ t('slhReconciliation.selectModal.back') }}
          </FaButton>
          <FaButton
            v-if="step === 0"
            type="button"
            class="w-full sm:w-auto"
            :disabled="selectedBillId === '' || locked"
            @click="nextStep"
          >
            {{ t('slhReconciliation.selectModal.next') }}
          </FaButton>
          <FaButton
            v-else
            type="button"
            class="w-full sm:w-auto"
            :loading="submitting"
            :disabled="!summary.canStart || locked"
            @click="submit"
          >
            {{ t('slhReconciliation.selectModal.start') }}
          </FaButton>
        </div>
      </div>
    </template>
  </QsGenericModal>
</template>
