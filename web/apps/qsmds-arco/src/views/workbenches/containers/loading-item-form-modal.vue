<script setup lang="ts">
import type { LoadingItemDraft, LoadingItemSubmission } from './form.logic'
import type { ContainerLoadingItemDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { buildLoadingItemSubmission, createLoadingItemDraft, resolveShipmentDisplay, validateLoadingItemDraft } from './form.logic'

const props = withDefaults(defineProps<{
  modelValue: boolean
  item?: ContainerLoadingItemDto | null
  shipment?: PurchaseShipmentListItemDto | null
  submitting?: boolean
  retryOnly?: boolean
  error?: string | null
  fieldErrors?: Readonly<Record<string, string>>
}>(), { item: null, shipment: null, submitting: false, retryOnly: false, error: null, fieldErrors: () => ({}) })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': [data: LoadingItemSubmission]
  'selectShipment': []
}>()
const { t } = useI18n()
const draft = ref(createLoadingItemDraft())
const { currencies, loading: currencyLoading, errorMessage: currencyError, reload: reloadCurrencies } = useCurrencyCatalog()
const currencyReady = computed(() => !currencyLoading.value && !currencyError.value && currencies.value.some(currency => currency.code === 'TWD' && currency.enabled))
const codAmount = computed({
  get: () => draft.value.codAmountTwd || null,
  set: (value: string | null) => { draft.value.codAmountTwd = value ?? '' },
})
const recipientAddress = computed({
  get: () => draft.value.recipientAddress,
  // 地址可在多行控件内自然折行，但现有接口只接受单行文本；仅将用户输入的换行变为空格。
  set: (value: string) => { draft.value.recipientAddress = value.replace(/\r\n?|\n/gu, ' ') },
})
// 表单内部字段值不会回写金额控件的 null 或其他中间态到业务草稿。
const formModel = computed(() => ({ ...draft.value }))
const formRef = useTemplateRef<{ submit: () => Promise<void>, setFieldError: (name: string, message?: string) => void }>('formRef')
const requested = ref(false)
const locked = computed(() => props.submitting || requested.value)
const shipmentLabel = computed(() => resolveShipmentDisplay(draft.value.shipmentId, props.shipment, props.item))
const shipmentSummary = computed(() => {
  if (props.shipment?.id === draft.value.shipmentId) {
    return { shipmentNo: props.shipment.shipmentNo, purchaseOrderNo: props.shipment.purchaseOrder?.orderNo, salesOrderNo: props.shipment.salesSource?.orderNo }
  }
  if (props.item?.shipmentId === draft.value.shipmentId && draft.value.shipmentId) {
    return { shipmentNo: props.item.shipmentNo, purchaseOrderNo: props.item.purchaseOrderNo, salesOrderNo: props.item.salesOrderNo }
  }
  return null
})
function rule(field: keyof LoadingItemDraft) {
  return (value: unknown) => {
    const current = { ...draft.value, [field]: typeof value === 'string' ? value : '' }
    const key = validateLoadingItemDraft(current)[field]
    return key ? t(`containerManagement.${key}`) : true
  }
}
const textFields = [
  { key: 'oceanShippingMarkText', limit: 128 },
  { key: 'warehouseReceiptReference', limit: 500 },
] as const
const dimensionFields = ['lengthCm', 'widthCm', 'heightCm'] as const
watch(() => [props.modelValue, props.item] as const, ([open]) => {
  if (open) {
    draft.value = createLoadingItemDraft(props.item)
    if (!props.item && props.shipment) {
      draft.value.shipmentId = props.shipment.id
    }
  }
  requested.value = false
}, { immediate: true })
watch(() => props.shipment, (shipment) => {
  // 外层货件选择器只控制关联，避免覆盖用户已填写的品名、收货资料和代收金额。
  if (props.modelValue && shipment) {
    draft.value.shipmentId = shipment.id
  }
})
watch(() => props.submitting, (value) => {
  if (!value) {
    requested.value = false
  }
})
watch(() => props.fieldErrors, (errors) => {
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(field, message)
  }
}, { deep: true })
function close(value = false) {
  if (!locked.value) {
    emit('update:modelValue', value)
  }
}
async function submit() {
  if (locked.value || (!props.retryOnly && Object.keys(validateLoadingItemDraft(draft.value)).length)) {
    return
  }
  requested.value = true
  emit('submit', buildLoadingItemSubmission(draft.value))
  await nextTick()
  if (!props.submitting) {
    requested.value = false
  }
}
</script>

