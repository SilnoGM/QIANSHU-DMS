<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import PersonDisplayShowcase from './components/PersonDisplayShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsPersonDisplay' })

const principles = [
  {
    title: '稳定展示降级',
    description: '头像缺失或加载失败时使用名称首字符；名称缺失时统一显示“未知人员”。',
    icon: 'i-lucide:user-round-check',
  },
  {
    title: '适配高密度界面',
    description: '三档尺寸覆盖表格、表单和详情场景，名称受限时保持单行截断。',
    icon: 'i-lucide:panel-top-dashed',
  },
  {
    title: '纯展示职责',
    description: '组件不读取 API、Store 或人员主数据，也不内置点击、跳转与业务操作。',
    icon: 'i-lucide:scan-eye',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="人员显示"
    description="独立验收 QsPersonDisplay 的头像回退、名称截断、完整名称提示和三档尺寸。"
    section-label="QsPersonDisplay"
    headline="统一展示头像与人员名称"
    summary="为订单出单人、负责人和创建人等字段提供稳定的人员展示语义；调用方只需传入显示名称与可选头像地址。"
    route-path="/component-library/business/person-display"
    icon="i-lucide:user-round"
    :principles="principles"
    stage-label="人员组件已展示"
    empty-description="人员显示示例尚未接入。"
  >
    <PersonDisplayShowcase />
  </ComponentCatalogPage>
</template>
