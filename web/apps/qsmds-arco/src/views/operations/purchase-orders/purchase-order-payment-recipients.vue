<script setup lang="ts">
import type { PaymentRecipientAccountInputDto } from '@/api/modules/payment-recipients'
import PaymentRecipientDetails from '@/components/business/QsPaymentRecipientEditor/PaymentRecipientDetails.vue'

defineProps<{ accounts: readonly PaymentRecipientAccountInputDto[] }>()
const { t } = useI18n()
</script>

<template>
  <section class="mt-5 pt-5 border-t border-border min-w-0 space-y-4" :aria-label="t('purchasePayment.recipientInformation')">
    <h3 class="qs-type-component-title m-0">
      {{ t('purchasePayment.recipientInformation') }}
    </h3>
    <p v-if="!accounts.length" class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchasePayment.noRecipient') }}
    </p>
    <div v-else class="gap-4 grid sm:grid-cols-2">
      <div v-for="recipient in accounts" :key="recipient.paymentMethod" class="p-4 border border-border rounded-lg min-w-0 space-y-3">
        <h4 class="qs-type-body-medium m-0">
          {{ t(`purchasePayment.methods.${recipient.paymentMethod}`) }}
        </h4>
        <PaymentRecipientDetails :account="recipient" />
      </div>
    </div>
  </section>
</template>
