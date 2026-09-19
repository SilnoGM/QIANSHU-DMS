<script setup lang="ts">
import type { LoadingItemDraft, LoadingItemSubmission } from './form.logic'
import type { ContainerLoadingItemDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
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
const formRef = useTemplateRef<{ submit: () => Promise<void>, setFieldError: (name: string, message?: string) => void }>('formRef')
const requested = ref(false)
const locked = computed(() => props.submitting || requested.value)
const shipmentLabel = computed(() => resolveShipmentDisplay(draft.value.shipmentId, props.shipment, props.item))
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
const dimensionFields = ['grossWeightKg', 'lengthCm', 'widthCm', 'heightCm'] as const
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
  <QsGenericModal :model-value="modelValue" :title="t(item ? 'containerManagement.editItem' : 'containerManagement.addItem')" :description="t('containerManagement.itemDescription')" size="lg" :submitting="locked" @update:model-value="close">
    <template #header-leading>
      <FaIcon name="i-lucide:package-plus" class="text-primary size-5" />
    </template>
    <FaAlert v-if="error" variant="destructive" :title="t('containerManagement.saveFailed')" :description="error" class="mb-5" role="alert" />
    <FaAlert v-if="retryOnly" :title="t('containerManagement.retryHint')" class="mb-5" />
    <FaForm ref="formRef" :model="draft" :disabled="locked || retryOnly" scroll-to-error class="gap-x-5 gap-y-4 grid-cols-1 sm:grid-cols-2" @submit="submit">
      <section class="p-3 border border-border rounded-lg bg-muted/25 sm:col-span-2" :aria-label="t('containerManagement.shipment')">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium">
              {{ t('containerManagement.shipment') }}
            </p>
            <p class="text-sm text-muted-foreground mt-1 break-all">
              {{ shipmentLabel || t(draft.shipmentId ? 'containerManagement.linkedShipment' : 'containerManagement.noShipment') }}
            </p>
          </div>
          <div class="flex gap-2">
            <FaButton type="button" variant="outline" :disabled="locked || retryOnly" @click="emit('selectShipment')">
              {{ t('containerManagement.selectShipment') }}
            </FaButton>
            <FaButton v-if="draft.shipmentId" type="button" variant="ghost" :disabled="locked || retryOnly" @click="draft.shipmentId = null">
              {{ t('containerManagement.clear') }}
            </FaButton>
          </div>
        </div>
        <p v-if="fieldErrors.shipmentId" class="text-sm text-destructive mt-2" role="alert">
          {{ fieldErrors.shipmentId }}
        </p>
        <slot name="shipment-picker" />
      </section>
      <FaFormItem name="goodsName" :label="t('containerManagement.goodsName')" :rules="rule('goodsName')" class="sm:col-span-2" required>
        <FaInput v-model="draft.goodsName" class="w-full" maxlength="255" />
      </FaFormItem>
      <FaFormItem name="packageCount" :label="t('containerManagement.packageCount')" :rules="rule('packageCount')" required>
        <FaInput v-model="draft.packageCount" class="w-full" inputmode="numeric" maxlength="7" />
      </FaFormItem>
      <FaFormItem name="packageUnit" :label="t('containerManagement.packageUnit')" :rules="rule('packageUnit')">
        <FaInput v-model="draft.packageUnit" class="w-full" maxlength="32" :placeholder="t('containerManagement.packageUnitHint')" />
      </FaFormItem>
      <FaFormItem v-for="field in textFields" :key="field.key" :name="field.key" :label="t(`containerManagement.${field.key}`)" :rules="rule(field.key)">
        <FaInput v-model="draft[field.key]" class="w-full" :maxlength="field.limit" />
      </FaFormItem>
      <div class="pt-2 border-t border-border sm:col-span-2">
        <h3 class="text-sm font-semibold">
          {{ t('containerManagement.measurements') }}
        </h3>
        <p class="text-xs text-muted-foreground mt-1">
          {{ t('containerManagement.measurementHint') }}
        </p>
      </div>
      <FaFormItem v-for="field in dimensionFields" :key="field" :name="field" :label="t(`containerManagement.${field}`)" :rules="rule(field)">
        <FaInput v-model="draft[field]" class="w-full" inputmode="decimal" maxlength="19" :placeholder="t('containerManagement.optional')" />
      </FaFormItem>
      <FaFormItem name="reportedVolumeCai" :label="t('containerManagement.reportedVolumeCai')" :rules="rule('reportedVolumeCai')" class="sm:col-span-2">
        <FaInput v-model="draft.reportedVolumeCai" class="w-full" inputmode="decimal" maxlength="25" :placeholder="t('containerManagement.optional')" />
      </FaFormItem>
      <h3 class="text-sm font-semibold pt-2 border-t border-border sm:col-span-2">
        {{ t('containerManagement.recipient') }}
      </h3>
      <FaFormItem name="recipientName" :label="t('containerManagement.recipientName')" :rules="rule('recipientName')">
        <FaInput v-model="draft.recipientName" class="w-full" maxlength="128" />
      </FaFormItem>
      <FaFormItem name="recipientPhone" :label="t('containerManagement.recipientPhone')" :rules="rule('recipientPhone')">
        <FaInput v-model="draft.recipientPhone" class="w-full" maxlength="128" />
      </FaFormItem>
      <FaFormItem name="recipientAddress" :label="t('containerManagement.recipientAddress')" :rules="rule('recipientAddress')" class="sm:col-span-2">
        <FaInput v-model="draft.recipientAddress" class="w-full" maxlength="2000" />
      </FaFormItem>
      <FaFormItem name="codAmountTwd" :label="t('containerManagement.codAmountTwd')" :description="t('containerManagement.codHint')" :rules="rule('codAmountTwd')" class="sm:col-span-2">
        <FaInput v-model="draft.codAmountTwd" class="w-full" inputmode="decimal" maxlength="31" />
      </FaFormItem>
      <FaFormItem name="remark" :label="t('containerManagement.remark')" :rules="rule('remark')" class="sm:col-span-2">
        <FaTextarea v-model="draft.remark" :rows="2" maxlength="500" />
      </FaFormItem>
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
