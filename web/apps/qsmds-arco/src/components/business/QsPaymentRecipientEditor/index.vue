<script setup lang="ts">
import type { PaymentRecipientAccountInputDto, PaymentRecipientMethod } from '@/api/modules/payment-recipients'
import { PAYMENT_RECIPIENT_METHODS } from './logic'
import QrImageUpload from './QrImageUpload.vue'

const props = withDefaults(defineProps<{ disabled?: boolean, minimum?: 0 | 1, methods?: readonly PaymentRecipientMethod[], compact?: boolean }>(), { disabled: false, minimum: 0, methods: () => [...PAYMENT_RECIPIENT_METHODS], compact: false })
const emit = defineEmits<{ busyChange: [value: boolean] }>()
const accounts = defineModel<PaymentRecipientAccountInputDto[]>({ required: true })
const { t } = useI18n()
const instanceId = useId()
const uploading = ref<Partial<Record<PaymentRecipientMethod, boolean>>>({})
const busy = computed(() => Object.values(uploading.value).some(Boolean))
const locked = computed(() => props.disabled || busy.value)
const sections = computed(() => props.methods.map(method => ({ method, account: accounts.value.find(item => item.paymentMethod === method) })))
function toggle(method: PaymentRecipientMethod, enabled: boolean) {
  if (locked.value || !props.methods.includes(method) || enabled === accounts.value.some(item => item.paymentMethod === method)) {
    return
  }
  accounts.value = enabled
    ? [...accounts.value, { paymentMethod: method, recipientName: '' }]
    : accounts.value.filter(item => item.paymentMethod !== method)
}
function update(method: PaymentRecipientMethod, patch: Partial<PaymentRecipientAccountInputDto>, uploaded = false) {
  if (props.disabled && !uploaded) {
    return
  }
  accounts.value = accounts.value.map(item => item.paymentMethod === method ? { ...item, ...patch } : item)
}
watch(busy, value => emit('busyChange', value))
onBeforeUnmount(() => emit('busyChange', false))
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-muted-foreground">
      {{ t(minimum ? 'paymentRecipient.minimumHint' : 'paymentRecipient.optionalHint') }}
    </p>
    <section v-for="section in sections" :key="section.method" class="border border-border rounded-lg overflow-hidden" :aria-labelledby="`${instanceId}-${section.method}`">
      <div class="px-4 py-3 bg-muted/25 flex gap-3 items-center justify-between">
        <h3 :id="`${instanceId}-${section.method}`" class="text-sm font-medium m-0">
          {{ t(`paymentRecipient.methods.${section.method}`) }}
        </h3>
        <FaSwitch :model-value="Boolean(section.account)" :disabled="locked" :aria-labelledby="`${instanceId}-${section.method}`" @update:model-value="toggle(section.method, Boolean($event))" />
      </div>
      <div v-if="section.account" class="p-4 gap-4 grid" :class="compact && section.method !== 'BANK_TRANSFER' ? 'sm:grid-cols-[minmax(0,1fr)_auto]' : 'sm:grid-cols-2'">
        <label class="text-sm flex flex-col gap-2 min-w-0" :class="{ 'sm:col-span-2': !compact && section.method !== 'BANK_TRANSFER' }">
          <span>{{ t(section.method === 'BANK_TRANSFER' ? 'paymentRecipient.accountName' : 'paymentRecipient.recipientName') }} <span class="text-destructive" aria-hidden="true">*</span></span>
          <FaInput class="w-full" :model-value="section.account.recipientName" :maxlength="128" :disabled="locked" aria-required="true" autocomplete="off" @update:model-value="update(section.method, { recipientName: String($event) })" />
        </label>
        <template v-if="section.method === 'BANK_TRANSFER'">
          <label class="text-sm flex flex-col gap-2">
            <span>{{ t('paymentRecipient.bankName') }} <span class="text-destructive" aria-hidden="true">*</span></span>
            <FaInput class="w-full" :model-value="section.account.bankName ?? ''" :maxlength="128" :disabled="locked" aria-required="true" autocomplete="off" @update:model-value="update(section.method, { bankName: String($event) })" />
          </label>
          <label class="text-sm flex flex-col gap-2 sm:col-span-2">
            <span>{{ t('paymentRecipient.bankAccount') }} <span class="text-destructive" aria-hidden="true">*</span></span>
            <FaInput :model-value="section.account.bankAccount ?? ''" :maxlength="128" :disabled="locked" class="qs-type-data w-full" aria-required="true" autocomplete="off" @update:model-value="update(section.method, { bankAccount: String($event) })" />
          </label>
          <label class="text-sm flex flex-col gap-2 sm:col-span-2">
            <span>{{ t('paymentRecipient.bankBranch') }} <span class="text-muted-foreground">{{ t('paymentRecipient.optional') }}</span></span>
            <FaInput class="w-full" :model-value="section.account.bankBranch ?? ''" :maxlength="128" :disabled="locked" autocomplete="off" @update:model-value="update(section.method, { bankBranch: String($event) })" />
          </label>
        </template>
        <div v-else class="space-y-2" :class="{ 'sm:col-span-2': !compact }">
          <p class="text-sm">
            {{ t('paymentRecipient.qrCode') }} <span class="text-destructive" aria-hidden="true">*</span>
          </p>
          <QrImageUpload :media-asset-id="section.account.qrMediaAssetId" :compact="compact" :disabled="disabled || (busy && !uploading[section.method])" @update:media-asset-id="update(section.method, { qrMediaAssetId: $event }, true)" @busy-change="uploading[section.method] = $event" />
        </div>
      </div>
    </section>
  </div>
</template>
