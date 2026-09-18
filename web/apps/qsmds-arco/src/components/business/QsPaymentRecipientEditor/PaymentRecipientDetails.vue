<script setup lang="ts">
import type { PaymentRecipientAccountInputDto } from '@/api/modules/payment-recipients'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import RecipientImage from './RecipientImage.vue'

const props = defineProps<{ account: PaymentRecipientAccountInputDto }>()
const { t } = useI18n()
const rows = computed(() => [
  { key: 'accountName', value: props.account.recipientName },
  { key: 'bankName', value: props.account.bankName },
  { key: 'bankAccount', value: props.account.bankAccount },
  { key: 'bankBranch', value: props.account.bankBranch },
].filter(row => row.value))
const bankText = computed(() => rows.value.map(row => `${t(`paymentRecipient.${row.key}`)}：${row.value}`).join('\n'))
</script>

<template>
  <div class="min-w-0 space-y-4">
    <template v-if="account.paymentMethod === 'BANK_TRANSFER'">
      <dl class="space-y-4">
        <div v-for="row in rows" :key="row.key" class="space-y-1">
          <dt class="text-sm text-muted-foreground">
            {{ t(`paymentRecipient.${row.key}`) }}
          </dt>
          <dd class="m-0 flex gap-2 min-w-0 items-center justify-between">
            <span class="[overflow-wrap:anywhere]" :class="{ 'qs-type-data-emphasis': row.key === 'bankAccount' }">{{ row.value }}</span>
            <CopyCellButton :text="row.value!" :label="t(`paymentRecipient.${row.key}`)" always-visible />
          </dd>
        </div>
      </dl>
      <div class="text-sm pt-3 border-t border-border flex items-center justify-between">
        <span>{{ t('paymentRecipient.copyBank') }}</span>
        <CopyCellButton :text="bankText" :label="t('paymentRecipient.bankDetails')" always-visible />
      </div>
    </template>
    <template v-else>
      <dl>
        <dt class="text-sm text-muted-foreground">
          {{ t('paymentRecipient.recipientName') }}
        </dt>
        <dd class="font-medium m-0 mt-1 [overflow-wrap:anywhere]">
          {{ account.recipientName }}
        </dd>
      </dl>
      <RecipientImage v-if="account.qrMediaAssetId" :media-asset-id="account.qrMediaAssetId" />
    </template>
  </div>
</template>
