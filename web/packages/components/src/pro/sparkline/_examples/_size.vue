<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaSparkline from '../index.vue'

const value = [1, 5, 2, 4, 8, 3, 7]
</script>

<template>
  <FaSparkline :value="value" :width="160" :height="48" />
</template>
