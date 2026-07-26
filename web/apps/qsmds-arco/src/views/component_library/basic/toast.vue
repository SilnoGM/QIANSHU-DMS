<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import QsToastShowcase from './components/QsToastShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsToast' })

const principles = [
  {
    title: '底层能力只复用一次',
    description: 'FaToast 继续负责队列、计时、堆叠、手势和安全区；QsToast 只接管项目视觉与受控 API。',
    icon: 'i-lucide:layers-3',
  },
  {
    title: '状态色保持克制',
    description: '浮层始终使用中性表面，状态颜色只出现在左侧细线、状态岛和专业图标。',
    icon: 'i-lucide:blend',
  },
  {
    title: '失败必须可感知',
    description: '错误使用 alert 语义，普通反馈使用 status；永久提示始终提供明确关闭入口。',
    icon: 'i-lucide:badge-alert',
  },
  {
    title: '业务调用保持受控',
    description: '调用方只能提供文案、说明、时长和动作，不能注入任意样式或替换内部组件。',
    icon: 'i-lucide:shield-check',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="轻提示"
    description="独立验收 QsToast 的状态反馈、操作按钮、加载流程、Promise 编排和无障碍语义。"
    section-label="QsToast"
    headline="短暂出现，但每个状态都有明确分量"
    summary="轻提示采用中性浮层与局部语义色，在不打断当前任务的前提下提供可靠反馈。项目 API 保持精简，底层继续复用 FaToast 已验证的全局队列能力。"
    route-path="/component-library/basic/toast"
    icon="i-lucide:message-circle-more"
    :principles="principles"
    stage-label="轻提示组件已展示"
    empty-description="轻提示组件示例尚未接入。"
  >
    <QsToastShowcase />
  </ComponentCatalogPage>
</template>
