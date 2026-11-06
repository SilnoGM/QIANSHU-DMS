<script setup lang="ts">
import type { CreateMachineViewingDto } from '@/api/generated/types.gen'
import type { MachineViewingDraft, MachineViewingField } from '@/utils/machine-viewing-schedule'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  createMachineViewingDraft,
  MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH,
  MACHINE_VIEWING_HOURS,
  MACHINE_VIEWING_MACHINE_TYPE_OPTIONS,
  MACHINE_VIEWING_PERIOD_OPTIONS,
  MACHINE_VIEWING_SITE_OPTIONS,
  previewMachineViewingTime,
  toMachineViewingCreatePayload,
  validateMachineViewingDraft,
  viewingDayOptions,
} from '@/utils/machine-viewing-schedule'
import { serverNowEpochMs } from '@/utils/server-clock'

const props = withDefaults(defineProps<{
  modelValue: boolean
  submitting?: boolean
  error?: string | null
  fieldErrors?: Readonly<Record<string, string>>
}>(), { submitting: false, error: null, fieldErrors: () => ({}) })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': [data: CreateMachineViewingDto]
}>()

const { t } = useI18n()
const account = useAppAccountStore()
const formRef = useTemplateRef<{
  setFieldError: (name: string, message?: string) => void
  clearValidate: () => void
}>('formRef')
const draft = ref<MachineViewingDraft>(createMachineViewingDraft(null, serverNowEpochMs()))
const requested = ref(false)
const locked = computed(() => props.submitting || requested.value)

const siteOptions = computed(() => MACHINE_VIEWING_SITE_OPTIONS.map(value => ({
  value,
  label: t(`machineViewing.site.${value}`),
})))
const machineTypeOptions = computed(() => MACHINE_VIEWING_MACHINE_TYPE_OPTIONS.map(value => ({
  value,
  label: t(`machineViewing.machineType.${value}`),
})))
const periodOptions = computed(() => MACHINE_VIEWING_PERIOD_OPTIONS.map(value => ({
  value,
  label: t(`machineViewing.period.${value}`),
})))
const monthOptions = computed(() => Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: t('machineViewing.form.monthOption', { month: index + 1 }),
})))
const dayOptions = computed(() => {
  const month = draft.value.month
  if (month === null) {
    return []
  }
  return viewingDayOptions(month, serverNowEpochMs()).map(day => ({
    value: String(day),
    label: t('machineViewing.form.dayOption', { day }),
  }))
})
const hourOptions = computed(() => [
  { value: 'none', label: t('machineViewing.form.hourUnspecified') },
  ...MACHINE_VIEWING_HOURS.map(hour => ({
    value: String(hour),
    label: t('machineViewing.form.hourOption', { hour }),
  })),
])
const preview = computed(() => previewMachineViewingTime(t, draft.value))

const siteValue = computed({
  get: () => draft.value.site,
  set: (value: string) => {
    draft.value.site = value as MachineViewingDraft['site']
  },
})
const machineTypeValue = computed({
  get: () => draft.value.machineType,
  set: (value: string) => {
    draft.value.machineType = value as MachineViewingDraft['machineType']
  },
})
const periodValue = computed({
  get: () => draft.value.period,
  set: (value: string) => {
    draft.value.period = value as MachineViewingDraft['period']
  },
})
const monthValue = computed({
  get: () => (draft.value.month === null ? '' : String(draft.value.month)),
  set: (value: string) => {
    draft.value.month = value === '' ? null : Number(value)
  },
})
const dayValue = computed({
  get: () => (draft.value.day === null ? '' : String(draft.value.day)),
  set: (value: string) => {
    draft.value.day = value === '' ? null : Number(value)
  },
})
const hourValue = computed({
  get: () => (draft.value.hour === null ? 'none' : String(draft.value.hour)),
  set: (value: string) => {
    draft.value.hour = value === 'none' || value === '' ? null : Number(value)
  },
})

// 换月后原来的「日」可能超出当月天数（例如 31 日切到 4 月），回落到该月最后一天。
watch(() => draft.value.month, (month) => {
  if (month === null || draft.value.day === null) {
    return
  }
  const max = viewingDayOptions(month, serverNowEpochMs()).length
  if (draft.value.day > max) {
    draft.value.day = max
  }
})

function rule(field: MachineViewingField) {
  return (value: unknown) => {
    // FaForm 可能在父 model 同步前校验文本控件，这里以控件值为准。
    const current = { ...draft.value }
    if (typeof value === 'string'
      && (field === 'customerName' || field === 'customerPhone' || field === 'contactPerson')) {
      current[field] = value
    }
    const key = validateMachineViewingDraft(current, serverNowEpochMs())[field]
    return key ? t(key) : true
  }
}

watch(() => props.modelValue, async (open) => {
  if (!open) {
    requested.value = false
    return
  }
  requested.value = false
  let issuerPrefix = account.profile?.issuerPrefix ?? null
  if (account.profile === null && account.profileState !== 'loading') {
    const profile = await account.loadProfile().catch(() => null)
    if (!props.modelValue) {
      return
    }
    issuerPrefix = profile?.issuerPrefix ?? null
  }
  draft.value = createMachineViewingDraft(issuerPrefix, serverNowEpochMs())
  await nextTick()
  formRef.value?.clearValidate()
}, { immediate: true })

watch(() => props.submitting, (value) => {
  if (!value) {
    requested.value = false
  }
})