<template>
  <QsGenericModal :model-value="modelValue" :title="t(item ? 'containerManagement.editItem' : 'containerManagement.addItem')" :description="t('containerManagement.itemDescription')" size="xl" :submitting="locked" @update:model-value="close">
    <template #header-leading>
      <FaIcon name="i-lucide:package-plus" class="text-primary size-5" />
    </template>
    <FaAlert v-if="error" variant="destructive" :title="t('containerManagement.saveFailed')" :description="error" class="mb-5" role="alert" />
    <FaAlert v-if="retryOnly" :title="t('containerManagement.retryHint')" class="mb-5" />
    <FaForm ref="formRef" :model="formModel" :disabled="locked || retryOnly" scroll-to-error class="gap-5" @submit="submit">
      <section :aria-label="t('containerManagement.shipment')" class="min-w-0">
        <div class="p-3.5 rounded-lg bg-muted/35 flex flex-wrap gap-3 items-start justify-between">
          <div class="flex-1 min-w-0">
            <p class="qs-type-meta text-muted-foreground m-0">
              {{ t('containerManagement.shipment') }}
            </p>
            <p class="m-0 mt-1 [overflow-wrap:anywhere]" :class="draft.shipmentId ? 'qs-type-data-emphasis' : 'qs-type-body text-muted-foreground'">
              {{ shipmentLabel || t(draft.shipmentId ? 'containerManagement.linkedShipment' : 'containerManagement.noShipment') }}
            </p>
            <div v-if="shipmentSummary" class="qs-type-meta text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 [overflow-wrap:anywhere]">
              <span v-if="shipmentSummary.shipmentNo && shipmentSummary.shipmentNo !== shipmentLabel">{{ shipmentSummary.shipmentNo }}</span>
              <span v-if="shipmentSummary.purchaseOrderNo">{{ t('containerManagement.purchaseSource') }} <span class="font-mono">{{ shipmentSummary.purchaseOrderNo }}</span></span>
              <span v-if="shipmentSummary.salesOrderNo">{{ t('containerManagement.salesSource') }} <span class="font-mono">{{ shipmentSummary.salesOrderNo }}</span></span>
            </div>
          </div>
          <div class="flex shrink-0 gap-1">
            <FaButton type="button" variant="outline" size="sm" :disabled="locked || retryOnly" @click="emit('selectShipment')">
              <FaIcon name="i-lucide:link" class="size-4" aria-hidden="true" />
              {{ t(draft.shipmentId ? 'containerManagement.changeShipment' : 'containerManagement.selectShipment') }}
            </FaButton>
            <FaButton v-if="draft.shipmentId" type="button" variant="ghost" size="sm" :disabled="locked || retryOnly" @click="draft.shipmentId = null">
              {{ t('containerManagement.clear') }}
            </FaButton>
          </div>
        </div>
        <p v-if="fieldErrors.shipmentId" class="text-sm text-destructive mt-2" role="alert">
          {{ fieldErrors.shipmentId }}
        </p>
        <slot name="shipment-picker" />
      </section>
      <section :aria-label="t('containerManagement.goodsSection')" class="min-w-0">
        <h3 class="qs-type-component-title m-0 mb-4 flex gap-2 items-center">
          <FaIcon name="i-lucide:package" class="text-muted-foreground size-4" aria-hidden="true" />
          {{ t('containerManagement.goodsSection') }}
        </h3>
        <div class="gap-x-5 gap-y-2 grid grid-cols-1 sm:grid-cols-2">
          <FaFormItem name="goodsName" :label="t('containerManagement.goodsName')" :rules="rule('goodsName')" class="sm:col-span-2" required>
            <FaInput v-model="draft.goodsName" class="w-full" maxlength="255" :placeholder="t('containerManagement.goodsNameHint')" />
          </FaFormItem>
          <FaFormItem v-for="field in textFields" :key="field.key" :name="field.key" :label="t(`containerManagement.${field.key}`)" :rules="rule(field.key)">
            <FaInput v-model="draft[field.key]" class="w-full" input-class="font-mono" :maxlength="field.limit" />
          </FaFormItem>
          <FaFormItem name="packageCount" :label="t('containerManagement.packageCount')" :rules="rule('packageCount')" required>
            <FaInput v-model="draft.packageCount" class="w-full" input-class="font-mono tabular-nums" inputmode="numeric" maxlength="7" />
          </FaFormItem>
          <FaFormItem name="packageUnit" :label="t('containerManagement.packageUnit')" :rules="rule('packageUnit')">
            <FaInput v-model="draft.packageUnit" class="w-full" maxlength="32" :placeholder="t('containerManagement.packageUnitHint')" />
          </FaFormItem>
        </div>
      </section>
      <section :aria-label="t('containerManagement.measurements')" class="pt-5 border-t border-border min-w-0">
        <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
          <FaIcon name="i-lucide:ruler" class="text-muted-foreground size-4" aria-hidden="true" />
          {{ t('containerManagement.measurements') }}
        </h3>
        <p class="qs-type-meta text-muted-foreground m-0 mb-4 mt-1.5">
          {{ t('containerManagement.measurementHint') }}
        </p>
        <div class="gap-x-5 gap-y-2 grid grid-cols-1 sm:grid-cols-2">
          <FaFormItem name="grossWeightKg" :label="t('containerManagement.grossWeightLabel')" :rules="rule('grossWeightKg')">
            <FaInput v-model="draft.grossWeightKg" class="w-full" input-class="font-mono tabular-nums" inputmode="decimal" maxlength="19" :placeholder="t('containerManagement.optional')">
              <template #end>
                <span class="qs-type-meta text-muted-foreground">kg</span>
              </template>
            </FaInput>
          </FaFormItem>
          <FaFormItem name="reportedVolumeCai" :label="t('containerManagement.reportedVolumeLabel')" :rules="rule('reportedVolumeCai')">
            <FaInput v-model="draft.reportedVolumeCai" class="w-full" input-class="font-mono tabular-nums" inputmode="decimal" maxlength="25" :placeholder="t('containerManagement.optional')">
              <template #end>
                <span class="qs-type-meta text-muted-foreground">{{ t('containerManagement.volumeUnit') }}</span>
              </template>
            </FaInput>
          </FaFormItem>
          <div class="gap-3 grid grid-cols-3 min-w-0 sm:col-span-2">
            <FaFormItem v-for="field in dimensionFields" :key="field" :name="field" :label="t(`containerManagement.${field}Label`)" :rules="rule(field)">
              <FaInput v-model="draft[field]" class="w-full" input-class="font-mono tabular-nums" inputmode="decimal" maxlength="19" :placeholder="t('containerManagement.blank')">
                <template #end>
                  <span class="qs-type-meta text-muted-foreground">cm</span>
                </template>
              </FaInput>
            </FaFormItem>
          </div>
        </div>
      </section>
      <section :aria-label="t('containerManagement.recipient')" class="pt-5 border-t border-border min-w-0">
        <h3 class="qs-type-component-title m-0 mb-4 flex gap-2 items-center">
          <FaIcon name="i-lucide:map-pin" class="text-muted-foreground size-4" aria-hidden="true" />
          {{ t('containerManagement.recipient') }}
        </h3>
        <div class="gap-x-5 gap-y-2 grid grid-cols-1 sm:grid-cols-2">
          <FaFormItem name="recipientName" :label="t('containerManagement.recipientName')" :rules="rule('recipientName')">
            <FaInput v-model="draft.recipientName" class="w-full" maxlength="128" />
          </FaFormItem>
          <FaFormItem name="recipientPhone" :label="t('containerManagement.recipientPhone')" :rules="rule('recipientPhone')">
            <FaInput v-model="draft.recipientPhone" class="w-full" type="tel" maxlength="128" />
          </FaFormItem>
          <FaFormItem name="recipientAddress" :label="t('containerManagement.recipientAddress')" :rules="rule('recipientAddress')" :auto-bind="false" class="sm:col-span-2">
            <FaTextarea v-model="recipientAddress" :aria-label="t('containerManagement.recipientAddress')" :disabled="locked || retryOnly" :rows="2" maxlength="2000" :placeholder="t('containerManagement.addressHint')" />
          </FaFormItem>
          <div class="min-w-0 sm:col-span-2">
            <FaFormItem name="codAmountTwd" :label="t('containerManagement.codAmountTwd')" :description="t('containerManagement.codHint')" :rules="rule('codAmountTwd')" :auto-bind="false">
              <MoneyInput v-model="codAmount" :aria-label="t('containerManagement.codAmountTwd')" currency="TWD" :currencies="currencies" :currency-selectable="false" :disabled="locked || retryOnly || !currencyReady" min="0" maxlength="31" />
            </FaFormItem>
            <div v-if="currencyError || (!currencyLoading && !currencyReady)" class="qs-type-meta text-destructive mt-2 flex flex-wrap gap-2 items-center" role="alert">
              <span>{{ currencyError || t('containerManagement.currencyUnavailable') }}</span>
              <FaButton type="button" variant="ghost" size="sm" :disabled="locked || retryOnly" @click="reloadCurrencies">
                {{ t('containerManagement.retryCurrency') }}
              </FaButton>
            </div>
            <p v-else-if="currencyLoading" class="qs-type-meta text-muted-foreground m-0 mt-1" role="status">
              {{ t('containerManagement.currencyLoading') }}
            </p>
          </div>
          <FaFormItem name="remark" :label="t('containerManagement.remark')" :rules="rule('remark')" class="sm:col-span-2">
            <FaTextarea v-model="draft.remark" :rows="2" maxlength="500" :placeholder="t('containerManagement.remarkHint')" />
          </FaFormItem>
        </div>
      </section>
    </FaForm>
    <template #footer>
      <FaButton variant="outline" :disabled="locked" class="w-full sm:w-auto" @click="close()">
        {{ t('containerManagement.cancel') }}
      </FaButton>
      <FaButton :loading="locked" :disabled="locked" class="w-full sm:w-auto" @click="retryOnly ? submit() : formRef?.submit()">
        {{ t(retryOnly ? 'containerManagement.retryConfirm' : 'containerManagement.save') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
