<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { ProductListItemViewModel } from '@/views/admin/product-management/list/product-list.logic'
import { computed } from 'vue'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import {
  buildProductImageItems,
  buildProductMainImageItems,
} from '@/views/admin/product-management/list/product-list.logic'
import {
  productLibraryAliasDisplay,
  productLibraryStatusLabel,
} from './product-library.logic'

defineOptions({ name: 'ProductLibraryDetailDrawer' })

const props = withDefaults(defineProps<{
  alias?: string | null
  canManageAlias?: boolean
  canReadMedia?: boolean
  currencies: readonly CurrencyDescriptor[]
  defaultAlias?: string | null
  error?: string
  loading?: boolean
  modelValue: boolean
  product: ProductListItemViewModel | null
  requestId?: string
}>(), {
  alias: null,
  canManageAlias: false,
  canReadMedia: false,
  defaultAlias: null,
  error: '',
  loading: false,
  requestId: undefined,
})

const emit = defineEmits<{
  'closed': []
  'editAlias': []
  'retry': []
  'update:modelValue': [value: boolean]
}>()

const title = computed(() => props.product?.name ?? '产品详情')
const description = computed(() => props.product === null
  ? '读取产品最新基础资料、价格、媒体与审计信息。'
  : `产品编号 ${props.product.productNo}`)
const supplierText = computed(() => props.product?.supplier?.label
  ?? props.product?.supplier?.value
  ?? '—')
const supplierState = computed(() => {
  if (!props.product?.supplier) {
    return '未选择供应商'
  }
  return {
    DISABLED: '已停用',
    EFFECTIVE: '当前有效',
    UNKNOWN: '未知历史值',
  }[props.product.supplier.state]
})
const categoryText = computed(() => props.product?.categoryName ?? '未分类')
const headText = computed(() => props.product?.productHeadName ?? '未填写产品头')
const aliasDisplay = computed(() => productLibraryAliasDisplay(props.alias, props.defaultAlias))
const mainImageItems = computed(() => props.product === null
  ? []
  : buildProductMainImageItems(props.product, props.canReadMedia))
