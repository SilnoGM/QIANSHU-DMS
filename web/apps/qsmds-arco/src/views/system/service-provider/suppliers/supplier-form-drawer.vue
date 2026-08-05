<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  SupplierDto,
  SupplierFormErrors,
  SupplierFormFieldErrors,
  SupplierFormMode,
  SupplierFormModel,
} from './supplier-management.logic'
import type { QsGenericDrawerCloseReason } from '@/components/business/QsGenericDrawer/logic'
import type { RegionSelectorValue } from '@/components/business/QsRegionSelector/types'

import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import {
  buildCreateSupplierRequest,
  buildUpdateSupplierRequest,
  cloneSupplierFormModel,
  createSupplierFormModel,
  firstSupplierFormErrorField,
  hasSupplierFormChanges,
  resolveSupplierFormFieldErrors,
  validateSupplierForm,
} from './supplier-management.logic'

defineOptions({ name: 'SupplierFormDrawer' })

const props = withDefaults(defineProps<{
  error?: null | string
  fieldErrors?: SupplierFormFieldErrors
  loading?: boolean
  mode: SupplierFormMode
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
  supplier?: null | SupplierDto
}>(), {
  error: null,
  fieldErrors: undefined,
  loading: false,
  requestId: null,
  submitting: false,
  supplier: null,
})

const emit = defineEmits<{
  'closeRequest': [context: {
    dirty: true
    reason: QsGenericDrawerCloseReason
  }]
  'closed': []
  'submit': [submission:
    | {
      mode: 'create'
      value: ReturnType<typeof buildCreateSupplierRequest>
    }
    | {
      mode: 'edit'
      supplierId: string
      value: ReturnType<typeof buildUpdateSupplierRequest>
    }]
  'update:modelValue': [value: boolean]
}>()

const formRef = useTemplateRef<FormExpose<SupplierFormModel>>('formRef')
const form = reactive<SupplierFormModel>(
  createSupplierFormModel(props.mode, props.supplier),
)
const baseline = ref(cloneSupplierFormModel(form))
const localFieldErrors = ref<SupplierFormErrors>({})
const submitRequested = ref(false)
const closeBypass = ref(false)
let initializedForCurrentOpen = false

const ENTITY_TYPE_OPTIONS = [
  { label: '企业/组织', value: 'ORGANIZATION' },
  { label: '个人', value: 'INDIVIDUAL' },
] as const

const title = computed(() => props.mode === 'create'
  ? '新建供应商'
  : '编辑供应商')
const submitLocked = computed(() =>
  props.loading || props.submitting || submitRequested.value)
const dirty = computed(() => props.mode === 'edit' && props.supplier !== null
  ? hasSupplierFormChanges(form, props.supplier)
  : JSON.stringify(form) !== JSON.stringify(baseline.value))
const visibleFieldErrors = computed<SupplierFormErrors>(() => ({
  ...resolveSupplierFormFieldErrors(props.fieldErrors),
  ...localFieldErrors.value,
}))
const visibleError = computed(() => {
  if (typeof props.error === 'string' && props.error.trim() !== '') {
    return props.error
  }
  return Object.keys(visibleFieldErrors.value).length > 0
    ? '部分字段未通过校验，请检查后重试'
    : ''
})
const submitDisabled = computed(() => submitLocked.value
  || (props.mode === 'edit' && !dirty.value)
  || (props.mode === 'edit' && props.supplier === null))

const registrationRegion = computed<RegionSelectorValue>({
  get: () => ({
    countryRegionId: form.registrationCountryRegionId,
    provinceStateId: null,
    cityId: null,
  }),
  set: (value) => {
    // 登记地只消费根级国家/地区；省州和城市属于主要地址，不进入登记契约。
    form.registrationCountryRegionId = value.countryRegionId
  },
})

function replaceForm(next: SupplierFormModel): void {
  Object.assign(form, cloneSupplierFormModel(next))
  form.primaryAddressRegion = { ...next.primaryAddressRegion }
}

async function applyFieldErrors(
  errors: SupplierFormErrors,
  focusFirst: boolean,
): Promise<void> {
  formRef.value?.clearValidate()
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(field, message)
  }
  if (!focusFirst) {
    return
  }
  const firstField = firstSupplierFormErrorField(errors)
  if (firstField === undefined) {
    return
  }
  await nextTick()
  formRef.value?.scrollToField(firstField)
}

async function initialize(): Promise<void> {
  const next = createSupplierFormModel(props.mode, props.supplier)
  replaceForm(next)
  baseline.value = cloneSupplierFormModel(next)
  localFieldErrors.value = {}
  submitRequested.value = false
  closeBypass.value = false
  await nextTick()
  await applyFieldErrors(visibleFieldErrors.value, true)
}

function handleEntityType(value: unknown): void {
  if (value === 'ORGANIZATION' || value === 'INDIVIDUAL') {
    form.entityType = value
  }
}

