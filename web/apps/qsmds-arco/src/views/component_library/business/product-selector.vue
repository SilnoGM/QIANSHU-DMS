<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import ProductSelectorShowcase from './components/ProductSelectorShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsProductSelector' })

const principles = [{
  title: '固定币种',
  description: '候选页只展示调用方给定币种的产品与标准价，不提供币种切换。',
  icon: 'i-lucide:badge-dollar-sign',
}, {
  title: '会话暂存',
  description: '新增与数量 +1 先进入右侧清单，最终确认才交给明细编辑器。',
  icon: 'i-lucide:list-checks',
}] as const
</script>

<template>
  <ComponentCatalogPage
    title="产品选择器"
    description="独立验收产品检索、供应商筛选、滚动分页、已有明细和待处理清单。"
    section-label="QsProductSelector"
    headline="先筛选，再一次确认"
    summary="组件由调用方注入分页 loader；示例使用本地内存 Provider 和产品页，不读取真实业务数据。"
    empty-description="产品选择器示例暂不可用。"
    route-path="/component-library/business/product-selector"
    icon="i-lucide:package-search"
    :principles="principles"
    stage-label="产品选择器已展示"
  >
    <ProductSelectorShowcase />
  </ComponentCatalogPage>
</template>
