<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import GenericModalShowcase from './components/GenericModalShowcase.vue'

defineOptions({ name: 'ComponentLibraryGenericModal' })

const principles = [
  {
    title: '聚焦单一决策',
    description: '标题、说明、正文状态与操作区形成稳定层级，避免短任务被页面上下文干扰。',
    icon: 'i-lucide:focus',
  },
  {
    title: '关闭行为可预期',
    description: '按钮、遮罩、键盘与程序关闭使用统一守卫，提交期间阻止重复操作与误关闭。',
    icon: 'i-lucide:shield-check',
  },
  {
    title: '业务动作由页面决定',
    description: '组件只提供 Footer 容器和稳定状态，不内置确认、保存、删除、权限或请求逻辑。',
    icon: 'i-lucide:workflow',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="通用模态框"
    description="独立验收 QsGenericModal 的任务分区、关闭守卫、稳定状态和响应式布局。"
    section-label="QsGenericModal"
    headline="在当前页面完成聚焦任务"
    summary="通用模态框以加固后的 FaModal 为内核，统一标题区、内容状态、操作区与关闭生命周期；业务页面仍负责表单、数据请求、权限判断和写入副作用。"
    route-path="/component-library/business/generic-modal"
    icon="i-lucide:panels-top-left"
    :principles="principles"
    stage-label="通用模态框已展示"
    empty-description="通用模态框示例尚未接入。"
  >
    <GenericModalShowcase />
  </ComponentCatalogPage>
</template>
