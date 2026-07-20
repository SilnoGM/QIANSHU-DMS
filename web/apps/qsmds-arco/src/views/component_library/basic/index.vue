<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'

defineOptions({ name: 'ComponentLibraryBasic' })

const principles = [
  {
    title: '保持低业务耦合',
    description: '通过 props、emits 和 slots 表达稳定接口，不读取业务 Store，也不直接调用领域 API。',
    icon: 'i-lucide:unplug',
  },
  {
    title: '覆盖完整状态',
    description: '组件进入正式页面前，需要检查默认、空值、加载、禁用、只读和错误边界。',
    icon: 'i-lucide:list-checks',
  },
  {
    title: '适配真实布局',
    description: '同时验证桌面与窄屏环境，优先使用现有主题 token 和 Fantastic-admin 能力。',
    icon: 'i-lucide:panels-top-left',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="基础组件"
    description="沉淀可由多个业务页面直接复用的低耦合界面能力。"
    section-label="基础能力"
    headline="先稳定组件接口，再进入业务页面"
    summary="本分类只接收具备清晰输入输出、完整状态和真实复用价值的组件。Arco Design Vue 与 Fantastic-admin 已有能力继续查阅现有手册，不在这里重复建设。"
    route-path="/component-library/basic"
    icon="i-lucide:shapes"
    :principles="principles"
    empty-description="阶段三将选择一个真实基础组件，完成测试、实现、状态示例和业务页面复用闭环。"
  />
</template>
