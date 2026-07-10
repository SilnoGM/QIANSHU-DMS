<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaScrollingText from '../index.vue'
</script>

<template>
  <FaScrollingText
    :items="[
      'Fantastic-admin v6 正式发布，欢迎体验新特性！',
      '框架已支持 Vue 3.6 + Vite 8，性能大幅提升',
      '新增 30+ 内建 UI 组件，开箱即用',
      '支持亮色/暗色主题，一键切换',
    ]"
    class="text-sm flex-1 h-6"
  />
</template>
