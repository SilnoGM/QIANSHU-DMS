<script setup lang="ts">
import type { ProductListItemViewModel } from './product-list.logic'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'

import {
  buildProductImageItems,
  buildProductMainImageItems,
} from './product-list.logic'

defineOptions({ name: 'ProductDetailDrawer' })

const props = withDefaults(defineProps<{
  canEdit?: boolean
  contentReadable?: boolean
  currencies: readonly CurrencyDescriptor[]
  error?: string
  loading?: boolean
  modelValue: boolean
  product: ProductListItemViewModel | null
  requestId?: string
}>(), {
  canEdit: false,
  contentReadable: false,
  error: '',
  loading: false,
  requestId: undefined,
})

const emit = defineEmits<{
  'closed': []
  'edit': [productId: string]
  'retry': []
  'update:modelValue': [value: boolean]
}>()

const title = computed(() => props.product === null
  ? '产品详情'
  : props.product.name)
const description = computed(() => props.product === null
  ? '读取产品最新基础资料、价格、媒体与审计信息。'
  : `产品编号 ${props.product.productNo}`)

function statusLabel(status: ProductListItemViewModel['status']): string {
  return { ACTIVE: '启用', INACTIVE: '停用' }[status]
}

function supplierStateLabel(product: ProductListItemViewModel): string {
  if (product.supplier === null) {
    return '未选择供应商'
  }
  if (product.supplier.state === 'UNKNOWN') {
    return '未知历史值'
  }
  if (product.supplier.state === 'DISABLED') {
    return '已停用'
  }
  return '当前有效'
}

function supplierDisplay(product: ProductListItemViewModel): string {
  return product.supplier?.label ?? product.supplier?.value ?? '—'
}
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
      <FaIcon name="i-lucide:package-search" class="size-4" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="emit('retry')">
        重新加载
      </FaButton>
      <code v-if="requestId" class="qs-type-meta [overflow-wrap:anywhere]">
        requestId: {{ requestId }}
      </code>
    </template>

    <FaEmpty
      v-if="product === null"
      icon="i-lucide:file-question"
      title="暂无产品详情"
      description="请返回列表重新选择产品。"
      class="min-h-64"
    />

    <!--
      详情主区块固定为单列，纵向溢出统一交给 QsGenericDrawer 的内容区处理，
      避免业务组件再创建嵌套滚动容器，导致页头、页脚或触控滚动失效。
    -->
    <div v-else data-testid="product-detail-drawer" class="gap-4 grid min-w-0">
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
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ statusLabel(product.status) }}
          </FaTag>
        </div>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 mb-3">
          分类与产品头
        </h3>
        <dl class="m-0 gap-3 grid grid-cols-1 sm:grid-cols-2">
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              分类
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ product.categoryName ?? '未分类' }}
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              产品头
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ product.productHeadName ?? '未填写产品头' }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 mb-3">
          供应商
        </h3>
        <p class="qs-type-body-medium m-0 break-all">
          {{ supplierDisplay(product) }}
        </p>
        <div class="mt-2 flex flex-wrap gap-2 items-center">
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ supplierStateLabel(product) }}
          </FaTag>
          <code v-if="product.supplier" class="qs-type-meta break-all">{{ product.supplier.value }}</code>
        </div>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0" aria-labelledby="product-detail-price-title">
        <h3 id="product-detail-price-title" class="qs-type-section-title m-0 mb-3">
          价格资料
        </h3>
        <dl class="m-0 gap-3 grid grid-cols-1 md:grid-cols-3">
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              台币销售价
            </dt>
            <dd class="font-mono m-0 mt-1">
              <AmountDisplay :value="product.twdSalePrice.amount" :currency="product.twdSalePrice.currency" :currencies="currencies" />
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              马币销售价
            </dt>
            <dd class="font-mono m-0 mt-1">
              <AmountDisplay :value="product.myrSalePrice.amount" :currency="product.myrSalePrice.currency" :currencies="currencies" />
            </dd>
          </div>
          <div class="p-3 border border-border rounded-lg bg-background min-w-0">
            <dt class="qs-type-compact-label">
              采购成本价
            </dt>
            <dd class="font-mono m-0 mt-1">
              <AmountDisplay :value="product.purchaseCost.amount" :currency="product.purchaseCost.currency" :currencies="currencies" />
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0" aria-labelledby="product-detail-attributes-title">
        <h3 id="product-detail-attributes-title" class="qs-type-section-title m-0 mb-3">
          产品属性（{{ product.attributes.length }}）
        </h3>
        <FaEmpty v-if="product.attributes.length === 0" icon="i-lucide:list-x" title="暂无产品属性" />
        <dl v-else class="m-0 gap-3 grid grid-cols-1 md:grid-cols-2">
          <div v-for="(attribute, index) in product.attributes" :key="`${index}-${attribute.title}`" class="p-3 border border-border rounded-lg min-w-0">
            <dt class="qs-type-compact-label break-words">
              {{ attribute.title }}
            </dt>
            <dd class="qs-type-body m-0 mt-1 break-words">
              {{ attribute.value }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 mb-3">
          媒体资料
        </h3>
        <FaEmpty
          v-if="!contentReadable"
          icon="i-lucide:shield-alert"
          title="无权读取媒体内容"
          description="当前身份可以查看产品资料，但不能加载图片或视频内容。"
          class="py-6"
        />
        <dl v-else class="m-0 gap-4 grid">
          <div>
            <dt class="qs-type-compact-label mb-2">
              产品主图
            </dt>
            <dd class="m-0">
              <ImageGroup :items="buildProductMainImageItems(product, contentReadable)" :max-count="1" radius="lg" :size="72" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-2">
              产品图片（{{ product.media.images.length }}）
            </dt>
            <dd class="m-0">
              <ImageGroup :items="buildProductImageItems(product, contentReadable)" :max-count="3" radius="lg" :size="64" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              产品视频（{{ product.media.videos.length }}）
            </dt>
            <dd class="m-0 mt-1">
              <span v-if="product.media.videos.length === 0">—</span>
              <ol v-else class="m-0 ps-5 gap-1 grid">
                <li v-for="video in product.media.videos" :key="video.id">
                  <span class="qs-type-meta break-all">{{ video.originalFilename }}</span>
                </li>
              </ol>
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 mb-3">
          审计信息
        </h3>
        <dl class="m-0 gap-3 grid grid-cols-1 md:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              创建人
            </dt><dd class="m-0 mt-1 break-words">
              {{ product.createdBy?.displayName ?? '—' }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              创建时间
            </dt><dd class="m-0 mt-1">
              <DateTimeDisplay :value="product.createdAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              更新人
            </dt><dd class="m-0 mt-1 break-words">
              {{ product.updatedBy?.displayName ?? '—' }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              更新时间
            </dt><dd class="m-0 mt-1">
              <DateTimeDisplay :value="product.updatedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              数据版本
            </dt><dd class="qs-type-data font-mono m-0 mt-1">
              v{{ product.version }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <template #footer>
      <!--
        footer slot 必须从首次挂载起稳定存在。详情数据是异步填充的；若把 v-if
        放在 slot template 上，QsGenericDrawer 初次看到空 slot 后不会补出 footer。
      -->
      <FaButton
        v-if="product !== null && canEdit"
        class="min-h-11 w-full md:min-h-9 md:w-auto"
        @click="emit('edit', product.id)"
      >
        <FaIcon name="i-lucide:pencil" aria-hidden="true" />
        编辑产品
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
