<script setup lang="ts">
import type { ContainerSwapContextDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import { getApiClientFailureMessage } from '@/api/errors'
import containerApi from '@/api/modules/container-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildSwapRequest, containerMarkDisplay, containerMarkTitle, isValidSwapCod, swapCodDrafts } from './container-swap.logic'
import SwapShipmentPicker from './swap-shipment-picker.vue'
import { containerFailure } from './use-container-resource'

defineOptions({ name: 'ContainerSwapModal' })

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'completed': []
}>()

const { t } = useI18n()
const toast = useQsToast()
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const left = ref<PurchaseShipmentListItemDto | null>(null)
const right = ref<PurchaseShipmentListItemDto | null>(null)
const pickingLeft = ref(true)
const pickingRight = ref(true)
const context = shallowRef<ContainerSwapContextDto | null>(null)
const contextLoading = ref(false)
const contextError = ref('')
const codDrafts = ref<Record<string, string>>({})
const note = ref('')
const submitting = ref(false)
const submitError = ref('')
const pending = ref<{ key: string, signature: string } | null>(null)
let contextController: AbortController | null = null

const codInvalid = computed(() => Object.values(codDrafts.value).some(value => !isValidSwapCod(value)))
const canSubmit = computed(() => (
  context.value?.canSwap === true
  && !contextLoading.value
  && !submitting.value
  && !pickingLeft.value
  && !pickingRight.value
  && !codInvalid.value
))
const leftOtherCod = computed(() => rightReferenceCod(context.value?.right.containerLoadingItems ?? []))
const rightOtherCod = computed(() => rightReferenceCod(context.value?.left.containerLoadingItems ?? []))
const leftCodTotal = computed(() => draftCodTotal(context.value?.left.containerLoadingItems ?? []))
const rightCodTotal = computed(() => draftCodTotal(context.value?.right.containerLoadingItems ?? []))

function draftCodTotal(lines: readonly { readonly id: string }[]): string {
  const total = lines.reduce((sum, line) => sum + Number(codDrafts.value[line.id]?.trim() || 0), 0)
  return total.toFixed(2)
}

function rightReferenceCod(lines: readonly { codAmountTwd: string | null }[]): string {
  const values = [...new Set(lines.map(line => line.codAmountTwd).filter((value): value is string => value !== null))]
  return values.length === 0 ? t('containerPage.none') : values.join(' / ')
}

function reset(): void {
  contextController?.abort()
  contextController = null
  left.value = null
  right.value = null
  pickingLeft.value = true
  pickingRight.value = true
  context.value = null
  contextLoading.value = false
  contextError.value = ''
  codDrafts.value = {}
  note.value = ''
  submitError.value = ''
  pending.value = null
  submitting.value = false
}

async function loadContext(): Promise<void> {
  contextController?.abort()
  contextController = null
  context.value = null
  contextError.value = ''
  submitError.value = ''
  if (left.value === null || right.value === null) {
    return
  }
  if (left.value.id === right.value.id) {
    contextError.value = t('containerPage.swapSameShipment')
    return
  }
  const controller = new AbortController()
  contextController = controller
  contextLoading.value = true
  try {
    const result = (await containerApi.swapContext({
      leftShipmentId: left.value.id,
      rightShipmentId: right.value.id,
    }, controller.signal)).data
    if (!controller.signal.aborted) {
      context.value = result
      codDrafts.value = swapCodDrafts(result)
    }
  }
  catch (failure) {
    if (!controller.signal.aborted) {
      contextError.value = containerFailure(failure).message
    }
  }
  finally {
    if (!controller.signal.aborted) {
      contextLoading.value = false
    }
  }
}

function selectLeft(shipment: PurchaseShipmentListItemDto): void {
  left.value = shipment
  pickingLeft.value = false
  pending.value = null
}

function selectRight(shipment: PurchaseShipmentListItemDto): void {
  right.value = shipment
  pickingRight.value = false
  pending.value = null
}

