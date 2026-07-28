<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import RegionSelectorShowcase from './components/RegionSelectorShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsRegionSelector' })

const principles = [
  {
    title: '只提交城市 ID',
    description: '公共 value 始终是 CITY UUID 或 null，完整路径只用于显示和用户 change 事件。',
    icon: 'i-lucide:map-pin-check',
  },
  {
    title: '按需读取三级地区',
    description: '根、省州和城市逐级加载，已有城市仅解析一条路径，不在表单挂载时下载全量树。',
    icon: 'i-lucide:route',
  },
  {
    title: '隔离业务与数据副作用',
    description: '组件处理选择体验；调用页面仍负责字段校验、业务保存、权限和领域映射。',
    icon: 'i-lucide:shield-check',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="地区选择器"
    description="独立验收 QsRegionSelector 的三级按需加载、完整路径、历史回显、错误重试和表单语义。"
    section-label="QsRegionSelector"
    headline="统一国家、地区与城市选择"
    summary="地区选择器只向业务表单提交稳定的 CITY UUID；展示工作台的标准状态直接读取数据库，停用与失败边界使用隔离 fixture。"
    route-path="/component-library/business/region-selector"
    icon="i-lucide:map-pinned"
    :principles="principles"
    stage-label="地区选择器已展示"
    empty-description="地区选择器示例尚未接入。"
  >
    <RegionSelectorShowcase />
  </ComponentCatalogPage>
</template>
