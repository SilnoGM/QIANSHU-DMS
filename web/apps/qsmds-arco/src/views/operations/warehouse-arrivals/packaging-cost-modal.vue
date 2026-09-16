<script setup lang="ts">
import type { PackagingCostContext, PackagingCostDraft, PackagingCostField, PackagingImageError } from './packaging-cost.logic'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { PACKAGING_DEFAULT_VENDOR, PACKAGING_IMAGE_LIMIT, validatePackagingCost } from './packaging-cost.logic'
import { createPackagingImagePreview } from './packaging-image-preview'

const props = withDefaults(defineProps<{
  modelValue: boolean
  context: PackagingCostContext | null
  loading?: boolean
  error?: string | null
  submitting?: boolean
  submitDisabled?: boolean
  submitDisabledHint?: string | null
}>(), { loading: false, error: null, submitting: false, submitDisabled: false, submitDisabledHint: null })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'reload': []
  'submit': [draft: PackagingCostDraft]
}>()
const { t } = useI18n()
const vendorLabelId = useId()
const { currencies, loading: currencyLoading, errorMessage: currencyError, resolve, reload: reloadCurrencies } = useCurrencyCatalog()
const cny = computed(() => resolve('CNY'))
const currencyReady = computed(() => !currencyLoading.value && !currencyError.value && Boolean(cny.value?.enabled))
const form = useTemplateRef<{ validate: () => Promise<{ valid: boolean }>, setFieldError: (field: string, message: string | undefined) => void }>('form')
const formKey = ref(0)
const validating = ref(false)
const fields = ref(emptyFields())
const imageGroups = ['packagingImages', 'quotationImages'] as const
type ImageGroup = typeof imageGroups[number]
const imageUrls = ref<Record<ImageGroup, string[]>>({ packagingImages: [], quotationImages: [] })
const uploadErrors = ref<Partial<Record<ImageGroup, PackagingImageError>>>({})
const previews = shallowRef(createPreviews())
const vendorOptions = computed(() => [
  { value: 'CHENGXIN', label: PACKAGING_DEFAULT_VENDOR },
  { value: 'OTHER', label: t('warehousePackagingCost.otherVendor') },
])
const details = computed(() => ['shipmentNo', 'shippingMarkText', 'purchaseOrderNo', 'salesOrderNo'].map(key => ({
  key,
  value: props.context?.[key as keyof PackagingCostContext] || t(key === 'salesOrderNo' ? 'warehousePackagingCost.noSalesSource' : 'warehousePackagingCost.notRecorded'),
})))
// FaForm 会同步其 model；传入独立快照，避免字段注册或卸载改写图片会话及业务草稿。
const formModel = computed(() => ({ ...fields.value, packagingImages: [...imageUrls.value.packagingImages], quotationImages: [...imageUrls.value.quotationImages] }))
const validation = computed(() => validatePackagingCost({
  ...fields.value,
  packagingImages: previews.value.packagingImages.files(imageUrls.value.packagingImages),
  quotationImages: previews.value.quotationImages.files(imageUrls.value.quotationImages),
}, cny.value?.minorUnit ?? 2))
const rules = Object.fromEntries(['packagingTypeValue', 'vendor', 'customVendorName', 'amount', ...imageGroups, 'remark'].map(field => [field, () => {
  const error = uploadErrors.value[field as ImageGroup] ?? validation.value.errors[field as PackagingCostField]
  return error ? t(`warehousePackagingCost.errors.${error}`) : true
}]))

function emptyFields() {
  return { packagingTypeValue: null as string | null, vendor: null as string | null, customVendorName: '', amount: null as string | null, remark: '' }
}

function createPreviews() {
  return Object.fromEntries(imageGroups.map(group => [group, createPackagingImagePreview({
    createObjectURL: file => URL.createObjectURL(file),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    onError: (error) => {
      uploadErrors.value[group] = error ?? undefined
      form.value?.setFieldError(group, error ? t(`warehousePackagingCost.errors.${error}`) : undefined)
    },
  })])) as Record<ImageGroup, ReturnType<typeof createPackagingImagePreview>>
}

