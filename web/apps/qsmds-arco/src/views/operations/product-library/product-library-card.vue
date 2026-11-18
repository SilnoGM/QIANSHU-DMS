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
    class="product-library-card py-0 rounded-xl gap-0 h-full shadow-sm overflow-hidden"
    content-class="p-0 flex flex-1"
  >
    <div class="p-3 flex gap-3 min-w-0 sm:gap-4">
      <div class="rounded-lg bg-muted/20 shrink-0 h-28 w-28 relative overflow-hidden sm:h-40 sm:w-40 xl:h-44 xl:w-44">
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
          <h3 class="qs-type-component-title m-0 break-words [overflow-wrap:anywhere]">
            {{ product.name }}
          </h3>
          <p
            v-if="canManageAlias"
            :title="aliasTitle"
            class="qs-type-body text-muted-foreground m-0 mt-1 truncate"
          >
            自定义别名：{{ aliasLabel }}
          </p>
        </div>

        <dl class="m-0 gap-3 grid grid-cols-2 min-w-0">
          <div class="min-w-0">
            <dt class="qs-type-meta">
              台币
            </dt>
            <dd class="m-0 mt-0.5">
              <AmountDisplay :currencies="currencies" :currency="product.twdSalePrice.currency" :value="product.twdSalePrice.amount" :show-code="false" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-meta">
              马币
            </dt>
            <dd class="m-0 mt-0.5">
              <AmountDisplay :currencies="currencies" :currency="product.myrSalePrice.currency" :value="product.myrSalePrice.amount" :show-code="false" />
            </dd>
          </div>
          <div class="col-span-2 min-w-0">
            <dt class="qs-type-meta">
              采购成本
            </dt>
            <dd class="m-0 mt-0.5">
              <AmountDisplay :currencies="currencies" :currency="product.purchaseCost.currency" :value="product.purchaseCost.amount" :show-code="false" />
            </dd>
          </div>
        </dl>

        <div class="mt-auto flex flex-wrap gap-2 justify-end">
          <FaButton
            v-if="canManageAlias"
            variant="ghost"
            size="sm"
            :aria-label="`设置 ${product.name} 的自定义别名`"
            @click="emit('editAlias')"
          >
            自定义别名
          </FaButton>
          <FaButton
            variant="outline"
            size="sm"
            :aria-label="`查看 ${product.name} 详情`"
            @click="emit('open')"
          >
            查看详情
          </FaButton>
        </div>
      </div>
    </div>
  </FaCard>
</template>
