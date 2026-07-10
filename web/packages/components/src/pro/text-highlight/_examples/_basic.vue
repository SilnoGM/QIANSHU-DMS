<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextHighlight from '../index.vue'
</script>

<template>
  <h1 class="text-4xl font-bold text-balance">
    李云龙：你<FaTextHighlight class="from-indigo-300 to-purple-300 bg-gradient-to-r">
      他娘的
    </FaTextHighlight>还真是个天才！
  </h1>
</template>