const imageItems = computed(() => props.product === null
  ? []
  : buildProductImageItems(props.product, props.canReadMedia))
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="title"
    :description="description"
    size="xl"
    :loading="loading"
    :error="error || null"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon name="qs-products" class="size-4" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="emit('retry')">
        重新加载
      </FaButton>
      <code v-if="requestId" class="qs-type-meta [overflow-wrap:anywhere]">
        requestId: {{ requestId }}
      </code>
    </template>

    <FaEmpty
      v-if="product === null"
      icon="i-lucide:package-search"
      title="暂无产品详情"
      description="请返回产品库重新选择产品。"
      class="min-h-64"
    />

    <div v-else class="gap-4 grid min-w-0">
      <section class="p-4 border border-border rounded-lg bg-muted/10 min-w-0">
        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div class="min-w-0">
            <p class="qs-type-compact-label m-0">
              产品身份
            </p>
            <h3 class="qs-type-section-title mb-1 mt-1 break-words">
              {{ product.name }}
            </h3>
            <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">
              {{ product.productNo }}
            </code>
          </div>
          <div class="flex flex-col gap-2 min-w-0">
            <FaTag variant="outline" class="qs-type-status-tag self-start">
              {{ productLibraryStatusLabel(product.status) }}
            </FaTag>
            <dl class="m-0 gap-x-3 gap-y-1 grid grid-cols-[auto_minmax(0,1fr)] min-w-0">
              <dt class="qs-type-compact-label m-0">
                唛头名称
              </dt>
              <dd class="qs-type-body-medium m-0 break-all">
                {{ aliasDisplay.name }}
              </dd>
              <dt class="qs-type-compact-label m-0">
                来源
              </dt>
              <dd class="qs-type-meta text-muted-foreground m-0">
                {{ aliasDisplay.sourceLabel }}
              </dd>
            </dl>
            <FaButton
              v-if="canManageAlias"
              variant="outline"
              size="sm"
              class="self-start"
              @click="emit('editAlias')"
            >
              <FaIcon name="i-lucide:tag" class="size-4" aria-hidden="true" />
              设置个人别名
            </FaButton>
          </div>
        </div>
      </section>

      <section v-if="canReadMedia" class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title mb-3 mt-0">
          产品图片
        </h3>
        <ImageGroup
          v-if="mainImageItems.length > 0"
          :items="mainImageItems"
          :max-count="1"
          radius="lg"
          :size="160"
          class="mb-3"
        />
        <ImageGroup
          v-if="imageItems.length > 0"
          :items="imageItems"
          :max-count="4"
          radius="lg"
          :size="96"
        />
        <p v-if="mainImageItems.length === 0 && imageItems.length === 0" class="qs-type-body text-muted-foreground m-0">
          暂无产品图片
        </p>
        <div v-if="product.media.videos.length > 0" class="mt-3">
          <h4 class="qs-type-compact-label m-0 mb-2">
            产品视频
          </h4>
          <ol class="m-0 ps-5 gap-1 grid">
            <li v-for="video in product.media.videos" :key="video.id" class="qs-type-meta break-all">
              {{ video.originalFilename }}
            </li>
          </ol>
        </div>
      </section>
      <FaAlert
        v-else
        icon="i-lucide:shield-alert"
        title="无权读取媒体内容"
        description="当前身份可以查看产品资料，但不能加载图片或视频内容。"
      />

      <section class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title mb-3 mt-0">
          价格资料
        </h3>
        <dl class="m-0 gap-3 grid grid-cols-1 md:grid-cols-3">
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              台币销售价
            </dt>
            <dd class="font-mono m-0 mt-1">
              <AmountDisplay :currencies="currencies" :currency="product.twdSalePrice.currency" :value="product.twdSalePrice.amount" />
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              马币销售价
            </dt>
            <dd class="font-mono m-0 mt-1">
              <AmountDisplay :currencies="currencies" :currency="product.myrSalePrice.currency" :value="product.myrSalePrice.amount" />
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              采购成本价
            </dt>
            <dd class="font-mono m-0 mt-1">
              <AmountDisplay :currencies="currencies" :currency="product.purchaseCost.currency" :value="product.purchaseCost.amount" />
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title mb-3 mt-0">
          基础资料
        </h3>
        <dl class="m-0 gap-3 grid grid-cols-1 sm:grid-cols-2">
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              分类
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ categoryText }}
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              产品头
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ headText }}
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              供应商
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ supplierText }}
            </dd>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              {{ supplierState }}
            </p>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              产品状态
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1">
              {{ productLibraryStatusLabel(product.status) }}
            </dd>
          </div>
        </dl>
        <template v-if="product.attributes.length > 0">
          <h4 class="qs-type-compact-label mb-2 mt-4">
            产品属性
          </h4>
          <dl class="m-0 gap-3 grid grid-cols-1 md:grid-cols-2">
            <div v-for="(attribute, index) in product.attributes" :key="`${index}-${attribute.title}`" class="p-3 border border-border rounded-lg min-w-0">
              <dt class="qs-type-compact-label break-words">
                {{ attribute.title }}
              </dt>
              <dd class="qs-type-body m-0 mt-1 break-words">
                {{ attribute.value }}
              </dd>
            </div>
          </dl>
        </template>
        <template v-if="product.remark">
          <h4 class="qs-type-compact-label mb-2 mt-4">
            产品备注
          </h4>
          <p class="qs-type-body m-0 whitespace-pre-wrap break-words">
            {{ product.remark }}
          </p>
        </template>
      </section>

      <details class="p-4 border border-border rounded-lg min-w-0">
        <summary class="qs-type-section-title list-none cursor-pointer">
          审计信息
        </summary>
        <dl class="m-0 mt-3 gap-3 grid grid-cols-1 md:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              创建人
            </dt>
            <dd class="m-0 mt-1 break-words">
              <QsPersonDisplay v-if="product.createdBy" :display-name="product.createdBy.displayName" size="sm" :avatar-url="product.createdBy.avatarUrl" />
              <span v-else class="text-muted-foreground">—</span>
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              创建时间
            </dt>
            <dd class="m-0 mt-1">
              <DateTimeDisplay :value="product.createdAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              更新人
            </dt>
            <dd class="m-0 mt-1 break-words">
              <QsPersonDisplay v-if="product.updatedBy" :display-name="product.updatedBy.displayName" size="sm" :avatar-url="product.updatedBy.avatarUrl" />
              <span v-else class="text-muted-foreground">—</span>
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              更新时间
            </dt>
            <dd class="m-0 mt-1">
              <DateTimeDisplay :value="product.updatedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              数据版本
            </dt>
            <dd class="qs-type-data font-mono m-0 mt-1">
              v{{ product.version }}
            </dd>
          </div>
        </dl>
      </details>
    </div>

    <template #footer>
      <FaButton
        v-if="product !== null && canManageAlias"
        class="min-h-11 w-full md:min-h-9 md:w-auto"
        @click="emit('editAlias')"
      >
        <FaIcon name="i-lucide:tag" class="size-4" aria-hidden="true" />
        设置别名
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
