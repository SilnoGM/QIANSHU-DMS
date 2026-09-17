<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PurchaseOrderPaymentRecipients from '@/views/operations/purchase-orders/purchase-order-payment-recipients.vue'
import OrderDocuments from './OrderDocuments.vue'
import OrderHistory from './OrderHistory.vue'
import OrderInformation from './OrderInformation.vue'
import OrderRecords from './OrderRecords.vue'

defineOptions({ name: 'QsPurchaseOrderDrawer' })
const props = defineProps<{
  modelValue: boolean
  order: PurchaseOrderListItemDto | null
  detail: PurchaseOrderDetailDto | null
  currencies: readonly CurrencyDescriptor[]
  loading: boolean
  error: string | null
  actionError: string
  busy: boolean
  canAttachDocument?: boolean
  canReceiveWarehouse?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'reload': []
  'closed': []
  'attachDocument': []
  'receiveWarehouse': []
}>()
const { t } = useI18n()
const toast = useQsToast()
const activeTab = ref<string | number>('information')
const drawerBody = useTemplateRef<HTMLDivElement>('drawerBody')
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const currentOrder = computed(() => props.detail ?? props.order)
const title = computed(() => currentOrder.value?.orderNo ?? t('purchaseOrderDrawer.title'))
const tabs = computed(() => [
  { value: 'information', label: t('purchaseOrderDrawer.information'), icon: 'i-lucide:receipt-text', class: 'dark:data-[state=active]:text-foreground!' },
  { value: 'changes', label: t('purchaseOrderDrawer.changes'), icon: 'i-lucide:history', class: 'dark:data-[state=active]:text-foreground!' },
])
// FaDrawer 是唯一滚动容器。换页签后只归零其正文，不移动背后的订单列表。
watch(activeTab, () => {
  drawerBody.value?.parentElement?.scrollTo({ top: 0 })
}, { flush: 'post' })
let returnFocus: HTMLElement | null = null
watch(() => [props.modelValue, props.order?.id] as const, ([open]) => {
  activeTab.value = 'information'
  if (open && typeof document !== 'undefined') {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
}, { immediate: true })
function onClosed() {
  // 抽屉关闭后恢复到打开它的查看按钮；列表重载后已移除的节点不再抢焦点。
  if (returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true })
  }
  emit('closed')
}
</script>

