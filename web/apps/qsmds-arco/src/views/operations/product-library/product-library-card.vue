<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { ProductListItemViewModel } from '@/views/admin/product-management/list/product-list.logic'
import { computed, ref, watch } from 'vue'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import {
  buildProductLibraryThumbnailUrl,
  productLibraryAliasLabel,
  productLibraryStatusLabel,
} from './product-library.logic'

defineOptions({ name: 'ProductLibraryCard' })

const props = withDefaults(defineProps<{
  alias?: string | null
  canManageAlias?: boolean
  canReadMedia?: boolean
  currencies: readonly CurrencyDescriptor[]
  product: ProductListItemViewModel
}>(), {
  alias: null,
  canManageAlias: false,
  canReadMedia: false,
})

const emit = defineEmits<{
  editAlias: []
  open: []
}>()

const imageFailed = ref(false)
const thumbnailUrl = computed(() => (
  props.canReadMedia ? buildProductLibraryThumbnailUrl(props.product) : null
))
const hasImage = computed(() => thumbnailUrl.value !== null && !imageFailed.value)
const supplierText = computed(() => props.product.supplier?.label ?? props.product.supplier?.value ?? '—')
const categoryText = computed(() => {
  const category = props.product.categoryName ?? '未分类'
  const head = props.product.productHeadName
  return head ? `${category} › ${head}` : category
})
const aliasLabel = computed(() => productLibraryAliasLabel(props.alias))
const aliasTitle = computed(() => props.alias?.trim() ? `我的别名：${props.alias}` : '使用产品名')
const statusLabel = computed(() => productLibraryStatusLabel(props.product.status))
const statusClass = computed(() => (
  props.product.status === 'ACTIVE'
    ? 'text-primary border-primary/30 bg-primary/10'
    : 'text-muted-foreground border-border bg-muted/50'
))
const initial = computed(() => Array.from(props.product.name.trim())[0] ?? '产')

watch(() => props.product.id, () => {
  imageFailed.value = false
})
</script>

<template>
  <FaCard
    role="article"
    :aria-label="`${product.name}，${product.productNo}`"
    class="product-library-card py-0 rounded-xl gap-0 h-full shadow-sm transition-shadow overflow-hidden hover:shadow-md"
    content-class="p-0 flex flex-1 flex-col"
    @click="emit('open')"
  >
    <div class="p-3">
      <div class="rounded-lg bg-muted/20 aspect-square relative overflow-hidden">
        <img
          v-if="hasImage && thumbnailUrl"
          :src="thumbnailUrl"
          :alt="`${product.name}主图`"
          loading="lazy"
          decoding="async"
          class="h-full w-full object-contain"
          @error="imageFailed = true"
        >
        <div v-else class="text-muted-foreground flex flex-col gap-2 h-full w-full items-center justify-center">
          <FaIcon name="qs-products" class="opacity-50 size-10" aria-hidden="true" />
          <span class="text-3xl font-semibold opacity-40">{{ initial }}</span>
        </div>
        <FaTag
          variant="outline"
          class="left-2 top-2 absolute backdrop-blur-sm"
          :class="statusClass"
        >
          {{ statusLabel }}
        </FaTag>
      </div>
    </div>

    <div class="px-4 pb-4 flex flex-1 flex-col gap-2">
      <div class="min-w-0">
        <h3 class="qs-type-section-title leading-snug m-0 line-clamp-2">
          {{ product.name }}
        </h3>
        <p class="qs-type-data text-muted-foreground m-0 mt-1 break-all">
          {{ product.productNo }}
        </p>
      </div>

      <p class="qs-type-meta text-muted-foreground m-0 break-words">
        {{ categoryText }}
      </p>
      <p class="qs-type-meta text-muted-foreground m-0 break-words">
        供应商：{{ supplierText }}
        <FaTag
          v-if="product.supplier && product.supplier.state !== 'EFFECTIVE'"
          variant="outline"
          class="text-[10px] text-amber-700 ml-1 border-amber-500/30 bg-amber-500/10 dark:text-amber-400"
        >
          {{ product.supplier.state === 'UNKNOWN' ? '未知历史值' : '已停用' }}
        </FaTag>
      </p>

      <dl class="text-sm m-0 gap-1 grid grid-cols-[auto_1fr]">
        <dt class="text-muted-foreground">
          台币
        </dt>
        <dd class="m-0 text-right">
          <AmountDisplay :currencies="currencies" :currency="product.twdSalePrice.currency" :value="product.twdSalePrice.amount" :show-code="false" />
        </dd>
        <dt class="text-muted-foreground">
          马币
        </dt>
        <dd class="m-0 text-right">
          <AmountDisplay :currencies="currencies" :currency="product.myrSalePrice.currency" :value="product.myrSalePrice.amount" :show-code="false" />
        </dd>
        <dt class="text-muted-foreground">
          成本
        </dt>
        <dd class="m-0 text-right">
          <AmountDisplay :currencies="currencies" :currency="product.purchaseCost.currency" :value="product.purchaseCost.amount" :show-code="false" />
        </dd>
      </dl>

      <div class="mt-auto pt-2 flex flex-col gap-2">
        <FaButton
          v-if="canManageAlias"
          variant="ghost"
          size="sm"
          class="px-2 min-w-0 justify-start"
          :title="aliasTitle"
          :aria-label="`${product.name}：${aliasTitle}`"
          @click.stop="emit('editAlias')"
        >
          <FaIcon name="i-lucide:tag" class="shrink-0 size-4" aria-hidden="true" />
          <span class="truncate">{{ aliasLabel }}</span>
          <FaIcon name="i-lucide:pencil" class="ml-auto opacity-60 shrink-0 size-3.5" aria-hidden="true" />
        </FaButton>
        <FaButton
          variant="outline"
          size="sm"
          class="w-full"
          :aria-label="`查看 ${product.name} 详情`"
          @click.stop="emit('open')"
        >
          查看详情
        </FaButton>
      </div>
    </div>
  </FaCard>
</template>
