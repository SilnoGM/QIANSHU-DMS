<script setup lang="ts">
import type { PurchaseOrderListItemDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { buildPurchasePayableLinkText } from '../../workbenches/purchase-payments/purchase-payments.logic'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ stale: [] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const router = useRouter()
const toast = useQsToast()
const loadingOrderId = ref<string | null>(null)
const canOpen = computed(() => props.active && auth('purchase-orders:read') && auth('purchase-orders:payment'))
let attempt = 0

function reset(): void {
  attempt++
  loadingOrderId.value = null
}

/** 待办入口分享整张采购单；同步发起剪贴板写入以保留浏览器用户手势，打开后再读取最新应付。 */
async function open(order: PurchaseOrderListItemDto): Promise<void> {
  if (!canOpen.value || loadingOrderId.value !== null) {
    return
  }
  if (order.orderStatus !== 'CONFIRMED' || order.paymentStatus === 'PAID') {
    toast.warning(t('purchaseOrderList.payment.unavailable'))
    emit('stale')
    return
  }
  const currentAttempt = ++attempt
  const href = router.resolve({ name: 'qsFinanceRealtimePurchaseOrderPayment', params: { id: order.id } }).href
  loadingOrderId.value = order.id
  try {
    await navigator.clipboard.writeText(buildPurchasePayableLinkText(order.orderNo, href, window.location.href))
    if (attempt === currentAttempt && canOpen.value) {
      toast.success(t('purchasePayment.linkCopied'))
    }
  }
  catch {
    if (attempt === currentAttempt && canOpen.value) {
      toast.error(t('purchasePayment.copyFailed'))
    }
  }
  finally {
    if (attempt === currentAttempt) {
      loadingOrderId.value = null
    }
  }
}

// 剪贴板操作无法撤回；页面或身份变化后只丢弃迟到反馈，不恢复旧状态。
watch(() => [props.active, account.authEpoch, canOpen.value] as const, reset, { flush: 'sync' })
onDeactivated(reset)
onBeforeUnmount(reset)
defineExpose({ open, loadingOrderId })
</script>

<template>
  <span hidden />
</template>
