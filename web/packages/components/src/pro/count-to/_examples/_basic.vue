<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaCountTo from '../index.vue'
</script>

<template>
  <FaCountTo :start-val="0" :end-val="100000" />
</template>
