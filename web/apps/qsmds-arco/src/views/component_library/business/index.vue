<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import GenericTableShowcase from './components/GenericTableShowcase.vue'

defineOptions({ name: 'ComponentLibraryBusiness' })

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
    title="业务组件"
    description="集中验收带有领域语义、但能够跨业务页面复用的交互组件。"
    section-label="领域交互"
    headline="让业务语义清晰，让数据副作用可控"
    summary="业务组件可以封装稳定的领域交互，但服务端仍是权限和数据正确性的最终边界。示例页只展示状态与事件，不承担正式业务流程。"
    route-path="/component-library/business"
    icon="i-lucide:workflow"
    :principles="principles"
    stage-label="首个组件已展示"
    empty-description="后续仅在出现真实跨页面复用需求时增加业务组件，避免为假设场景提前抽象。"
  >
    <GenericTableShowcase />
  </ComponentCatalogPage>
</template>
