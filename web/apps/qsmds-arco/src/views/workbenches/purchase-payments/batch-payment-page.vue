<script setup lang="ts">
import type { PurchaseBatchPaymentInput } from './use-purchase-batch-payment'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PurchaseBatchPaymentForm from './purchase-batch-payment-form.vue'
import { usePurchaseBatchPayment } from './use-purchase-batch-payment'

defineOptions({ name: 'QsPurchaseBatchPayment' })
const { t } = useI18n()
const { auth } = useAppAuth()
const toast = useQsToast()
const account = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const active = ref(false)
const canPay = computed(() => auth('purchase-orders:payment'))
const enabled = computed(() => active.value && account.authState === 'authenticated' && canPay.value && route.name === 'qsFinanceRealtimePurchaseBatchPayment')
const batch = usePurchaseBatchPayment(enabled, computed(() => account.authEpoch))
const locked = computed(() => batch.busy.value || batch.unknown.value)

async function submit(input?: PurchaseBatchPaymentInput) {
  const result = await (input ? batch.submit(input) : batch.retrySubmit())
  if (result) {
    toast.success(t('purchasePayment.batch.success', { count: result.orderIds.length }))
    await batch.reload()
  }
}
// 确认结果未返回时保留原请求用于核对；退出登录或权限撤销仍交给全局认证流程。
onBeforeRouteLeave(() => {
  if (enabled.value && locked.value) {
    toast.info(t('purchasePayment.batch.waitBeforeLeave'))
    return false
  }
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (enabled.value && locked.value) {
    event.preventDefault()
  }
}
onMounted(() => {
  active.value = true
  window.addEventListener('beforeunload', beforeUnload)
})
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => {
  active.value = false
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('purchasePayment.batch.pageTitle')" :description="t('purchasePayment.batch.description')">
      <FaButton variant="outline" class="min-h-11 sm:min-h-9" :disabled="locked" @click="router.push({ name: 'qsFinanceRealtimePurchasePayments' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('purchasePayment.backToList') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain main-class="p-0" class="min-w-0">
      <FaEmpty v-if="!canPay" icon="i-lucide:shield-alert" :title="t('purchasePayment.noPermission')" class="py-12" />
      <PurchaseBatchPaymentForm
        v-else :enabled="enabled" :supplier-value="batch.supplier.value" :orders="batch.orders.value" :suppliers="batch.suppliers.value"
        :suppliers-loading="batch.suppliersLoading.value" :loading="batch.loading.value" :busy="batch.busy.value"
        :unknown="batch.unknown.value" :stale="batch.stale.value" :error="batch.error.value || (batch.errorKey.value ? t(batch.errorKey.value) : '')"
        @supplier-change="batch.changeSupplier" @submit="submit" @retry="batch.reload" @retry-submit="submit()"
      />
    </FaPageMain>
  </div>
</template>
