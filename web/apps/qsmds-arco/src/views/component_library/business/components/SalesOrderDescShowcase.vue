<script setup lang="ts">
import QsSalesOrderDesc from '@/components/business/QsSalesOrderDesc/index.vue'
import { SHOWCASE_CURRENCIES } from '../../shared/currency.fixture'
import { SALES_ORDER_DESC_SHOWCASE_MODEL } from '../fixtures/sales-order-desc.fixture'

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
    aria-labelledby="sales-order-desc-showcase-title"
    data-testid="sales-order-desc-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:receipt-text" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">只读订单快照</span>
          </div>
          <h3
            id="sales-order-desc-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            同一详情适配创建侧栏与正式详情页
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            示例使用确定性本地 ViewModel，覆盖正式产品、临时产品、金额强调与附件预览，不读取真实订单数据。
          </p>
        </div>
        <FaTag variant="secondary">
          QsSalesOrderDesc
        </FaTag>
      </div>

      <div
        class="mt-6 flex flex-wrap gap-2"
        role="group"
        aria-label="预览容器宽度"
      >
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
        <div
          class="mx-auto transition-[max-width] duration-200"
          :class="previewWidthClass"
        >
          <QsSalesOrderDesc
            :model="SALES_ORDER_DESC_SHOWCASE_MODEL"
            :currencies="SHOWCASE_CURRENCIES"
          >
            <template #actions>
              <div class="flex flex-wrap gap-3 items-center justify-between">
                <div class="min-w-0">
                  <p class="qs-type-compact-label text-foreground m-0">
                    操作区插槽
                  </p>
                  <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                    展示页不执行提交，正式页面负责校验和二次确认。
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  class="text-sm text-primary-foreground font-medium px-4 border-0 rounded-lg bg-primary opacity-60 min-h-11 cursor-not-allowed"
                >
                  确认提交
                </button>
              </div>
            </template>
          </QsSalesOrderDesc>
        </div>
      </div>

      <p class="qs-type-meta text-muted-foreground m-0 mt-4" role="status">
        当前预览：{{ previewWidth === 'sidebar' ? '新增订单右侧栏宽度' : '正式订单详情页宽度' }}。窄屏响应式效果请直接缩小浏览器视口检查。
      </p>
    </div>
  </section>
</template>
