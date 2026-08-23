<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import OrderProductLineEditorShowcase from './components/OrderProductLineEditorShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsOrderProductLineEditor' })

const principles = [{
  title: '业务中立',
  description: '表格通过标签和 loader 适配销售或采购语义，不持久化订单。',
  icon: 'i-lucide:workflow',
}, {
  title: '原子变更',
  description: '选择器确认结果经过再次校验后一次写入，拒绝重复行和部分应用。',
  icon: 'i-lucide:shield-check',
}] as const
</script>

<template>
  <ComponentCatalogPage
    title="订单产品明细编辑器"
    description="独立验收数据库/临时产品、横向表格、Tooltip、行小计与双汇总。"
    section-label="QsOrderProductLineEditor"
    headline="一行一个产品，完整保留业务列"
    summary="示例同时包含长产品名、长备注、数据库产品和临时产品；全部数据只存在于本地会话。"
    empty-description="订单产品明细编辑器示例暂不可用。"
    route-path="/component-library/business/order-product-line-editor"
    icon="i-lucide:table-properties"
    :principles="principles"
    stage-label="订单产品明细编辑器已展示"
  >
    <OrderProductLineEditorShowcase />
  </ComponentCatalogPage>
</template>
