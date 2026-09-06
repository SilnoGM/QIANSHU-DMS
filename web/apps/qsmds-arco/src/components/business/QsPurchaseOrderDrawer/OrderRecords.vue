<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { getPaymentDocuments } from './logic'
import OrderDocument from './OrderDocument.vue'

const props = defineProps<{ detail: PurchaseOrderDetailDto, currencies: readonly CurrencyDescriptor[], canManagePayment: boolean, busy: boolean }>()
const emit = defineEmits<{ recordPayment: [] }>()
const { t } = useI18n()
const methodCatalog = useDictionaryCatalog('payment.method')
// 凭证仅在所属付款记录内展示，避免独立小节重复；采购允许无凭证付款。
// 按 paymentId 精确关联，解除记录仍保留文字但不加载媒体。
const paymentRecords = computed(() => props.detail.payments.map((payment) => {
  const vouchers = getPaymentDocuments(props.detail.documents, payment.id)
  return { payment, vouchers, thumbnail: vouchers.find(item => item.detachedAt === null && item.mediaType === 'IMAGE' && item.contentUrl)?.contentUrl }
}))
const canRecordPayment = computed(() => props.canManagePayment && props.detail.orderStatus === 'CONFIRMED' && props.detail.paymentStatus !== 'PAID')
const expandedPayment = ref<string | null>(null)
// 每次换单都清空展开状态，避免同一抽屉实例残留上一单的卡片状态。
watch(() => props.detail.id, () => {
  expandedPayment.value = null
})
</script>

<template>
  <section :aria-label="t('purchaseOrderDrawer.payments')" class="pt-5 border-t border-border/70">
    <div class="mb-3 flex flex-wrap gap-3 items-center justify-between">
      <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('purchaseOrderDrawer.payments') }}
        <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ detail.payments.length }}</span>
      </h3>
      <FaButton v-if="canRecordPayment" type="button" size="sm" :disabled="busy" @click="emit('recordPayment')">
        <FaIcon name="i-lucide:circle-plus" aria-hidden="true" />{{ t('purchaseOrderDrawer.recordPayment') }}
      </FaButton>
    </div>
    <FaEmpty v-if="!detail.payments.length" :title="t('purchaseOrderDrawer.noPayments')" class="py-6" />
    <div v-else class="space-y-2.5">
      <FaCollapsible
        v-for="{ payment, vouchers, thumbnail } in paymentRecords" :key="payment.id"
        :model-value="expandedPayment === payment.id"
        class="border border-border rounded-xl transition-colors duration-150 overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full motion-reduce:transition-none"
        :class="expandedPayment === payment.id ? 'border-primary/35' : ''"
        @update:model-value="expandedPayment = $event ? payment.id : null"
      >
        <template #trigger="{ open }">
          <TransitionGroup name="record-summary" tag="span" class="p-4 text-start flex gap-3 min-h-22 min-w-0 items-center relative hover:bg-muted/25 sm:gap-4">
            <span v-if="!open" key="thumbnail" data-slot="record-summary-thumbnail" class="border border-border/70 rounded-lg bg-muted/20 flex shrink-0 size-14 items-center justify-center overflow-hidden">
              <img v-if="thumbnail" :src="thumbnail" :alt="t('purchaseOrderDrawer.documents')" class="size-full object-cover">
              <FaIcon v-else name="i-lucide:receipt-text" class="text-muted-foreground size-6" aria-hidden="true" />
            </span>
            <span key="details" class="flex flex-1 flex-wrap gap-x-4 gap-y-2 min-w-0 items-center justify-between">
              <span class="min-w-0">
                <span class="flex flex-wrap gap-2 items-center">
                  <span class="qs-type-body-medium">{{ t(`purchaseOrderDrawer.paymentTypes.${payment.paymentType}`) }}</span>
                  <FaTag variant="outline" :class="payment.voidedAt ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5 text-primary dark:text-foreground'">{{ t(payment.voidedAt ? 'purchaseOrderDrawer.voided' : 'purchaseOrderDrawer.valid') }}</FaTag>
                </span>
                <span class="qs-type-meta mt-1.5 block"><DateTimeDisplay :value="payment.paidAt" /></span>
              </span>
              <AmountDisplay :value="payment.amount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-base !font-semibold" :class="payment.voidedAt ? 'text-muted-foreground! line-through' : ''" />
            </span>
            <span key="toggle" class="text-muted-foreground rounded-full bg-muted/50 flex shrink-0 size-7 items-center justify-center">
              <FaIcon name="i-lucide:chevron-down" class="size-4 transition-transform duration-150 motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
            </span>
          </TransitionGroup>
        </template>
        <div class="p-4 border-t border-border/70 bg-muted/15 flex flex-col gap-5 sm:p-5">
          <!-- 时间与付款备注跨整行，避免长日期和业务备注挤压相邻字段。 -->
          <dl class="text-sm m-0 gap-x-6 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
            <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-start">
              <dt class="text-muted-foreground">
                {{ t('purchaseOrderDrawer.paymentMethod') }}
              </dt>
              <dd class="m-0 [overflow-wrap:anywhere]">
                {{ methodCatalog.resolve(payment.paymentMethod)?.label ?? payment.paymentMethod ?? '-' }}
              </dd>
            </div>
            <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-start">
              <dt class="text-muted-foreground">
                {{ t('purchaseOrderDrawer.recordedBy') }}
              </dt>
              <dd class="m-0 min-w-0">
                <QsPersonDisplay :display-name="payment.createdBy.displayName" size="sm" />
              </dd>
            </div>
            <div data-slot="payment-recorded-at" class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-start sm:col-span-2">
              <dt class="text-muted-foreground">
                {{ t('purchaseOrderDrawer.recordedAt') }}
              </dt>
              <dd class="m-0 min-w-0">
                <DateTimeDisplay :value="payment.createdAt" class="whitespace-normal!" />
              </dd>
            </div>
            <div data-slot="payment-remark" class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-start sm:col-span-2">
              <dt class="text-muted-foreground">
                {{ t('purchaseOrderDrawer.paymentRemark') }}
              </dt>
              <dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {{ payment.remark || '-' }}
              </dd>
            </div>
          </dl>
          <p v-if="payment.voidedAt" class="text-sm text-destructive m-0">
            {{ t('purchaseOrderDrawer.voidReason') }}：{{ payment.voidReason || '-' }} · <DateTimeDisplay :value="payment.voidedAt" />
          </p>
          <div class="pt-5 border-t border-border/70">
            <FaEmpty v-if="!vouchers.length" :title="t('purchaseOrderDrawer.noVoucher')" class="py-2" />
            <div v-else class="space-y-5">
              <OrderDocument v-for="voucher in vouchers" :key="voucher.id" :document="voucher" />
            </div>
          </div>
        </div>
      </FaCollapsible>
    </div>
  </section>
</template>

<style scoped>
/* 小图退出时立即脱离占位，Vue 的 FLIP 位移动画让摘要平滑补位；不逐帧改变宽高。 */
.record-summary-move {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.record-summary-enter-active,
.record-summary-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.record-summary-leave-active {
  position: absolute;
  inset-inline-start: 1rem;
  pointer-events: none;
}

.record-summary-enter-from,
.record-summary-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* 跟随系统减少动态效果设置，快速切换仍由 Vue 取消上一段过渡，不另建计时状态。 */
@media (prefers-reduced-motion: reduce) {
  .record-summary-move,
  .record-summary-enter-active,
  .record-summary-leave-active {
    transition: none;
  }
}
</style>
