<script setup lang="ts">
import type { InvoiceFormLine } from '../invoice-form.logic'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import exchangeRatesApi from '@/api/modules/exchange-rates'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { calculateEstimatedCostCny, INVOICE_MAILING_FEE_CNY, INVOICE_SERVICE_FEE_RATE } from '../invoice-cost.logic'
import { resolveDuplicateFieldErrors, resolveInvoiceFailureKey } from '../invoice-failure.logic'
import { buildInvoiceSubmitPayload, calculateInvoiceTotals, emptyInvoiceFormLine, formatLineAmount, INVOICE_REQUEST_LINE_LIMIT } from '../invoice-form.logic'
import { parseDuplicateSuspects } from '../invoice-status.logic'

/**
 * 开票申请表单：新建与「重新填写」共用本页。
 *
 * 金额只由系统算（数量 × 单价），汇总走 AmountDisplay（台币）；提交前二次确认；
 * 离开确认覆盖四类出口：路由离开、路由参数变化、刷新/关标签、提交进行中。
 * 校验是手工的：buildInvoiceSubmitPayload 返回第一个不合格字段，页面按下标红该字段。
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const currencyCatalog = useCurrencyCatalog()

const editingId = computed(() => (typeof route.query.id === 'string' ? route.query.id : null))
const editingVersion = ref<number | null>(null)
const buyerName = ref('')
const buyerTaxId = ref('')
const invoiceRemark = ref('')
const internalRemark = ref('')
const recipientName = ref('')
const recipientPhone = ref('')
const recipientAddress = ref('')
const lines = ref<InvoiceFormLine[]>([emptyInvoiceFormLine()])
const loadError = ref<string | null>(null)
const loadFailed = ref(false)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const fieldError = ref<string | null>(null)
const returnedReason = ref<string | null>(null)
const confirmOpen = ref(false)
const duplicateOpen = ref(false)
const discardOpen = ref(false)
const duplicateSuspects = ref<ReturnType<typeof parseDuplicateSuspects>>([])
const dirty = ref(false)

const totals = computed(() => calculateInvoiceTotals(lines.value))
const canAddLine = computed(() => lines.value.length < INVOICE_REQUEST_LINE_LIMIT)
const invoiceCurrency = 'TWD'
const serviceFeePercent = Math.round(INVOICE_SERVICE_FEE_RATE * 100)

/** 预估成本用的当前台币汇率（1 人民币兑多少台币）；加载失败或缺失时为 null。 */
const costRate = ref<string | null>(null)
const costRateState = ref<'loading' | 'ready' | 'unavailable'>('loading')

const estimatedCostCny = computed(() => {
  if (costRate.value === null || totals.value.totalAmount === null) {
    return null
  }
  return calculateEstimatedCostCny(totals.value.totalAmount, Number(costRate.value))
})

const costHint = computed(() => {
  if (costRateState.value === 'loading') {
    return ''
  }
  return costRate.value === null ? t('invoiceRequest.cost.rateUnavailable') : t('invoiceRequest.cost.hint', { rate: costRate.value })
})

function markDirty(): void {
  dirty.value = true
  fieldError.value = null
}

function addLine(): void {
  if (!canAddLine.value) {
    return
  }
  lines.value = [...lines.value, emptyInvoiceFormLine()]
  markDirty()
}

function removeLine(index: number): void {
  lines.value = lines.value.filter((_, current) => current !== index)
  markDirty()
}

function lineFieldError(index: number, field: 'productName' | 'quantity' | 'unitPrice'): boolean {
  return fieldError.value === `lines.${index}.${field}` || fieldError.value === 'lines'
}

function currentPayload(): ReturnType<typeof buildInvoiceSubmitPayload> {
  return buildInvoiceSubmitPayload({
    buyerName: buyerName.value,
    buyerTaxId: buyerTaxId.value,
    invoiceRemark: invoiceRemark.value,
    internalRemark: internalRemark.value,
    recipientName: recipientName.value,
    recipientPhone: recipientPhone.value,
    recipientAddress: recipientAddress.value,
    lines: lines.value,
  })
}

