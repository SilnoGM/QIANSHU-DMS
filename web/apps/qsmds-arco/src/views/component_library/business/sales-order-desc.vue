<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import SalesOrderDescShowcase from './components/SalesOrderDescShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsSalesOrderDesc' })

const principles = [
  {
    title: '中立只读模型',
    description: '创建表单与正式详情 DTO 都在页面边界映射，组件不读取 API、Store、权限或路由。',
    icon: 'i-lucide:braces',
  },
  {
    title: '金额层级明确',
    description: '产品小计、销售总价、约定定金与约定尾款保持稳定顺序，并通过标签与排版共同强调。',
    icon: 'i-lucide:badge-dollar-sign',
  },
  {
    title: '附件生命周期外置',
    description: '组件只消费缩略图与预览地址；上传、Object URL 回收和文件写入继续由业务页面负责。',
    icon: 'i-lucide:paperclip',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="销售订单详情"
    description="独立验收 QsSalesOrderDesc 的业务区块、金额强调、附件缩略图和响应式宽度。"
    section-label="QsSalesOrderDesc"
    headline="统一新增预览与正式订单详情"
    summary="销售订单详情按照基础信息、客户、产品与小计、销售信息和附件的稳定顺序展示；调用方提供中立 ViewModel，组件不承担计算、校验或提交。"
    route-path="/component-library/business/sales-order-desc"
    icon="i-lucide:receipt-text"
    :principles="principles"
    stage-label="销售订单详情已展示"
    empty-description="销售订单详情示例尚未接入。"
  >
    <SalesOrderDescShowcase />
  </ComponentCatalogPage>
</template>
