<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import SalesOrderAddOnProductsModalShowcase from './components/SalesOrderAddOnProductsModalShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsSalesOrderAddOnProductsModal' })

const principles = [{
  title: '只追加不改历史',
  description: '原销售产品保持只读，本次编辑区只产生新的独立销售明细。',
  icon: 'i-lucide:shield-check',
}, {
  title: '金额精确预览',
  description: '新增小计、约定总价和尾款使用定点金额计算，定金保持不变。',
  icon: 'i-lucide:calculator',
}, {
  title: '副作用外置',
  description: '组件只发出规范化确认意图，API 写入和采购同步由业务页面编排。',
  icon: 'i-lucide:workflow',
}] as const
</script>

<template>
  <ComponentCatalogPage
    title="销售订单加购产品弹窗"
    description="独立验收 QsSalesOrderAddOnProductsModal 的只追加编辑、金额变化和二次确认。"
    section-label="QsSalesOrderAddOnProductsModal"
    headline="海运前追加销售产品并同步采购"
    summary="弹窗基于 QsGenericModal 和 QsOrderProductLineEditor，原销售明细只读，本次新增产品经过二次确认后才交给业务页面保存。"
    route-path="/component-library/business/sales-order-add-on-products-modal"
    icon="i-lucide:package-plus"
    :principles="principles"
    stage-label="销售订单加购产品弹窗已展示"
    empty-description="销售订单加购产品弹窗示例尚未接入。"
  >
    <SalesOrderAddOnProductsModalShowcase />
  </ComponentCatalogPage>
</template>