async function loadForRefill(id: string): Promise<void> {
  loadFailed.value = false
  try {
    const { data } = await invoiceRequestsApi.get(id, new AbortController().signal)
    editingVersion.value = data.version
    buyerName.value = data.buyerName
    buyerTaxId.value = data.buyerTaxId
    invoiceRemark.value = data.invoiceRemark ?? ''
    internalRemark.value = data.internalRemark ?? ''
    recipientName.value = data.recipientName
    recipientPhone.value = data.recipientPhone
    recipientAddress.value = data.recipientAddress
    lines.value = data.lines.map(line => ({ productName: line.productName, quantity: String(line.quantity), unitPrice: line.unitPrice }))
    returnedReason.value = data.history.filter(entry => entry.action === 'RETURN').at(-1)?.reason ?? null
    dirty.value = false
  }
  catch (error) {
    loadFailed.value = true
    loadError.value = t(resolveInvoiceFailureKey(error))
  }
}

/** 预估成本模块只读当前台币汇率；失败不阻塞表单，模块内提示「汇率暂不可用」。 */
async function loadCostRate(): Promise<void> {
  try {
    const response = await exchangeRatesApi.list(new AbortController().signal)
    const current = response.data.items.find(entry => entry.currency.code === 'TWD')?.currentRate
    costRate.value = current?.foreignUnitsPerCny ?? null
  }
  catch {
    costRate.value = null
  }
  costRateState.value = costRate.value === null ? 'unavailable' : 'ready'
}

onMounted(async () => {
  if (editingId.value !== null) {
    await loadForRefill(editingId.value)
  }
})

onMounted(() => {
  void loadCostRate()
})

function requestSubmit(): void {
  submitError.value = null
  const built = currentPayload()
  if ('invalidField' in built) {
    fieldError.value = built.invalidField
    return
  }
  fieldError.value = null
  confirmOpen.value = true
}

async function send(duplicateAcknowledged: boolean): Promise<void> {
  const built = currentPayload()
  if ('invalidField' in built) {
    fieldError.value = built.invalidField
    return
  }
  submitting.value = true
  submitError.value = null
  // 收尾动作必须发生在释放 submitting 之后：弹窗的程序化关闭与路由离开守卫都把
  // submitting 视为硬阻止，提前收尾会被拒绝——弹窗被回写为打开、导航被静默取消，
  // 单据已在服务端创建却看起来像没提交成功。
  let outcome: 'success' | 'duplicate' | 'failed' = 'failed'
  try {
    const signal = new AbortController().signal
    const payload = duplicateAcknowledged ? { ...built.payload, duplicateAcknowledged: true } : built.payload
    if (editingId.value === null) {
      // 提交是唯一带幂等键的动作：同一个键重放只会恢复同一张单。
      await invoiceRequestsApi.submit(payload, crypto.randomUUID(), signal)
    }
    else {
      if (editingVersion.value === null) {
        throw new Error('missing version')
      }
      await invoiceRequestsApi.resubmit(editingId.value, { ...payload, expectedVersion: editingVersion.value }, signal)
    }
    outcome = 'success'
  }
  catch (error) {
    const suspects = parseDuplicateSuspects(resolveDuplicateFieldErrors(error))
    if (suspects.length > 0) {
      // 四项比对命中：列出相似单再确认，确认后带 duplicateAcknowledged 重发。
      duplicateSuspects.value = suspects
      outcome = 'duplicate'
    }
    else {
      submitError.value = t(resolveInvoiceFailureKey(error))
    }
  }
  finally {
    submitting.value = false
  }

  if (outcome === 'success') {
    dirty.value = false
    confirmOpen.value = false
    duplicateOpen.value = false
    await router.push({ name: 'qsOperationsInvoicesRecords' })
  }
  else if (outcome === 'duplicate') {
    confirmOpen.value = false
    duplicateOpen.value = true
  }
}

