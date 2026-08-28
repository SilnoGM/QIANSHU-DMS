<script setup lang="ts">
import QsPurchaseOrderDesc from '@/components/business/QsPurchaseOrderDesc/index.vue'

import { SHOWCASE_CURRENCIES } from '../../shared/currency.fixture'
import { PURCHASE_ORDER_DESC_SHOWCASE_MODEL } from '../fixtures/purchase-order-desc.fixture'

type PreviewWidth = 'page' | 'sidebar'

const previewWidth = ref<PreviewWidth>('sidebar')
const previewWidthClass = computed(() => (
  previewWidth.value === 'sidebar' ? 'max-w-[34rem]' : 'max-w-[72rem]'
))

function setPreviewWidth(value: PreviewWidth): void {
  previewWidth.value = value
}
</script>

<template>
  <section
    aria-labelledby="purchase-order-desc-showcase-title"
    data-testid="purchase-order-desc-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:shopping-basket" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">只读采购快照</span>
          </div>
          <h3
            id="purchase-order-desc-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            同一详情适配采购创建核对与正式订单
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            示例使用确定性本地 ViewModel，覆盖供应商、销售来源、采购双价、产品主图、付款进度和状态，不读取真实订单数据。
          </p>
        </div>
        <FaTag variant="secondary">
          QsPurchaseOrderDesc
        </FaTag>
      </div>

      <div class="mt-6 flex flex-wrap gap-2" role="group" aria-label="预览容器宽度">
        <button
          type="button"
          class="text-sm font-medium px-4 border rounded-lg min-h-11 transition-colors"
          :class="previewWidth === 'sidebar'
            ? 'text-primary border-primary/35 bg-primary/10'
            : 'text-muted-foreground border-border bg-background hover:bg-muted/40'"
          :aria-pressed="previewWidth === 'sidebar'"
          @click="setPreviewWidth('sidebar')"
        >
          侧栏宽度
        </button>
        <button
          type="button"
          class="text-sm font-medium px-4 border rounded-lg min-h-11 transition-colors"
          :class="previewWidth === 'page'
            ? 'text-primary border-primary/35 bg-primary/10'
            : 'text-muted-foreground border-border bg-background hover:bg-muted/40'"
          :aria-pressed="previewWidth === 'page'"
          @click="setPreviewWidth('page')"
        >
          页面宽度
        </button>
      </div>

      <div class="mt-4 p-3 border border-border rounded-2xl bg-muted/20 sm:p-6">
        <div class="mx-auto transition-[max-width] duration-200" :class="previewWidthClass">
          <QsPurchaseOrderDesc
            :model="PURCHASE_ORDER_DESC_SHOWCASE_MODEL"
            :currencies="SHOWCASE_CURRENCIES"
          >
            <template #actions>
              <div class="flex flex-wrap gap-3 items-center justify-between">
                <div class="min-w-0">
                  <p class="qs-type-compact-label text-foreground m-0">
                    操作区插槽
                  </p>
                  <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                    展示页不执行采购提交或状态推进，正式页面继续持有领域操作。
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  class="text-sm text-primary-foreground font-medium px-4 border-0 rounded-lg bg-primary opacity-60 min-h-11 cursor-not-allowed"
                >
                  确认采购
                </button>
              </div>
            </template>
          </QsPurchaseOrderDesc>
        </div>
      </div>

      <p class="qs-type-meta text-muted-foreground m-0 mt-4" role="status">
        当前预览：{{ previewWidth === 'sidebar' ? '采购详情抽屉宽度' : '正式采购详情页宽度' }}。窄屏效果可直接缩小浏览器视口检查。
      </p>
    </div>
  </section>
</template>
