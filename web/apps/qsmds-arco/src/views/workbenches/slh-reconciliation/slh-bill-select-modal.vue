<script setup lang="ts">
import type { SlhReconciliationSelectStep } from './select-modal.logic'
import type { SlhBillListItemDto, SlhReconciliationBatchDetailDto, SlhReconciliationBatchPreviewDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import {
  buildSlhReconciliationBatchCreatePayload,
  buildSlhReconciliationPreviewColumns,
  resolveSlhReconciliationPreviewSummary,
  SLH_RECONCILIATION_SELECT_STEPS,
} from './select-modal.logic'
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
const billColumns = computed<QsGenericTableColumn<SlhBillListItemDto>[]>(() => [
  { id: 'slhBillNo', title: t('slhBill.column.slhBillNo'), accessorKey: 'slhBillNo', width: 205, minWidth: 205, fixed: 'left' },
  { id: 'billName', title: t('slhBill.column.billName'), accessorFn: item => item.billName, minWidth: 220 },
  { id: 'period', title: t('slhBill.column.period'), accessorFn: item => `${item.periodStart} ~ ${item.periodEnd}`, minWidth: 200 },
  { id: 'lineCount', title: t('slhBill.column.lineCount'), accessorKey: 'lineCount', minWidth: 110, align: 'right' },
  { id: 'reconciliationStatus', title: t('slhBill.column.reconciliationStatus'), accessorKey: 'reconciliationStatus', minWidth: 140 },
])
const matchedColumns = computed(() => buildSlhReconciliationPreviewColumns(t, 'matched'))
const unmatchedColumns = computed(() => buildSlhReconciliationPreviewColumns(t, 'unmatched'))

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
          :search-placeholder="t('slhBill.search')"
          :empty-title="t('slhReconciliation.selectModal.emptyBills')"
          :empty-description="t('slhReconciliation.selectModal.emptyBillsDescription')"
          @search="searchBills"
          @pagination-change="loadBills"
          @retry="loadBills"
          @row-click="(row: SlhBillListItemDto) => selectBill(row.id)"
        >
          <template #cell-slhBillNo="{ row }">
            <span class="flex gap-2 min-w-0 items-center">
              <FaIcon
                :name="row.original.id === selectedBillId ? 'i-lucide:circle-dot' : 'i-lucide:circle'"
                class="text-primary shrink-0 size-4"
                aria-hidden="true"
              />
              <span class="qs-type-data-emphasis font-mono break-all">{{ row.original.slhBillNo }}</span>
            </span>
          </template>
          <template #cell-reconciliationStatus="{ row }">
            <SlhBillReconciliationStatusTag :status="row.original.reconciliationStatus" />
          </template>
        </QsGenericTable>
      </template>

      <template v-else>
        <FaAlert v-if="previewError" variant="destructive" role="alert" :title="previewError" />
        <SaSpin v-else-if="previewLoading" class="py-8" />
        <template v-else-if="preview">
          <p class="qs-type-description text-muted-foreground m-0">
            {{ t('slhReconciliation.selectModal.summary', { bill: deliverable?.slhBillNo ?? '', matched: summary.matchedCount, unmatched: summary.unmatchedCount }) }}
          </p>
          <FaAlert v-if="!summary.canStart" variant="destructive" role="status" :title="t('slhReconciliation.selectModal.noMatch')" />
          <div class="min-w-0 space-y-2">
            <h4 class="qs-type-component-title m-0">
              {{ t('slhReconciliation.selectModal.matchedTitle', { count: summary.matchedCount }) }}
            </h4>
            <QsGenericTable
              :columns="matchedColumns"
              :data="preview.matched"
              :total="preview.matched.length"
              :searchable="false"
              :addable="false"
              :show-column-settings="false"
              :empty-title="t('slhReconciliation.selectModal.noMatch')"
            >
              <template #cell-source="{ row }">
                <FaTag variant="outline" class="qs-type-status-tag">
                  {{ t(resolveSlhBillLineMatchSourceLabelKey(row.original.matchSource)) }}
                </FaTag>
              </template>
            </QsGenericTable>
          </div>
          <div class="min-w-0 space-y-2">
            <h4 class="qs-type-component-title m-0">
              {{ t('slhReconciliation.selectModal.unmatchedTitle', { count: summary.unmatchedCount }) }}
            </h4>
            <QsGenericTable
              :columns="unmatchedColumns"
              :data="preview.unmatched"
              :total="preview.unmatched.length"
              :searchable="false"
              :addable="false"
              :show-column-settings="false"
              :empty-title="t('slhReconciliation.selectModal.unmatchedEmpty')"
              :page-size="50"
            >
              <template #cell-reason="{ row }">
                <FaTag variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/40 dark:text-amber-300">
                  {{ row.original.reason === null ? '' : t(resolveSlhBillLineUnmatchedReasonLabelKey(row.original.reason)) }}
                </FaTag>
              </template>
            </QsGenericTable>
          </div>
        </template>
        <FaAlert v-if="submitError" variant="destructive" role="alert" :title="submitError" />
      </template>
    </div>
    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
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
    </template>
  </QsGenericModal>
</template>
