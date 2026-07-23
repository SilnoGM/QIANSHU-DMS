<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import GenericTableShowcase from './components/GenericTableShowcase.vue'

defineOptions({ name: 'ComponentLibraryGenericTable' })

const principles = [
  {
    title: '保留领域语义',
    description: '组件可以理解千树 DMS 的稳定领域类型，但不能把示例数据或调试状态写进正式实现。',
    icon: 'i-lucide:workflow',
  },
  {
    title: '隔离数据副作用',
    description: '数据读取和写入优先交给页面或领域 composable，示例默认不得修改真实业务数据。',
    icon: 'i-lucide:shield-check',
  },
  {
    title: '明确失败传播',
    description: '涉及异步流程时，需要定义加载、错误、重试、取消和身份切换后的稳定行为。',
    icon: 'i-lucide:route',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="通用表格"
    description="独立验收 QsGenericTable 的查询状态、操作列、汇总和响应式展示。"
    section-label="QsGenericTable"
    headline="统一数据浏览与行级操作"
    summary="通用表格组合搜索、筛选、排序、分页、列设置、汇总和移动卡片；页面仍负责数据请求、权限判断和所有写入副作用。"
    route-path="/component-library/business/generic-table"
    icon="i-lucide:table-2"
    :principles="principles"
    stage-label="通用表格已展示"
    empty-description="通用表格示例尚未接入。"
  >
    <GenericTableShowcase />
  </ComponentCatalogPage>
</template>
