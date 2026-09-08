<script setup lang="ts">
import type {
  PurchaseStartPresetSalesOrder,
  PurchaseStartPresetValidator,
  PurchaseStartProductMode,
  PurchaseStartPurchaseType,
  PurchaseStartSelection,
} from './types'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  createPurchaseStartSelection,
  resetPurchaseStartSupplierDraft,
  validatePurchaseStartDraft,
} from './logic'

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

const productModeDraft = ref<PurchaseStartProductMode | null>(null)
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
const submissionPending = computed(() => props.submitting || validationPending.value)
const canConfirm = computed(() => (
  draftValidation.value.valid
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
    validationController.value = null
    validationPending.value = false
    emit('confirm', selection)
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
        <span class="qs-type-meta text-muted-foreground">开始前将重新校验待采购产品</span>
      </section>

      <fieldset class="m-0 p-0 border-0 min-w-0" :disabled="disabled || submissionPending">
        <legend class="qs-type-body-medium font-semibold mb-3">
          第一步：选择采购产品类型
        </legend>
        <div class="gap-4 grid grid-cols-1 sm:grid-cols-2" role="radiogroup" aria-label="采购产品类型">
          <label
            class="min-w-0 cursor-pointer relative"
            :class="(disabled || submissionPending) && 'cursor-not-allowed'"
          >
            <input
              type="radio"
              name="purchase-start-product-mode"
              value="CATALOG"
              :checked="productModeDraft === 'CATALOG'"
              class="peer sr-only"
              @change="selectProductMode('CATALOG')"
            >
            <span
              data-testid="purchase-start-product-mode-card"
              data-product-mode="CATALOG"
              class="p-5 text-start border rounded-xl bg-background flex flex-col min-h-64 transition-[border-color,background-color,box-shadow] duration-200 ease-out relative overflow-hidden sm:p-6 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
              :class="disabled || submissionPending
                ? 'border-border bg-muted/30 opacity-60'
                : productModeDraft === 'CATALOG'
                  ? 'border-primary bg-primary/[0.035] shadow-md ring-1 ring-primary/20'
                  : 'border-border shadow-sm hover:border-primary/40 hover:bg-muted/20 hover:shadow-md'"
            >
              <span class="flex gap-4 min-w-0 items-start relative">
                <span
                  data-testid="purchase-start-product-mode-emblem"
                  class="text-emerald-700 rounded-xl bg-emerald-50 flex shrink-0 size-16 ring-2 ring-emerald-200 shadow-sm items-center justify-center dark:text-emerald-300 dark:bg-emerald-950/60 dark:ring-emerald-700/50"
                  aria-hidden="true"
                >
                  <FaIcon name="i-lucide:boxes" class="size-8" />
                </span>
                <span class="pt-0.5 flex-1 min-w-0">
                  <strong class="text-lg leading-7 font-semibold block">产品库产品采购</strong>
                  <span class="text-xs text-emerald-700 font-medium mt-1.5 px-2 py-0.5 border border-emerald-200 rounded-md bg-emerald-50 inline-flex items-center dark:text-emerald-300 dark:border-emerald-700/50 dark:bg-emerald-950/60">
                    已建档产品
                  </span>
                </span>
                <FaIcon
                  v-if="productModeDraft === 'CATALOG'"
                  name="i-lucide:circle-check-big"
                  class="text-primary shrink-0 size-7"
                  aria-hidden="true"
                />
              </span>

              <span class="mt-6 pt-5 border-t border-dashed flex flex-1 flex-col min-w-0 relative">
                <span class="flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline relative z-10">
                  <strong class="text-3xl leading-none tracking-wide font-semibold">产品库</strong>
                  <span class="text-sm text-muted-foreground font-mono">CATALOG</span>
                </span>
                <span class="qs-type-meta text-muted-foreground mt-3 max-w-[32rem] relative z-10">
                  采购已建档产品，并沿用产品档案中的采购成本。
                </span>
                <span
                  class="text-sm font-medium mt-auto pt-6 flex gap-2 items-center relative z-10"
                  :class="productModeDraft === 'CATALOG' ? 'text-primary' : 'text-muted-foreground'"
                >
                  <FaIcon name="i-lucide:mouse-pointer-click" class="size-4" aria-hidden="true" />
                  {{ productModeDraft === 'CATALOG' ? '已选中' : '点击选择' }}
                </span>
                <FaIcon
                  name="i-lucide:boxes"
                  class="text-emerald-500/10 size-28 absolute dark:text-emerald-400/10 -bottom-8 -right-5"
                  aria-hidden="true"
                />
              </span>
            </span>
          </label>

          <label
            class="min-w-0 cursor-pointer relative"
            :class="(disabled || submissionPending) && 'cursor-not-allowed'"
          >
            <input
              type="radio"
              name="purchase-start-product-mode"
              value="CUSTOM"
              :checked="productModeDraft === 'CUSTOM'"
              class="peer sr-only"
              @change="selectProductMode('CUSTOM')"
            >
            <span
              data-testid="purchase-start-product-mode-card"
              data-product-mode="CUSTOM"
              class="p-5 text-start border rounded-xl bg-background flex flex-col min-h-64 transition-[border-color,background-color,box-shadow] duration-200 ease-out relative overflow-hidden sm:p-6 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
              :class="disabled || submissionPending
                ? 'border-border bg-muted/30 opacity-60'
                : productModeDraft === 'CUSTOM'
                  ? 'border-primary bg-primary/[0.035] shadow-md ring-1 ring-primary/20'
                  : 'border-border shadow-sm hover:border-primary/40 hover:bg-muted/20 hover:shadow-md'"
            >
              <span class="flex gap-4 min-w-0 items-start relative">
                <span
                  data-testid="purchase-start-product-mode-emblem"
                  class="text-amber-700 rounded-xl bg-amber-50 flex shrink-0 size-16 ring-2 ring-amber-200 shadow-sm items-center justify-center dark:text-amber-300 dark:bg-amber-950/60 dark:ring-amber-700/50"
                  aria-hidden="true"
                >
                  <FaIcon name="i-lucide:package-plus" class="size-8" />
                </span>
                <span class="pt-0.5 flex-1 min-w-0">
                  <strong class="text-lg leading-7 font-semibold block">自定义产品采购</strong>
                  <span class="text-xs text-amber-700 font-medium mt-1.5 px-2 py-0.5 border border-amber-200 rounded-md bg-amber-50 inline-flex items-center dark:text-amber-300 dark:border-amber-700/50 dark:bg-amber-950/60">
                    临时产品
                  </span>
                </span>
                <FaIcon
                  v-if="productModeDraft === 'CUSTOM'"
                  name="i-lucide:circle-check-big"
                  class="text-primary shrink-0 size-7"
                  aria-hidden="true"
                />
              </span>

              <span class="mt-6 pt-5 border-t border-dashed flex flex-1 flex-col min-w-0 relative">
                <span class="flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline relative z-10">
                  <strong class="text-3xl leading-none tracking-wide font-semibold">自定义</strong>
                  <span class="text-sm text-muted-foreground font-mono">CUSTOM</span>
                </span>
                <span class="qs-type-meta text-muted-foreground mt-3 max-w-[32rem] relative z-10">
                  采购销售订单中的临时产品，采购价格由用户填写。
                </span>
                <span
                  class="text-sm font-medium mt-auto pt-6 flex gap-2 items-center relative z-10"
                  :class="productModeDraft === 'CUSTOM' ? 'text-primary' : 'text-muted-foreground'"
                >
                  <FaIcon name="i-lucide:mouse-pointer-click" class="size-4" aria-hidden="true" />
                  {{ productModeDraft === 'CUSTOM' ? '已选中' : '点击选择' }}
                </span>
                <FaIcon
                  name="i-lucide:package-plus"
                  class="text-amber-500/10 size-28 absolute dark:text-amber-400/10 -bottom-8 -right-5"
                  aria-hidden="true"
                />
              </span>
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
