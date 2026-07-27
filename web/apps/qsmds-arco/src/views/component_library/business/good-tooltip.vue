<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import GoodTooltipShowcase from './components/GoodTooltipShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsGoodTooltip' })

const principles = [
  {
    title: '沿用统一浮层内核',
    description: '继续复用 FaTooltip 的 Portal、方向避让、键盘描述和关闭行为，不建立第二套浮层系统。',
    icon: 'i-lucide:layers-2',
  },
  {
    title: '信息结构由业务决定',
    description: '组件只固定左图右文框架，名称、SPU、SKU、规格和状态由 content 插槽按页面语境组合。',
    icon: 'i-lucide:braces',
  },
  {
    title: '提示保持只读',
    description: 'Tooltip 仅承载补充说明，不放操作、输入或选择控件；复杂任务交互应使用 Popover 等容器。',
    icon: 'i-lucide:badge-info',
  },
  {
    title: '内容层可以复用',
    description: '已有 Tooltip 宿主时复用 QsGoodTooltipContent；只有完整包装时才使用 QsGoodTooltip。',
    icon: 'i-lucide:split',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="产品提示"
    description="独立验收 QsGoodTooltip 的产品图、信息插槽、失败占位、禁用状态和输入方式边界。"
    section-label="QsGoodTooltip"
    headline="在不离开当前任务时辨认产品"
    summary="产品提示以 FaTooltip 为内核，统一轻量的左图右文结构；调用方决定 SPU、SKU 与规格字段，不把领域数据模型固化进组件。"
    route-path="/component-library/business/good-tooltip"
    icon="i-lucide:package-search"
    :principles="principles"
    stage-label="产品提示组件已展示"
    empty-description="产品提示组件示例尚未接入。"
  >
    <GoodTooltipShowcase />
  </ComponentCatalogPage>
</template>