function changeLeft(): void {
  left.value = null
  pickingLeft.value = true
  pending.value = null
}

function changeRight(): void {
  right.value = null
  pickingRight.value = true
  pending.value = null
}

function codValue(lineId: string): string {
  return codDrafts.value[lineId] ?? ''
}

function setCod(lineId: string, value: string | undefined): void {
  codDrafts.value[lineId] = value ?? ''
}

async function submit(): Promise<void> {
  const current = context.value
  if (left.value === null || right.value === null || current === null || !canSubmit.value) {
    return
  }
  const payload = buildSwapRequest({
    leftShipmentId: left.value.id,
    rightShipmentId: right.value.id,
    context: current,
    codDrafts: codDrafts.value,
    note: note.value,
  })
  const signature = JSON.stringify(payload)
  const requestKey = pending.value?.signature === signature ? pending.value.key : crypto.randomUUID()
  pending.value = { key: requestKey, signature }
  submitting.value = true
  submitError.value = ''
  const controller = new AbortController()
  try {
    await containerApi.swap(payload, requestKey, controller.signal)
    pending.value = null
    toast.success(t('containerPage.swapSuccess'))
    emit('completed')
    emit('update:modelValue', false)
  }
  catch (failure) {
    submitError.value = getApiClientFailureMessage(failure, t('containerPage.swapFailed'))
  }
  finally {
    submitting.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    reset()
  }
}, { immediate: true })

