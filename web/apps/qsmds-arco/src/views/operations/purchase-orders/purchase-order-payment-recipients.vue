<script setup lang="ts">
import type { PaymentRecipientAccountInputDto } from '@/api/modules/payment-recipients'
import PaymentRecipientDetails from '@/components/business/QsPaymentRecipientEditor/PaymentRecipientDetails.vue'
import RecipientImage from '@/components/business/QsPaymentRecipientEditor/RecipientImage.vue'

defineProps<{ accounts: readonly PaymentRecipientAccountInputDto[] }>()
const { t } = useI18n()
</script>

<template>
  <section class="mt-4 pt-4 border-t border-border min-w-0 space-y-3" :aria-label="t('purchasePayment.recipientInformation')">
    <h3 class="qs-type-component-title m-0">
      {{ t('purchasePayment.recipientInformation') }}
    </h3>
    <p v-if="!accounts.length" class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchasePayment.noRecipient') }}
    </p>
    <div v-else class="gap-3 grid items-start sm:grid-cols-2">
      <template v-for="recipient in accounts" :key="recipient.paymentMethod">
        <FaCollapsible v-if="recipient.paymentMethod === 'BANK_TRANSFER'" class="border border-border rounded-lg min-w-0 overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full">
          <template #trigger="{ open }">
            <span class="p-3 text-start flex gap-3 min-w-0 items-center hover:bg-muted/25">
              <span class="text-muted-foreground border border-border rounded-lg bg-muted/25 flex shrink-0 size-16 items-center justify-center">
                <FaIcon name="i-lucide:landmark" class="size-6" aria-hidden="true" />
              </span>
              <span class="flex-1 min-w-0 space-y-1">
                <span class="qs-type-body-medium block">{{ t(`purchasePayment.methods.${recipient.paymentMethod}`) }}</span>
                <span class="qs-type-meta text-muted-foreground block [overflow-wrap:anywhere]">{{ recipient.recipientName }} · {{ recipient.bankName }}</span>
                <span class="qs-type-meta text-muted-foreground block">{{ t(open ? 'paymentRecipient.collapseBank' : 'paymentRecipient.expandBank') }}</span>
              </span>
              <FaIcon name="i-lucide:chevron-down" class="text-muted-foreground shrink-0 size-4 transition-transform motion-reduce:transition-none" :class="{ 'rotate-180': open }" aria-hidden="true" />
            </span>
          </template>
          <div class="p-4 border-t border-border bg-muted/15">
            <PaymentRecipientDetails :account="recipient" />
          </div>
        </FaCollapsible>
        <div v-else class="p-3 border border-border rounded-lg flex gap-3 min-w-0 items-center">
          <RecipientImage v-if="recipient.qrMediaAssetId" :media-asset-id="recipient.qrMediaAssetId" thumbnail />
          <span v-else class="text-muted-foreground border border-border rounded-lg bg-muted/25 flex shrink-0 size-16 items-center justify-center" role="img" :aria-label="t('paymentRecipient.errors.qrRequired')">
            <FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" />
          </span>
          <div class="flex-1 min-w-0 space-y-1">
            <h4 class="qs-type-body-medium m-0">
              {{ t(`purchasePayment.methods.${recipient.paymentMethod}`) }}
            </h4>
            <p class="qs-type-meta text-muted-foreground m-0 [overflow-wrap:anywhere]">
              {{ recipient.recipientName }}
            </p>
            <p class="qs-type-meta text-muted-foreground m-0">
              {{ t('paymentRecipient.previewQr') }}
            </p>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
