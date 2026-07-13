<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextHighlight from '../index.vue'
</script>

<template>
  <h1 class="text-4xl font-bold text-balance">
    圆角是<FaTextHighlight class="rounded-lg from-purple-300 to-orange-300 bg-gradient-to-r">
      最好
    </FaTextHighlight>的。
  </h1>
</template>