// 服务端字段名与表单字段名不同（月/日/时段/小时都落在「预约时间」上），统一收敛。
const SERVER_FIELD_MAP: Readonly<Record<string, string>> = {
  site: 'site',
  machineType: 'machineType',
  appointmentMonth: 'appointmentTime',
  appointmentDay: 'appointmentTime',
  period: 'appointmentTime',
  hour: 'appointmentTime',
  customerName: 'customerName',
  customerPhone: 'customerPhone',
  contactPerson: 'contactPerson',
}
watch(() => props.fieldErrors, (errors) => {
  formRef.value?.clearValidate()
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(SERVER_FIELD_MAP[field] ?? field, message)
  }
}, { deep: true })

function close(value = false): void {
  if (!locked.value) {
    emit('update:modelValue', value)
  }
}

function submit(): void {
  if (locked.value) {
    return
  }
  const errors = validateMachineViewingDraft(draft.value, serverNowEpochMs())
  const entries = Object.entries(errors)
  if (entries.length > 0) {
    formRef.value?.clearValidate()
    for (const [field, key] of entries) {
      formRef.value?.setFieldError(field, t(key))
    }
    return
  }
  requested.value = true
  emit('submit', toMachineViewingCreatePayload(draft.value))
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('machineViewing.form.title')"
    size="lg"
    :submitting="locked"
    @update:model-value="close"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:calendar-check" class="text-primary size-5" />
    </template>
    <FaAlert
      v-if="error"
      variant="destructive"
      :title="t('machineViewing.saveFailed')"
      :description="error"
      class="mb-5"
      role="alert"
    />
    <FaForm ref="formRef" :model="draft" :disabled="locked" scroll-to-error class="gap-3" @submit="submit">
      <div class="gap-3 grid grid-cols-1 sm:grid-cols-2">
        <FaFormItem name="site" :label="t('machineViewing.form.site')" :rules="rule('site')" required>
          <FaSelect
            v-model="siteValue"
            :options="siteOptions"
            :disabled="locked"
            :placeholder="t('machineViewing.form.sitePlaceholder')"
            class="w-full"
          />
        </FaFormItem>
        <FaFormItem name="machineType" :label="t('machineViewing.form.machineType')" :rules="rule('machineType')" required>
          <FaSelect
            v-model="machineTypeValue"
            :options="machineTypeOptions"
            :disabled="locked"
            :placeholder="t('machineViewing.form.machineTypePlaceholder')"
            class="w-full"
          />
        </FaFormItem>
      </div>

      <FaFormItem
        name="appointmentTime"
        :label="t('machineViewing.form.appointmentTime')"
        :rules="rule('appointmentTime')"
        :auto-bind="false"
        required
      >
        <div class="min-w-0 space-y-2">
          <div class="gap-2 grid grid-cols-2 sm:grid-cols-4">
            <FaSelect
              v-model="monthValue"
              :options="monthOptions"
              :disabled="locked"
              :placeholder="t('machineViewing.form.monthPlaceholder')"
              :aria-label="t('machineViewing.form.monthPlaceholder')"
              class="min-w-0 w-full"
            />
            <FaSelect
              v-model="dayValue"
              :options="dayOptions"
              :disabled="locked"
              :placeholder="t('machineViewing.form.dayPlaceholder')"
              :aria-label="t('machineViewing.form.dayPlaceholder')"
              class="min-w-0 w-full"
            />
            <FaSelect
              v-model="periodValue"
              :options="periodOptions"
              :disabled="locked"
              :placeholder="t('machineViewing.form.periodPlaceholder')"
              :aria-label="t('machineViewing.form.periodPlaceholder')"
              class="min-w-0 w-full"
            />
            <FaSelect
              v-model="hourValue"
              :options="hourOptions"
              :disabled="locked"
              :aria-label="t('machineViewing.form.hourPlaceholder')"
              class="min-w-0 w-full"
            />
          </div>
          <div
            class="px-3 py-2.5 rounded-md bg-muted/40 flex gap-3 items-center justify-between"
            aria-live="polite"
            aria-atomic="true"
          >
            <span class="qs-type-meta text-muted-foreground flex gap-2 items-center">
              <FaIcon name="i-lucide:calendar-days" class="size-4" aria-hidden="true" />
              {{ t('machineViewing.form.previewLabel') }}
            </span>
            <span class="qs-type-data-emphasis">{{ preview || '—' }}</span>
          </div>
        </div>
      </FaFormItem>

      <div class="gap-3 grid grid-cols-1 sm:grid-cols-2">
        <FaFormItem name="customerName" :label="t('machineViewing.form.customerName')" :rules="rule('customerName')" required>
          <FaInput
            v-model="draft.customerName"
            class="w-full"
            :maxlength="MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH"
            :placeholder="t('machineViewing.form.customerNamePlaceholder')"
          />
        </FaFormItem>
        <FaFormItem name="customerPhone" :label="t('machineViewing.form.customerPhone')" :rules="rule('customerPhone')">
          <FaInput
            v-model="draft.customerPhone"
            class="w-full"
            :maxlength="MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH"
            :placeholder="t('machineViewing.form.customerPhonePlaceholder')"
          />
        </FaFormItem>
      </div>

      <FaFormItem
        name="contactPerson"
        :label="t('machineViewing.form.contactPerson')"
        :description="t('machineViewing.form.contactPersonHint')"
        :rules="rule('contactPerson')"
        required
      >
        <FaInput
          v-model="draft.contactPerson"
          class="w-full"
          :maxlength="MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH"
          :placeholder="t('machineViewing.form.contactPersonPlaceholder')"
        />
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton variant="outline" :disabled="locked" class="w-full sm:w-auto" @click="close()">
        {{ t('machineViewing.form.cancel') }}
      </FaButton>
      <FaButton :loading="locked" :disabled="locked" class="w-full sm:w-auto" @click="submit">
        {{ t('machineViewing.form.submit') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
