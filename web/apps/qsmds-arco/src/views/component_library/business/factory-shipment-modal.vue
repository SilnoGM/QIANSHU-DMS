<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import FactoryShipmentModalShowcase from './components/FactoryShipmentModalShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsFactoryShipmentModal' })

const principles = [
  {
    title: '范围先于动作',
    description: '销售订单发货必须明确本次涉及的采购单，避免把部分到货误判为整单完成。',
    icon: 'i-lucide:list-checks',
  },
  {
    title: '影响即时可见',
    description: '提交前汇总本次发货数、剩余待发货数和销售履约状态的预计变化。',
    icon: 'i-lucide:route',
  },
  {
    title: '业务副作用外置',
    description: '组件只输出发货意图，权限、请求、冲突恢复和列表刷新由所属业务页面处理。',
    icon: 'i-lucide:shield-check',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="订单工厂发货弹窗"
    description="独立验收销售订单聚合发货与采购订单单单发货的范围选择、影响预览和异常状态。"
    section-label="QsFactoryShipmentModal"
    headline="确认真实发货范围后再推进履约"
    summary="公共弹窗复用 QsGenericModal，通过两种模式覆盖销售待办与采购待办；组件保持纯展示和事件输出，不读取业务 API。"
    route-path="/component-library/business/factory-shipment-modal"
    icon="i-lucide:truck"
    :principles="principles"
    stage-label="发货弹窗已展示"
    empty-description="订单工厂发货弹窗示例尚未接入。"
  >
    <FactoryShipmentModalShowcase />
  </ComponentCatalogPage>
</template>