<template>
  <FaDrawer
    v-model="visible"
    :title="title"
    :description="t('purchaseOrderDrawer.title')"
    :closable="false"
    :loading="busy"
    :close-on-click-overlay="!busy"
    :close-on-press-escape="!busy"
    :show-confirm-button="false"
    :destroy-on-close="true"
    content-class="qs-purchase-order-drawer border-border rounded-l-2xl bg-background w-screen max-w-none overflow-hidden sm:max-w-none md:w-[48rem] md:max-w-[calc(100vw-3rem)]"
    header-class="p-0"
    footer-class="px-5 py-2 bg-muted/15 sm:px-6"
    @closed="onClosed"
  >
    <template #header>
      <div class="px-5 py-3 bg-muted/15 flex gap-3 min-w-0 items-center sm:px-6 sm:gap-4">
        <span class="text-primary border border-primary/15 rounded-xl bg-primary/8 flex shrink-0 size-12 items-center justify-center dark:text-foreground"><FaIcon name="i-lucide:shopping-cart" class="size-6" aria-hidden="true" /></span>
        <div class="flex-1 min-w-0">
          <h2 class="qs-type-page-title m-0 [overflow-wrap:anywhere] font-mono!">
            {{ title }}
          </h2>
          <p v-if="currentOrder" class="qs-type-meta m-0 mt-2 flex flex-wrap gap-2.5 items-center">
            <FaTag variant="outline" class="text-emerald-700 border-emerald-500/30 bg-emerald-500/8 dark:text-emerald-300">
              {{ currentOrder.currencyCode }}
            </FaTag>
            <span aria-hidden="true">·</span><span class="inline-flex gap-1.5 items-center"><FaIcon name="i-lucide:calendar-days" class="size-3.5" aria-hidden="true" />{{ currentOrder.orderDate }}</span>
          </p>
        </div>
        <FaButton type="button" variant="ghost" size="icon" class="text-muted-foreground rounded-full shrink-0 size-11 self-start" :disabled="busy" :aria-label="t('purchaseOrderDrawer.close')" @click="visible = false">
          <FaIcon name="i-lucide:x" class="size-5" />
        </FaButton>
      </div>
    </template>
    <div ref="drawerBody" data-testid="purchase-order-detail-drawer" :aria-busy="loading" class="px-1 min-w-0 sm:px-2">
      <div v-if="loading" role="status" class="space-y-4">
        <span class="sr-only">{{ t('purchaseOrderDrawer.loading') }}</span>
        <div v-for="n in 4" :key="n" class="rounded-lg bg-muted h-24 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
      </div>
      <FaAlert v-else-if="error" :title="t('purchaseOrderDrawer.loadFailed')" variant="destructive">
        <template #description>
          <p>{{ error }}</p><FaButton variant="outline" @click="emit('reload')">
            {{ t('purchaseOrderDrawer.reload') }}
          </FaButton>
        </template>
      </FaAlert>
      <FaTabs v-else-if="detail" v-model="activeTab" :list="tabs" class="drawer-tabs" list-class="rounded-none bg-background h-12 w-full sticky -top-4 z-10" content-class="mt-6 min-w-0">
        <template #information>
          <div class="pb-2 space-y-6">
            <FaAlert v-if="actionError" :title="t('purchaseOrderDrawer.actionFailed')" :description="actionError" variant="destructive" />
            <OrderInformation :detail="detail" :currencies="currencies" />
            <PurchaseOrderPaymentRecipients :accounts="detail.paymentRecipientProfile?.accounts ?? []" />
            <OrderRecords :detail="detail" :currencies="currencies" />
            <OrderDocuments :detail="detail" :busy="busy" :can-attach-document="Boolean(canAttachDocument)" @attach-document="emit('attachDocument')" />
          </div>
        </template>
        <template #changes>
          <OrderHistory :detail="detail" :currencies="currencies" />
        </template>
      </FaTabs>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton v-if="canReceiveWarehouse" variant="ghost" class="text-primary" :disabled="busy || loading || !detail || Boolean(error)" @click="emit('receiveWarehouse')">
          <FaIcon name="i-lucide:warehouse" class="size-4" />{{ t('purchaseWarehouseReceipt.action') }}
        </FaButton>
        <FaButton type="button" variant="outline" size="sm" class="px-3 h-8" :disabled="busy || loading || !detail || Boolean(error)" @click="toast.info(t('purchaseOrderDrawer.printNotice'))">
          <FaIcon name="i-lucide:printer" class="size-4" aria-hidden="true" />{{ t('purchaseOrderDrawer.print') }}
        </FaButton>
      </div>
    </template>
  </FaDrawer>
</template>

<style scoped>
/* 保留 FaTabs 的键盘与选中语义，只在本抽屉内改为页签样式，不影响全站 Tabs。 */
.drawer-tabs :deep([data-slot="tabs-list"]) {
  gap: 1.5rem;
  justify-content: flex-start;
  padding: 0;
  border-bottom: 1px solid oklch(var(--border));
}

.drawer-tabs :deep([data-slot="tabs-trigger"]) {
  flex: none;
  width: auto;
  height: 100%;
  padding: 0 0.25rem;
  color: oklch(var(--muted-foreground));
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  box-shadow: none;
}

.drawer-tabs :deep([data-slot="tabs-trigger"][data-state="active"]) {
  font-weight: var(--qs-type-weight-semibold, 600);
  color: oklch(var(--primary));
  border-bottom-color: oklch(var(--primary));
}
</style>