function releasePreviews() {
  imageGroups.forEach(group => previews.value[group].dispose())
}

function resetDraft() {
  releasePreviews()
  fields.value = emptyFields()
  imageUrls.value = { packagingImages: [], quotationImages: [] }
  uploadErrors.value = {}
  previews.value = createPreviews()
  // 更换实例隔离 FaImageUpload 在 await afterUpload 后的旧 model 写入。
  formKey.value += 1
  validating.value = false
}

function updateVendor(value: unknown) {
  fields.value.vendor = value === 'CHENGXIN' || value === 'OTHER' ? value : null
}

async function submit() {
  if (validating.value || props.submitting || props.submitDisabled || props.loading || props.error || !props.modelValue || !props.context) {
    return
  }
  const key = formKey.value
  validating.value = true
  try {
    const result = await form.value?.validate()
    if (key !== formKey.value || !props.modelValue || !props.context || props.loading || props.error || props.submitDisabled || props.submitting || !result?.valid || !currencyReady.value) {
      return
    }
    const draft = validation.value.draft
    if (draft) {
      emit('submit', draft)
    }
  }
  finally {
    if (key === formKey.value) {
      validating.value = false
    }
  }
}

// 图片控件排序会先 splice 再赋值，需等完整交换结束再释放移除项，不能消费重复 URL 的中间态。
watch(imageUrls, value => imageGroups.forEach(group => previews.value[group].sync(value[group])), { deep: true, flush: 'post' })
watch(() => [props.modelValue, props.context?.shipmentId], resetDraft, { flush: 'sync' })
onBeforeUnmount(releasePreviews)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('warehousePackagingCost.title')"
    size="xl"
    :loading="loading"
    :error="error"
    :submitting="submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #error-actions>
      <FaButton type="button" variant="outline" @click="emit('reload')">
        {{ t('warehousePackagingCost.retry') }}
      </FaButton>
    </template>
    <div v-if="context" class="space-y-5">
      <dl class="p-4 border border-border rounded-lg bg-muted/25 gap-x-6 gap-y-3 grid sm:grid-cols-2">
        <div v-for="detail in details" :key="detail.key" class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t(`warehousePackagingCost.${detail.key}`) }}
          </dt>
          <dd class="qs-type-data-emphasis mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ detail.value }}
          </dd>
        </div>
      </dl>
      <FaForm ref="form" :key="formKey" :model="formModel" :disabled="submitting" @submit="submit">
        <div class="gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <FaFormItem name="packagingTypeValue" :label="t('warehousePackagingCost.packagingType')" :rules="rules.packagingTypeValue" :auto-bind="false" required>
            <QsDictionarySelect v-model="fields.packagingTypeValue" dictionary-code="warehouse.packaging_type" :disabled="submitting" :placeholder="t('warehousePackagingCost.selectPackagingType')" />
          </FaFormItem>
          <FaFormItem name="vendor" :label="t('warehousePackagingCost.vendor')" :rules="rules.vendor" :auto-bind="false" required>
            <template #label>
              <span :id="vendorLabelId">{{ t('warehousePackagingCost.vendor') }}</span>
              <span class="text-destructive" aria-hidden="true">*</span>
            </template>
            <FaCombobox :model-value="fields.vendor ?? undefined" :options="vendorOptions" :disabled="submitting" :placeholder="t('warehousePackagingCost.selectVendor')" :input-attrs="{ 'aria-labelledby': vendorLabelId, 'aria-required': true }" class="w-full" @update:model-value="updateVendor" />
          </FaFormItem>
          <FaFormItem v-if="fields.vendor === 'OTHER'" name="customVendorName" :label="t('warehousePackagingCost.customVendorName')" :rules="rules.customVendorName" :auto-bind="false" class="sm:col-span-2" required>
            <FaInput v-model="fields.customVendorName" :disabled="submitting" :placeholder="t('warehousePackagingCost.enterVendorName')" class="w-full" />
          </FaFormItem>
          <FaFormItem name="amount" :label="t('warehousePackagingCost.amount')" :rules="rules.amount" :auto-bind="false" required>
            <MoneyInput v-model="fields.amount" currency="CNY" :currencies="currencies" :currency-selectable="false" :disabled="submitting || !currencyReady" min="0.01" />
          </FaFormItem>
          <div class="min-w-0">
            <p class="text-sm font-medium px-1">
              {{ t('warehousePackagingCost.owner') }}
            </p>
            <p class="qs-type-body-medium mt-2 flex min-h-9 break-all items-center">
              {{ context.ownerName || t('warehousePackagingCost.notRecorded') }}
            </p>
            <p class="qs-type-meta text-muted-foreground mt-1">
              {{ t('warehousePackagingCost.ownerDescription') }}
            </p>
          </div>
          <p v-if="currencyLoading" role="status" class="qs-type-meta text-muted-foreground sm:col-span-2">
            {{ t('warehousePackagingCost.currencyLoading') }}
          </p>
          <FaAlert v-else-if="!currencyReady" :title="t('warehousePackagingCost.currencyUnavailable')" variant="destructive" class="sm:col-span-2">
            <template #description>
              <FaButton type="button" variant="outline" size="sm" :disabled="submitting" @click="reloadCurrencies">
                {{ t('warehousePackagingCost.retry') }}
              </FaButton>
            </template>
          </FaAlert>
          <FaFormItem v-for="group in imageGroups" :key="group" :name="group" :label="t(`warehousePackagingCost.${group}`)" :rules="rules[group]" :description="t('warehousePackagingCost.imageHint')" :auto-bind="false" required>
            <FaImageUpload
              v-model="imageUrls[group]"
              :disabled="submitting"
              :max="PACKAGING_IMAGE_LIMIT"
              :width="88"
              :height="88"
              :before-upload="previews[group].beforeUpload"
              :http-request="previews[group].httpRequest"
              :after-upload="previews[group].afterUpload"
              multiple
            >
              <span class="text-muted-foreground border-2 border-border rounded-lg border-dashed flex flex-col gap-1 size-full items-center justify-center">
                <FaIcon name="i-icon-park-outline:upload" class="size-6" aria-hidden="true" />
                <span class="text-xs">{{ t('warehousePackagingCost.addImage') }}</span>
              </span>
            </FaImageUpload>
          </FaFormItem>
          <FaFormItem name="remark" :label="t('warehousePackagingCost.remark')" :rules="rules.remark" :auto-bind="false" class="sm:col-span-2">
            <FaTextarea v-model="fields.remark" :disabled="submitting" :rows="3" :maxlength="500" :placeholder="t('warehousePackagingCost.remarkPlaceholder')" />
            <p class="qs-type-meta text-muted-foreground text-end">
              {{ fields.remark.length }}/500
            </p>
          </FaFormItem>
        </div>
      </FaForm>
    </div>
    <template #footer>
      <div class="flex flex-col gap-3 w-full">
        <p v-if="submitDisabledHint" role="status" class="qs-type-meta text-muted-foreground">
          {{ submitDisabledHint }}
        </p>
        <div class="flex gap-2 justify-end">
          <FaButton type="button" variant="outline" :disabled="submitting" @click="emit('update:modelValue', false)">
            {{ t('warehousePackagingCost.cancel') }}
          </FaButton>
          <FaButton type="button" :disabled="submitDisabled || loading || Boolean(error) || !context || !currencyReady" :loading="submitting || validating" @click="submit">
            {{ t('warehousePackagingCost.submit') }}
          </FaButton>
        </div>
      </div>
    </template>
  </QsGenericModal>
</template>
