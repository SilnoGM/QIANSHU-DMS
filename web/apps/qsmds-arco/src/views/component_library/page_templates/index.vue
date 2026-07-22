<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'

defineOptions({ name: 'ComponentLibraryPageTemplates' })

const principles = [
  {
    title: '表达页面模式',
    description: '模板用于展示列表、详情和表单等组合方式，不定义新的领域数据结构。',
    icon: 'i-lucide:layout-template',
  },
  {
    title: '优先提取复用点',
    description: '出现稳定重复结构时先提取组件，再由模板和正式业务页面共同消费。',
    icon: 'i-lucide:blocks',
  },
  {
    title: '保持响应式边界',
    description: '窄屏数据页面优先使用卡片或 Drawer，不把横向滚动桌面表格作为默认方案。',
    icon: 'i-lucide:smartphone',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="页面模板"
    description="验证常用业务页面的布局、层级和响应式组合方式。"
    section-label="页面模式"
    headline="沉淀组合方法，而不是复制完整页面"
    summary="页面模板是实现参考，不是正式页面的数据或接口真相源。实际业务页面继续依据 OpenAPI 契约、权限和真实流程落地。"
    route-path="/component-library/page-templates"
    icon="i-lucide:panels-top-left"
    :principles="principles"
    empty-description="页面模式将在真实业务场景形成后逐步加入，并优先复用已经验收的基础组件与业务组件。"
  />
</template>
