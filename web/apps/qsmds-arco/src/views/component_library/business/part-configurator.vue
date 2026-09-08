<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import PartConfiguratorShowcase from './components/PartConfiguratorShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsPartConfigurator' })
const principles = [{
  title: '数量守恒',
  description: '同一产品支持分装，多种产品支持合件，删除配置后实时退回数量。',
  icon: 'i-lucide:split',
}, {
  title: '提交前核对',
  description: '同一组件切换只读模式展示货件，唛头由正式提交流程生成。',
  icon: 'i-lucide:package-check',
}] as const
</script>

<template>
  <ComponentCatalogPage
    title="货件配置器"
    description="配置产品如何装入货件，独立验收拆分、合件、删除回退和只读核对。"
    section-label="QsPartConfigurator"
    headline="从产品数量到完整货件"
    summary="示例包含 A5 和 B3，全部操作只作用于本地会话，可直接载入 A2、A3+B3 的完整配置。"
    empty-description="货件配置器示例暂不可用。"
    route-path="/component-library/business/part-configurator"
    icon="i-lucide:package-open"
    :principles="principles"
    stage-label="货件配置器已展示"
  >
    <PartConfiguratorShowcase />
  </ComponentCatalogPage>
</template>