// 离开确认：脏表单才拦；提交中硬阻止；确认放弃后 resolve(true) 放行。
let pendingNavigationResolver: ((value: boolean) => void) | null = null
function beforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value || submitting.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  pendingNavigationResolver?.(false)
})
onBeforeRouteLeave(() => {
  if (submitting.value) {
    return false
  }
  if (!dirty.value) {
    return true
  }
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
    discardOpen.value = true
  })
})

function finishLeave(allowed: boolean): void {
  discardOpen.value = false
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  if (allowed) {
    dirty.value = false
  }
  resolve?.(allowed)
}

const pageTitle = computed(() => editingId.value === null ? t('invoiceRequest.create.title') : t('invoiceRequest.form.resubmit'))
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="pageTitle" :description="t('invoiceRequest.create.description')">
      <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="router.push({ name: 'qsOperationsInvoicesRecords' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('invoiceRequest.action.viewRecords') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain main-class="min-w-0 overflow-visible" class="min-w-0">
      <FaAlert v-if="returnedReason !== null" variant="destructive" icon="i-lucide:circle-alert" :title="t('invoiceRequest.form.returnedBanner')" class="mb-4">
        <template #description>
          <span>{{ t('invoiceRequest.detail.returnReason') }}：{{ returnedReason }}</span>
        </template>
      </FaAlert>
      <FaAlert v-if="loadFailed" variant="destructive" icon="i-lucide:circle-alert" :title="loadError ?? t('invoiceRequest.detail.loadFailed')" class="mb-4" />
      <FaAlert v-if="submitError !== null" variant="destructive" icon="i-lucide:circle-alert" :title="submitError" role="alert" class="mb-4" />

      <FaForm :disabled="submitting" class="min-w-0 space-y-6">
        <FaCard :title="t('invoiceRequest.form.buyerSection')" content-class="gap-4 grid grid-cols-1 md:grid-cols-12">
          <FaFormItem name="buyerName" :label="t('invoiceRequest.field.buyerName')" required :auto-bind="false" class="md:col-span-7">
            <FaInput
              v-model="buyerName"
              class="w-full"
              maxlength="200"
              :disabled="submitting"
              :aria-invalid="fieldError === 'buyerName'"
              @update:model-value="markDirty"
            />
            <p v-if="fieldError === 'buyerName'" role="alert" class="text-xs text-destructive m-0 mt-1">
              {{ t('invoiceRequest.error.validation') }}
            </p>
          </FaFormItem>
          <FaFormItem name="buyerTaxId" :label="t('invoiceRequest.field.buyerTaxId')" required :auto-bind="false" class="md:col-span-5">
            <FaInput
              v-model="buyerTaxId"
              class="w-full"
              inputmode="numeric"
              maxlength="8"
              input-class="font-mono! tabular-nums"
              :disabled="submitting"
              :aria-invalid="fieldError === 'buyerTaxId'"
              @update:model-value="markDirty"
            />
            <p v-if="fieldError === 'buyerTaxId'" role="alert" class="text-xs text-destructive m-0 mt-1">
              {{ t('invoiceRequest.error.taxIdFormat') }}
            </p>
          </FaFormItem>
        </FaCard>

        <FaCard :title="t('invoiceRequest.form.linesSection')" :description="t('invoiceRequest.form.lineLimit')" content-class="space-y-4">
          <div class="border border-border rounded-xl bg-background overflow-x-auto">
            <table class="text-sm min-w-[46rem] w-full border-collapse">
              <caption class="sr-only">
                {{ t('invoiceRequest.form.linesSection') }}
              </caption>
              <thead class="bg-muted/45">
                <tr>
                  <th scope="col" class="font-medium p-3 text-left w-12">
                    #
                  </th>
                  <th scope="col" class="font-medium p-3 text-left">
                    {{ t('invoiceRequest.field.productName') }}
                  </th>
                  <th scope="col" class="font-medium p-3 text-right w-28">
                    {{ t('invoiceRequest.field.quantity') }}
                  </th>
                  <th scope="col" class="font-medium p-3 text-right w-36">
                    {{ t('invoiceRequest.form.unitPriceExTax') }}
                  </th>
                  <th scope="col" class="font-medium p-3 text-right w-36">
                    {{ t('invoiceRequest.field.amount') }}
                  </th>
                  <th scope="col" class="font-medium p-3 text-right w-20">
                    <span class="sr-only">{{ t('invoiceRequest.form.removeLine') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, index) in lines" :key="index" class="align-middle border-b border-border last:border-b-0">
                  <td class="qs-type-meta p-3">
                    {{ index + 1 }}
                  </td>
                  <td class="p-3">
                    <FaInput
                      v-model="line.productName"
                      class="w-full"
                      maxlength="200"
                      :placeholder="t('invoiceRequest.placeholder.productName')"
                      :disabled="submitting"
                      :aria-invalid="lineFieldError(index, 'productName')"
                      :aria-label="t('invoiceRequest.field.productName')"
                      @update:model-value="markDirty"
                    />
                  </td>
                  <td class="p-3">
                    <FaInput
                      v-model="line.quantity"
                      class="w-full"
                      inputmode="numeric"
                      maxlength="7"
                      input-class="text-right font-mono! tabular-nums"
                      :aria-label="t('invoiceRequest.field.quantity')"
                      :disabled="submitting"
                      :aria-invalid="lineFieldError(index, 'quantity')"
                      @update:model-value="markDirty"
                    />
                  </td>
                  <td class="p-3">
                    <FaInput
                      v-model="line.unitPrice"
                      class="w-full"
                      inputmode="numeric"
                      maxlength="16"
                      input-class="text-right font-mono! tabular-nums"
                      :aria-label="t('invoiceRequest.field.unitPrice')"
                      :disabled="submitting"
                      :aria-invalid="lineFieldError(index, 'unitPrice')"
                      @update:model-value="markDirty"
                    />
                  </td>
                  <td class="p-3 text-right">
                    <span :class="totals.lineAmounts[index] === null ? 'qs-type-meta' : 'qs-type-data-emphasis'">{{ formatLineAmount(totals.lineAmounts[index]) }}</span>
                  </td>
                  <td class="p-3 text-right">
                    <FaButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                      :aria-label="`${t('invoiceRequest.form.removeLine')} ${index + 1}`"
                      :disabled="submitting || lines.length <= 1"
                      @click="removeLine(index)"
                    >
                      <FaIcon name="i-lucide:trash-2" aria-hidden="true" />
                    </FaButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="fieldError === 'lines' || lineFieldError(0, 'quantity')" role="alert" class="text-xs text-destructive m-0">
            {{ t('invoiceRequest.form.lineLimit') }}
          </p>
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <p class="text-xs text-muted-foreground m-0">
              {{ t('invoiceRequest.form.amountHint') }}
            </p>
            <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="submitting || !canAddLine" @click="addLine">
              <FaIcon name="i-lucide:list-plus" aria-hidden="true" />{{ t('invoiceRequest.form.addLine', { current: lines.length, limit: INVOICE_REQUEST_LINE_LIMIT }) }}
            </FaButton>
          </div>
          <div class="gap-3 grid grid-cols-1 md:grid-cols-3">
            <div class="p-4 border border-border rounded-xl flex flex-col gap-2">
              <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.field.salesAmount') }}</span>
              <AmountDisplay
                :value="totals.salesAmount === null ? null : String(totals.salesAmount)"
                :currency="invoiceCurrency"
                :currencies="currencyCatalog.currencies.value"
                class="text-lg font-semibold self-end"
              />
            </div>
            <div class="p-4 border border-border rounded-xl flex flex-col gap-2">
              <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.form.taxAmountWithRate') }}</span>
              <AmountDisplay
                :value="totals.taxAmount === null ? null : String(totals.taxAmount)"
                :currency="invoiceCurrency"
                :currencies="currencyCatalog.currencies.value"
                class="text-lg font-semibold self-end"
              />
            </div>
            <div class="p-4 border border-border rounded-xl bg-primary/5 flex flex-col gap-2">
              <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.field.totalAmount') }}</span>
              <AmountDisplay
                :value="totals.totalAmount === null ? null : String(totals.totalAmount)"
                :currency="invoiceCurrency"
                :currencies="currencyCatalog.currencies.value"
                class="text-lg font-bold self-end"
              />
            </div>
          </div>
        </FaCard>

        <FaCard :title="t('invoiceRequest.form.remarkSection')" content-class="gap-4 grid grid-cols-1 md:grid-cols-2">
          <FaFormItem name="invoiceRemark" :label="t('invoiceRequest.field.invoiceRemark')" :description="t('invoiceRequest.form.invoiceRemarkHint')" :auto-bind="false">
            <FaInput
              v-model="invoiceRemark"
              class="w-full"
              maxlength="500"
              :disabled="submitting"
              @update:model-value="markDirty"
            />
          </FaFormItem>
          <FaFormItem name="internalRemark" :label="t('invoiceRequest.field.internalRemark')" :description="t('invoiceRequest.form.internalRemarkHint')" :auto-bind="false">
            <FaInput v-model="internalRemark" class="w-full" maxlength="500" :disabled="submitting" @update:model-value="markDirty" />
          </FaFormItem>
        </FaCard>

        <FaCard :title="t('invoiceRequest.form.recipientSection')" content-class="gap-4 grid grid-cols-1 md:grid-cols-12">
          <FaFormItem name="recipientName" :label="t('invoiceRequest.field.recipientName')" required :auto-bind="false" class="md:col-span-3">
            <FaInput
              v-model="recipientName"
              class="w-full"
              :disabled="submitting"
              :aria-invalid="fieldError === 'recipientName'"
              @update:model-value="markDirty"
            />
          </FaFormItem>
          <FaFormItem name="recipientPhone" :label="t('invoiceRequest.field.recipientPhone')" required :description="t('invoiceRequest.form.recipientPhoneHint')" :auto-bind="false" class="md:col-span-4">
            <FaInput
              v-model="recipientPhone"
              class="w-full"
              :disabled="submitting"
              :aria-invalid="fieldError === 'recipientPhone'"
              @update:model-value="markDirty"
            />
          </FaFormItem>
          <FaFormItem name="recipientAddress" :label="t('invoiceRequest.field.recipientAddress')" required :auto-bind="false" class="md:col-span-5">
            <FaInput
              v-model="recipientAddress"
              class="w-full"
              :disabled="submitting"
              :aria-invalid="fieldError === 'recipientAddress'"
              @update:model-value="markDirty"
            />
          </FaFormItem>
        </FaCard>
      </FaForm>

      <FaCard :title="t('invoiceRequest.cost.section')" class="mt-6" content-class="space-y-3">
        <div class="gap-3 grid grid-cols-1 md:grid-cols-3">
          <div class="p-4 border border-border rounded-xl flex flex-col gap-2">
            <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.cost.serviceFeeRate') }}</span>
            <span class="text-lg qs-type-data-emphasis font-semibold self-end">{{ serviceFeePercent }}%</span>
          </div>
          <div class="p-4 border border-border rounded-xl flex flex-col gap-2">
            <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.cost.mailingFee') }}</span>
            <AmountDisplay
              :value="String(INVOICE_MAILING_FEE_CNY)"
              currency="CNY"
              :currencies="currencyCatalog.currencies.value"
              class="text-lg font-semibold self-end"
            />
          </div>
          <div class="p-4 border border-border rounded-xl bg-destructive/5 flex flex-col gap-2">
            <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.cost.estimatedCost') }}</span>
            <AmountDisplay
              :value="estimatedCostCny === null ? null : String(estimatedCostCny)"
              currency="CNY"
              :currencies="currencyCatalog.currencies.value"
              class="text-lg font-bold self-end"
            />
          </div>
        </div>
        <p v-if="costHint !== ''" class="text-xs text-muted-foreground m-0">
          {{ costHint }}
        </p>
      </FaCard>
    </FaPageMain>

    <FaFixedBar position="bottom" class="pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="router.push({ name: 'qsOperationsInvoicesRecords' })">
          {{ t('invoiceRequest.common.cancel') }}
        </FaButton>
        <div class="flex flex-col gap-3 sm:flex-row sm:gap-6 sm:items-center">
          <div class="gap-2 hidden items-baseline sm:flex">
            <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.form.totalPreview') }}</span>
            <AmountDisplay
              :value="totals.totalAmount === null ? null : String(totals.totalAmount)"
              :currency="invoiceCurrency"
              :currencies="currencyCatalog.currencies.value"
              class="text-base font-bold"
            />
          </div>
          <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="submitting" @click="requestSubmit">
            {{ editingId === null ? t('invoiceRequest.form.submit') : t('invoiceRequest.form.resubmit') }}
          </FaButton>
        </div>
      </div>
    </FaFixedBar>

    <QsGenericModal
      v-model="confirmOpen"
      :title="t('invoiceRequest.form.submitConfirmTitle')"
      :description="t('invoiceRequest.form.submitConfirmBody', { count: lines.length, total: totals.totalAmount ?? 0 })"
      size="sm"
      :submitting="submitting"
      :error="submitError"
    >
      <template #footer>
        <FaButton type="button" variant="outline" :disabled="submitting" @click="confirmOpen = false">
          {{ t('invoiceRequest.form.continueEditing') }}
        </FaButton>
        <FaButton type="button" :loading="submitting" :disabled="submitting" @click="send(false)">
          {{ t('invoiceRequest.common.confirm') }}
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal v-model="duplicateOpen" :title="t('invoiceRequest.form.duplicateTitle')" :description="t('invoiceRequest.form.duplicateBody')" size="md" :submitting="submitting">
      <ul class="m-0 p-0 list-none space-y-2">
        <li v-for="suspect in duplicateSuspects" :key="suspect.invoiceNo" class="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
          <span class="qs-type-data-emphasis">{{ suspect.invoiceNo }}</span>
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ t(`invoiceRequest.status.${suspect.status}`) }}
          </FaTag>
          <span class="qs-type-data">{{ suspect.submittedAt }}</span>
        </li>
      </ul>
      <template #footer>
        <FaButton type="button" variant="outline" :disabled="submitting" @click="duplicateOpen = false">
          {{ t('invoiceRequest.form.continueEditing') }}
        </FaButton>
        <FaButton type="button" :loading="submitting" :disabled="submitting" @click="send(true)">
          {{ t('invoiceRequest.form.duplicateConfirm') }}
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      :model-value="discardOpen"
      :title="t('invoiceRequest.form.discardTitle')"
      :description="t('invoiceRequest.form.discardBody')"
      size="sm"
      @update:model-value="$event ? (discardOpen = true) : finishLeave(false)"
    >
      <template #footer>
        <FaButton type="button" variant="outline" @click="finishLeave(false)">
          {{ t('invoiceRequest.form.continueEditing') }}
        </FaButton>
        <FaButton type="button" variant="destructive" @click="finishLeave(true)">
          {{ t('invoiceRequest.form.confirmDiscard') }}
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
