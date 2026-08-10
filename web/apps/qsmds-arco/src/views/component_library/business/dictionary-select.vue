<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import DictionarySelectShowcase from './components/DictionarySelectShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsDictionarySelect' })

const principles = [
  {
    title: '稳定 value 驱动',
    description: '业务模型只保存字典 value；Label、停用与未知说明均来自当前可信 Catalog。',
    icon: 'i-lucide:badge-check',
  },
  {
    title: '失败时关闭新选择',
    description: '加载、缺失、错误与无效配置不回退旧候选，历史 raw 仍可安全回显和提交。',
    icon: 'i-lucide:shield-alert',
  },
  {
    title: '表单语义独立承载',
    description: '真实搜索 input 负责交互，隐藏代理分别负责精确 FormData 与原生 required。',
    icon: 'i-lucide:form-input',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="字典选择器"
    description="独立验收 QsDictionarySelect 的目录加载、历史值、搜索、错误重试和表单语义。"
    section-label="QsDictionarySelect"
    headline="统一业务字典单选体验"
    summary="字典选择器只消费中立 Catalog Provider，以稳定 value 完成搜索、选择和历史回显；业务页面继续负责字段规则和 Server 保存校验。"
    route-path="/component-library/business/dictionary-select"
    icon="i-lucide:list-filter"
    :principles="principles"
    stage-label="字典选择器已展示"
    empty-description="字典选择器示例尚未接入。"
  >
    <DictionarySelectShowcase />
  </ComponentCatalogPage>
</template>
