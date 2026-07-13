<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextHighlight from '../index.vue'
</script>

<template>
  <h1 class="text-4xl font-bold text-balance">
    使用系统主题色，你可以尝试<FaTextHighlight class="from-primary to-accent bg-gradient-to-r">
      更改系统主题色
    </FaTextHighlight>。
  </h1>
</template>
