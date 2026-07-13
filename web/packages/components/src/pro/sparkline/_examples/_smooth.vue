<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaSparkline from '../index.vue'

const value = [1, 8, 2, 9, 4, 7, 5]
</script>

<template>
  <FaSparkline :value="value" smooth />
</template>
