<script setup lang="ts">
import type { SalesOrderPendingPurchaseProductDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import PendingProductThumbnail from './pending-product-thumbnail.vue'

const props = defineProps<{ orderId: string, active: boolean }>()
const { t } = useI18n()
const items = shallowRef<SalesOrderPendingPurchaseProductDto[]>([])
const loading = ref(false)
const failed = ref(false)
const retryKey = ref(0)
const visibleItems = computed(() => items.value.length > 4 ? items.value.slice(0, 3) : items.value)
const hiddenItems = computed(() => items.value.length > 4 ? items.value.slice(3) : [])
function describe(item: SalesOrderPendingPurchaseProductDto): string {
  return t('purchaseStart.productDescription', {
    name: item.productName,
    type: t(item.lineType === 'CATALOG' ? 'purchaseStart.catalog' : 'purchaseStart.custom'),
    quantity: item.remainingQuantity,
  })
}
// 关闭、切换订单和重试均取消上一请求，防止旧订单的图片回写到当前弹窗。
watch(() => [props.orderId, props.active, retryKey.value] as const, async ([orderId, active], _, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  items.value = []
  failed.value = false
  loading.value = active
  if (!active) {
    return
  }
  try {
    const response = await salesOrdersApi.pendingPurchaseProducts(orderId, controller.signal)
    if (!controller.signal.aborted) {
      items.value = response.data.items
    }
  }
  catch {
    if (!controller.signal.aborted) {
      failed.value = true
    }
  }
  finally {
    if (!controller.signal.aborted) {
      loading.value = false
    }
  }
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-1 min-w-0 sm:items-end" :aria-label="t('purchaseStart.pendingProducts')" :aria-busy="loading">
    <span class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.pendingProducts') }}</span>
    <div class="flex gap-2 min-h-10 items-center">
      <span v-if="loading" role="status" class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.loading') }}</span>
      <div v-else-if="failed" class="flex gap-2 items-center" role="status">
        <span class="qs-type-meta text-destructive">{{ t('purchaseStart.loadFailed') }}</span>
        <FaButton variant="link" size="sm" @click="retryKey++">
          {{ t('purchaseStart.retry') }}
        </FaButton>
      </div>
      <span v-else-if="items.length === 0" class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.empty') }}</span>
      <template v-else>
        <PendingProductThumbnail v-for="item in visibleItems" :key="item.id" :item="item" :description="describe(item)" />
        <FaPopover v-if="hiddenItems.length" align="end" class="max-w-[calc(100vw-2rem)] w-80">
          <FaButton variant="outline" class="p-0 shrink-0 size-10" :aria-label="t('purchaseStart.more', { count: hiddenItems.length })">
            +{{ hiddenItems.length }}
          </FaButton>
          <template #panel>
            <ul class="m-0 p-0 list-none flex flex-col gap-3 max-h-64 overflow-y-auto">
              <li v-for="item in hiddenItems" :key="item.id" class="flex gap-3 items-center">
                <PendingProductThumbnail :item="item" :description="describe(item)" />
                <span class="text-sm min-w-0 break-words">{{ describe(item) }}</span>
              </li>
            </ul>
          </template>
        </FaPopover>
      </template>
      <FaTooltip :text="t('purchaseStart.revalidate')">
        <button type="button" :aria-label="t('purchaseStart.revalidate')" class="text-muted-foreground p-0 border-0 rounded bg-transparent inline-flex shrink-0 size-6 items-center justify-center focus-visible:outline-primary">
          <FaIcon name="i-lucide:info" class="size-4" aria-hidden="true" />
        </button>
      </FaTooltip>
    </div>
  </div>
</template>
