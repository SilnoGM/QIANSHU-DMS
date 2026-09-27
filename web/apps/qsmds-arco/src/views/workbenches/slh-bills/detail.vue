<script setup lang="ts">
import type { SlhBillDto, SlhBillLineDto, SlhBillTotalsDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import slhBillsApi from '@/api/modules/slh-bills'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import { collectSlhBillFlaggedRowNumbers, countSlhBillFindings, pageForSlhBillLine, SLH_BILL_FLAGGED_ROW_CLASS } from './comparison.logic'
import { buildSlhBillLineColumns } from './line-columns.logic'
import { resolveSlhBillReconciliationLabelKey } from './reconciliation-status.logic'
import SlhBillCharges from './slh-bill-charges.vue'
import SlhBillComparison from './slh-bill-comparison.vue'
import SlhBillConclusion from './slh-bill-conclusion.vue'
import SlhBillInfo from './slh-bill-info.vue'
import SlhBillOverflowText from './slh-bill-overflow-text.vue'
import SlhBillPricingBasisTag from './slh-bill-pricing-basis-tag.vue'
import SlhBillRecipient from './slh-bill-recipient.vue'
import SlhBillReconciliationStatusTag from './slh-bill-reconciliation-status-tag.vue'
import SlhBillVolumeDifference from './slh-bill-volume-difference.vue'

defineOptions({ name: 'QsFinanceBillReconciliationSlhBillDetail' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const instanceId = String(route.params.id ?? '')
const canRead = computed(() => auth('slh-bills:read'))
const bill = shallowRef<SlhBillDto | null>(null)
const loading = ref(false)
const error = ref('')
const downloading = ref(false)
const downloadError = ref('')
const linePage = ref(1)
// 一张账单通常 30–50 行，默认 50 条一页，避免核对时频繁翻页。
const linePageSize = ref(50)
const lines = shallowRef<SlhBillLineDto[]>([])
const lineTotal = ref(0)
const linesLoading = ref(false)
const linesError = ref('')
// 明细的检索与柜号筛选都在服务端做：明细分页是服务端的，只过滤当前页会骗人。
const lineKeyword = ref('')
const lineFilters = ref<QsGenericTableFilterValues>({})
const lineContainerBatchName = computed(() => typeof lineFilters.value.containerBatch === 'string' ? lineFilters.value.containerBatch : undefined)
const lineFilterDefinitions = computed(() => [{
  key: 'containerBatch',
  label: t('slhBill.line.containerBatchName'),
  options: (bill.value?.containerBatchNames ?? []).map(name => ({ label: name, value: name })),
}])
let billController: AbortController | null = null
let linesController: AbortController | null = null
let downloadController: AbortController | null = null
// 对比组件吃的是与预览一致的 totals 形状；详情返回的是平铺字段，这里拼一次。
const comparisonTotals = computed<SlhBillTotalsDto>(() => ({
  freightTotalAmountCny: bill.value?.freightTotalAmountCny ?? '0',
  codHandlingTotalAmountCny: bill.value?.codHandlingTotalAmountCny ?? '0',
  surchargeTotalAmountCny: bill.value?.surchargeTotalAmountCny ?? '0',
  payableTotalAmountCny: bill.value?.payableTotalAmountCny ?? '0',
  codTotalAmountTwd: bill.value?.codTotalAmountTwd ?? '0',
  ntdSurchargeTotalAmountTwd: bill.value?.ntdSurchargeTotalAmountTwd ?? '0',
  reportedNetAmountTwd: bill.value?.reportedNetAmountTwd ?? '0',
}))
/** 差异项按行号跳到明细表对应页；行号是整张账单的序号，跳页前必须先清掉筛选与关键字。 */
function jumpToLine(lineNumber: number): void {
  const hadQuery = lineKeyword.value.trim() !== '' || lineContainerBatchName.value !== undefined
  lineKeyword.value = ''
  lineFilters.value = {}
  const target = pageForSlhBillLine(lineNumber, linePageSize.value)
  if (!hadQuery && target === linePage.value) {
    return
  }
  linePage.value = target
  void loadLines()
}
/** 明细检索与筛选都回到第一页：条件变了还停在第 3 页会直接看到空结果。 */
function searchLines(): void {
  linePage.value = 1
  void loadLines()
}
/**
 * 明细列与导入预览共用，只有详情页追加对账状态：预览行尚未入库，没有对账状态可言。
 * 列定义本文件只做追加，取值与文案映射统一放在 reconciliation-status.logic。
 */
const columns = computed<QsGenericTableColumn<SlhBillLineDto>[]>(() => [
  ...buildSlhBillLineColumns(t),
  {
    id: 'reconciliationStatus',
    title: t('slhBill.line.reconciliationStatus'),
    accessorFn: line => t(resolveSlhBillReconciliationLabelKey(line.reconciliationStatus)),
    width: 130,
    minWidth: 130,
    maxWidth: 130,
    // 明细表很宽，对账状态要一直看得见：固定在最右侧（本表没有操作列，它就是最右一列）。
    fixed: 'right',
  },
])
const flaggedRowNumbers = computed(() => collectSlhBillFlaggedRowNumbers(bill.value?.findings ?? []))
/** 有差异或告警的明细行标黄；详情页的差异来自落库快照，按原表行号对应。 */
function lineRowClass(row: { original: SlhBillLineDto }): string {
  return flaggedRowNumbers.value.has(row.original.sourceRowNumber) ? SLH_BILL_FLAGGED_ROW_CLASS : ''
}
const findingCounts = computed(() => countSlhBillFindings(bill.value?.findings ?? []))
const comparisonAnchor = ref<HTMLElement>()
/** 结论层的「查看差异」只负责定位：滚到对账核对区块，不改动数据与分页状态。 */
function scrollToFindings(): void {
  comparisonAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
async function load(): Promise<void> {
  billController?.abort()
  if (!canRead.value || instanceId === '') {
    bill.value = null
    return
  }
  const current = new AbortController()
  billController = current
  loading.value = true
  error.value = ''
  try {
    const response = await slhBillsApi.get(instanceId, current.signal)
    if (current.signal.aborted || !canRead.value) {
      return
    }
    bill.value = response.data
  }
  catch (failure) {
    if (!current.signal.aborted) {
      bill.value = null
      error.value = containerFailure(failure).message
    }
  }
  finally {
    if (billController === current) {
      loading.value = false
    }
  }
}
async function loadLines(): Promise<void> {
  linesController?.abort()
  if (!canRead.value || instanceId === '') {
    lines.value = []
    lineTotal.value = 0
    return
  }
  const current = new AbortController()
  linesController = current
  linesLoading.value = true
  linesError.value = ''
  const keyword = lineKeyword.value.trim()
  try {
    const response = await slhBillsApi.lines(instanceId, {
      page: linePage.value,
      pageSize: linePageSize.value,
      ...(keyword === '' ? {} : { keyword }),
      ...(lineContainerBatchName.value === undefined ? {} : { containerBatchName: lineContainerBatchName.value }),
    }, current.signal)
    if (current.signal.aborted || !canRead.value) {
      return
    }
    lines.value = response.data.items
    lineTotal.value = response.data.total
  }
  catch (failure) {
    if (!current.signal.aborted) {
      lines.value = []
      lineTotal.value = 0
      linesError.value = containerFailure(failure).message
    }
  }
  finally {
    if (linesController === current) {
      linesLoading.value = false
    }
  }
}
async function download(): Promise<void> {
  const current = bill.value
  if (!current || downloading.value) {
    return
  }
  downloadController?.abort()
  const request = new AbortController()
  downloadController = request
  downloading.value = true
  downloadError.value = ''
  try {
    const response = await slhBillsApi.downloadSourceFile(current.id, request.signal)
    if (request.signal.aborted) {
      return
    }
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = current.sourceFileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  catch (failure) {
    if (!request.signal.aborted) {
      downloadError.value = containerFailure(failure).message
    }
  }
  finally {
    if (downloadController === request) {
      downloading.value = false
    }
  }
}
watch(() => [canRead.value, accountStore.authEpoch, instanceId], () => {
  bill.value = null
  lines.value = []
  lineTotal.value = 0
  linePage.value = 1
  void load()
  void loadLines()
}, { immediate: true })
watch([linePage, linePageSize], () => {
  void loadLines()
})
onBeforeUnmount(() => {
  billController?.abort()
  linesController?.abort()
  downloadController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader main-class="min-w-0" default-class="w-full min-w-0 sm:w-auto" :title="bill ? `${bill.slhBillNo} · ${t('slhBill.detailTitle')}` : t('slhBill.detailTitle')">
      <template #description>
        <!-- 副标题用人类可读的账单名称；编号在标题里，期间由下方信息卡唯一承载。 -->
        <span v-if="bill" class="qs-type-body-medium">{{ bill.billName }}</span>
        <span v-else class="qs-type-description">{{ t('slhBill.intro') }}</span>
      </template>
      <FaButton variant="outline" class="w-full sm:w-auto" @click="router.push({ name: 'qsFinanceBillReconciliationSlhBillManagement' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhBill.back') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain v-if="!canRead">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('slhBill.noPermission')" class="py-12" />
    </FaPageMain>
    <template v-else>
      <FaPageMain v-if="error">
        <FaAlert variant="destructive" :title="error" /><FaButton variant="outline" class="mt-4" @click="load">
          {{ t('slhBill.retry') }}
        </FaButton>
      </FaPageMain>
      <FaPageMain v-else-if="loading && !bill">
        <div role="status" class="space-y-4">
          <span class="sr-only">{{ t('slhBill.detailTitle') }}</span>
          <div v-for="n in 3" :key="n" class="rounded-lg bg-muted h-10 animate-pulse motion-reduce:animate-none" />
        </div>
      </FaPageMain>
      <template v-else-if="bill">
        <FaPageMain v-if="bill.supersededById">
          <FaAlert variant="destructive" :title="t('slhBill.supersededNotice')">
            <template #description>
              <p v-if="bill.supersededAt" class="m-0 mt-1">
                {{ t('slhBill.supersededAt') }} · <DateTimeDisplay :value="bill.supersededAt" />
              </p>
            </template>
          </FaAlert>
        </FaPageMain>
        <!-- 结论层：金额与对账结论是首屏的视觉落点，元数据整体退到下一区块。 -->
        <FaPageMain class="min-w-0">
          <h2 class="qs-type-section-title m-0 mb-4 flex gap-2 items-center">
            <FaIcon name="i-lucide:clipboard-check" class="text-muted-foreground size-4" aria-hidden="true" />
            {{ t('slhBill.conclusion.title') }}
          </h2>
          <SlhBillConclusion
            :totals="comparisonTotals"
            :reported="bill.reported"
            :embedded-foreign-units-per-cny="bill.reported.embeddedForeignUnitsPerCny ?? null"
            :counts="findingCounts"
            :line-count="bill.lineCount"
            @view-findings="scrollToFindings"
          />
        </FaPageMain>
        <FaPageMain class="min-w-0">
          <h2 class="qs-type-section-title m-0 mb-4 flex gap-2 items-center">
            <FaIcon name="i-lucide:receipt-text" class="text-muted-foreground size-4" aria-hidden="true" />
            {{ t('slhBill.overview') }}
          </h2>
          <SlhBillInfo :bill="bill" :downloading="downloading" @download="download" />
          <FaAlert v-if="downloadError" class="mt-4" variant="destructive" :title="t('slhBill.downloadFailed')">
            <template #description>
              {{ downloadError }}
            </template>
          </FaAlert>
        </FaPageMain>
        <FaPageMain class="min-w-0">
          <div ref="comparisonAnchor" class="min-w-0">
            <h2 class="qs-type-section-title m-0 mb-4 flex gap-2 items-center">
              <FaIcon name="i-lucide:scale" class="text-muted-foreground size-4" aria-hidden="true" />
              {{ t('slhBill.reconciliation') }}
            </h2>
            <SlhBillComparison
              :totals="comparisonTotals"
              :reported="bill.reported"
              :embedded-foreign-units-per-cny="bill.reported.embeddedForeignUnitsPerCny ?? null"
              :findings="bill.findings"
              :line-count="bill.lineCount"
              @jump-to-line="jumpToLine"
            />
          </div>
        </FaPageMain>
        <FaPageMain class="min-w-0">
          <h2 class="qs-type-section-title m-0 mb-4 flex gap-2 items-center">
            <FaIcon name="i-lucide:table" class="text-muted-foreground size-4" aria-hidden="true" />
            {{ t('slhBill.lines') }}
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mb-4 mt-1.5">
            {{ t('slhBill.chargesHint') }}
          </p>
          <QsGenericTable
            v-model:page="linePage"
            v-model:page-size="linePageSize"
            v-model:search="lineKeyword"
            v-model:filters="lineFilters"
            row-key="lineNumber"
            table-class="w-max min-w-full"
            :row-class="lineRowClass"
            :show-row-number="true"
            :columns="columns"
            :data="lines"
            :loading="linesLoading"
            :error="linesError || undefined"
            :total="lineTotal"
            :addable="false"
            :searchable="true"
            :search-placeholder="t('slhBill.lineSearch')"
            :filter-definitions="lineFilterDefinitions"
            :page-size-options="[20, 50, 100]"
            :empty-title="t('slhBill.empty')"
            @search="searchLines"
            @filter-change="searchLines"
            @retry="loadLines"
          >
            <template #cell-charges="{ row }">
              <SlhBillCharges :charges="row.original.charges" />
            </template>
            <template #cell-recipientInfo="{ row }">
              <SlhBillRecipient
                :name="row.original.recipientName ?? null"
                :phones="row.original.recipientPhones ?? null"
                :address="row.original.recipientAddress ?? null"
              />
            </template>
            <template #cell-warehouseReceiptReference="{ row }">
              <SlhBillOverflowText :text="row.original.warehouseReceiptReference ?? t('slhBill.valueMissing')" />
            </template>
            <template #cell-volumeDifferenceCai="{ row }">
              <SlhBillVolumeDifference :line="row.original" />
            </template>
            <template #cell-pricingBasis="{ row }">
              <SlhBillPricingBasisTag :basis="row.original.pricingBasis ?? null" />
            </template>
            <template #cell-reconciliationStatus="{ row }">
              <SlhBillReconciliationStatusTag :status="row.original.reconciliationStatus" />
            </template>
          </QsGenericTable>
        </FaPageMain>
      </template>
    </template>
  </div>
</template>
