<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import StatusSwitchToolbarShowcase from './components/StatusSwitchToolbarShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsStatusSwitchToolbar' })

const principles = [
  {
    title: '单一受控状态',
    description: '通过 v-model 接收当前状态，筛选请求、路由同步和默认值均由业务页面决定。',
    icon: 'i-lucide:mouse-pointer-click',
  },
  {
    title: '自动处理溢出',
    description: '状态项超出可用宽度时自动出现浏览入口，完整工具栏无需换行或压缩文字。',
    icon: 'i-lucide:move-horizontal',
  },
  {
    title: '完整交互语义',
    description: '原生按钮支持键盘、禁用和选中语义，并尊重系统减少动态效果设置。',
    icon: 'i-lucide:accessibility',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="状态切换工具栏"
    description="独立验收 QsStatusSwitchToolbar 的受控切换、状态计数、禁用项和横向溢出浏览。"
    section-label="QsStatusSwitchToolbar"
    headline="在页头与表格之间快速切换状态"
    summary="为待办订单、全部订单等高频状态视图提供统一工具栏；组件只表达选择，不耦合任何业务查询。"
    route-path="/component-library/business/status-switch-toolbar"
    icon="i-lucide:list-filter"
    :principles="principles"
    stage-label="状态工具栏已展示"
    empty-description="状态切换工具栏示例尚未接入。"
  >
    <StatusSwitchToolbarShowcase />
  </ComponentCatalogPage>
</template>
