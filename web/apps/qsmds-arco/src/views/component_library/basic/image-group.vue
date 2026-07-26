<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import ImageGroupShowcase from './components/ImageGroupShowcase.vue'

defineOptions({ name: 'ComponentLibraryImageGroup' })

const principles = [
  {
    title: '缩略图只承担识别',
    description: '表格内保持稳定尺寸与紧凑堆叠，详细查看交给既有整组预览器。',
    icon: 'i-lucide:scan-search',
  },
  {
    title: '圆角保持受控',
    description: '优先使用项目预设，也允许传入非负像素值，并统一作用于全部图片状态。',
    icon: 'i-lucide:badge',
  },
  {
    title: '每张图片独立提示',
    description: 'FaTooltip 始终对应当前缩略图，键盘聚焦与鼠标 hover 获得相同信息。',
    icon: 'i-lucide:message-square-text',
  },
  {
    title: '领域结构留在页面',
    description: '组件只接收 ImageGroupItem；产品、SKU 和附件字段由调用方显式映射。',
    icon: 'i-lucide:split',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="图片组"
    description="独立验收 ImageGroup 的单图、多图堆叠、圆角、Tooltip、整组预览和失败边界。"
    section-label="ImageGroup"
    headline="让产品图片在表格里保持清晰而克制"
    summary="图片组使用稳定尺寸、背景分隔环和受控重叠，在不撑大列宽的前提下保留每张图片的辨识度。hover 查看当前图，点击进入整组预览。"
    route-path="/component-library/basic/image-group"
    icon="i-lucide:images"
    :principles="principles"
    stage-label="图片组组件已展示"
    empty-description="图片组组件示例尚未接入。"
  >
    <ImageGroupShowcase />
  </ComponentCatalogPage>
</template>
