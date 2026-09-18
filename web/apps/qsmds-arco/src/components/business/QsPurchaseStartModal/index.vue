<script setup lang="ts">
import type {
  PurchaseStartPresetSalesOrder,
  PurchaseStartPresetValidator,
  PurchaseStartProductMode,
  PurchaseStartPurchaseType,
  PurchaseStartSelection,
} from './types'
import type { PaymentRecipientAccountInputDto } from '@/api/modules/payment-recipients'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPaymentRecipientEditor from '@/components/business/QsPaymentRecipientEditor/index.vue'
import { validatePaymentRecipientAccounts } from '@/components/business/QsPaymentRecipientEditor/logic'
import {
  createPurchaseStartSelection,
  resetPurchaseStartSupplierDraft,
  validatePurchaseStartDraft,
} from './logic'
import { savePurchaseRecipientDraft } from './recipient-draft'

defineOptions({ name: 'QsPurchaseStartModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  purchaseType: PurchaseStartPurchaseType
  presetSalesOrder?: PurchaseStartPresetSalesOrder | null
  validatePreset?: PurchaseStartPresetValidator
  disabled?: boolean
  submitting?: boolean
}>(), {
  presetSalesOrder: null,
  validatePreset: undefined,
  disabled: false,
  submitting: false,
})

const emit = defineEmits<{
  'cancel': []
  'confirm': [selection: PurchaseStartSelection]
  'update:modelValue': [value: boolean]
  'validationError': [message: string]
}>()

const { t } = useI18n()
const account = useAppAccountStore()
const paymentAccounts = ref<PaymentRecipientAccountInputDto[]>([])
const uploading = ref(false)
const productModeDraft = ref<PurchaseStartProductMode | null>(null)
const recipientError = computed(() => productModeDraft.value === 'CUSTOM' ? validatePaymentRecipientAccounts(paymentAccounts.value, 1) : null)
const supplierValueDraft = ref<string | null>(null)
const customSupplierNameDraft = ref('')
const customSupplierTouched = ref(false)
const validationPending = ref(false)
const validationController = shallowRef<AbortController | null>(null)

const draftValidation = computed(() => validatePurchaseStartDraft({
  productMode: productModeDraft.value,
  supplierValue: supplierValueDraft.value,
  customSupplierName: customSupplierNameDraft.value,
}))
const submissionPending = computed(() => props.submitting || validationPending.value || uploading.value)
const canConfirm = computed(() => (
  draftValidation.value.valid
  && recipientError.value === null
  && !props.disabled
  && !submissionPending.value
))
const customSupplierError = computed(() => (
  productModeDraft.value === 'CUSTOM'
  && customSupplierTouched.value
  && !draftValidation.value.valid
    ? draftValidation.value.message
    : null
))

function abortValidation(): void {
  validationController.value?.abort()
  validationController.value = null
  validationPending.value = false
}

function resetSupplierDraft(): void {
  const reset = resetPurchaseStartSupplierDraft()
  supplierValueDraft.value = reset.supplierValue
  customSupplierNameDraft.value = reset.customSupplierName
  customSupplierTouched.value = false
  paymentAccounts.value = []
}

function resetDraft(): void {
  abortValidation()
  productModeDraft.value = null
  resetSupplierDraft()
}

function selectProductMode(mode: PurchaseStartProductMode): void {
  if (props.disabled || submissionPending.value || productModeDraft.value === mode) {
    return
  }
  abortValidation()
  productModeDraft.value = mode
  // 两种供应商来源互斥；切换模式时必须同时清空，不能保留隐藏字段。
  resetSupplierDraft()
}

function closeAsCancel(): void {
  if (submissionPending.value) {
    return
  }
  resetDraft()
  emit('cancel')
  emit('update:modelValue', false)
}

function handleVisibility(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
  }
  else {
    closeAsCancel()
  }
}

async function confirm(): Promise<void> {
  if (!canConfirm.value) {
    if (productModeDraft.value === 'CUSTOM') {
      customSupplierTouched.value = true
    }
    return
  }

  const selection = createPurchaseStartSelection({
    purchaseType: props.purchaseType,
    productMode: productModeDraft.value,
    supplierValue: supplierValueDraft.value,
    customSupplierName: customSupplierNameDraft.value,
  })
  const presetSalesOrder = props.presetSalesOrder
  const validator = props.validatePreset
  const controller = new AbortController()
  abortValidation()
  validationController.value = controller
  validationPending.value = true

  try {
    if (presetSalesOrder !== null && validator !== undefined) {
      const result = await validator(selection, presetSalesOrder, controller.signal)
      if (controller.signal.aborted || validationController.value !== controller) {
        return
      }
      if (!result.eligible) {
        emit('validationError', result.message ?? '该销售订单没有符合当前条件的待采购产品')
        return
      }
    }

    if (controller.signal.aborted || validationController.value !== controller) {
      return
    }
    const paymentDraftKey = selection.productMode === 'CUSTOM'
      ? savePurchaseRecipientDraft(`${account.userId}:${account.authContext?.session.createdAt ?? ''}`, paymentAccounts.value)
      : undefined
    validationController.value = null
    validationPending.value = false
    emit('confirm', { ...selection, paymentDraftKey })
    resetDraft()
    emit('update:modelValue', false)
  }
  catch (error: unknown) {
    if (!controller.signal.aborted && validationController.value === controller) {
      emit('validationError', error instanceof Error && error.message.trim()
        ? error.message
        : '销售订单资格校验失败，请稍后重试')
    }
  }
  finally {
    if (validationController.value === controller) {
      validationController.value = null
      validationPending.value = false
    }
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    resetDraft()
  }
  else {
    resetDraft()
  }
})

