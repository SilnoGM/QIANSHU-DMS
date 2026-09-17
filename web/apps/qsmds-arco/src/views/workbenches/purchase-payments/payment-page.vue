<script setup lang="ts">
import PaymentForm from './payment-form.vue'
import { usePurchasePayableDetail } from './use-purchase-payable-detail'

defineOptions({ name: 'QsPurchasePayablePayment' })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const active = ref(false)
const locked = ref(false)
const canPay = computed(() => auth('purchase-orders:payment'))
const byOrder = computed(() => route.name === 'qsFinanceRealtimePurchaseOrderPayment')
const enabled = computed(() => active.value && account.authState === 'authenticated' && canPay.value && (byOrder.value || route.name === 'qsFinanceRealtimePurchasePayablePayment'))
const target = computed(() => ({ id: typeof route.params.id === 'string' ? route.params.id : '', kind: byOrder.value ? 'order' as const : 'payable' as const }))
const { selection, loading, invalid, error, load, applyOrder, selectPayable } = usePurchasePayableDetail(target, enabled, computed(() => account.authEpoch))
onMounted(() => active.value = true)
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => active.value = false)
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('purchasePayment.payTitle')" :description="t('purchasePayment.pageDescription')">
      <div class="flex flex-wrap gap-2">
        <FaButton variant="outline" class="min-h-11 sm:min-h-9" :disabled="locked" @click="router.push({ name: 'qsFinanceRealtimePurchasePayments' })">
          <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />
          {{ t('purchasePayment.backToList') }}
        </FaButton>
        <FaButton v-if="canPay" variant="outline" class="min-h-11 sm:min-h-9" :disabled="locked" :loading="loading" @click="load">
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('purchasePayment.refresh') }}
        </FaButton>
      </div>
    </FaPageHeader>
    <div class="mx-auto max-w-6xl min-w-0">
      <FaPageMain main-class="p-0" :aria-busy="loading">
        <FaEmpty v-if="!canPay" icon="i-lucide:shield-alert" :title="t('purchasePayment.noPermission')" class="py-12" />
        <div v-else-if="loading" role="status" class="text-muted-foreground py-12 flex gap-3 items-center justify-center">
          <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" aria-hidden="true" />{{ t('purchasePayment.loading') }}
        </div>
        <FaEmpty v-else-if="invalid" icon="i-lucide:link-2-off" :title="t('purchasePayment.invalidLink')" :description="t('purchasePayment.invalidLinkDescription')" class="py-12" />
        <FaEmpty v-else-if="error" icon="i-lucide:triangle-alert" :title="t('purchasePayment.loadFailed')" :description="error" class="py-12">
          <FaButton variant="outline" @click="load">
            {{ t('purchasePayment.retry') }}
          </FaButton>
        </FaEmpty>
        <PaymentForm v-else-if="selection && enabled" :selection="selection" :enabled="enabled" :selectable="byOrder" @select="selectPayable" @changed="applyOrder" @refresh="load" @lock-change="locked = $event" />
      </FaPageMain>
    </div>
  </div>
</template>
