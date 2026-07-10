<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaSparkline from '../index.vue'

const value = [
  { tooltip: '1', value: 1 },
  { tooltip: '3', value: 3 },
  { tooltip: '5', value: 5 },
  { tooltip: '8', value: 8 },
  { tooltip: '4', value: 4 },
  { tooltip: '6', value: 6 },
  { tooltip: '9', value: 9 },
]
</script>

<template>
  <FaSparkline :value="value" tooltip />
</template>
