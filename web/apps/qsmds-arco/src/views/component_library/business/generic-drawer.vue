<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import GenericDrawerShowcase from './components/GenericDrawerShowcase.vue'

defineOptions({ name: 'ComponentLibraryGenericDrawer' })

const principles = [
  {
    title: '保留任务上下文',
    description: '标题、说明、状态与主操作保持稳定分区，长内容滚动时仍能快速判断当前任务。',
    icon: 'i-lucide:panel-right',
  },
  {
    title: '关闭行为可预期',
    description: '按钮、遮罩、键盘与程序关闭使用统一守卫，并在异步提交期间阻止误关闭。',
    icon: 'i-lucide:shield-check',
  },
  {
    title: '业务动作由页面决定',
    description: '组件只提供 Footer 容器与稳定状态，不内置编辑、删除、权限或请求逻辑。',
    icon: 'i-lucide:workflow',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="通用抽屉"
    description="独立验收 QsGenericDrawer 的任务分区、关闭守卫、稳定状态和响应式布局。"
    section-label="QsGenericDrawer"
    headline="聚焦处理轻量业务任务"
    summary="通用抽屉以 FaDrawer 为内核，统一标题区、内容状态与操作区；业务页面仍负责表单、数据请求、权限判断和写入副作用。"
    route-path="/component-library/business/generic-drawer"
    icon="i-lucide:panel-right-open"
    :principles="principles"
    stage-label="通用抽屉已展示"
    empty-description="通用抽屉示例尚未接入。"
  >
    <GenericDrawerShowcase />
  </ComponentCatalogPage>
</template>