watch(() => props.presetSalesOrder?.id, () => {
  // 快捷入口身份变化时旧资格响应绝不能回写到新订单上下文。
  abortValidation()
})

watch(() => account.authEpoch, resetDraft)
onBeforeUnmount(abortValidation)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="选择采购产品类型"
    description="先确定产品来源和供应商，再进入采购订单填写流程。"
    size="xl"
    :submitting="submissionPending"
    :dismiss-on-overlay="!submissionPending"
    :dismiss-on-escape="!submissionPending"
    @update:model-value="handleVisibility"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:shopping-cart" class="size-4" aria-hidden="true" />
    </template>

    <div class="gap-5 grid">
      <section
        v-if="presetSalesOrder"
        class="p-4 border border-border rounded-lg bg-muted/25 gap-3 grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        aria-label="预选销售订单"
      >
        <div class="min-w-0">
          <span class="qs-type-meta text-muted-foreground block">销售订单快捷入口</span>
          <strong class="qs-type-data-emphasis font-mono mt-1 block break-all">
            {{ presetSalesOrder.orderNo }}
          </strong>
        </div>
        <slot name="preset-products">
          <span class="qs-type-meta text-muted-foreground">开始前将重新校验待采购产品</span>
        </slot>
      </section>

      <fieldset class="m-0 p-0 border-0 min-w-0" :disabled="disabled || submissionPending">
        <legend class="qs-type-body-medium font-semibold mb-3">
          第一步：选择采购产品类型
        </legend>
        <div class="gap-3 grid grid-cols-1 sm:grid-cols-2" role="radiogroup" aria-label="采购产品类型">
          <label v-for="mode in (['CATALOG', 'CUSTOM'] as const)" :key="mode" class="cursor-pointer relative">
            <input type="radio" name="purchase-start-product-mode" :value="mode" :checked="productModeDraft === mode" class="peer sr-only" @change="selectProductMode(mode)">
            <span data-testid="purchase-start-product-mode-card" :data-product-mode="mode" class="p-4 border rounded-lg flex gap-3 items-center peer-focus-visible:ring-2 peer-focus-visible:ring-primary" :class="productModeDraft === mode ? 'border-primary bg-primary/5' : 'border-border'">
              <FaIcon :name="mode === 'CATALOG' ? 'i-lucide:boxes' : 'i-lucide:package-plus'" class="text-primary shrink-0 size-6" aria-hidden="true" />
              <span class="flex-1 min-w-0">
                <strong class="qs-type-body-medium block">{{ mode === 'CATALOG' ? '产品库产品采购' : '自定义产品采购' }}</strong>
                <span class="qs-type-meta text-muted-foreground mt-1 block">{{ mode === 'CATALOG' ? '选择供应商的已建档产品' : '填写供应商和本单收款资料' }}</span>
              </span>
              <FaIcon v-if="productModeDraft === mode" name="i-lucide:circle-check" class="text-primary shrink-0 size-5" aria-hidden="true" />
            </span>
          </label>
        </div>
      </fieldset>

      <section
        v-if="productModeDraft"
        class="p-4 border border-border rounded-xl bg-muted/20 sm:p-5"
        aria-labelledby="purchase-start-supplier-title"
      >
        <div class="mb-3">
          <h3 id="purchase-start-supplier-title" class="qs-type-body-medium font-semibold m-0">
            第二步：{{ productModeDraft === 'CATALOG' ? '下拉选择供应商' : '填写供应商名称' }}
          </h3>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            {{ productModeDraft === 'CATALOG'
              ? '后续只展示该供应商仍需采购的产品库产品。'
              : '后续只展示仍需采购的自定义产品。' }}
          </p>
        </div>

        <QsDictionarySelect
          v-if="productModeDraft === 'CATALOG'"
          v-model="supplierValueDraft"
          dictionary-code="service_provider.supplier"
          :disabled="disabled || submissionPending"
          placeholder="选择供应商"
          clearable
          required
          class="w-full"
        />
        <div v-else class="w-full">
          <FaInput
            v-model="customSupplierNameDraft"
            placeholder="填写本次采购的供应商名称"
            :aria-invalid="Boolean(customSupplierError)"
            :disabled="disabled || submissionPending"
            class="min-h-11 w-full"
            @blur="customSupplierTouched = true"
          />
          <p
            v-if="customSupplierError"
            class="qs-type-meta text-destructive m-0 mt-2"
            role="alert"
          >
            {{ customSupplierError }}
          </p>
        </div>
      </section>
      <section v-if="productModeDraft === 'CUSTOM'" class="space-y-3">
        <h3 class="qs-type-component-title m-0">
          {{ t('purchasePayment.customRecipients') }}
        </h3>
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.customRecipientsHint') }}
        </p>
        <QsPaymentRecipientEditor v-model="paymentAccounts" :minimum="1" :disabled="disabled || validationPending || submitting" @busy-change="uploading = $event" />
        <p v-if="recipientError" class="qs-type-meta text-muted-foreground m-0">
          {{ t(recipientError) }}
        </p>
      </section>
    </div>

    <template #footer>
      <div class="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3 w-full justify-end sm:px-6">
        <FaButton
          type="button"
          variant="outline"
          class="px-6 min-h-11"
          :disabled="submissionPending"
          @click="closeAsCancel"
        >
          取消
        </FaButton>
        <FaButton
          type="button"
          class="px-6 min-h-11"
          :disabled="!canConfirm"
          :loading="submissionPending"
          @click="confirm"
        >
          <FaIcon name="i-lucide:arrow-right" class="size-4" aria-hidden="true" />
          开始采购
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