watch([left, right], () => {
  void loadContext()
})
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('containerPage.swapTitle')"
    :description="t('containerPage.swapDescription')"
    size="3xl"
    :submitting="submitting"
    :error="submitError"
    :error-title="t('containerPage.swapFailed')"
    :before-close="() => !submitting"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:arrow-left-right" class="text-primary size-5" />
    </template>
    <div class="min-w-0 space-y-5">
      <div class="gap-5 grid lg:grid-cols-2">
        <section class="p-4 border border-border rounded-xl min-w-0">
          <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
            <h3 class="qs-type-component-title m-0">
              {{ t('containerPage.swapLeft') }}
            </h3>
            <FaButton v-if="left && !pickingLeft" type="button" variant="ghost" size="sm" :disabled="submitting" @click="changeLeft">
              {{ t('containerPage.swapChange') }}
            </FaButton>
          </div>
          <SwapShipmentPicker
            v-if="pickingLeft"
            :title="t('containerPage.swapPickLeft')"
            :exclude-shipment-id="right?.id ?? null"
            @select="selectLeft"
          />
          <template v-else-if="left">
            <div class="space-y-2">
              <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                <span class="text-foreground font-semibold">
                  {{ left.containerBatch?.containerBatchName ?? t('containerPage.none') }}
                </span>
                <span class="text-muted-foreground">·</span>
                <span class="text-primary font-semibold max-w-full min-w-0 truncate" :title="containerMarkTitle(left)">
                  {{ containerMarkDisplay(left) }}
                </span>
              </div>
              <div v-if="left.shipmentNo" class="qs-type-data [overflow-wrap:anywhere]">
                {{ left.shipmentNo }}
              </div>
              <div class="qs-type-meta text-muted-foreground flex flex-nowrap gap-x-3 min-w-0">
                <span class="shrink-0 whitespace-nowrap">{{ t('containerPage.swapSalesOrder') }}：{{ left.salesSource?.orderNo ?? t('containerPage.swapUnassigned') }}</span>
                <span class="flex shrink gap-1 max-w-48 min-w-0 items-baseline overflow-hidden" :title="left.salesSource?.customerName ?? ''">
                  <span class="shrink-0">{{ t('containerPage.swapCustomer') }}：</span>
                  <span class="min-w-0 truncate">{{ left.salesSource?.customerName ?? '—' }}</span>
                </span>
                <span class="shrink-0 whitespace-nowrap">{{ t('containerPage.purchase') }}：{{ left.purchaseOrder.orderNo }}</span>
              </div>
              <div v-if="right" class="qs-type-meta text-primary p-2 rounded-md bg-primary/5 flex flex-wrap gap-x-1 items-baseline">
                <span>{{ t('containerPage.swapAfterSalesOrder') }}：{{ right.salesSource?.orderNo ?? t('containerPage.swapUnassigned') }}</span>
                <span class="text-muted-foreground max-w-48 min-w-0 truncate" :title="right.salesSource?.customerName ?? ''">
                  · {{ right.salesSource?.customerName ?? '—' }}
                </span>
              </div>
            </div>
            <div v-if="context" class="mt-4 space-y-3">
              <div class="p-3 rounded-lg bg-muted/40">
                <div class="qs-type-meta text-muted-foreground">
                  {{ t('containerPage.swapProducts') }}
                </div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span v-for="item in context.left.items" :key="`${item.productId ?? item.productName}-${item.quantity}`" class="qs-type-data">
                    {{ item.productName }} × {{ item.quantity }}
                  </span>
                </div>
              </div>
              <div v-for="line in context.left.containerLoadingItems" :key="line.id" class="p-3 border border-border rounded-lg space-y-2">
                <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                  <span class="qs-type-meta text-muted-foreground">第 {{ line.lineNumber }} 行</span>
                  <span class="qs-type-data">{{ line.goodsName }}</span>
                  <span v-if="line.oceanShippingMarkText" class="qs-type-meta text-muted-foreground">{{ line.oceanShippingMarkText }}</span>
                </div>
                <div class="gap-2 grid sm:grid-cols-2">
                  <div>
                    <div class="qs-type-meta text-muted-foreground">
                      {{ t('containerPage.swapBefore') }}
                    </div>
                    <div class="qs-type-body mt-1 [overflow-wrap:anywhere]">
                      {{ line.recipientName || t('containerPage.swapEmpty') }}
                      <span v-if="line.recipientPhone" class="text-muted-foreground"> · {{ line.recipientPhone }}</span>
                      <div v-if="line.recipientAddress" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.recipientAddress }}
                      </div>
                      <div v-if="line.remark" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.remark }}
                      </div>
                      <div class="qs-type-data mt-1">
                        COD {{ line.codAmountTwd ?? t('containerPage.none') }}
                      </div>
                    </div>
                  </div>
                  <div class="p-2 rounded-md bg-primary/5">
                    <div class="qs-type-meta text-primary">
                      {{ t('containerPage.swapAfter') }}
                    </div>
                    <div class="qs-type-body mt-1 [overflow-wrap:anywhere]">
                      {{ line.afterRecipientName || t('containerPage.swapEmpty') }}
                      <span v-if="line.afterRecipientPhone" class="text-muted-foreground"> · {{ line.afterRecipientPhone }}</span>
                      <div v-if="line.afterRecipientAddress" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.afterRecipientAddress }}
                      </div>
                      <div v-if="line.afterRemark" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.afterRemark }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 items-end">
                  <label class="flex-1 min-w-40">
                    <span class="qs-type-meta text-muted-foreground">{{ t('containerPage.swapCod') }}</span>
                    <FaInput
                      :model-value="codValue(line.id)"
                      inputmode="decimal"
                      :placeholder="t('containerPage.swapCodPlaceholder')"
                      :disabled="submitting"
                      @update:model-value="setCod(line.id, $event)"
                    />
                  </label>
                  <span class="qs-type-meta text-muted-foreground pb-2">
                    {{ t('containerPage.swapCodOpposite') }}：{{ rightOtherCod }}
                  </span>
                </div>
                <p v-if="!isValidSwapCod(codValue(line.id))" class="qs-type-meta text-destructive m-0" role="alert">
                  {{ t('containerPage.swapCodInvalid') }}
                </p>
              </div>
              <div class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.swapLeftCodTotal') }} {{ leftCodTotal }}
              </div>
            </div>
          </template>
        </section>

        <section class="p-4 border border-border rounded-xl min-w-0">
          <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
            <h3 class="qs-type-component-title m-0">
              {{ t('containerPage.swapRight') }}
            </h3>
            <FaButton v-if="right && !pickingRight" type="button" variant="ghost" size="sm" :disabled="submitting" @click="changeRight">
              {{ t('containerPage.swapChange') }}
            </FaButton>
          </div>
          <SwapShipmentPicker
            v-if="pickingRight"
            :title="t('containerPage.swapPickRight')"
            :exclude-shipment-id="left?.id ?? null"
            @select="selectRight"
          />
          <template v-else-if="right">
            <div class="space-y-2">
              <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                <span class="text-foreground font-semibold">
                  {{ right.containerBatch?.containerBatchName ?? t('containerPage.none') }}
                </span>
                <span class="text-muted-foreground">·</span>
                <span class="text-primary font-semibold max-w-full min-w-0 truncate" :title="containerMarkTitle(right)">
                  {{ containerMarkDisplay(right) }}
                </span>
              </div>
              <div v-if="right.shipmentNo" class="qs-type-data [overflow-wrap:anywhere]">
                {{ right.shipmentNo }}
              </div>
              <div class="qs-type-meta text-muted-foreground flex flex-nowrap gap-x-3 min-w-0">
                <span class="shrink-0 whitespace-nowrap">{{ t('containerPage.swapSalesOrder') }}：{{ right.salesSource?.orderNo ?? t('containerPage.swapUnassigned') }}</span>
                <span class="flex shrink gap-1 max-w-48 min-w-0 items-baseline overflow-hidden" :title="right.salesSource?.customerName ?? ''">
                  <span class="shrink-0">{{ t('containerPage.swapCustomer') }}：</span>
                  <span class="min-w-0 truncate">{{ right.salesSource?.customerName ?? '—' }}</span>
                </span>
                <span class="shrink-0 whitespace-nowrap">{{ t('containerPage.purchase') }}：{{ right.purchaseOrder.orderNo }}</span>
              </div>
              <div v-if="left" class="qs-type-meta text-primary p-2 rounded-md bg-primary/5 flex flex-wrap gap-x-1 items-baseline">
                <span>{{ t('containerPage.swapAfterSalesOrder') }}：{{ left.salesSource?.orderNo ?? t('containerPage.swapUnassigned') }}</span>
                <span class="text-muted-foreground max-w-48 min-w-0 truncate" :title="left.salesSource?.customerName ?? ''">
                  · {{ left.salesSource?.customerName ?? '—' }}
                </span>
              </div>
            </div>
            <div v-if="context" class="mt-4 space-y-3">
              <div class="p-3 rounded-lg bg-muted/40">
                <div class="qs-type-meta text-muted-foreground">
                  {{ t('containerPage.swapProducts') }}
                </div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span v-for="item in context.right.items" :key="`${item.productId ?? item.productName}-${item.quantity}`" class="qs-type-data">
                    {{ item.productName }} × {{ item.quantity }}
                  </span>
                </div>
              </div>
              <div v-for="line in context.right.containerLoadingItems" :key="line.id" class="p-3 border border-border rounded-lg space-y-2">
                <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                  <span class="qs-type-meta text-muted-foreground">第 {{ line.lineNumber }} 行</span>
                  <span class="qs-type-data">{{ line.goodsName }}</span>
                  <span v-if="line.oceanShippingMarkText" class="qs-type-meta text-muted-foreground">{{ line.oceanShippingMarkText }}</span>
                </div>
                <div class="gap-2 grid sm:grid-cols-2">
                  <div>
                    <div class="qs-type-meta text-muted-foreground">
                      {{ t('containerPage.swapBefore') }}
                    </div>
                    <div class="qs-type-body mt-1 [overflow-wrap:anywhere]">
                      {{ line.recipientName || t('containerPage.swapEmpty') }}
                      <span v-if="line.recipientPhone" class="text-muted-foreground"> · {{ line.recipientPhone }}</span>
                      <div v-if="line.recipientAddress" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.recipientAddress }}
                      </div>
                      <div v-if="line.remark" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.remark }}
                      </div>
                      <div class="qs-type-data mt-1">
                        COD {{ line.codAmountTwd ?? t('containerPage.none') }}
                      </div>
                    </div>
                  </div>
                  <div class="p-2 rounded-md bg-primary/5">
                    <div class="qs-type-meta text-primary">
                      {{ t('containerPage.swapAfter') }}
                    </div>
                    <div class="qs-type-body mt-1 [overflow-wrap:anywhere]">
                      {{ line.afterRecipientName || t('containerPage.swapEmpty') }}
                      <span v-if="line.afterRecipientPhone" class="text-muted-foreground"> · {{ line.afterRecipientPhone }}</span>
                      <div v-if="line.afterRecipientAddress" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.afterRecipientAddress }}
                      </div>
                      <div v-if="line.afterRemark" class="qs-type-meta text-muted-foreground mt-1">
                        {{ line.afterRemark }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 items-end">
                  <label class="flex-1 min-w-40">
                    <span class="qs-type-meta text-muted-foreground">{{ t('containerPage.swapCod') }}</span>
                    <FaInput
                      :model-value="codValue(line.id)"
                      inputmode="decimal"
                      :placeholder="t('containerPage.swapCodPlaceholder')"
                      :disabled="submitting"
                      @update:model-value="setCod(line.id, $event)"
                    />
                  </label>
                  <span class="qs-type-meta text-muted-foreground pb-2">
                    {{ t('containerPage.swapCodOpposite') }}：{{ leftOtherCod }}
                  </span>
                </div>
                <p v-if="!isValidSwapCod(codValue(line.id))" class="qs-type-meta text-destructive m-0" role="alert">
                  {{ t('containerPage.swapCodInvalid') }}
                </p>
              </div>
              <div class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.swapRightCodTotal') }} {{ rightCodTotal }}
              </div>
            </div>
          </template>
        </section>
      </div>

      <div v-if="contextLoading" class="flex flex-col gap-2" role="status" :aria-label="t('containerPage.loading')">
        <div class="rounded-lg bg-muted/40 h-24 animate-pulse" aria-hidden="true" />
        <div class="rounded-lg bg-muted/40 h-24 animate-pulse" aria-hidden="true" />
      </div>
      <FaAlert v-else-if="contextError" variant="destructive" :title="t('containerPage.swapBlockedTitle')" :description="contextError" />
      <FaAlert v-else-if="context && !context.canSwap" variant="destructive" :title="t('containerPage.swapBlockedTitle')">
        <template #description>
          <p class="m-0 mb-1">
            {{ t('containerPage.swapBlockedHint') }}
          </p>
          <ul class="m-0 pl-5 space-y-1">
            <li v-for="error in context.errors" :key="`${error.code}:${error.message}`">
              {{ error.message }}
            </li>
          </ul>
        </template>
      </FaAlert>
      <div v-if="context" class="min-w-0">
        <label class="block">
          <span class="qs-type-meta text-muted-foreground">{{ t('containerPage.swapNote') }}</span>
          <FaTextarea v-model="note" :rows="2" maxlength="500" :placeholder="t('containerPage.swapNotePlaceholder')" :disabled="submitting" />
        </label>
      </div>
      <p class="qs-type-meta text-muted-foreground m-0">
        {{ t('containerPage.swapHint') }}
      </p>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="submitting" class="w-full sm:w-auto" @click="visible = false">
        {{ t('containerManagement.cancel') }}
      </FaButton>
      <FaButton :loading="submitting" :disabled="!canSubmit" class="w-full sm:w-auto" @click="submit">
        {{ t('containerPage.swapSubmit') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
