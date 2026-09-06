<script setup lang="ts">
import type { SalesOrderDetailDto, SalesOrderListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import OrderHistory from './OrderHistory.vue'
import OrderInformation from './OrderInformation.vue'

defineOptions({ name: 'QsSalesOrderDrawer' })
const props = defineProps<{
  modelValue: boolean
  order: SalesOrderListItemDto | null
  detail: SalesOrderDetailDto | null
  currencies: readonly CurrencyDescriptor[]
  loading: boolean
  error: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'reload': []
  'closed': []
}>()
const { t } = useI18n()
const toast = useQsToast()
const activeTab = ref<string | number>('information')
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const currentOrder = computed(() => props.detail ?? props.order)
const title = computed(() => currentOrder.value?.orderNo ?? t('salesOrderDrawer.title'))
const tabs = computed(() => [
  { value: 'information', label: t('salesOrderDrawer.information'), icon: 'i-lucide:receipt-text' },
  { value: 'changes', label: t('salesOrderDrawer.changes'), icon: 'i-lucide:history' },
])
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
    :description="t('salesOrderDrawer.title')"
    :closable="false"
    :show-confirm-button="false"
    :destroy-on-close="true"
    content-class="qs-sales-order-drawer border-border bg-background w-screen max-w-none sm:max-w-none md:w-[48rem] md:max-w-[calc(100vw-3rem)]"
    header-class="p-0"
    footer-class="p-4 bg-background"
    @closed="onClosed"
  >
    <template #header>
      <div class="p-4 flex gap-3 min-w-0 items-start">
        <span class="text-primary rounded-lg bg-primary/10 flex shrink-0 size-10 items-center justify-center"><FaIcon name="i-lucide:receipt-text" class="size-5" aria-hidden="true" /></span>
        <div class="flex-1 min-w-0">
          <h2 class="text-lg qs-type-data-emphasis m-0 [overflow-wrap:anywhere]">
            {{ title }}
          </h2>
          <p v-if="currentOrder" class="text-sm text-muted-foreground m-0 mt-2 flex flex-wrap gap-2 items-center">
            <FaTag variant="outline" :class="currentOrder.currencyCode === 'TWD' ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300' : 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300'">
              {{ currentOrder.currencyCode }}
            </FaTag>
            <span aria-hidden="true">·</span><span>{{ currentOrder.orderDate }}</span>
          </p>
        </div>
        <FaButton type="button" variant="ghost" size="icon" class="shrink-0 size-11" :aria-label="t('salesOrderDrawer.close')" @click="visible = false">
          <FaIcon name="i-lucide:x" class="size-5" />
        </FaButton>
      </div>
    </template>
    <div data-testid="sales-order-detail-drawer" :aria-busy="loading" class="min-w-0">
      <div v-if="loading" role="status" class="space-y-4">
        <span class="sr-only">{{ t('salesOrderDrawer.loading') }}</span>
        <div v-for="n in 4" :key="n" class="rounded-lg bg-muted h-24 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
      </div>
      <FaAlert v-else-if="error" :title="t('salesOrderDrawer.loadFailed')" variant="destructive">
        <template #description>
          <p>{{ error }}</p><FaButton variant="outline" @click="emit('reload')">
            {{ t('salesOrderDrawer.reload') }}
          </FaButton>
        </template>
      </FaAlert>
      <FaTabs v-else-if="detail" v-model="activeTab" :list="tabs" list-class="rounded-none bg-background h-auto min-h-11 w-full sticky -top-4 z-10" content-class="mt-5 min-w-0">
        <template #information>
          <OrderInformation :detail="detail" :currencies="currencies" :line-previews="order?.id === detail.id ? order.lineSummary.previews : []" />
        </template>
        <template #changes>
          <OrderHistory :detail="detail" :currencies="currencies" />
        </template>
      </FaTabs>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 w-full sm:w-auto" :disabled="loading || !detail || Boolean(error)" @click="toast.info(t('salesOrderDrawer.printNotice'))">
        <FaIcon name="i-lucide:printer" class="size-4" aria-hidden="true" />{{ t('salesOrderDrawer.print') }}
      </FaButton>
    </template>
  </FaDrawer>
</template>
