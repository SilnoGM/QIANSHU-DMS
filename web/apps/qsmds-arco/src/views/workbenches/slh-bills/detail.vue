<script setup lang="ts">
import type { SlhBillDto, SlhBillLineDto, SlhBillTotalsDto } from '@/api/generated/types.gen'
import slhBillsApi from '@/api/modules/slh-bills'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import { pageForSlhBillLine } from './comparison.logic'
import { formatSlhBillRate } from './display.logic'
import { buildSlhBillLineColumns } from './line-columns.logic'
import SlhBillCharges from './slh-bill-charges.vue'
import SlhBillComparison from './slh-bill-comparison.vue'
import SlhBillOverflowText from './slh-bill-overflow-text.vue'
import SlhBillPricingBasisTag from './slh-bill-pricing-basis-tag.vue'
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
const linePageSize = ref(20)
const lines = shallowRef<SlhBillLineDto[]>([])
const lineTotal = ref(0)
const linesLoading = ref(false)
const linesError = ref('')
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
/** 差异项按行号跳到明细表对应页；明细分页在服务端，切页会重新加载。 */
function jumpToLine(lineNumber: number): void {
  const target = pageForSlhBillLine(lineNumber, linePageSize.value)
  if (target === linePage.value) {
    return
  }
  linePage.value = target
  void loadLines()
}
// 序号列跨页连续：偏移由当前页与每页条数推出。
const columns = computed(() => buildSlhBillLineColumns(t, { sequenceOffset: (linePage.value - 1) * linePageSize.value }))
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
  try {
    const response = await slhBillsApi.lines(instanceId, { page: linePage.value, pageSize: linePageSize.value }, current.signal)
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
        <span v-if="bill" class="qs-type-data">{{ bill.periodStart }} ~ {{ bill.periodEnd }}</span>
        <span v-else class="qs-type-description">{{ t('slhBill.intro') }}</span>
      </template>
      <div class="flex flex-wrap gap-2 w-full sm:w-auto">
        <FaButton v-if="bill" variant="outline" class="w-full sm:w-auto" :disabled="downloading" @click="download">
          <FaIcon name="i-lucide:download" aria-hidden="true" />{{ t('slhBill.download') }}
        </FaButton>
        <FaButton variant="outline" class="w-full sm:w-auto" @click="router.push({ name: 'qsFinanceBillReconciliationSlhBillManagement' })">
          <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhBill.back') }}
        </FaButton>
      </div>
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
        <div class="m-4 gap-4 grid min-w-0 lg:grid-cols-2">
          <FaPageMain class="m-0 min-w-0">
            <section class="min-w-0" :aria-label="t('slhBill.overview')">
              <h2 class="qs-type-component-title m-0 mb-4 flex gap-2 items-center">
                <FaIcon name="i-lucide:receipt-text" class="text-muted-foreground size-4" aria-hidden="true" />
                {{ t('slhBill.overview') }}
              </h2>
              <dl class="m-0 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)]">
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.slhBillNo') }}
                  </dt>
                  <dd class="qs-type-data-emphasis font-mono m-0 mt-1.5 break-all">
                    {{ bill.slhBillNo }}
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.period') }}
                  </dt>
                  <dd class="qs-type-data m-0 mt-1.5">
                    {{ bill.periodStart }} ~ {{ bill.periodEnd }}
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.lineCount') }}
                  </dt>
                  <dd class="qs-type-data m-0 mt-1.5">
                    {{ bill.lineCount }}
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.containerBatchCount') }}
                  </dt>
                  <dd class="m-0 mt-1.5">
                    <span class="qs-type-data">{{ bill.containerBatchCount }}</span>
                    <div class="mt-3">
                      <p class="qs-type-meta text-muted-foreground m-0 mb-2">
                        {{ t('slhBill.containerBatches') }}
                      </p>
                      <div class="flex flex-wrap gap-2">
                        <FaTag v-for="name in bill.containerBatchNames" :key="name" variant="outline" class="qs-type-data max-w-full whitespace-normal break-words">
                          {{ name }}
                        </FaTag>
                      </div>
                    </div>
                  </dd>
                </div>
                <div class="min-w-0 sm:col-span-2">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.sourceFile') }}
                  </dt>
                  <dd class="qs-type-body m-0 mt-1.5 flex flex-wrap gap-3 items-center">
                    <span class="min-w-0 [overflow-wrap:anywhere]">{{ bill.sourceFileName }}</span>
                    <FaButton variant="outline" size="sm" :disabled="downloading" @click="download">
                      <FaIcon name="i-lucide:download" aria-hidden="true" />{{ t('slhBill.download') }}
                    </FaButton>
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.created') }}
                  </dt>
                  <dd class="qs-type-body m-0 mt-1.5">
                    {{ bill.createdByDisplayName }}
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.createdAt') }}
                  </dt>
                  <dd class="m-0 mt-1.5">
                    <DateTimeDisplay :value="bill.createdAt" />
                  </dd>
                </div>
              </dl>
              <FaAlert v-if="downloadError" class="mt-3" variant="destructive" :title="t('slhBill.downloadFailed')">
                <template #description>
                  {{ downloadError }}
                </template>
              </FaAlert>
            </section>
          </FaPageMain>
          <FaPageMain class="m-0 min-w-0">
            <section class="min-w-0" :aria-label="t('slhBill.rate')">
              <h2 class="qs-type-component-title m-0 mb-4 flex gap-2 items-center">
                <FaIcon name="i-lucide:scale" class="text-muted-foreground size-4" aria-hidden="true" />
                {{ t('slhBill.rate') }}
              </h2>
              <p v-if="!bill.rate" class="qs-type-meta text-muted-foreground m-0">
                {{ t('slhBill.noRate') }}
              </p>
              <dl v-else class="m-0 gap-x-5 gap-y-4 grid grid-cols-2">
                <div class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.column.rateSource') }}
                  </dt>
                  <dd class="m-0 mt-1.5">
                    <FaTag variant="outline" class="qs-type-status-tag">
                      {{ t(`slhBill.rateSource.${bill.rate.source}`) }}
                    </FaTag>
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.rateValue') }}
                  </dt>
                  <dd class="qs-type-data-emphasis m-0 mt-1.5 tabular-nums">
                    {{ formatSlhBillRate(bill.rate.foreignUnitsPerCny) ?? t('slhBill.valueMissing') }}
                  </dd>
                </div>
                <div v-if="bill.rate.embeddedForeignUnitsPerCny" class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.rateEmbedded') }}
                  </dt>
                  <dd class="qs-type-data m-0 mt-1.5 tabular-nums">
                    {{ formatSlhBillRate(bill.rate.embeddedForeignUnitsPerCny) ?? t('slhBill.valueMissing') }}
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t('slhBill.rateCapturedAt') }}
                  </dt>
                  <dd class="m-0 mt-1.5">
                    <DateTimeDisplay :value="bill.rate.capturedAt" />
                  </dd>
                </div>
              </dl>
            </section>
          </FaPageMain>
        </div>
        <FaPageMain class="min-w-0">
          <SlhBillComparison
            :totals="comparisonTotals"
            :reported="bill.reported"
            :embedded-foreign-units-per-cny="bill.reported.embeddedForeignUnitsPerCny ?? null"
            :findings="bill.findings"
            :line-count="bill.lineCount"
            @jump-to-line="jumpToLine"
          />
        </FaPageMain>
        <FaPageMain>
          <h2 class="qs-type-section-title m-0">
            {{ t('slhBill.lines') }}
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mb-4 mt-1.5">
            {{ t('slhBill.chargesHint') }}
          </p>
          <QsGenericTable
            v-model:page="linePage"
            v-model:page-size="linePageSize"
            row-key="lineNumber"
            table-class="w-max min-w-full"
            :show-row-number="false"
            :columns="columns"
            :data="lines"
            :loading="linesLoading"
            :error="linesError || undefined"
            :total="lineTotal"
            :addable="false"
            :searchable="false"
            :page-size-options="[20, 50, 100]"
            :empty-title="t('slhBill.empty')"
            @retry="loadLines"
          >
            <template #cell-charges="{ row }">
              <SlhBillCharges :charges="row.original.charges" />
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
          </QsGenericTable>
        </FaPageMain>
      </template>
    </template>
  </div>
</template>
