<script setup lang="ts">
import type { SalesOrderPendingPurchaseProductDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

const props = defineProps<{ orderId: string, active: boolean }>()
const { t } = useI18n()
const items = shallowRef<SalesOrderPendingPurchaseProductDto[]>([])
const loading = ref(false)
const failed = ref(false)
const retryKey = ref(0)
const images = computed(() => items.value.flatMap(item => item.mainImage === null
  ? []
  : [{
      key: item.id,
      src: item.mainImage.contentUrl,
      alt: item.productName,
      tooltip: describe(item),
    }]))
const withoutImages = computed(() => items.value.filter(item => item.mainImage === null))
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
  <div class="flex flex-col gap-2 min-w-0 sm:max-w-sm sm:items-end" :aria-label="t('purchaseStart.pendingProducts')" :aria-busy="loading">
    <span class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.pendingProducts') }}</span>
    <span v-if="loading" role="status" class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.loading') }}</span>
    <div v-else-if="failed" class="flex flex-wrap gap-2 items-center" role="status">
      <span class="qs-type-meta text-destructive">{{ t('purchaseStart.loadFailed') }}</span>
      <FaButton variant="link" size="sm" @click="retryKey++">
        {{ t('purchaseStart.retry') }}
      </FaButton>
    </div>
    <span v-else-if="items.length === 0" class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.empty') }}</span>
    <template v-else>
      <ImageGroup v-if="images.length" :items="images" :size="44" :max-count="5" radius="md" />
      <div v-if="withoutImages.length" class="flex flex-wrap gap-2 min-w-0 sm:justify-end">
        <FaTooltip v-for="item in withoutImages" :key="item.id" :text="describe(item)">
          <span tabindex="0" class="text-xs px-2 py-1 border border-border rounded-md bg-background inline-flex gap-1 max-w-full min-w-0 items-center">
            <FaIcon name="i-lucide:image-off" class="text-muted-foreground shrink-0 size-3.5" aria-hidden="true" />
            <span class="truncate">{{ item.productName }}</span>
            <span class="text-muted-foreground shrink-0">{{ t('purchaseStart.noImage') }}</span>
          </span>
        </FaTooltip>
      </div>
    </template>
    <span class="qs-type-meta text-muted-foreground">{{ t('purchaseStart.revalidate') }}</span>
  </div>
</template>