async function submit(): Promise<void> {
  if (submitDisabled.value) {
    return
  }
  const requireEnableReady = props.mode === 'edit'
    && props.supplier?.enabled === true
  localFieldErrors.value = validateSupplierForm(form, requireEnableReady)
  await applyFieldErrors(visibleFieldErrors.value, true)
  if (Object.keys(localFieldErrors.value).length > 0) {
    return
  }

  submitRequested.value = true
  if (props.mode === 'create') {
    emit('submit', {
      mode: 'create',
      value: buildCreateSupplierRequest(form),
    })
  }
  else if (props.supplier !== null) {
    emit('submit', {
      mode: 'edit',
      supplierId: props.supplier.id,
      value: buildUpdateSupplierRequest(form, props.supplier),
    })
  }
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

async function handleBeforeClose(
  reason: QsGenericDrawerCloseReason,
): Promise<boolean> {
  if (closeBypass.value) {
    closeBypass.value = false
    return true
  }
  if (submitLocked.value) {
    return false
  }
  if (!dirty.value) {
    return true
  }
  emit('closeRequest', { dirty: true, reason })
  return false
}

function requestClose(): void {
  if (!submitLocked.value) {
    emit('update:modelValue', false)
  }
}

function handleClosed(): void {
  initializedForCurrentOpen = false
  localFieldErrors.value = {}
  submitRequested.value = false
  closeBypass.value = false
  formRef.value?.clearValidate()
  emit('closed')
}

function closeWithoutDirtyGuard(): void {
  if (submitLocked.value) {
    return
  }
  closeBypass.value = true
  emit('update:modelValue', false)
}

function closeForAuthorityLoss(): void {
  closeBypass.value = true
  submitRequested.value = false
  replaceForm(createSupplierFormModel('create', null))
  emit('update:modelValue', false)
}

defineExpose({
  closeForAuthorityLoss,
  closeWithoutDirtyGuard,
})

watch(
  () => props.modelValue,
  (visible) => {
    if (visible && !initializedForCurrentOpen) {
      initializedForCurrentOpen = true
      void initialize()
    }
  },
  { immediate: true },
)

watch(
  () => [props.mode, props.supplier] as const,
  () => {
    if (props.modelValue && initializedForCurrentOpen) {
      void initialize()
    }
  },
  { deep: true },
)

watch(
  () => props.fieldErrors,
  () => {
    if (props.modelValue) {
      void applyFieldErrors(visibleFieldErrors.value, true)
    }
  },
  { deep: true },
)

watch(
  () => props.submitting,
  (submitting) => {
    if (!submitting) {
      submitRequested.value = false
    }
  },
)
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="title"
    :description="mode === 'create'
      ? '供应商编号由 SUPPLIER 规则自动生成；新建记录固定为停用草稿。'
      : '供应商编号与创建身份不可修改；保存时使用版本号保护并发更新。'"
    size="xl"
    :before-close="handleBeforeClose"
    :loading="loading"
    :submitting="submitLocked"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="handleClosed"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:building-2" class="size-4" />
    </template>

    <div class="gap-5 grid min-w-0">
      <FaAlert
        v-if="visibleError"
        role="alert"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="保存失败"
      >
        <template #description>
          <div class="gap-2 grid">
            <span>{{ visibleError }}</span>
            <code v-if="requestId" class="qs-type-meta break-all">
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <section class="p-4 border border-border rounded-lg bg-muted/25">
        <div class="flex gap-3 min-w-0 items-start">
          <FaIcon name="i-lucide:badge-info" class="mt-0.5 shrink-0 size-4" />
          <div class="min-w-0">
            <h3 class="qs-type-section m-0">
              {{ mode === 'create' ? '停用草稿' : supplier?.code ?? '供应商资料' }}
            </h3>
            <p class="qs-type-description mb-0 mt-1">
              联系人、登记和地址允许稍后补齐；启用时只要求联系人姓名和电话或微信号。
            </p>
          </div>
        </div>
      </section>

      <FaForm
        ref="formRef"
        :model="form"
        :disabled="submitLocked"
        class="gap-6 grid"
        @submit="submit"
      >
        <fieldset class="m-0 p-0 border-0 gap-4 grid min-w-0">
          <legend class="qs-type-section mb-3">
            主体信息
          </legend>
          <div class="gap-4 grid grid-cols-1 sm:grid-cols-2">
            <FaFormItem name="legalName" label="法定名称" required>
              <FaInput
                v-model="form.legalName"
                autocomplete="organization"
                class="w-full"
                placeholder="请输入营业执照或证件上的名称"
                @clear="form.legalName = ''"
              />
            </FaFormItem>
            <FaFormItem name="shortName" label="简称">
              <FaInput
                v-model="form.shortName"
                autocomplete="off"
                class="w-full"
                placeholder="用于内部快速识别"
                @clear="form.shortName = ''"
              />
            </FaFormItem>
            <FaFormItem name="entityType" label="主体类型" required>
              <FaSelect
                :model-value="form.entityType"
                :options="[...ENTITY_TYPE_OPTIONS]"
                class="w-full"
                @update:model-value="handleEntityType"
              />
            </FaFormItem>
            <div v-if="mode === 'edit'" class="min-w-0">
              <p class="qs-type-compact-label mb-1.5 mt-0">
                Supplier Code
              </p>
              <code class="qs-type-data-emphasis px-3 py-2.5 border border-border rounded-md bg-muted/25 block break-all">
                {{ supplier?.code ?? '—' }}
              </code>
            </div>
          </div>
        </fieldset>

        <fieldset class="m-0 p-0 border-0 gap-4 grid min-w-0">
          <legend class="qs-type-section mb-3">
            登记信息
          </legend>
          <div class="gap-4 grid grid-cols-1 sm:grid-cols-2">
            <FaFormItem
              name="registration.countryRegionId"
              label="登记国家/地区"
              :auto-bind="false"
            >
              <QsRegionSelector
                v-model="registrationRegion"
                class="supplier-registration-region"
                :disabled="submitLocked"
                :error="visibleFieldErrors['registration.countryRegionId'] !== undefined"
              />
            </FaFormItem>
            <FaFormItem name="registration.number" label="登记号">
              <FaInput
                v-model="form.registrationNumber"
                autocomplete="off"
                class="font-mono w-full"
                placeholder="与登记国家/地区同时填写"
                spellcheck="false"
                @clear="form.registrationNumber = ''"
              />
            </FaFormItem>
          </div>
        </fieldset>

        <fieldset class="m-0 p-0 border-0 gap-4 grid min-w-0">
          <legend class="qs-type-section mb-3">
            主要联系人
          </legend>
          <div class="gap-4 grid grid-cols-1 sm:grid-cols-2">
            <FaFormItem name="primaryContact.name" label="联系人姓名">
              <FaInput
                v-model="form.primaryContactName"
                autocomplete="name"
                class="w-full"
                placeholder="启用前必填"
                @clear="form.primaryContactName = ''"
              />
            </FaFormItem>
            <FaFormItem name="primaryContact.phone" label="联系人电话">
              <FaInput
                v-model="form.primaryContactPhone"
                autocomplete="tel"
                class="font-mono w-full"
                inputmode="tel"
                placeholder="电话或微信号至少填写一项"
                @clear="form.primaryContactPhone = ''"
              />
            </FaFormItem>
            <FaFormItem name="primaryContact.wechatId" label="微信号">
              <FaInput
                v-model="form.primaryContactWechatId"
                autocomplete="off"
                class="font-mono w-full"
                placeholder="电话或微信号至少填写一项"
                spellcheck="false"
                @clear="form.primaryContactWechatId = ''"
              />
            </FaFormItem>
          </div>
          <p
            v-if="visibleFieldErrors['primaryContact.channel']"
            class="qs-type-description text-destructive m-0"
            role="alert"
          >
            {{ visibleFieldErrors['primaryContact.channel'] }}
          </p>
        </fieldset>

        <fieldset class="m-0 p-0 border-0 gap-4 grid min-w-0">
          <legend class="qs-type-section mb-3">
            主要地址
          </legend>
          <FaFormItem name="primaryAddress.region" label="国家/地区、省/州、城市" :auto-bind="false">
            <QsRegionSelector
              v-model="form.primaryAddressRegion"
              :disabled="submitLocked"
              :error="visibleFieldErrors['primaryAddress.region'] !== undefined"
            />
          </FaFormItem>
          <div class="gap-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <FaFormItem name="primaryAddress.addressLine" label="详细地址">
              <FaInput
                v-model="form.primaryAddressLine"
                autocomplete="street-address"
                class="w-full"
                placeholder="街道、门牌与楼层等"
                @clear="form.primaryAddressLine = ''"
              />
            </FaFormItem>
            <FaFormItem name="primaryAddress.postalCode" label="邮编（可选）">
              <FaInput
                v-model="form.primaryAddressPostalCode"
                autocomplete="postal-code"
                class="font-mono w-full"
                placeholder="可留空"
                @clear="form.primaryAddressPostalCode = ''"
              />
            </FaFormItem>
          </div>
        </fieldset>

        <FaFormItem name="remark" label="备注">
          <FaTextarea
            v-model="form.remark"
            :rows="4"
            placeholder="记录合作背景或内部说明；不填写敏感凭据"
          />
        </FaFormItem>
      </FaForm>
    </div>

    <template #footer>
      <span v-if="dirty" class="qs-type-meta mr-auto" aria-live="polite">
        有未保存修改
      </span>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitLocked"
        @click="requestClose"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="submitLocked"
        :disabled="submitDisabled"
        @click="submit"
      >
        {{ mode === 'create' ? '创建停用草稿' : '保存修改' }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>

<style scoped>
.supplier-registration-region :deep([data-region-level="COUNTRY_REGION"]) {
  grid-column: 1 / -1;
}

.supplier-registration-region :deep([data-region-level="PROVINCE_STATE"]),
.supplier-registration-region :deep([data-region-level="CITY"]) {
  display: none;
}
</style>
