<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { ProductListItemViewModel } from '@/views/admin/product-management/list/product-list.logic'
import { computed, ref, watch } from 'vue'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import {
  buildProductLibraryOriginalImageUrl,
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
const useOriginalImage = ref(false)
const thumbnailUrl = computed(() => (
  props.canReadMedia ? buildProductLibraryThumbnailUrl(props.product) : null
))
const originalUrl = computed(() => (
  props.canReadMedia ? buildProductLibraryOriginalImageUrl(props.product) : null
))
const displayImageUrl = computed(() => (
  useOriginalImage.value ? originalUrl.value : thumbnailUrl.value
))
const hasImage = computed(() => displayImageUrl.value !== null && !imageFailed.value)
const aliasLabel = computed(() => productLibraryAliasLabel(props.alias))
const aliasTitle = computed(() => props.alias?.trim() ? `自定义别名：${props.alias}` : '自定义别名：使用产品名')
const statusLabel = computed(() => productLibraryStatusLabel(props.product.status))
const statusDotClass = computed(() => (
  props.product.status === 'ACTIVE' ? 'bg-green-600' : 'bg-red-600'
))

function onImageError(): void {
  if (!useOriginalImage.value && originalUrl.value !== null) {
    useOriginalImage.value = true
    return
  }
  imageFailed.value = true
}

watch(() => props.product.id, () => {
  imageFailed.value = false
  useOriginalImage.value = false
})
</script>

<template>
  <FaCard
    role="article"
    :aria-label="`${product.name}，${statusLabel}`"
    class="product-library-card py-0 rounded-xl gap-0 h-full w-full shadow-sm overflow-hidden"
    content-class="p-0 flex flex-1"
  >
    <div class="p-3 flex-1 gap-3 grid grid-cols-[7rem_minmax(0,1fr)] min-w-0 sm:gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)]">
      <div class="rounded-lg bg-muted/20 w-full aspect-square relative overflow-hidden">
        <img
          v-if="hasImage && displayImageUrl"
          :key="displayImageUrl"
          :src="displayImageUrl"
          :alt="`${product.name}主图`"
          loading="lazy"
          decoding="async"
          class="h-full w-full object-contain"
          @error="onImageError"
        >
        <div v-else class="text-muted-foreground flex flex-col gap-2 h-full w-full items-center justify-center">
          <FaIcon :name="canReadMedia ? 'qs-products' : 'i-lucide:image-off'" class="opacity-50 size-9 sm:size-10" aria-hidden="true" />
          <span class="text-xs px-2 text-center">{{ canReadMedia ? '暂无图片' : '无图片权限' }}</span>
        </div>
        <span
          role="status"
          :aria-label="statusLabel"
          :title="statusLabel"
          class="border-2 border-background rounded-full size-3 ring-2 ring-background shadow-sm bottom-2 right-2 absolute"
          :class="statusDotClass"
        />
      </div>

      <div class="flex flex-1 flex-col gap-2 min-w-0">
        <div class="min-w-0">
          <h3 class="qs-type-component-title m-0 min-w-0">
            <button
              type="button"
              title="查看详情"
              :aria-label="`查看 ${product.name} 详情`"
              class="text-inherit text-left rounded-sm max-w-full block cursor-pointer truncate transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              @click="emit('open')"
            >
              {{ product.name }}
            </button>
          </h3>
          <div v-if="canManageAlias" class="mt-1 flex gap-1 min-w-0 items-center">
            <p
              :title="aliasTitle"
              class="qs-type-body text-muted-foreground m-0 min-w-0 truncate"
            >
              自定义别名：{{ aliasLabel }}
            </p>
            <FaButton
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground shrink-0 size-6 hover:text-foreground"
              :aria-label="`设置 ${product.name} 的自定义别名`"
              title="设置自定义别名"
              @click="emit('editAlias')"
            >
              <FaIcon name="i-lucide:pencil" class="size-3" />
            </FaButton>
          </div>
        </div>

        <div class="p-2 rounded-lg bg-muted/40 flex flex-1 flex-col">
          <dl class="m-0 flex flex-1 flex-col gap-2 min-w-0">
            <div class="flex-1 gap-x-6 gap-y-2 grid grid-cols-1 min-w-0 min-[480px]:gap-y-0 min-[480px]:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
              <dt class="qs-type-meta">
                标准售价
              </dt>
              <dd class="m-0 text-right min-w-0">
                <span class="qs-type-meta block">台币</span>
                <AmountDisplay class="!text-[15px]" :currencies="currencies" :currency="product.twdSalePrice.currency" :value="product.twdSalePrice.amount" :show-code="false" />
              </dd>
              <dd class="m-0 text-right min-w-0">
                <span class="qs-type-meta block">马币</span>
                <AmountDisplay class="!text-[15px]" :currencies="currencies" :currency="product.myrSalePrice.currency" :value="product.myrSalePrice.amount" :show-code="false" />
              </dd>
            </div>
            <div class="pt-2 border-t border-border/60 flex gap-3 min-w-0 items-baseline justify-between">
              <dt class="qs-type-meta">
                采购成本（人民币）
              </dt>
              <dd class="m-0 min-w-0">
                <AmountDisplay class="!text-[15px]" :currencies="currencies" :currency="product.purchaseCost.currency" :value="product.purchaseCost.amount" :show-code="false" />
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </FaCard>
</template>
