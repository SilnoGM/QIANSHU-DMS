<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextHighlight from '../index.vue'
</script>

<template>
  <h1 class="text-4xl font-bold">
    这段文字<FaTextHighlight
      class="rounded-xl from-green-300 to-blue-300 bg-gradient-to-r"
      text-end-color="oklch(var(--accent))"
    >
      会随着文本颜色变化
    </FaTextHighlight>，不信你看。
  </h1>
</template>
