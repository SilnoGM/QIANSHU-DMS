<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import PurchaseOrderDescShowcase from './components/PurchaseOrderDescShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsPurchaseOrderDesc' })

const principles = [
  {
    title: '中立只读模型',
    description: '创建草稿与正式详情 DTO 均在页面边界映射，组件不读取 API、Store、权限或路由。',
    icon: 'i-lucide:braces',
  },
  {
    title: '采购价格清晰',
    description: '产品行只展示真实采购价、数量与小计，视觉层级与销售订单详情保持一致。',
    icon: 'i-lucide:badge-dollar-sign',
  },
  {
    title: '领域操作外置',
    description: '付款流水、凭证管理、履约推进和订单取消继续由正式详情抽屉负责。',
    icon: 'i-lucide:workflow',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="采购订单详情"
    description="独立验收 QsPurchaseOrderDesc 的采购来源、真实采购价、金额、状态和响应式宽度。"
    section-label="QsPurchaseOrderDesc"
    headline="统一采购创建核对与正式详情"
    summary="采购订单详情按基础信息、供应商与销售来源、产品与小计、采购金额和唛头备注的稳定顺序展示；调用方提供中立 ViewModel。"
    route-path="/component-library/business/purchase-order-desc"
    icon="i-lucide:shopping-basket"
    :principles="principles"
    stage-label="采购订单详情已展示"
    empty-description="采购订单详情示例尚未接入。"
  >
    <PurchaseOrderDescShowcase />
  </ComponentCatalogPage>
</template>
