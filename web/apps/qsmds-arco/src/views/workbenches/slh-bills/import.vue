<script setup lang="ts">
import type { FileItem } from '@fantastic-admin/components'
import type { SlhBillImportPreviewDto, SlhBillPreviewLineDto, SlhBillStagedFileDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhBillsApi from '@/api/modules/slh-bills'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import { pageForSlhBillLine } from './comparison.logic'
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
import SlhBillComparison from './slh-bill-comparison.vue'

defineOptions({ name: 'QsFinanceBillReconciliationSlhBillImport' })
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
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
const previewLines = computed(() => preview.value?.lines ?? [])
const pagedLines = computed(() => previewLines.value.slice((previewPage.value - 1) * previewPageSize.value, previewPage.value * previewPageSize.value))
const columns = computed<QsGenericTableColumn<SlhBillPreviewLineDto>[]>(() => [
  ...buildSlhBillLineColumns<SlhBillPreviewLineDto>(t),
  // 行内提示与账单级分组来自同一份 findings，只是这里按行过滤。
  { id: 'lineIssues', title: t('slhBill.previewIssues'), accessorFn: (line: SlhBillPreviewLineDto) => [...line.errors, ...line.findings.map(finding => finding.message)].join('；'), minWidth: 280, width: 320 },
])
/** 差异项按行号跳到明细表对应页；预览表是前端分页，直接切页即可。 */
function jumpToLine(lineNumber: number): void {
  previewPage.value = pageForSlhBillLine(lineNumber, previewPageSize.value)
}
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
          <SlhBillComparison
            :totals="preview.totals"
            :reported="preview.reported"
            :embedded-foreign-units-per-cny="preview.reported.embeddedForeignUnitsPerCny ?? null"
            :findings="preview.findings"
            :line-count="preview.lineCount"
            @jump-to-line="jumpToLine"
          />
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
