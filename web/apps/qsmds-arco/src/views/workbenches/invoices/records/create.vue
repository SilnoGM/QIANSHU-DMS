<script setup lang="ts">
import type { InvoiceFormLine } from '../invoice-form.logic'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import { resolveDuplicateFieldErrors, resolveInvoiceFailureKey } from '../invoice-failure.logic'
import { buildInvoiceSubmitPayload, calculateInvoiceTotals, emptyInvoiceFormLine, INVOICE_REQUEST_LINE_LIMIT } from '../invoice-form.logic'
import { parseDuplicateSuspects } from '../invoice-status.logic'

/**
 * 开票申请表单：新建与「重新填写」共用本页。
 *
 * 金额只由系统算（数量 × 单价），提交前二次确认；提交成功后跳开票记录。
 * 离开确认覆盖四类出口：路由离开、路由参数变化、刷新/关标签、提交进行中。
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

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
const returnedReason = ref<string | null>(null)
const confirmVisible = ref(false)
const duplicateVisible = ref(false)
const duplicateSuspects = ref<ReturnType<typeof parseDuplicateSuspects>>([])
const discardVisible = ref(false)
const dirty = ref(false)

const totals = computed(() => calculateInvoiceTotals(lines.value))
const canAddLine = computed(() => lines.value.length < INVOICE_REQUEST_LINE_LIMIT)

function markDirty(): void {
  dirty.value = true
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

onMounted(async () => {
  if (editingId.value !== null) {
    await loadForRefill(editingId.value)
  }
})

function requestSubmit(): void {
  submitError.value = null
  const built = buildInvoiceSubmitPayload({
    buyerName: buyerName.value,
    buyerTaxId: buyerTaxId.value,
    invoiceRemark: invoiceRemark.value,
    internalRemark: internalRemark.value,
    recipientName: recipientName.value,
    recipientPhone: recipientPhone.value,
    recipientAddress: recipientAddress.value,
    lines: lines.value,
  })
  if ('invalidField' in built) {
    submitError.value = t('invoiceRequest.error.validation')
    return
  }
  confirmVisible.value = true
}

async function submit(): Promise<void> {
  const built = buildInvoiceSubmitPayload({
    buyerName: buyerName.value,
    buyerTaxId: buyerTaxId.value,
    invoiceRemark: invoiceRemark.value,
    internalRemark: internalRemark.value,
    recipientName: recipientName.value,
    recipientPhone: recipientPhone.value,
    recipientAddress: recipientAddress.value,
    lines: lines.value,
  })
  if ('invalidField' in built) {
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    const signal = new AbortController().signal
    if (editingId.value === null) {
      // 提交是唯一带幂等键的动作：同一个键重放只会恢复同一张单。
      await invoiceRequestsApi.submit(built.payload, crypto.randomUUID(), signal)
    }
    else {
      if (editingVersion.value === null) {
        throw new Error('missing version')
      }
      await invoiceRequestsApi.resubmit(editingId.value, { ...built.payload, expectedVersion: editingVersion.value }, signal)
    }
    dirty.value = false
    confirmVisible.value = false
    duplicateVisible.value = false
    await router.push({ name: 'qsOperationsInvoicesRecords' })
  }
  catch (error) {
    const suspects = parseDuplicateSuspects(resolveDuplicateFieldErrors(error))
    if (suspects.length > 0) {
      // 四项比对命中：列出相似单再确认，确认后带 duplicateAcknowledged 重发。
      duplicateSuspects.value = suspects
      confirmVisible.value = false
      duplicateVisible.value = true
    }
    else {
      submitError.value = t(resolveInvoiceFailureKey(error))
    }
  }
  finally {
    submitting.value = false
  }
}

async function submitAcknowledged(): Promise<void> {
  const built = buildInvoiceSubmitPayload({
    buyerName: buyerName.value,
    buyerTaxId: buyerTaxId.value,
    invoiceRemark: invoiceRemark.value,
    internalRemark: internalRemark.value,
    recipientName: recipientName.value,
    recipientPhone: recipientPhone.value,
    recipientAddress: recipientAddress.value,
    lines: lines.value,
  })
  if ('invalidField' in built) {
    return
  }
  submitting.value = true
  try {
    const signal = new AbortController().signal
    if (editingId.value === null) {
      await invoiceRequestsApi.submit({ ...built.payload, duplicateAcknowledged: true }, crypto.randomUUID(), signal)
    }
    else {
      if (editingVersion.value === null) {
        throw new Error('missing version')
      }
      await invoiceRequestsApi.resubmit(editingId.value, { ...built.payload, duplicateAcknowledged: true, expectedVersion: editingVersion.value }, signal)
    }
    dirty.value = false
    dirty.value = false
    await router.push({ name: 'qsOperationsInvoicesRecords' })
  }
  catch (error) {
    duplicateVisible.value = false
    submitError.value = t(resolveInvoiceFailureKey(error))
  }
  finally {
    submitting.value = false
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
    discardVisible.value = true
  })
})
function finishLeave(allowed: boolean): void {
  discardVisible.value = false
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  if (allowed) {
    dirty.value = false
  }
  resolve?.(allowed)
}
</script>

<template>
  <FaPageMain class="min-w-0">
    <div class="mx-auto flex flex-col gap-5 max-w-3xl w-full">
      <div v-if="returnedReason !== null" class="text-sm text-destructive px-4 py-3 border border-destructive/30 rounded-md bg-destructive/10">
        <p>{{ t('invoiceRequest.form.returnedBanner') }}</p>
        <p class="mt-1">
          {{ t('invoiceRequest.detail.returnReason') }}：{{ returnedReason }}
        </p>
      </div>

      <section class="p-4 border border-border rounded-lg bg-card">
        <h2 class="text-base font-semibold mb-3">
          {{ t('invoiceRequest.form.buyerSection') }}
        </h2>
        <div class="gap-3 grid sm:grid-cols-2">
          <label class="text-sm flex flex-col gap-1">
            <span>{{ t('invoiceRequest.field.buyerName') }}</span>
            <input v-model="buyerName" class="px-3 border border-border rounded-md bg-background min-h-11" :placeholder="t('invoiceRequest.placeholder.buyerName')" @input="markDirty">
          </label>
          <label class="text-sm flex flex-col gap-1">
            <span>{{ t('invoiceRequest.field.buyerTaxId') }}</span>
            <input v-model="buyerTaxId" inputmode="numeric" maxlength="8" class="px-3 border border-border rounded-md bg-background min-h-11" :placeholder="t('invoiceRequest.placeholder.buyerTaxId')" @input="markDirty">
          </label>
        </div>
      </section>

      <section class="p-4 border border-border rounded-lg bg-card">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold">
            {{ t('invoiceRequest.form.linesSection') }}
          </h2>
          <span class="text-xs text-muted-foreground">{{ t('invoiceRequest.form.lineLimit') }}</span>
        </div>
        <div class="flex flex-col gap-3">
          <div v-for="(line, index) in lines" :key="index" class="gap-2 grid sm:grid-cols-[1fr_5rem_7rem_7rem_auto] sm:items-center">
            <input v-model="line.productName" class="px-3 border border-border rounded-md bg-background min-h-11" :placeholder="t('invoiceRequest.field.productName')" @input="markDirty">
            <input v-model="line.quantity" inputmode="numeric" class="px-3 border border-border rounded-md bg-background min-h-11" :placeholder="t('invoiceRequest.field.quantity')" @input="markDirty">
            <input v-model="line.unitPrice" inputmode="numeric" class="px-3 border border-border rounded-md bg-background min-h-11" :placeholder="t('invoiceRequest.field.unitPrice')" @input="markDirty">
            <span class="text-sm tabular-nums">{{ totals.lineAmounts[index] ?? '—' }}</span>
            <FaButton v-if="lines.length > 1" type="button" variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive" @click="removeLine(index)">
              {{ t('invoiceRequest.form.removeLine') }}
            </FaButton>
          </div>
        </div>
        <FaButton v-if="canAddLine" type="button" variant="outline" size="sm" class="mt-3" @click="addLine">
          {{ t('invoiceRequest.form.addLine') }}
        </FaButton>
        <dl class="text-sm mt-4 pt-3 border-t border-border gap-1 grid">
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.salesAmount') }}</dt><dd class="tabular-nums">
              {{ totals.salesAmount ?? '—' }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.taxAmount') }}</dt><dd class="tabular-nums">
              {{ totals.taxAmount ?? '—' }}
            </dd>
          </div>
          <div class="font-semibold flex justify-between">
            <dt>{{ t('invoiceRequest.field.totalAmount') }}</dt><dd class="tabular-nums">
              {{ totals.totalAmount ?? '—' }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-lg bg-card">
        <h2 class="text-base font-semibold mb-3">
          {{ t('invoiceRequest.form.remarkSection') }}
        </h2>
        <label class="text-sm flex flex-col gap-1">
          <span>{{ t('invoiceRequest.field.invoiceRemark') }}<span class="text-xs text-muted-foreground ml-2">{{ t('invoiceRequest.form.invoiceRemarkHint') }}</span></span>
          <input v-model="invoiceRemark" class="px-3 border border-border rounded-md bg-background min-h-11" :placeholder="t('invoiceRequest.placeholder.invoiceRemark')" @input="markDirty">
        </label>
        <label class="text-sm mt-3 flex flex-col gap-1">
          <span>{{ t('invoiceRequest.field.internalRemark') }}<span class="text-xs text-muted-foreground ml-2">{{ t('invoiceRequest.form.internalRemarkHint') }}</span></span>
          <input v-model="internalRemark" class="px-3 border border-border rounded-md bg-background min-h-11" @input="markDirty">
        </label>
      </section>

      <section class="p-4 border border-border rounded-lg bg-card">
        <h2 class="text-base font-semibold mb-3">
          {{ t('invoiceRequest.form.recipientSection') }}
        </h2>
        <div class="gap-3 grid sm:grid-cols-2">
          <label class="text-sm flex flex-col gap-1">
            <span>{{ t('invoiceRequest.field.recipientName') }}</span>
            <input v-model="recipientName" class="px-3 border border-border rounded-md bg-background min-h-11" @input="markDirty">
          </label>
          <label class="text-sm flex flex-col gap-1">
            <span>{{ t('invoiceRequest.field.recipientPhone') }}<span class="text-xs text-muted-foreground ml-2">{{ t('invoiceRequest.form.recipientPhoneHint') }}</span></span>
            <input v-model="recipientPhone" class="px-3 border border-border rounded-md bg-background min-h-11" @input="markDirty">
          </label>
          <label class="text-sm flex flex-col gap-1 sm:col-span-2">
            <span>{{ t('invoiceRequest.field.recipientAddress') }}</span>
            <input v-model="recipientAddress" class="px-3 border border-border rounded-md bg-background min-h-11" @input="markDirty">
          </label>
        </div>
      </section>

      <p v-if="loadFailed" class="text-sm text-destructive">
        {{ loadError ?? t('invoiceRequest.detail.loadFailed') }}
      </p>
      <p v-if="submitError !== null" class="text-sm text-destructive">
        {{ submitError }}
      </p>

      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="submitting" @click="router.push({ name: 'qsOperationsInvoicesRecords' })">
          {{ t('invoiceRequest.common.cancel') }}
        </FaButton>
        <FaButton :loading="submitting" :disabled="submitting" @click="requestSubmit">
          {{ editingId === null ? t('invoiceRequest.form.submit') : t('invoiceRequest.form.resubmit') }}
        </FaButton>
      </div>
    </div>

    <div v-if="confirmVisible" class="p-4 bg-black/40 flex items-center inset-0 justify-center fixed z-50">
      <div class="p-5 rounded-lg bg-card max-w-md w-full shadow-lg">
        <h3 class="text-base font-semibold">
          {{ t('invoiceRequest.form.submitConfirmTitle') }}
        </h3>
        <p class="text-sm text-muted-foreground mt-2">
          {{ t('invoiceRequest.form.submitConfirmBody', { count: lines.length, total: totals.totalAmount ?? 0 }) }}
        </p>
        <div class="mt-5 flex gap-2 justify-end">
          <FaButton variant="outline" :disabled="submitting" @click="confirmVisible = false">
            {{ t('invoiceRequest.form.continueEditing') }}
          </FaButton>
          <FaButton :loading="submitting" :disabled="submitting" @click="submit">
            {{ t('invoiceRequest.common.confirm') }}
          </FaButton>
        </div>
      </div>
    </div>

    <div v-if="duplicateVisible" class="p-4 bg-black/40 flex items-center inset-0 justify-center fixed z-50">
      <div class="p-5 rounded-lg bg-card max-w-lg w-full shadow-lg">
        <h3 class="text-base font-semibold">
          {{ t('invoiceRequest.form.duplicateTitle') }}
        </h3>
        <p class="text-sm text-muted-foreground mt-2">
          {{ t('invoiceRequest.form.duplicateBody') }}
        </p>
        <ul class="text-sm mt-3 flex flex-col gap-1">
          <li v-for="suspect in duplicateSuspects" :key="suspect.invoiceNo" class="tabular-nums">
            {{ suspect.invoiceNo }} · {{ t(`invoiceRequest.status.${suspect.status}`) }} · {{ suspect.submittedAt }}
          </li>
        </ul>
        <div class="mt-5 flex gap-2 justify-end">
          <FaButton variant="outline" :disabled="submitting" @click="duplicateVisible = false">
            {{ t('invoiceRequest.form.continueEditing') }}
          </FaButton>
          <FaButton :loading="submitting" :disabled="submitting" @click="submitAcknowledged">
            {{ t('invoiceRequest.form.duplicateConfirm') }}
          </FaButton>
        </div>
      </div>
    </div>

    <div v-if="discardVisible" class="p-4 bg-black/40 flex items-center inset-0 justify-center fixed z-50">
      <div class="p-5 rounded-lg bg-card max-w-md w-full shadow-lg">
        <h3 class="text-base font-semibold">
          {{ t('invoiceRequest.form.discardTitle') }}
        </h3>
        <p class="text-sm text-muted-foreground mt-2">
          {{ t('invoiceRequest.form.discardBody') }}
        </p>
        <div class="mt-5 flex gap-2 justify-end">
          <FaButton variant="outline" @click="finishLeave(false)">
            {{ t('invoiceRequest.form.continueEditing') }}
          </FaButton>
          <FaButton variant="destructive" @click="finishLeave(true)">
            {{ t('invoiceRequest.form.confirmDiscard') }}
          </FaButton>
        </div>
      </div>
    </div>
  </FaPageMain>
</template>
