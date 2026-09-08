<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import SalesOrderProductsEditorModalShowcase from './components/SalesOrderProductsEditorModalShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsSalesOrderProductsEditorModal' })

const principles = [{
  title: '采购事实受保护',
  description: '已存在有效采购单的产品只能增加数量，未采购产品才可减少或移除。',
  icon: 'i-lucide:shield-check',
}, {
  title: '金额原子预览',
  description: '统一展示产品差额、新总价、定金与尾款变化，最终仍由服务端重算。',
  icon: 'i-lucide:calculator',
}, {
  title: '副作用外置',
  description: '组件只发出规范化修改意图，API 写入与成功刷新由业务页面编排。',
  icon: 'i-lucide:workflow',
}] as const
</script>

<template>
  <ComponentCatalogPage
    title="销售订单产品修改弹窗"
    description="独立验收 QsSalesOrderProductsEditorModal 的增减约束、金额变化和定金下调确认。"
    section-label="QsSalesOrderProductsEditorModal"
    headline="海运前安全修改销售产品"
    summary="弹窗基于 QsGenericModal 和 QsOrderProductLineEditor，既有行只调整数量，新增产品与全部金额变化在保存前统一复核。"
    route-path="/component-library/business/sales-order-products-editor-modal"
    icon="i-lucide:list-restart"
    :principles="principles"
    stage-label="销售订单产品修改弹窗已展示"
    empty-description="销售订单产品修改弹窗示例尚未接入。"
  >
    <SalesOrderProductsEditorModalShowcase />
  </ComponentCatalogPage>
</template>
