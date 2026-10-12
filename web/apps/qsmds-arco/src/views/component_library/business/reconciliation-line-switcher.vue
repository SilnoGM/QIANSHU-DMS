<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import ReconciliationLineSwitcherShowcase from './components/ReconciliationLineSwitcherShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsReconciliationLineSwitcher' })

const principles = [
  {
    title: '状态色由调用方定义',
    description: '组件不认识「未核对 / 已核对」：状态取值经 items.status 传入，语义色经 statusTones 传入，未登记状态回落中性灰。',
    icon: 'i-lucide:list-filter',
  },
  {
    title: '受控选中，内部形态',
    description: '选中行由页面通过 v-model 持有，可驱动对照面板或深链；折叠与展开只是组件内部视图状态，切换不改变选中值。',
    icon: 'i-lucide:mouse-pointer-click',
  },
  {
    title: '边界明确',
    description: '到首尾即禁用不循环，条带贴边铺满不补空槽位；少于槽位数只显示实际项；空数组给出空态并禁用全部操作。',
    icon: 'i-lucide:accessibility',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="对账明细行切换"
    description="独立验收 QsReconciliationLineSwitcher 的受控选中、两种形态、首尾禁用与状态色映射。"
    section-label="QsReconciliationLineSwitcher"
    headline="按顺序逐条核对明细行"
    summary="折叠条带聚焦当前行并放大选中项，展开形态纵览全部行；组件只表达选中了哪一行，核对结果、请求与权限仍由页面负责。"
    route-path="/component-library/business/reconciliation-line-switcher"
    icon="i-lucide:gallery-horizontal-end"
    :principles="principles"
    stage-label="明细行切换已展示"
    empty-description="对账明细行切换示例尚未接入。"
  >
    <ReconciliationLineSwitcherShowcase />
  </ComponentCatalogPage>
</template>
