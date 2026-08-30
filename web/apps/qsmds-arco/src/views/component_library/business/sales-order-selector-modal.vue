<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import SalesOrderSelectorModalShowcase from './components/SalesOrderSelectorModalShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsSalesOrderSelectorModal' })

const principles = [
  {
    title: '资格双重防线',
    description: '调用方按已确认状态查询，组件再次过滤非候选订单，避免缓存或组合数据越过业务边界。',
    icon: 'i-lucide:shield-check',
  },
  {
    title: '选择与确认分离',
    description: '单击候选项只更新选择草稿，用户显式确认后才把完整订单交还业务页面。',
    icon: 'i-lucide:mouse-pointer-click',
  },
  {
    title: '数据副作用外置',
    description: '组件发出搜索、分页、重试和确认意图，接口、权限与后续业务动作继续由调用方负责。',
    icon: 'i-lucide:workflow',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="销售订单选择弹窗"
    description="独立验收 QsSalesOrderSelectorModal 的候选资格、单选确认、稳定状态和响应式布局。"
    section-label="QsSalesOrderSelectorModal"
    headline="在业务流程中复用销售订单选择入口"
    summary="销售订单选择弹窗基于 QsGenericModal，统一搜索、候选列表、分页与显式确认；业务页面继续负责数据请求、权限判断和确认后的领域动作。"
    route-path="/component-library/business/sales-order-selector-modal"
    icon="i-lucide:list-checks"
    :principles="principles"
    stage-label="销售订单选择弹窗已展示"
    empty-description="销售订单选择弹窗示例尚未接入。"
  >
    <SalesOrderSelectorModalShowcase />
  </ComponentCatalogPage>
</template>
