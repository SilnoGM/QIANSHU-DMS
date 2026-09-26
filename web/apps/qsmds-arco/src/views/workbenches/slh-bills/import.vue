<script setup lang="ts">
import type { FileItem } from '@fantastic-admin/components'
import type { SlhBillImportPreviewDto, SlhBillPreviewLineDto, SlhBillStagedFileDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhBillsApi from '@/api/modules/slh-bills'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import { formatSlhBillRate } from './display.logic'
import {
  buildSlhBillImportPayload,
  collectSlhBillLineErrors,
  countSlhBillImportIssues,
  needsSlhBillManualRate,
  resolveSlhBillImportBlock,
  resolveSlhBillImportKeyAction,
  resolveSlhBillImportPhase,
  resolveSlhBillManualRate,
} from './import.logic'
import { buildSlhBillLineColumns } from './line-columns.logic'
import SlhBillCharges from './slh-bill-charges.vue'

defineOptions({ name: 'QsFinanceBillReconciliationSlhBillImport' })
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const canImport = computed(() => auth('slh-bills:create'))
const files = ref<FileItem[]>([])
const staged = shallowRef<SlhBillStagedFileDto | null>(null)
const preview = shallowRef<SlhBillImportPreviewDto | null>(null)
const uploading = ref(false)
const parsing = ref(false)
const submitting = ref(false)
const parseError = ref('')
const submitError = ref('')
const manualRateDraft = ref('')
const duplicateAcknowledged = ref(false)
const previewPage = ref(1)
const previewPageSize = ref(20)
let controller: AbortController | null = null
// 幂等键与提交内容配对：内容变化必须换键，结果未知时必须复用同一个键。
let pendingKey: string | null = null
let pendingSignature: string | null = null
const phase = computed(() => resolveSlhBillImportPhase({ mediaAssetId: staged.value?.mediaAssetId ?? null, parsing: parsing.value, preview: preview.value }))
const issues = computed(() => preview.value === null
  ? { differences: 0, lineErrors: 0, warnings: 0 }
  : countSlhBillImportIssues(preview.value))
const lineErrors = computed(() => collectSlhBillLineErrors(preview.value?.lines ?? []))
const manualRateNeeded = computed(() => preview.value !== null && needsSlhBillManualRate(preview.value))
const manualRate = computed(() => preview.value === null
  ? { error: null, value: null } as const
  : resolveSlhBillManualRate(preview.value, manualRateDraft.value))
const blockReason = computed(() => preview.value === null
  ? null
  : resolveSlhBillImportBlock({ duplicateAcknowledged: duplicateAcknowledged.value, manualRateError: manualRate.value.error, preview: preview.value }))
const blockMessage = computed(() => {
  switch (blockReason.value) {
    case 'manualRateRequired':
      return t('slhBill.manualRate.required')
    case 'manualRateFormat':
      return t('slhBill.manualRate.format')
    case 'lineErrors':
      return t('slhBill.lineErrorsBlocked', { count: issues.value.lineErrors })
    case 'duplicateUnacknowledged':
      return preview.value?.duplicate
        ? t('slhBill.duplicate.notice', { billNo: preview.value.duplicate.slhBillNo, period: `${preview.value.duplicate.periodStart} ~ ${preview.value.duplicate.periodEnd}` })
        : ''
    default:
      return ''
  }
})
const totals = computed(() => preview.value === null
  ? []
  : [
      { amount: preview.value.totals.freightTotalAmountCny, currency: 'CNY', label: 'freight' },
      { amount: preview.value.totals.codHandlingTotalAmountCny, currency: 'CNY', label: 'codHandling' },
      { amount: preview.value.totals.surchargeTotalAmountCny, currency: 'CNY', label: 'surcharge' },
      { amount: preview.value.totals.payableTotalAmountCny, currency: 'CNY', label: 'payable' },
      { amount: preview.value.totals.codTotalAmountTwd, currency: 'TWD', label: 'codTwd' },
      { amount: preview.value.totals.ntdSurchargeTotalAmountTwd, currency: 'TWD', label: 'ntdSurcharge' },
      { amount: preview.value.totals.reportedNetAmountTwd, currency: 'TWD', label: 'reportedNet' },
    ] as const)
// 账单自报值按原文呈现：它要与系统自算值并列核对，不能先被本系统的格式化改写。
const reported = computed(() => preview.value === null
  ? []
  : [
      { label: 'subtotalPayable', value: preview.value.reported.subtotalPayableAmountCny ?? t('slhBill.unknown') },
      { label: 'payable', value: preview.value.reported.payableAmountCny ?? t('slhBill.unknown') },
      { label: 'netCell', value: preview.value.reported.netAmountTwd ?? t('slhBill.unknown') },
      { label: 'netFormula', value: preview.value.reported.netAmountFormula ?? t('slhBill.unknown') },
      { label: 'netAmount', value: preview.value.reported.reportedNetAmountTwd },
    ] as const)
const previewLines = computed(() => preview.value?.lines ?? [])
const pagedLines = computed(() => previewLines.value.slice((previewPage.value - 1) * previewPageSize.value, previewPage.value * previewPageSize.value))
const columns = computed<QsGenericTableColumn<SlhBillPreviewLineDto>[]>(() => [
  ...buildSlhBillLineColumns<SlhBillPreviewLineDto>(t),
  { id: 'lineIssues', title: t('slhBill.previewIssues'), accessorFn: (line: SlhBillPreviewLineDto) => [...line.errors, ...line.differences, ...line.lineWarnings, ...line.notes].join('；'), minWidth: 280, width: 320 },
])
const busy = computed(() => uploading.value || parsing.value || submitting.value)
function back(): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillManagement' })
}
function validate(file: File): boolean {
  const valid = /\.xlsx$/iu.test(file.name) && file.size > 0 && file.size <= 50 * 1024 * 1024
  parseError.value = valid ? '' : t('slhBill.upload.invalidFile')
  return valid
}
async function parse(mediaAssetId: string): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  parsing.value = true
  parseError.value = ''
  try {
    const response = await slhBillsApi.importPreview({ mediaAssetId }, current.signal)
    if (current.signal.aborted) {
      return
    }
    preview.value = response.data
    previewPage.value = 1
    duplicateAcknowledged.value = false
    // 默认填系统汇率的两小数展示值；用户不改动时不提交手填汇率，服务端按 SYSTEM 冻结。
    manualRateDraft.value = formatSlhBillRate(response.data.systemForeignUnitsPerCny) ?? ''
  }
  catch (failure) {
    if (!current.signal.aborted) {
      parseError.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      parsing.value = false
    }
  }
}
async function upload({ file }: { file: File }): Promise<SlhBillStagedFileDto | null> {
  if (busy.value || !validate(file)) {
    return null
  }
  controller?.abort()
  const current = new AbortController()
  controller = current
  uploading.value = true
  parseError.value = ''
  try {
    const response = await slhBillsApi.uploadSourceFile(file, current.signal)
    if (current.signal.aborted) {
      return null
    }
    staged.value = response.data
    void parse(response.data.mediaAssetId)
    return response.data
  }
  catch (failure) {
    if (!current.signal.aborted) {
      parseError.value = containerFailure(failure).message
    }
    // 交给 FaFileUpload 标记失败状态，错误文案已经在上方统一展示。
    throw failure
  }
  finally {
    if (controller === current) {
      uploading.value = false
    }
  }
}
function resetUpload(): void {
  controller?.abort()
  files.value = []
  staged.value = null
  preview.value = null
  parseError.value = ''
  submitError.value = ''
  manualRateDraft.value = ''
  duplicateAcknowledged.value = false
  previewPage.value = 1
  pendingKey = null
  pendingSignature = null
}
function retryParse(): void {
  if (staged.value === null) {
    return
  }
  void parse(staged.value.mediaAssetId)
}
async function submit(): Promise<void> {
  if (preview.value === null || staged.value === null || submitting.value || blockReason.value !== null) {
    return
  }
  const payload = buildSlhBillImportPayload({
    duplicateAcknowledged: duplicateAcknowledged.value,
    manualRate: manualRate.value.value,
    mediaAssetId: staged.value.mediaAssetId,
  })
  const signature = JSON.stringify(payload)
  if (resolveSlhBillImportKeyAction({ pendingSignature, settled: 'pending', signature }) === 'mine') {
    pendingKey = crypto.randomUUID()
    pendingSignature = signature
  }
  const key = pendingKey
  if (key === null) {
    return
  }
  const request = new AbortController()
  controller = request
  submitting.value = true
  submitError.value = ''
  try {
    const response = await slhBillsApi.create(payload, key, request.signal)
    if (request.signal.aborted) {
      return
    }
    const action = resolveSlhBillImportKeyAction({ pendingSignature, settled: 'created', signature })
    if (action === 'drop') {
      pendingKey = null
      pendingSignature = null
    }
    toast.success(t('slhBill.importSuccess', { billNo: response.data.slhBillNo }))
    await router.push({ name: 'qsFinanceBillReconciliationSlhBillDetail', params: { id: response.data.id } })
  }
  catch (failure) {
    if (request.signal.aborted) {
      return
    }
    const parsed = containerFailure(failure)
    submitError.value = parsed.message
    // 结果未知时保留原键，人工重试仍能恢复到同一张账单。
    const action = resolveSlhBillImportKeyAction({ pendingSignature, settled: parsed.unknownResult ? 'unknown' : 'rejected', signature })
    if (action === 'drop') {
      pendingKey = null
      pendingSignature = null
    }
  }
  finally {
    if (controller === request) {
      submitting.value = false
    }
  }
}
watch(() => accountStore.authEpoch, () => resetUpload())
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('slhBill.importTitle')" :description="t('slhBill.importDescription')">
      <!-- 上传与解析都是可重试的只读动作，离开页面即取消；只有入库期间禁止离开。 -->
      <FaButton variant="outline" :disabled="submitting" @click="back">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhBill.back') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain v-if="!canImport">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('slhBill.noPermission')" class="py-12" />
    </FaPageMain>
    <template v-else>
      <FaPageMain v-if="phase === 'upload'">
        <div v-if="staged" class="p-4 border border-border rounded-lg bg-muted/20 flex flex-wrap gap-4 items-center justify-between">
          <div class="flex gap-3 min-w-0 items-center">
            <div class="text-primary rounded-md bg-primary/10 flex shrink-0 size-10 items-center justify-center dark:text-foreground">
              <FaIcon name="i-lucide:file-spreadsheet" class="size-6" aria-hidden="true" />
            </div>
            <div class="min-w-0">
              <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
                {{ staged.fileName }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                {{ t('slhBill.sourceFile') }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaButton variant="outline" :disabled="busy" @click="retryParse">
              {{ t('slhBill.retry') }}
            </FaButton>
            <FaButton variant="outline" :disabled="busy" @click="resetUpload">
              {{ t('slhBill.upload.reupload') }}
            </FaButton>
          </div>
        </div>
        <FaFileUpload
          v-else
          v-model="files"
          :max="1"
          :disabled="busy"
          :before-upload="validate"
          :http-request="upload"
          :description="t('slhBill.upload.label')"
          class="[&>button]:px-4 [&>button]:py-6 [&>button]:border [&>button]:h-auto"
        >
          <div class="flex flex-wrap gap-x-3 gap-y-1 items-center justify-center">
            <span class="qs-type-body-medium flex gap-2 items-center">
              <FaIcon name="i-lucide:upload" class="size-4" aria-hidden="true" />{{ t('slhBill.upload.label') }}
            </span>
            <span class="qs-type-meta text-muted-foreground">{{ t('slhBill.upload.hint') }}</span>
          </div>
        </FaFileUpload>
        <p v-if="uploading" role="status" class="qs-type-meta text-muted-foreground m-0 mt-4">
          {{ t('slhBill.upload.uploading') }}
        </p>
        <FaAlert v-if="parseError" class="mt-4" variant="destructive" :title="t('slhBill.parseFailed')">
          <template #description>
            <p class="m-0">
              {{ parseError }}
            </p>
          </template>
        </FaAlert>
      </FaPageMain>
      <FaPageMain v-else-if="phase === 'parsing'">
        <div role="status" class="text-muted-foreground py-16 flex-col-center gap-3">
          <FaIcon name="i-lucide:loader-circle" class="size-8 animate-spin" aria-hidden="true" />
          <p class="qs-type-section-title m-0">
            {{ t('slhBill.parsing') }}
          </p>
          <p class="qs-type-meta m-0">
            {{ t('slhBill.parsingHint') }}
          </p>
        </div>
      </FaPageMain>
      <template v-else-if="preview">
        <FaPageMain>
          <dl class="m-0 gap-x-6 gap-y-4 grid lg:grid-cols-4 sm:grid-cols-2">
            <div>
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('slhBill.sourceFile') }}
              </dt>
              <dd class="qs-type-body m-0 mt-1.5 [overflow-wrap:anywhere]">
                {{ staged?.fileName ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('slhBill.periodRange') }}
              </dt>
              <dd class="qs-type-data m-0 mt-1.5">
                {{ preview.periodStart }} ~ {{ preview.periodEnd }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('slhBill.column.lineCount') }}
              </dt>
              <dd class="qs-type-data-emphasis m-0 mt-1.5">
                {{ preview.lineCount }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('slhBill.column.containerBatchCount') }}
              </dt>
              <dd class="qs-type-data-emphasis m-0 mt-1.5">
                {{ preview.containerBatchCount }}
              </dd>
            </div>
          </dl>
          <div class="mt-4 pt-4 border-t border-border">
            <p class="qs-type-meta text-muted-foreground m-0 mb-2">
              {{ t('slhBill.containerBatches') }}
            </p>
            <div class="flex flex-wrap gap-2">
              <FaTag v-for="name in preview.containerBatchNames" :key="name" variant="outline" class="qs-type-data max-w-full whitespace-normal break-words">
                {{ name }}
              </FaTag>
            </div>
          </div>
        </FaPageMain>
        <FaPageMain>
          <div class="gap-6 grid min-w-0 lg:grid-cols-2">
            <section class="min-w-0" :aria-label="t('slhBill.totals.title')">
              <h2 class="qs-type-component-title m-0 mb-4">
                {{ t('slhBill.totals.title') }}
              </h2>
              <dl class="m-0 gap-x-5 gap-y-4 grid grid-cols-2">
                <div v-for="item in totals" :key="item.label" class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t(`slhBill.totals.${item.label}`) }}
                  </dt>
                  <dd class="m-0 mt-1.5">
                    <AmountDisplay :value="item.amount" :currency="item.currency" :currencies="currencyCatalog.currencies.value" />
                  </dd>
                </div>
              </dl>
            </section>
            <section class="min-w-0" :aria-label="t('slhBill.reported.title')">
              <h2 class="qs-type-component-title m-0 mb-4">
                {{ t('slhBill.reported.title') }}
              </h2>
              <dl class="m-0 gap-x-5 gap-y-4 grid grid-cols-2">
                <div v-for="item in reported" :key="item.label" class="min-w-0">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t(`slhBill.reported.${item.label}`) }}
                  </dt>
                  <dd class="qs-type-data m-0 mt-1.5 [overflow-wrap:anywhere]">
                    {{ item.value }}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </FaPageMain>
        <FaPageMain>
          <section class="min-w-0" :aria-label="t('slhBill.differences')">
            <h2 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
              {{ t('slhBill.differences') }}
              <FaTag v-if="preview.differences.length" variant="outline" class="text-destructive qs-type-status-tag border-destructive/30 bg-destructive/10">
                {{ preview.differences.length }}
              </FaTag>
            </h2>
            <p v-if="!preview.differences.length" class="qs-type-meta text-muted-foreground m-0">
              {{ t('slhBill.noDifferences') }}
            </p>
            <ul v-else class="m-0 p-0 list-none gap-2 grid">
              <li v-for="(difference, index) in preview.differences" :key="index" class="qs-type-body text-destructive px-3 py-2 border border-destructive/30 rounded-md bg-destructive/10 flex gap-2 min-w-0 items-start">
                <FaIcon name="i-lucide:triangle-alert" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
                <span class="min-w-0 [overflow-wrap:anywhere]">{{ difference }}</span>
              </li>
            </ul>
          </section>
          <section class="mt-6 min-w-0" :aria-label="t('slhBill.warnings')">
            <h2 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
              {{ t('slhBill.warnings') }}
              <FaTag v-if="preview.warnings.length" variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/30 bg-amber-500/10 dark:text-amber-300">
                {{ preview.warnings.length }}
              </FaTag>
            </h2>
            <p v-if="!preview.warnings.length" class="qs-type-meta text-muted-foreground m-0">
              {{ t('slhBill.noWarnings') }}
            </p>
            <ul v-else class="m-0 p-0 list-none gap-2 grid">
              <li v-for="(warning, index) in preview.warnings" :key="index" class="qs-type-body text-amber-700 px-3 py-2 border border-amber-500/30 rounded-md bg-amber-500/8 flex gap-2 min-w-0 items-start dark:text-amber-300">
                <FaIcon name="i-lucide:circle-alert" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
                <span class="min-w-0 [overflow-wrap:anywhere]">{{ warning }}</span>
              </li>
            </ul>
          </section>
          <FaAlert v-if="lineErrors.length" class="mt-6" variant="destructive" :title="t('slhBill.lineErrors')">
            <template #description>
              <ul class="m-0 p-0 list-none gap-1 grid">
                <li v-for="message in lineErrors" :key="message">
                  {{ message }}
                </li>
              </ul>
            </template>
          </FaAlert>
        </FaPageMain>
        <FaPageMain v-if="manualRateNeeded || preview.duplicate">
          <section v-if="manualRateNeeded" class="min-w-0" :aria-label="t('slhBill.manualRate.label')">
            <FaLabel for="slh-bill-manual-rate" class="qs-type-body-medium mb-2 block">
              {{ t('slhBill.manualRate.label') }}
            </FaLabel>
            <FaInput id="slh-bill-manual-rate" v-model="manualRateDraft" type="text" inputmode="decimal" class="w-full sm:max-w-60" :disabled="submitting" />
            <p class="qs-type-meta text-muted-foreground m-0 mt-2">
              {{ t('slhBill.manualRate.hint') }}
            </p>
            <p v-if="manualRate.error" role="alert" class="qs-type-meta text-destructive m-0 mt-2">
              {{ t(manualRate.error === 'required' ? 'slhBill.manualRate.required' : 'slhBill.manualRate.format') }}
            </p>
          </section>
          <section v-if="preview.duplicate" role="alert" class="mt-6 p-4 border border-destructive/40 rounded-lg bg-destructive/10 min-w-0">
            <div class="text-destructive flex gap-2 min-w-0 items-start">
              <FaIcon name="i-lucide:copy-x" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
              <p class="qs-type-body-medium m-0 min-w-0 [overflow-wrap:anywhere]">
                {{ t('slhBill.duplicate.notice', { billNo: preview.duplicate.slhBillNo, period: `${preview.duplicate.periodStart} ~ ${preview.duplicate.periodEnd}` }) }}
              </p>
            </div>
            <FaCheckbox v-model="duplicateAcknowledged" class="mt-3" :disabled="submitting">
              {{ t('slhBill.duplicate.confirm') }}
            </FaCheckbox>
          </section>
        </FaPageMain>
        <FaPageMain>
          <h2 class="qs-type-section-title m-0">
            {{ t('slhBill.previewLines') }}
          </h2>
          <p class="qs-type-meta text-muted-foreground m-0 mb-4 mt-1.5">
            {{ t('slhBill.chargesHint') }}
          </p>
          <QsGenericTable
            v-model:page="previewPage"
            v-model:page-size="previewPageSize"
            row-key="lineNumber"
            table-class="w-max min-w-full"
            :show-row-number="false"
            :columns="columns"
            :data="pagedLines"
            :total="previewLines.length"
            :addable="false"
            :searchable="false"
            :page-size-options="[20, 50, 100]"
            :empty-title="t('slhBill.empty')"
          >
            <template #cell-charges="{ row }">
              <SlhBillCharges :charges="row.original.charges" />
            </template>
          </QsGenericTable>
        </FaPageMain>
        <FaFixedBar position="bottom" class="pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border">
          <div class="space-y-3">
            <FaAlert v-if="submitError" variant="destructive" :title="submitError">
              <template #description>
                <p class="m-0 mt-1">
                  {{ t('slhBill.retry') }}
                </p>
              </template>
            </FaAlert>
            <p v-else-if="blockReason" role="alert" class="qs-type-body-medium text-destructive m-0">
              {{ blockMessage }}
            </p>
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ t('slhBill.parsingHint') }}
              </p>
              <div class="gap-3 grid grid-cols-2 md:flex md:shrink-0">
                <FaButton variant="outline" :disabled="submitting" @click="back">
                  {{ t('slhBill.cancel') }}
                </FaButton>
                <FaButton :loading="submitting" :disabled="submitting || blockReason !== null" @click="submit">
                  {{ t(submitting ? 'slhBill.submitting' : 'slhBill.confirm') }}
                </FaButton>
              </div>
            </div>
          </div>
        </FaFixedBar>
      </template>
    </template>
  </div>
</template>
